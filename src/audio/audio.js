// audio/audio.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { SFX_ALIASES, SFX_RECIPES, bakeSfxBuffer, createSfxBaker } from './library.js';

import { noop } from '../core/fallbacks.js';

import {
  SCRATCH_EULER,
  SCRATCH_POSITION,
  SCRATCH_ROTATION,
  SCRATCH_SCALE,
  SCRATCH_TRS_MATRIX,
  TEMP_EULER_C,
  TEMP_POS_C,
  TEMP_QUAT_C,
  TEMP_SCALE_C,
} from '../core/geometry.js';

import { clamp01 } from '../core/math.js';

import { Pv, pi } from '../misc.js';

/**
 * 就地把几何体平移+绕欧拉角旋转（r 缺省则只平移），是道具装配里最热的调用，因此复用临时对象
 */
export function applyTransform(
  object,
  { p: positionArr = [0, 0, 0], r: rotationArr = [0, 0, 0], s: scaleVal = 1 } = {},
) {
  return (
    SCRATCH_EULER.set(rotationArr[0], rotationArr[1], rotationArr[2]),
    SCRATCH_ROTATION.setFromEuler(SCRATCH_EULER),
    SCRATCH_POSITION.set(positionArr[0], positionArr[1], positionArr[2]),
    typeof scaleVal == 'number'
      ? SCRATCH_SCALE.set(scaleVal, scaleVal, scaleVal)
      : SCRATCH_SCALE.set(scaleVal[0], scaleVal[1], scaleVal[2]),
    SCRATCH_TRS_MATRIX.compose(SCRATCH_POSITION, SCRATCH_ROTATION, SCRATCH_SCALE),
    object.applyMatrix4(SCRATCH_TRS_MATRIX),
    object
  );
}

/**
 * 在区间内做 smoothstep 插值，用于音乐各层按战斗强度分段渐入而不出现台阶。
 */
export var smoothstepRange = (edge0, edge1, x) => {
  let n = clamp01((x - edge0) / (edge1 - edge0));
  return n * n * (3 - 2 * n);
};

/**
 * 把数值夹到 [min,max]；引擎里所有来自事件的增益、音高、强度都先过它，防止外部数据把声音推到失控值。
 */
export var clampValue = (i, e, t) => Math.min(t, Math.max(e, i));

/**
 * 由 {p,r,s} 描述合成矩阵：装配器 push() 的变换 DSL，让道具代码写成「位移+旋转+缩放」三元组
 */
export function composePropTransform({
  p: posArr = [0, 0, 0],
  r: rotArr = [0, 0, 0],
  s: scaleVal = 1,
} = {}) {
  return (
    TEMP_EULER_C.set(rotArr[0], rotArr[1], rotArr[2]),
    TEMP_QUAT_C.setFromEuler(TEMP_EULER_C),
    TEMP_POS_C.set(posArr[0], posArr[1], posArr[2]),
    typeof scaleVal == 'number'
      ? TEMP_SCALE_C.set(scaleVal, scaleVal, scaleVal)
      : TEMP_SCALE_C.set(scaleVal[0], scaleVal[1], scaleVal[2]),
    new THREE.Matrix4().compose(TEMP_POS_C, TEMP_QUAT_C, TEMP_SCALE_C)
  );
}

/**
 * 按道具朝向把方体投影成轴对齐碰撞盒（旋转时收缩到投影包络），避免旋转物件碰撞体过大或穿模
 */
export function addFootprintCollider(
  ctx,
  posX,
  posZ,
  yaw,
  width,
  depth,
  height,
  surface = 'metal',
  baseY = 0,
) {
  let cosYaw = Math.abs(Math.cos(yaw)),
    sinYaw = Math.abs(Math.sin(yaw)),
    shrink = Math.abs(Math.sin(2 * yaw)) > 0.2 ? 0.9 : 1,
    halfX = ((width * cosYaw + depth * sinYaw) / 2) * shrink,
    halfZ = ((width * sinYaw + depth * cosYaw) / 2) * shrink;
  ctx.col(posX - halfX, baseY, posZ - halfZ, posX + halfX, baseY + height, posZ + halfZ, surface);
}

/**
 * 命中材质到弹着音效名的映射（泥土、橡胶做近似归并），未知材质回落到混凝土。
 */
var SURFACE_IMPACT_SFX = {
  metal: 'impact_metal',
  concrete: 'impact_concrete',
  wood: 'impact_wood',
  water: 'impact_water',
  glass: 'impact_glass',
  dirt: 'impact_concrete',
  rubber: 'impact_wood',
};

/**
 * 地面材质到脚步音效名的映射，只有金属与水面走专用音色，其余归到混凝土以控制变体数量。
 */
var SURFACE_STEP_SFX = {
  metal: 'step_metal',
  water: 'step_water',
  concrete: 'step_concrete',
  wood: 'step_concrete',
  dirt: 'step_concrete',
  glass: 'step_concrete',
  rubber: 'step_concrete',
};

/**
 * 必须立即发声的关键音效集合：若缓冲尚未烘焙完成就先登记回调并在 2.5 秒内补播，避免高潮时刻静音。
 */
var LATE_RETRY_SFX = new Set([
  'thunder',
  'foghorn',
  'objective',
  'objective_all',
  'complete',
  'death',
  'explosion',
  'rifle_tail_in',
  'gull_die',
  'hound_die',
  'relay_cut',
  'container_bang',
  'ear_ring',
]);

/**
 * 启动烘焙顺序表：关键与高频音效排在前面先出，次要音效靠空闲时间切片补齐。
 */
var BAKE_ORDER = [
  'ir_outdoor',
  'ir_shed',
  'rain',
  'whiz',
  'reload_magout',
  'reload_magin',
  'reload_bolt',
  'shell_bounce',
  'impact_concrete',
  'impact_metal',
  'land',
  'jump',
  'hurt',
  'music_drone',
  'wind',
  'music_motif',
  'impact_enemy',
  'impact_wood',
  'impact_water',
  'impact_glass',
  'ricochet',
  'gull_rotor',
  'hound_servo',
  'alert',
  'telegraph',
  'gull_fire',
  'hound_fire',
  'hound_step',
  'ui_click',
  'ui_hover',
  'sea',
  'rain_interior',
  'relay_hum',
  'gull_die',
  'hound_die',
  'explosion',
  'ear_ring',
  'death',
  'music_ost',
  'music_perc',
  'music_brass',
  'relay_cut',
  'objective',
  'thunder',
  'objective_all',
  'complete',
  'gull_cry',
  'halyard',
  'foghorn',
  'container_bang',
];

/**
 * 音乐层固定顺序（drone/ost/perc/brass/motif），与 musicMix 返回的增益数组按位置一一对应。
 */
var MUSIC_LAYERS = ['music_drone', 'music_ost', 'music_perc', 'music_brass', 'music_motif'];

/**
 * WebAudio 不可用（或被策略禁用）时的哑引擎：接口齐全但全部空实现，使上层游戏逻辑无需判断音频是否存在。
 */
function createSilentAudioEngine() {
  let noop = () => {},
    soundHandle = {
      setPos: noop,
      setGain: noop,
      setPitch: noop,
      stop: noop,
    };
  return {
    silent: !0,
    update: noop,
    resume: noop,
    play: noop,
    loop: () => soundHandle,
    setIntensity: noop,
    setInterior: noop,
    setVolume: noop,
    setPaused: noop,
    debug: () => ({
      state: 'none',
    }),
    names: Object.keys(SFX_RECIPES),
    ready: Promise.resolve(),
  };
}

/**
 * 创建 AudioContext（interactive 延迟模式）并交给真正的引擎装配；构造失败或环境不支持时打印告警并退回哑引擎。
 */
export async function createAudio(ctx) {
  let audioCtor = typeof window < 'u' && (window.AudioContext || window.webkitAudioContext),
    audioCtxInstance = null;
  try {
    audioCtor &&
      (audioCtxInstance = new audioCtor({
        latencyHint: 'interactive',
      }));
  } catch {
    audioCtxInstance = null;
  }
  return audioCtxInstance
    ? createWebAudioEngine(ctx, audioCtxInstance, null)
    : (console.warn('[audio] WebAudio unavailable \u2014 running silent'),
      createSilentAudioEngine());
}

/**
 * WebAudio 音频引擎主体：分 world/near/amb/dry/music 五条总线，声部池按优先级抢占并发，距离与 HRTF 空间化，室外与棚内两套卷积混响，声音事件订阅表，音乐分层随战斗强度混合，敌人循环音做距离 LOD，室内/受伤/暂停走滤波与增益，并提供离线自检。
 */
function createWebAudioEngine(ctx, webAudioCtx, opts) {
  let events = ctx.events,
    rnd = Math.random,
    isLive = () => (opts ? !0 : webAudioCtx.state === 'running'),
    buffers = opts ? opts.bufs : new Map(),
    waiters = new Map(),
    synthMs = 0,
    bufferCount = 0,
    bootMs = 0;
  function registerBuffer(te, he) {
    let pe = webAudioCtx.createBuffer(he.ch.length, he.ch[0].length, he.sr);
    for (let ye = 0; ye < he.ch.length; ye++) pe.getChannelData(ye).set(he.ch[ye]);
    (buffers.set(te, pe), bufferCount++);
    let ge = waiters.get(te);
    if (ge) {
      waiters.delete(te);
      for (let ye of ge)
        try {
          ye(pe);
        } catch (Le) {
          console.error('[audio] ready callback', Le);
        }
    }
    return pe;
  }
  let irSampleRate = (te) => (SFX_RECIPES[te].ir ? webAudioCtx.sampleRate : void 0);
  function synthNow(te, he) {
    let pe = performance.now(),
      ge = registerBuffer(te + '#' + he, bakeSfxBuffer(te, he, irSampleRate(te)));
    return ((synthMs += performance.now() - pe), ge);
  }
  let queue = [],
    seenNames = new Set();
  for (let te of [...BAKE_ORDER, ...Object.keys(SFX_RECIPES)]) {
    let he = SFX_RECIPES[te];
    if (!(!he || seenNames.has(te))) {
      seenNames.add(te);
      for (let pe = 0; pe < he.n; pe++)
        buffers.has(te + '#' + pe) ||
          (he.boot
            ? synthNow(te, pe)
            : queue.push({
                name: te,
                v: pe,
                k: te + '#' + pe,
                steps: null,
              }));
    }
  }
  bootMs = synthMs;
  let resolveReady,
    readyPromise = new Promise((te) => {
      resolveReady = te;
    });
  function pumpQueue() {
    let te = performance.now();
    for (; queue.length;) {
      let he = queue[0];
      if (buffers.has(he.k)) {
        queue.shift();
        continue;
      }
      he.steps || (he.steps = createSfxBaker(he.name, he.v, irSampleRate(he.name)));
      let pe = null;
      try {
        pe = he.steps.step();
      } catch (ge) {
        (console.error('[audio] synthesis failed for ' + he.k, ge), queue.shift());
        continue;
      }
      if (
        (pe && (registerBuffer(he.k, pe), queue.shift(), onBufferReady(he.name)),
        performance.now() - te > 6)
      )
        break;
    }
    ((synthMs += performance.now() - te),
      queue.length ? setTimeout(pumpQueue, 12) : resolveReady());
  }
  opts ? resolveReady() : setTimeout(pumpQueue, 120);
  function whenReady(te, he, pe) {
    let ge = te + '#' + he,
      ye = buffers.get(ge);
    if (ye) {
      pe(ye);
      return;
    }
    (waiters.has(ge) || waiters.set(ge, []), waiters.get(ge).push(pe));
    let Le = queue.findIndex((ke) => ke.k === ge);
    if (Le > 0 && !queue[Le].steps) {
      let [ke] = queue.splice(Le, 1);
      queue.splice(queue[0] && queue[0].steps ? 1 : 0, 0, ke);
    }
  }
  let gainNode = (te) => {
      let he = webAudioCtx.createGain();
      return ((he.gain.value = te), he);
    },
    masterGain = gainNode(1),
    compressor = webAudioCtx.createDynamicsCompressor(),
    compGain = gainNode(0.45),
    shaper = webAudioCtx.createWaveShaper(),
    outputGain = gainNode(0.9);
  ((compressor.threshold.value = -10),
    (compressor.knee.value = 6),
    (compressor.ratio.value = 6),
    (compressor.attack.value = 0.002),
    (compressor.release.value = 0.14));
  {
    let he = new Float32Array(2049);
    for (let pe = 0; pe < 2049; pe++) {
      let ge = ((pe / 2048) * 2 - 1) * 2,
        ye = Math.abs(ge);
      he[pe] = Math.sign(ge) * (ye <= 0.6 ? ye : 0.6 + 0.4 * Math.tanh((ye - 0.6) / 0.4));
    }
    shaper.curve = he;
    try {
      shaper.oversample = '2x';
    } catch {}
  }
  (masterGain.connect(compressor),
    compressor.connect(compGain),
    compGain.connect(shaper),
    shaper.connect(outputGain),
    outputGain.connect(webAudioCtx.destination));
  let lowpass = webAudioCtx.createBiquadFilter();
  ((lowpass.type = 'lowpass'), (lowpass.frequency.value = 2e4), (lowpass.Q.value = 0.5));
  let lowpassGain = gainNode(1);
  (lowpass.connect(lowpassGain), lowpassGain.connect(masterGain));
  let buses = {
    world: gainNode(1),
    near: gainNode(0.95),
    amb: gainNode(0.55),
    dry: gainNode(1),
    music: gainNode(0.62),
  };
  (buses.world.connect(lowpass),
    buses.near.connect(lowpass),
    buses.amb.connect(lowpass),
    buses.dry.connect(masterGain));
  let musicGain = gainNode(1);
  (buses.music.connect(musicGain), musicGain.connect(masterGain));
  let reverbSend = gainNode(1),
    outdoorVerbSend = gainNode(1),
    indoorVerbSend = gainNode(0),
    outdoorConvolver = webAudioCtx.createConvolver(),
    indoorConvolver = webAudioCtx.createConvolver(),
    outdoorVerbReturn = gainNode(0.75),
    indoorVerbReturn = gainNode(0.95),
    worldVerbSend = gainNode(0.9),
    nearVerbSend = gainNode(0.32),
    musicVerbSend = gainNode(0.2);
  (buses.world.connect(worldVerbSend),
    worldVerbSend.connect(reverbSend),
    buses.near.connect(nearVerbSend),
    nearVerbSend.connect(reverbSend),
    reverbSend.connect(outdoorVerbSend),
    reverbSend.connect(indoorVerbSend),
    outdoorVerbSend.connect(outdoorConvolver),
    indoorVerbSend.connect(indoorConvolver),
    outdoorConvolver.connect(outdoorVerbReturn),
    indoorConvolver.connect(indoorVerbReturn),
    outdoorVerbReturn.connect(lowpass),
    indoorVerbReturn.connect(lowpass),
    buses.music.connect(musicVerbSend),
    musicVerbSend.connect(indoorConvolver),
    whenReady('ir_outdoor', 0, (te) => {
      outdoorConvolver.buffer = te;
    }),
    whenReady('ir_shed', 0, (te) => {
      indoorConvolver.buffer = te;
    }));
  function setPannerPos(te, he, pe, ge) {
    te.positionX
      ? ((te.positionX.value = he), (te.positionY.value = pe), (te.positionZ.value = ge))
      : te.setPosition(he, pe, ge);
  }
  function makePanner(te) {
    let he = webAudioCtx.createPanner();
    return (
      (he.panningModel = te ? 'HRTF' : 'equalpower'),
      (he.distanceModel = 'inverse'),
      (he.refDistance = 3),
      (he.rolloffFactor = 0.6),
      (he.maxDistance = 400),
      (he.coneInnerAngle = 360),
      he
    );
  }
  let voicePools = {
    world: [],
    near: [],
    dry: [],
    music: [],
  };
  function allocVoice(te, he) {
    let pe = {
      g: gainNode(0),
      pan: null,
      src: null,
      end: 0,
      start: 0,
      name: '',
      pri: 0,
    };
    (he
      ? ((pe.pan = makePanner(!1)), pe.g.connect(pe.pan), pe.pan.connect(buses[te]))
      : pe.g.connect(buses[te]),
      voicePools[te].push(pe));
  }
  for (let te = 0; te < 22; te++) allocVoice('world', !0);
  for (let te = 0; te < 12; te++) allocVoice('near', !1);
  for (let te = 0; te < 8; te++) allocVoice('dry', !1);
  for (let te = 0; te < 3; te++) allocVoice('music', !1);
  let listenerPos = {
      x: 0,
      y: 1.7,
      z: 0,
    },
    unlocked = !1,
    paused = !1,
    masterVolume = 0.9,
    gameState = (ctx.game && ctx.game.state) || 'title',
    interiorTarget = 0,
    interior = 0,
    intensityTarget = 0,
    danger = 0,
    intensity = 0,
    muffle = 0,
    musicDuck = 1,
    liveGain = 1,
    ambienceGain = 0,
    lastShotAt = -9,
    lastTailAt = -9,
    shotVariant = 0,
    lastImpactAt = -9,
    lastRicochetAt = -9,
    lastEarRingAt = -9,
    lastShellAt = -9,
    lastAlertAt = -9,
    lastStingerAt = -9,
    lastWhizAt = -9,
    variantCursor = {},
    api = {
      autoIntensity: !0,
    };
  function pickVoice(te, he, pe, ge) {
    let ye = null,
      Le = 0,
      ke = null,
      Ue = null;
    for (let ct = 0; ct < te.length; ct++) {
      let De = te[ct];
      if (De.end <= ge) {
        ye || (ye = De);
        continue;
      }
      (De.name === he && (Le++, (!ke || De.start < ke.start) && (ke = De)),
        (!Ue || De.pri < Ue.pri || (De.pri === Ue.pri && De.start < Ue.start)) && (Ue = De));
    }
    return Le >= (pe.max || 4) ? ke : ye || (Ue && Ue.pri <= pe.pri ? Ue : null);
  }
  function play(te, he) {
    ((he = he || {}),
      (te = SFX_ALIASES[te] || te),
      he.surface &&
        (te === 'impact_concrete'
          ? (te = SURFACE_IMPACT_SFX[he.surface] || te)
          : te === 'step_concrete' && (te = SURFACE_STEP_SFX[he.surface] || te)));
    let pe = SFX_RECIPES[te];
    if (!pe || pe.loop || pe.ir || !isLive()) return !1;
    let ge = he.variant;
    ge == null
      ? (ge = variantCursor[te] =
          ((variantCursor[te] || 0) + 1 + (pe.n > 2 && rnd() < 0.3 ? 1 : 0)) % pe.n)
      : (ge %= pe.n);
    let ye = buffers.get(te + '#' + ge);
    if (!ye) {
      if (LATE_RETRY_SFX.has(te)) {
        let Ht = webAudioCtx.currentTime;
        return (
          whenReady(te, ge, () => {
            webAudioCtx.currentTime - Ht < 2.5 &&
              play(
                te,
                Object.assign({}, he, {
                  variant: ge,
                }),
              );
          }),
          !1
        );
      }
      ye = synthNow(te, ge);
    }
    let Le = webAudioCtx.currentTime,
      ke = he.pos,
      Ue = !!ke && pe.bus === 'world',
      ct = Ue ? voicePools.world : voicePools[pe.bus === 'world' ? 'near' : pe.bus],
      De = pickVoice(ct, te, pe, Le);
    if (!De) return !1;
    let it = Le + (he.delay || 0),
      gt = De.g.gain;
    if ((gt.cancelScheduledValues(Le), De.end > Le && De.src)) {
      gt.setTargetAtTime(0, Le, 0.004);
      try {
        De.src.stop(Le + 0.025);
      } catch {}
      it = Math.max(it, Le + 0.025);
    }
    let Ot = he.jitter != null ? he.jitter : 0.035,
      xn = pi((he.pitch || 1) * (1 + (rnd() * 2 - 1) * Ot), 0.25, 4);
    if ((gt.setValueAtTime((he.gain != null ? he.gain : 1) * (1 - rnd() * 0.08), it), Ue)) {
      let Ht = Array.isArray(ke)
        ? {
            x: ke[0],
            y: ke[1],
            z: ke[2],
          }
        : ke;
      (setPannerPos(De.pan, Ht.x || 0, Ht.y || 0, Ht.z || 0),
        (De.pan.refDistance = he.ref || pe.ref || 3),
        (De.pan.rolloffFactor = he.roll != null ? he.roll : pe.roll != null ? pe.roll : 0.6));
    }
    let $t = webAudioCtx.createBufferSource();
    return (
      ($t.buffer = ye),
      ($t.playbackRate.value = xn),
      $t.connect(De.g),
      ($t.onended = () => {
        try {
          $t.disconnect();
        } catch {}
      }),
      $t.start(it),
      (De.src = $t),
      (De.start = it),
      (De.end = it + ye.duration / xn + 0.03),
      (De.name = te),
      (De.pri = pe.pri || 0),
      !0
    );
  }
  let loops = new Set(),
    spatialLoops = new Set(),
    noop = () => {},
    autoSpatialOn = !1,
    NULL_LOOP = {
      setPos: noop,
      setGain: noop,
      setPitch: noop,
      stop: noop,
      alive: !1,
    };
  function loop(te, he) {
    he = he || {};
    let pe = SFX_RECIPES[te];
    if (!pe || !pe.loop) return NULL_LOOP;
    let ge = (te === 'gull_rotor' || te === 'hound_servo') && !he._auto;
    ge &&
      !he.hrtf &&
      (he = Object.assign(
        {
          hrtf: !0,
        },
        he,
      ));
    let ye = {
        name: te,
        alive: !0,
        vT: 1,
        vC: 1,
        px: 0,
        py: 0,
        pz: 0,
        gT: he.gain != null ? he.gain : 1,
        gC: 0,
        pT: he.pitch || 1,
        pC: he.pitch || 1,
        src: null,
        g: gainNode(0),
        pan: null,
        rate: he.fade || 6,
      },
      Le = ye.g;
    if (
      (he.pos &&
        ((ye.pan = makePanner(!!he.hrtf)),
        (ye.pan.refDistance = he.ref || pe.ref || 3),
        (ye.pan.rolloffFactor = he.roll != null ? he.roll : pe.roll != null ? pe.roll : 0.6),
        ye.g.connect(ye.pan),
        (Le = ye.pan)),
      Le.connect(buses[he.bus || (he.pos ? 'world' : pe.music ? 'music' : 'amb')]),
      (ye.setPos = (ke) => {
        ye.pan &&
          ke &&
          (Array.isArray(ke)
            ? ((ye.px = ke[0]), (ye.py = ke[1]), (ye.pz = ke[2]))
            : ((ye.px = ke.x || 0), (ye.py = ke.y || 0), (ye.pz = ke.z || 0)),
          Number.isFinite(ye.px + ye.py + ye.pz) && setPannerPos(ye.pan, ye.px, ye.py, ye.pz));
      }),
      (ye.setGain = (ke) => {
        ye.gT = Math.max(0, +ke || 0);
      }),
      (ye.setPitch = (ke) => {
        ye.pT = pi(+ke || 1, 0.25, 4);
      }),
      (ye.stop = (ke) => {
        if (!ye.alive) return;
        ((ye.alive = !1), loops.delete(ye), spatialLoops.delete(ye));
        let Ue = ke ?? 0.18,
          ct = webAudioCtx.currentTime;
        try {
          (ye.g.gain.setValueAtTime(ye.gC, ct),
            ye.g.gain.linearRampToValueAtTime(0, ct + Ue),
            ye.src && ye.src.stop(ct + Ue + 0.03));
        } catch {}
        setTimeout(
          () => {
            try {
              (ye.src && ye.src.disconnect(), ye.g.disconnect(), ye.pan && ye.pan.disconnect());
            } catch {}
          },
          (Ue + 0.3) * 1e3,
        );
      }),
      he.pos && ye.setPos(he.pos),
      whenReady(te, 0, (ke) => {
        if (!ye.alive) return;
        let Ue = webAudioCtx.createBufferSource();
        ((Ue.buffer = ke),
          (Ue.loop = !0),
          (Ue.playbackRate.value = ye.pC),
          Ue.connect(ye.g),
          Ue.start(0, he.offset != null ? he.offset : rnd() * ke.duration),
          (ye.src = Ue));
      }),
      loops.add(ye),
      ge && (spatialLoops.add(ye), !autoSpatialOn))
    ) {
      autoSpatialOn = !0;
      for (let ke of [...tracked.keys()]) untrackEnemy(ke);
    }
    return ye;
  }
  let music = {
    on: !1,
    layers: {},
  };
  function startMusic() {
    if (music.on || !isLive()) return;
    for (let he of MUSIC_LAYERS) if (!buffers.has(he + '#0')) return;
    let te = webAudioCtx.currentTime + 0.08;
    for (let he of MUSIC_LAYERS) {
      let pe = gainNode(0),
        ge = webAudioCtx.createBufferSource();
      ((ge.buffer = buffers.get(he + '#0')),
        (ge.loop = !0),
        ge.connect(pe),
        pe.connect(buses.music),
        ge.start(te),
        (music.layers[he] = {
          g: pe,
          s: ge,
          c: 0,
        }));
    }
    ((music.on = !0), (music.t0 = te));
  }
  function musicMix(te) {
    return gameState === 'title'
      ? [0.85, 0, 0, 0, 0.9]
      : gameState === 'intro'
        ? [0.8, 0, 0, 0, 0.6]
        : gameState === 'dead'
          ? [0.75, 0, 0, 0, 0]
          : gameState === 'complete'
            ? [0.6, 0, 0, 0, 0.7]
            : [
                0.6 + 0.3 * te,
                Pv(0.05, 0.5, te) * 0.85,
                Pv(0.4, 0.8, te) * 0.95,
                Pv(0.62, 1, te) * 0.8,
                0,
              ];
  }
  function onBufferReady(te) {
    SFX_RECIPES[te].music && startMusic();
  }
  let ambience = {
      rain: loop('rain', {
        gain: 0,
        fade: 2,
      }),
      rainIn: loop('rain_interior', {
        gain: 0,
        fade: 2,
      }),
      wind: loop('wind', {
        gain: 0,
        fade: 2,
      }),
      sea: loop('sea', {
        gain: 0,
        pos: [33, -1, 0],
        fade: 2,
        bus: 'amb',
      }),
    },
    windGust = 0.4,
    windTarget = 0.4,
    windTick = 2,
    ambientTimers = {
      fog: 14 + rnd() * 14,
      gull: 5 + rnd() * 8,
      hal: 4 + rnd() * 6,
      bang: 20 + rnd() * 25,
    };
  function updateAmbience(te, he) {
    let pe = 1 - 0.7 * interior;
    if ((ambientTimers.fog -= te) <= 0) {
      ambientTimers.fog = 40 + rnd() * 30;
      let ge = listenerPos.z + (rnd() * 2 - 1) * 250;
      play('foghorn', {
        pos: [listenerPos.x + 320, 8, ge],
        ref: 400,
        gain: 0.34 * he * pe,
        pitch: rnd() < 0.3 ? 0.89 : 1,
        jitter: 0.01,
      });
    }
    if ((ambientTimers.gull -= te) <= 0) {
      ambientTimers.gull = 9 + rnd() * 16;
      let ge = rnd() * 6.283,
        ye = 35 + rnd() * 50;
      play('gull_cry', {
        pos: [
          listenerPos.x + Math.cos(ge) * ye,
          14 + rnd() * 18,
          listenerPos.z + Math.sin(ge) * ye,
        ],
        ref: ye,
        roll: 1,
        gain: (0.16 + rnd() * 0.16) * he * pe,
        jitter: 0.1,
      });
    }
    if (
      ((ambientTimers.hal -= te) <= 0 &&
        ((ambientTimers.hal = 6 + rnd() * 11),
        play('halyard', {
          pos: [29 + rnd() * 8, 3 + rnd() * 6, -8 + rnd() * 32],
          ref: 16,
          roll: 0.5,
          gain: (0.3 + rnd() * 0.3) * he * pe,
          jitter: 0.08,
        })),
      (ambientTimers.bang -= te) <= 0)
    ) {
      ambientTimers.bang = 28 + rnd() * 34;
      let ge = 1.6 + rnd() * 3.2;
      play('container_bang', {
        pos: [listenerPos.x + Math.cos(ge) * 150, 4, listenerPos.z + Math.sin(ge) * 150],
        ref: 150,
        gain: (0.2 + rnd() * 0.16) * he * pe,
        jitter: 0.12,
      });
    }
  }
  let tracked = new Map(),
    trackTick = 0;
  function trackEnemy(te) {
    !te ||
      autoSpatialOn ||
      tracked.has(te) ||
      te.alive === !1 ||
      tracked.set(te, {
        h: null,
        type: te.type === 'hound' ? 'hound' : 'gull',
        lx: te.pos ? te.pos.x : 0,
        ly: te.pos ? te.pos.y : 0,
        lz: te.pos ? te.pos.z : 0,
        sp: 0,
        d: 1e9,
        tune: 0.96 + rnd() * 0.1,
      });
  }
  function untrackEnemy(te) {
    let he = tracked.get(te);
    he && (he.h && he.h.stop(0.12), tracked.delete(te));
  }
  let trackSort = [];
  function updateEnemyLoops(te) {
    if (((trackTick -= te), trackTick <= 0 && autoSpatialOn)) {
      ((trackTick = 0.25), (trackSort.length = 0));
      for (let he of spatialLoops)
        ((he.d = Math.hypot(he.px - listenerPos.x, he.py - listenerPos.y, he.pz - listenerPos.z)),
          trackSort.push(he));
      trackSort.sort((he, pe) => he.d - pe.d);
      for (let he = 0; he < trackSort.length; he++)
        trackSort[he].vT = he < 6 && trackSort[he].d < 90 ? 1 : 0;
    }
    if (trackTick <= 0) {
      trackTick = 0.25;
      let he = ctx.enemies && ctx.enemies.list;
      if (Array.isArray(he))
        for (let pe = 0; pe < he.length; pe++) {
          let ge = he[pe];
          ge && ge.alive !== !1 && !tracked.has(ge) && trackEnemy(ge);
        }
      trackSort.length = 0;
      for (let [pe, ge] of tracked) {
        if (pe.alive === !1 || (Array.isArray(he) && he.indexOf(pe) < 0)) {
          untrackEnemy(pe);
          continue;
        }
        let ye = pe.pos;
        ye &&
          ((ge.d = Math.hypot(ye.x - listenerPos.x, ye.y - listenerPos.y, ye.z - listenerPos.z)),
          trackSort.push(ge));
      }
      trackSort.sort((pe, ge) => pe.d - ge.d);
      for (let pe = 0; pe < trackSort.length; pe++) {
        let ge = trackSort[pe],
          ye = pe < 6 && ge.d < 90;
        ye && !ge.h
          ? (ge.h = loop(ge.type === 'gull' ? 'gull_rotor' : 'hound_servo', {
              pos: [ge.lx, ge.ly, ge.lz],
              gain: 0,
              hrtf: !0,
              fade: 5,
              _auto: !0,
            }))
          : !ye && ge.h && (ge.h.stop(0.25), (ge.h = null));
      }
    }
    for (let [he, pe] of tracked) {
      let ge = he.pos;
      if (ge) {
        if (te > 0) {
          let ye = Math.hypot(ge.x - pe.lx, ge.y - pe.ly, ge.z - pe.lz) / te;
          pe.sp += (Math.min(ye, 30) - pe.sp) * Math.min(1, te * 5);
        }
        if (((pe.lx = ge.x), (pe.ly = ge.y), (pe.lz = ge.z), !!pe.h))
          if ((pe.h.setPos(ge), pe.type === 'gull'))
            (pe.h.setGain(1), pe.h.setPitch(pe.tune * (0.94 + 0.3 * pi(pe.sp / 10, 0, 1))));
          else {
            let ye = pi(pe.sp / 3, 0, 1);
            (pe.h.setGain(0.3 + 0.5 * ye), pe.h.setPitch(pe.tune * (0.88 + 0.3 * ye)));
          }
      }
    }
  }
  let relayHums = [];
  function syncRelayHums() {
    for (let he of relayHums) he.h.stop(0.2);
    relayHums = [];
    let te = ctx.level && ctx.level.objectives;
    Array.isArray(te) &&
      te.forEach((he, pe) => {
        he &&
          he.pos &&
          relayHums.push({
            id: he.id,
            index: pe,
            pos: {
              x: he.pos.x,
              y: (he.pos.y || 0) + 1.2,
              z: he.pos.z,
            },
            h: loop('relay_hum', {
              pos: [he.pos.x, (he.pos.y || 0) + 1.2, he.pos.z],
              gain: 0.9,
            }),
          });
      });
  }
  function stopRelayHum(te) {
    te = te || {};
    let he = relayHums.findIndex((pe) => te.id != null && pe.id === te.id);
    if (
      (he < 0 && te.index != null && (he = relayHums.findIndex((pe) => pe.index === te.index)),
      he >= 0)
    ) {
      let pe = relayHums[he];
      (pe.h.stop(0.08),
        relayHums.splice(he, 1),
        play('relay_cut', {
          pos: pe.pos,
          gain: 1,
        }));
    } else
      play('relay_cut', {
        gain: 0.8,
      });
  }
  let asVec3 = (te) => (te && typeof te.x == 'number' ? te : null);
  function playTail(te) {
    let he = interior;
    (he < 0.95 &&
      play('rifle_tail_out', {
        gain: te * (1 - he),
        jitter: 0.03,
      }),
      he > 0.05 &&
        play('rifle_tail_in', {
          gain: te * he,
          jitter: 0.03,
        }),
      (lastTailAt = webAudioCtx.currentTime));
  }
  let onEvent = (te, he) => {
    events &&
      events.on &&
      events.on(te, (pe) => {
        try {
          he(pe || {});
        } catch (ge) {
          console.error('[audio] ' + te, ge);
        }
      });
  };
  (onEvent('weapon:fire', () => {
    ((shotVariant = (shotVariant + 1) & 3),
      play('rifle_shot', {
        variant: shotVariant,
        gain: 1,
        jitter: 0.012,
      }));
    let te = webAudioCtx.currentTime;
    ((lastShotAt = te),
      te - lastTailAt > 0.28 && playTail(1),
      (musicDuck = Math.min(musicDuck, 0.55)),
      danger > 0.3 && (danger = Math.min(1, danger + 0.015)));
  }),
    onEvent('weapon:dry', () =>
      play('rifle_dry', {
        gain: 0.9,
      }),
    ),
    onEvent('weapon:reload', (te) => {
      te.phase === 'magout'
        ? play('reload_magout')
        : te.phase === 'magin'
          ? play('reload_magin')
          : te.phase === 'bolt'
            ? play('reload_bolt')
            : te.phase === 'start' &&
              play('jump', {
                gain: 0.5,
                pitch: 1.3,
              });
    }),
    onEvent('weapon:melee', () =>
      play('jump', {
        gain: 0.9,
        pitch: 1.2,
      }),
    ),
    onEvent('shell:bounce', (te) => {
      let he = webAudioCtx.currentTime;
      he - lastShellAt < 0.04 ||
        ((lastShellAt = he),
        te.surface === 'water'
          ? play('impact_water', {
              pos: asVec3(te.pos),
              gain: 0.25,
              pitch: 1.7,
            })
          : play('shell_bounce', {
              pos: asVec3(te.pos),
              gain: te.surface === 'metal' ? 1 : 0.8,
              pitch: te.surface === 'metal' ? 1.12 : 1,
            }));
    }),
    onEvent('impact', (te) => {
      let he = webAudioCtx.currentTime;
      if (he - lastImpactAt < 0.022) return;
      lastImpactAt = he;
      let pe = asVec3(te.point),
        ge = te.surface;
      if (te.enemy) {
        play('impact_enemy', {
          pos: pe,
          gain: te.part === 'weak' ? 1 : 0.85,
          pitch: te.part === 'weak' ? 1.25 : 1,
        });
        return;
      }
      if (
        te.from === 'enemy' &&
        pe &&
        te.dir &&
        typeof te.dir.x == 'number' &&
        he - lastWhizAt > 0.09
      ) {
        let ye = te.dir,
          Le = ye.x * ye.x + ye.y * ye.y + ye.z * ye.z || 1,
          ke =
            ((listenerPos.x - pe.x) * ye.x +
              (listenerPos.y - pe.y) * ye.y +
              (listenerPos.z - pe.z) * ye.z) /
            Le;
        if (ke < -1.5) {
          let Ue = pe.x + ye.x * ke,
            ct = pe.y + ye.y * ke,
            De = pe.z + ye.z * ke,
            it = Math.hypot(listenerPos.x - Ue, listenerPos.y - ct, listenerPos.z - De);
          it < 3.2 &&
            ((lastWhizAt = he),
            play('whiz', {
              pos: {
                x: Ue,
                y: ct,
                z: De,
              },
              gain: pi(1.15 - it / 3.5, 0.3, 1),
              jitter: 0.1,
            }));
        }
      }
      (play(SURFACE_IMPACT_SFX[ge] || 'impact_concrete', {
        pos: pe,
        gain: te.from === 'enemy' ? 0.8 : 0.9,
        pitch: ge === 'dirt' ? 0.8 : ge === 'rubber' ? 0.7 : 1,
        jitter: 0.07,
      }),
        he - lastRicochetAt > 0.22 &&
          ((ge === 'metal' && rnd() < 0.24) || (ge === 'concrete' && rnd() < 0.07)) &&
          ((lastRicochetAt = he),
          play('ricochet', {
            pos: pe,
            gain: 0.75,
            delay: 0.012,
            jitter: 0.12,
          })));
    }),
    onEvent('player:step', (te) => {
      let he = te.surface || 'concrete';
      try {
        te.pos &&
          ctx.ground &&
          ctx.ground.isPuddle &&
          ctx.ground.isPuddle(te.pos.x, te.pos.z) &&
          (he = 'water');
      } catch {}
      play(SURFACE_STEP_SFX[he] || 'step_concrete', {
        gain: (te.sprint ? 0.8 : 0.55) * (he === 'water' ? 0.9 : 1),
        pitch: (te.sprint ? 1.05 : 1) * (he === 'wood' ? 1.18 : 1),
        jitter: 0.06,
      });
    }),
    onEvent('player:jump', () =>
      play('jump', {
        gain: 0.8,
      }),
    ),
    onEvent('player:land', (te) => {
      let he = pi(0.35 + (Math.abs(te.speed) || 4) / 10, 0.35, 1);
      (play('land', {
        gain: he,
      }),
        (te.surface === 'water' || te.surface === 'metal') &&
          play(SURFACE_STEP_SFX[te.surface], {
            gain: he * 0.8,
            pitch: 0.9,
          }));
    }),
    onEvent('player:hit', (te) => {
      let he = +te.amount || 10,
        pe = webAudioCtx.currentTime;
      (play('hurt', {
        gain: pi(0.5 + he / 40, 0.5, 1),
        jitter: 0.08,
      }),
        he >= 6 &&
          pe - lastEarRingAt > 1.8 &&
          ((lastEarRingAt = pe),
          play('ear_ring', {
            gain: pi(he / 28, 0.3, 1),
            jitter: 0.02,
          })),
        (muffle = Math.max(muffle, pi(he / 40, 0.2, 0.7))),
        (danger = Math.min(1, Math.max(danger, 0.6) + 0.15)));
    }),
    onEvent('player:dead', () => {
      (webAudioCtx.currentTime - lastStingerAt > 1 &&
        ((lastStingerAt = webAudioCtx.currentTime),
        play('death', {
          gain: 1,
          jitter: 0,
        })),
        (muffle = 1));
    }),
    onEvent('enemy:spawn', (te) => trackEnemy(te.enemy)),
    onEvent('enemy:alert', (te) => {
      danger = Math.max(danger, 0.6);
      let he = webAudioCtx.currentTime;
      if (he - lastAlertAt < 0.12) return;
      lastAlertAt = he;
      let pe = te.enemy || {};
      play('alert', {
        pos: asVec3(pe.pos) || asVec3(te.pos),
        variant: pe.type === 'hound' ? 1 : 0,
        gain: 0.9,
      });
    }),
    onEvent('enemy:fire', (te) => {
      let he = te.type || (te.enemy && te.enemy.type),
        pe = asVec3(te.pos) || (te.enemy && asVec3(te.enemy.pos));
      (play(he === 'hound' ? 'hound_fire' : 'gull_fire', {
        pos: pe,
        gain: 1,
        jitter: 0.04,
      }),
        (danger = Math.min(1, Math.max(danger, 0.6) + 0.05)));
    }),
    onEvent('enemy:step', (te) => {
      if (te.crash) {
        (play('hound_step', {
          pos: asVec3(te.pos),
          gain: 1,
          pitch: 0.72,
        }),
          play('impact_metal', {
            pos: asVec3(te.pos),
            gain: 0.8,
            pitch: 0.55,
          }));
        return;
      }
      te.type !== 'gull' &&
        play('hound_step', {
          pos: asVec3(te.pos),
          gain: pi(0.6 + (+te.speed || 2) * 0.1, 0.6, 1),
          jitter: 0.06,
        });
    }),
    onEvent('enemy:telegraph', (te) => {
      let he = te.enemy || {},
        pe = te.type || he.type,
        ge = pi(+te.time || 0.55, 0.15, 1.5);
      (play('telegraph', {
        pos: asVec3(te.pos) || asVec3(he.pos),
        variant: pe === 'hound' ? 1 : 0,
        pitch: 0.55 / ge,
        gain: te.melee ? 0.7 : 1,
        jitter: 0,
      }),
        (danger = Math.max(danger, 0.6)));
    }),
    onEvent('enemy:melee', (te) => {
      let he = asVec3(te.pos) || (te.enemy && asVec3(te.enemy.pos));
      (play('hound_step', {
        pos: he,
        gain: 1,
        pitch: 0.8,
      }),
        play('impact_metal', {
          pos: he,
          gain: 0.9,
          pitch: 0.7,
        }),
        play('hurt', {
          gain: 0.6,
        }));
    }),
    onEvent('enemy:killed', (te) => {
      let he = te.enemy,
        pe = te.type || (he && he.type),
        ge = asVec3(te.pos) || (he && asVec3(he.pos));
      (he && untrackEnemy(he),
        play(pe === 'hound' ? 'hound_die' : 'gull_die', {
          pos: ge,
          gain: 1,
          jitter: 0.05,
        }));
    }),
    onEvent('explosion', (te) => {
      let he = pi(+te.size || 1, 0.3, 3),
        pe = asVec3(te.pos);
      if (
        (play('explosion', {
          pos: pe,
          gain: pi(0.6 + 0.25 * he, 0.5, 1.1),
          pitch: pi(1.12 - 0.1 * he, 0.8, 1.15),
          jitter: 0.04,
        }),
        pe)
      ) {
        let ge = Math.hypot(pe.x - listenerPos.x, pe.y - listenerPos.y, pe.z - listenerPos.z);
        muffle = Math.max(muffle, pi(1 - (ge - 5) / 10, 0, 0.8));
      }
      ((danger = Math.max(danger, 0.6)), (musicDuck = Math.min(musicDuck, 0.4)));
    }),
    onEvent('objective:done', (te) => {
      (stopRelayHum(te),
        play('objective', {
          delay: 0.35,
          gain: 1,
          jitter: 0,
        }));
    }),
    onEvent('objective:all', () =>
      play('objective_all', {
        delay: 2.2,
        gain: 1,
        jitter: 0,
      }),
    ));
  let onExtracted = () => {
    let te = webAudioCtx.currentTime;
    te - lastStingerAt > 6 &&
      ((lastStingerAt = te),
      play('complete', {
        gain: 1,
        jitter: 0,
      }));
  };
  (onEvent('extraction:reached', onExtracted),
    onEvent('thunder', (te) => {
      let he = pi(te.intensity != null ? +te.intensity : 0.6, 0.1, 1);
      play('thunder', {
        variant: he > 0.6 ? 1 : 0,
        delay: 0.5 + (1 - he) * 2 + rnd() * 0.6,
        gain: 0.35 + 0.65 * he,
        jitter: 0.1,
      });
    }),
    onEvent('ui:click', () => play('ui_click')),
    onEvent('ui:hover', () => play('ui_hover')),
    onEvent('game:state', (te) => {
      let he = gameState;
      if (((gameState = te.state || gameState), gameState === 'playing' && he !== 'paused')) {
        ((danger = 0), (muffle = 0), syncRelayHums());
        for (let pe of [...tracked.keys()]) pe.alive === !1 && untrackEnemy(pe);
      }
      (gameState === 'complete' && onExtracted(),
        gameState === 'paused' ? (paused = !0) : he === 'paused' && (paused = !1));
    }));
  function unlock() {
    if (((unlocked = !0), webAudioCtx.state !== 'running' && webAudioCtx.state !== 'closed'))
      try {
        let te = webAudioCtx.resume();
        te && te.catch && te.catch(() => {});
      } catch {}
  }
  if (typeof window < 'u' && !opts) {
    let te = () => {
      if ((unlock(), isLive()))
        for (let he of ['pointerdown', 'keydown', 'touchend', 'mousedown'])
          window.removeEventListener(he, te, !0);
    };
    for (let he of ['pointerdown', 'keydown', 'touchend', 'mousedown'])
      window.addEventListener(he, te, {
        capture: !0,
        passive: !0,
      });
    document.addEventListener('visibilitychange', () => {
      try {
        document.hidden ? webAudioCtx.suspend() : unlocked && webAudioCtx.resume();
      } catch {}
    });
  }
  function update(te) {
    te = Math.min(Math.max(+te || 0, 0), 0.25);
    let he = ctx.camera,
      pe = webAudioCtx.listener;
    if (he && he.matrixWorld) {
      let De = he.matrixWorld.elements;
      ((listenerPos.x = De[12]),
        (listenerPos.y = De[13]),
        (listenerPos.z = De[14]),
        Number.isFinite(listenerPos.x + listenerPos.y + listenerPos.z + De[8] + De[4]) &&
          (pe.positionX
            ? ((pe.positionX.value = listenerPos.x),
              (pe.positionY.value = listenerPos.y),
              (pe.positionZ.value = listenerPos.z),
              (pe.forwardX.value = -De[8]),
              (pe.forwardY.value = -De[9]),
              (pe.forwardZ.value = -De[10]),
              (pe.upX.value = De[4]),
              (pe.upY.value = De[5]),
              (pe.upZ.value = De[6]))
            : (pe.setPosition(listenerPos.x, listenerPos.y, listenerPos.z),
              pe.setOrientation(-De[8], -De[9], -De[10], De[4], De[5], De[6]))));
    }
    let ge = ctx.level && ctx.level.interiorBoxes;
    if (Array.isArray(ge) && ge.length) {
      let De = 0;
      for (let it = 0; it < ge.length; it++) {
        let gt = ge[it];
        if (
          gt &&
          gt.min &&
          gt.max &&
          listenerPos.x > gt.min.x &&
          listenerPos.x < gt.max.x &&
          listenerPos.y > gt.min.y - 0.5 &&
          listenerPos.y < gt.max.y &&
          listenerPos.z > gt.min.z &&
          listenerPos.z < gt.max.z
        ) {
          De = 1;
          break;
        }
      }
      interiorTarget = De;
    }
    let ye = (De) => 1 - Math.exp(-te * De);
    if (
      ((interior += (interiorTarget - interior) * ye(3)),
      (outdoorVerbSend.gain.value = 1 - 0.9 * interior),
      (indoorVerbSend.gain.value = interior),
      !isLive())
    )
      return;
    startMusic();
    let Le = webAudioCtx.currentTime;
    lastShotAt > lastTailAt + 0.02 && Le - lastShotAt > 0.1 && playTail(0.9);
    let ke = gameState === 'playing' || gameState === 'intro';
    ((ambienceGain +=
      ((paused ? 0 : gameState === 'title' ? 0.6 : gameState === 'dead' ? 0.7 : 1) - ambienceGain) *
      ye(1.2)),
      (liveGain += ((paused ? 0 : 1) - liveGain) * ye(12)),
      (lowpassGain.gain.value = liveGain),
      (muffle += ((gameState === 'dead' ? 0.85 : 0) - muffle) * ye(gameState === 'dead' ? 3 : 0.9)),
      (lowpass.frequency.value = 2e4 * Math.pow(0.03, pi(muffle, 0, 1))),
      (outputGain.gain.value = masterVolume),
      (windTick -= te) <= 0 && ((windTick = 3 + rnd() * 6), (windTarget = 0.12 + rnd() * 0.88)),
      (windGust += (windTarget - windGust) * ye(0.5)),
      ambience.rain.setGain(ambienceGain * (1 - 0.93 * interior) * 0.95),
      ambience.rainIn.setGain(ambienceGain * interior * 0.95),
      ambience.wind.setGain(ambienceGain * (0.3 + 0.7 * windGust) * (1 - 0.65 * interior) * 0.75),
      ambience.wind.setPitch(0.9 + 0.25 * windGust),
      ambience.sea.setGain(ambienceGain * (1 - 0.5 * interior) * 1),
      ambience.sea.setPos([33, -1, pi(listenerPos.z, -28, 26)]),
      !paused &&
        (ke || gameState === 'title' || gameState === 'complete') &&
        updateAmbience(te, gameState === 'title' ? 0.7 : 1),
      paused || updateEnemyLoops(te),
      (danger = Math.max(0, danger - te * (tracked.size ? 0.045 : 0.14))));
    let ct =
      ke || paused ? Math.max(intensityTarget, api.autoIntensity ? Math.max(0.15, danger) : 0) : 0;
    if (
      ((intensity += (ct - intensity) * ye(2)),
      (musicDuck += (1 - musicDuck) * ye(3.5)),
      (musicGain.gain.value = musicDuck * (paused ? 0.45 : 1)),
      music.on)
    ) {
      let De = musicMix(intensity),
        it = ye(1 / 0.5);
      for (let gt = 0; gt < MUSIC_LAYERS.length; gt++) {
        let Ot = music.layers[MUSIC_LAYERS[gt]];
        ((Ot.c += (De[gt] - Ot.c) * it), (Ot.g.gain.value = Ot.c));
      }
    }
    for (let De of loops)
      ((De.vC += (De.vT - De.vC) * ye(4)),
        (De.gC += (De.gT * De.vC - De.gC) * ye(De.rate)),
        (De.g.gain.value = De.gC),
        De.src &&
          Math.abs(De.pT - De.pC) > 1e-4 &&
          ((De.pC += (De.pT - De.pC) * ye(8)), (De.src.playbackRate.value = De.pC)));
  }
  async function selfTest(te) {
    ((te = te || {}), await readyPromise);
    let he = webAudioCtx.sampleRate,
      pe = te.seconds || 10,
      ge = new OfflineAudioContext(2, he * pe, he),
      ye = new Map(),
      Le = {
        on(Tt, Ai) {
          (ye.has(Tt) || ye.set(Tt, []), ye.get(Tt).push(Ai));
        },
        emit(Tt, Ai) {
          for (let sn of ye.get(Tt) || []) sn(Ai);
        },
      },
      ke = new Float32Array(16);
    ((ke[0] = ke[5] = ke[10] = ke[15] = 1), (ke[13] = 1.7));
    let Ue = [
        {
          type: 'gull',
          alive: !0,
          pos: {
            x: 6,
            y: 4,
            z: -9,
          },
        },
        {
          type: 'hound',
          alive: !0,
          pos: {
            x: -8,
            y: 0,
            z: -14,
          },
        },
        {
          type: 'gull',
          alive: !0,
          pos: {
            x: 0,
            y: 5,
            z: -30,
          },
        },
      ],
      ct = {
        min: {
          x: -99,
          y: -9,
          z: -99,
        },
        max: {
          x: 99,
          y: 99,
          z: 99,
        },
      },
      De = {
        events: Le,
        params: {},
        camera: {
          matrixWorld: {
            elements: ke,
          },
        },
        enemies: {
          list: [],
        },
        level: {
          interiorBoxes: te.interior
            ? [ct]
            : [
                {
                  min: {
                    x: 500,
                    y: 0,
                    z: 500,
                  },
                  max: {
                    x: 501,
                    y: 1,
                    z: 501,
                  },
                },
              ],
          objectives: [
            {
              id: 'A',
              pos: {
                x: 4,
                y: 0,
                z: 3,
              },
            },
          ],
        },
      },
      it = createWebAudioEngine(De, ge, {
        bufs: buffers,
      }),
      gt = 0.02,
      Ot = 0,
      xn = (tickIdx) => {
        let elapsedSec = tickIdx * gt;
        if (
          (tickIdx === 0 &&
            Le.emit('game:state', {
              state: 'playing',
            }),
          elapsedSec < 3 &&
            tickIdx % 23 === 0 &&
            Le.emit('player:step', {
              surface: 'concrete',
              sprint: !1,
            }),
          tickIdx === 150)
        ) {
          for (let enemySpawn of Ue)
            (De.enemies.list.push(enemySpawn),
              Le.emit('enemy:spawn', {
                enemy: enemySpawn,
              }));
          (Le.emit('enemy:alert', {
            enemy: Ue[0],
          }),
            it.setIntensity(1));
        }
        (elapsedSec >= 3 &&
          elapsedSec < 6 &&
          (tickIdx % 4 === 0 &&
            (elapsedSec < 4.2 || elapsedSec > 4.8) &&
            (Le.emit('weapon:fire', {}),
            Le.emit('impact', {
              point: {
                x: 4,
                y: 1,
                z: -12,
              },
              surface: tickIdx % 8 ? 'metal' : 'concrete',
              from: 'player',
            }),
            Le.emit('shell:bounce', {
              pos: {
                x: 0.6,
                y: 0,
                z: 0.2,
              },
              surface: 'concrete',
            })),
          tickIdx % 13 === 0 &&
            Le.emit('enemy:fire', {
              enemy: Ue[0],
              pos: Ue[0].pos,
              type: 'gull',
            }),
          tickIdx % 17 === 0 &&
            Le.emit('enemy:fire', {
              enemy: Ue[1],
              pos: Ue[1].pos,
              type: 'hound',
            }),
          tickIdx % 25 === 0 &&
            Le.emit('enemy:step', {
              pos: Ue[1].pos,
              type: 'hound',
            })),
          tickIdx === 300 &&
            Le.emit('explosion', {
              pos: {
                x: 3,
                y: 0,
                z: -5,
              },
              size: 1.5,
            }),
          tickIdx === 350 &&
            Le.emit('player:hit', {
              amount: 20,
            }),
          tickIdx === 360 &&
            ((Ue[0].alive = !1),
            Le.emit('enemy:killed', {
              enemy: Ue[0],
              pos: Ue[0].pos,
              type: 'gull',
            })),
          tickIdx === 400 &&
            (Le.emit('objective:done', {
              id: 'A',
              index: 0,
              total: 3,
            }),
            it.setIntensity(0.15)));
      };
    for (let Tt = 1; Tt * gt < pe - 0.01; Tt++)
      ge.suspend(Tt * gt).then(() => {
        (xn(Tt), it.update(gt), Ot++, ge.resume());
      });
    (xn(0), it.update(gt));
    let $t = performance.now(),
      Ht = await ge.startRendering(),
      Je = performance.now() - $t,
      Pt = {
        interior: !!te.interior,
        renderMs: Math.round(Je),
        steps: Ot,
        peak: 0,
        over: 0,
        nan: 0,
        rmsDb: [],
        inst: it.debug(),
      },
      Vt = Ht.getChannelData(0),
      ss = Ht.getChannelData(1),
      Hs = Math.round(he / 2);
    for (let Tt = 0; Tt * Hs < Vt.length; Tt++) {
      let Ai = 0;
      for (let sn = Tt * Hs; sn < (Tt + 1) * Hs && sn < Vt.length; sn++) {
        let os = Vt[sn],
          rs = ss[sn];
        (!(Math.abs(os) < 1e9) || !(Math.abs(rs) < 1e9)) && Pt.nan++;
        let Ni = Math.max(Math.abs(os), Math.abs(rs));
        (Ni > Pt.peak && (Pt.peak = Ni), Ni >= 0.999 && Pt.over++, (Ai += os * os + rs * rs));
      }
      Pt.rmsDb.push(+(10 * Math.log10(Ai / (2 * Hs) + 1e-12)).toFixed(1));
    }
    return ((Pt.peak = +Pt.peak.toFixed(3)), Pt);
  }
  return (
    Object.assign(api, {
      ctx: webAudioCtx,
      resume: unlock,
      play: play,
      loop: loop,
      update: update,
      ready: readyPromise,
      selfTest: selfTest,
      setIntensity(te) {
        intensityTarget = pi(+te || 0, 0, 1);
      },
      setInterior(te) {
        interiorTarget = pi(+te || 0, 0, 1);
      },
      setVolume(te) {
        ((masterVolume = pi(+te, 0, 1)),
          Number.isFinite(masterVolume) || (masterVolume = 0.9),
          (outputGain.gain.value = masterVolume));
      },
      setPaused(te) {
        paused = !!te;
      },
      names: Object.keys(SFX_RECIPES).filter((te) => !SFX_RECIPES[te].ir),
      get intensity() {
        return intensity;
      },
      get interior() {
        return interior;
      },
      debug() {
        let te = 0,
          he = webAudioCtx.currentTime;
        for (let pe in voicePools) for (let ge of voicePools[pe]) ge.end > he && te++;
        return {
          state: webAudioCtx.state,
          sampleRate: webAudioCtx.sampleRate,
          buffers: bufferCount,
          queued: queue.length,
          genMs: Math.round(synthMs),
          bootMs: Math.round(bootMs),
          voices: te,
          loops: loops.size,
          tracked: tracked.size,
          music: music.on,
          intensity: +intensity.toFixed(2),
          interior: +interior.toFixed(2),
          gameState: gameState,
          reverb: [!!outdoorConvolver.buffer, !!indoorConvolver.buffer],
        };
      },
    }),
    api
  );
}
