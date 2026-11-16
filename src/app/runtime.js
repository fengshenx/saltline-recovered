// app/runtime.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { enableBenchmark } from './benchmark.js';

import { bootScreenEl, setBootProgress } from './boot-screen.js';

import { showFatalError } from './diagnostics.js';

import { createAudio } from '../audio/audio.js';

import { createCombat } from '../combat/combat.js';

import { createEventBus } from '../core/events.js';

import { FALLBACKS } from '../core/fallbacks.js';

import { createShadowMesh } from '../core/geometry.js';

import { chooseQuality } from '../core/quality.js';

import { createRng } from '../core/random.js';

import { createEffects } from '../effects/effects.js';

import { createEnemies } from '../enemies/enemies.js';

import { SHOWCASE_REGISTRY } from '../game.js';

import { createGameFlow } from '../game/flow.js';

import { createInput, createStubInput } from '../input/input.js';

import { createPlayer, createStubPlayer } from '../player/player.js';

import { createMaterials } from '../render/materials/materials.js';

import { createRenderer } from '../render/renderer.js';

import { createHUD } from '../ui/hud.js';

import { createWeapon } from '../weapons/weapon.js';

import { createBackdrop } from '../world/backdrop/backdrop.js';

import { createGround } from '../world/ground/ground.js';

import { createLevel } from '../world/level/level.js';

import { createPhysics } from '../world/physics.js';

import { createProps } from '../world/props/props.js';

/**
 * 弹壳落地事件的复用负载对象（位置加表面材质），避免每次反弹都新建对象触发 GC
 */
export var SHELL_BOUNCE_PAYLOAD = {
  pos: new THREE.Vector3(),
  surface: 'concrete',
};

/**
 * 完整启动序列：解析 URL 参数与画质、按顺序加载渲染/材质/物理/关卡/背景/地面/特效/音频/玩家/战斗/武器/敌人/HUD/主流程（每步失败可回退到 stub），挂 setAnimationLoop 组织每帧更新顺序与 wetness 室内插值，并暴露 __stats/__ready 供自动化截图判定
 */
export async function startGame() {
  let params = Object.fromEntries(new URLSearchParams(location.search)),
    benchMode = !!params.bench || location.hash === '#bench';
  benchMode && ((params.noaudio = '1'), (params.autostart = '1'));
  let game = {
    THREE: THREE,
    params: params,
    events: createEventBus(),
    rng: createRng(+(params.seed || 4207)),
    time: {
      t: 0,
      dt: 0,
      frame: 0,
      real: 0,
    },
    quality: chooseQuality(params.q || (params.shot ? 'test' : '')),
  };
  window.__G = game;
  let showcaseName = params.show && SHOWCASE_REGISTRY[params.show] ? params.show : null;
  game.showcase = showcaseName;
  let camOverride = null;
  function applyShot(h) {
    if (h.cam) {
      let f = String(h.cam).split(',').map(Number);
      camOverride = {
        pos: new THREE.Vector3(f[0], f[1], f[2]),
        look: new THREE.Vector3(f[3] ?? 0, f[4] ?? 1, f[5] ?? 0),
      };
    }
    (h.cam === '' && (camOverride = null),
      h.fov && ((game.camera.fov = +h.fov), game.camera.updateProjectionMatrix()),
      h.exposure && (game.render.exposure = +h.exposure));
  }
  window.__setShot = applyShot;
  async function loadModule(h, f, p, d = !1) {
    let v = performance.now();
    try {
      game[h] = await p();
    } catch (x) {
      if (
        (console.error(`[boot] module "${h}" failed: ${(x && x.stack) || x}`), d || !FALLBACKS[h])
      )
        throw x;
      game[h] = FALLBACKS[h]();
    }
    let g = performance.now() - v;
    g > 150 && console.log(`[boot] ${h} ${g.toFixed(0)}ms`);
  }
  if (
    (await setBootProgress('Waking the renderer', 0.04),
    await loadModule('render', 'render', () => createRenderer(game), !0),
    (game.renderer = game.render.renderer),
    (game.scene = game.render.scene),
    (game.camera = game.render.camera),
    (game.viewCamera = game.render.viewCamera),
    await setBootProgress('Mixing paint, rust and rain', 0.12),
    await loadModule('mats', 'materials', () => createMaterials(game)),
    (game.physics = createPhysics(game)),
    (game.props = createProps(game)),
    (game.input = showcaseName ? createStubInput() : createInput(game)),
    showcaseName)
  ) {
    let now = createShadowMesh(
      new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
      game.mats.get('concrete'),
      {
        cast: !1,
      },
    );
    if (
      (game.scene.add(now),
      (game.level = {
        stub: !0,
        playerStart: {
          pos: new THREE.Vector3(0, 0, 4),
          yaw: 0,
        },
        objectives: [],
        enemySpawns: [],
        zones: [],
        interiorBoxes: [],
        cinematicPath: [],
        extraction: {
          pos: new THREE.Vector3(),
          radius: 2,
        },
        groundSurfaceAt: () => 'concrete',
        update() {},
      }),
      (game.backdrop = FALLBACKS.backdrop()),
      (game.ground = FALLBACKS.ground()),
      game.physics.build(),
      showcaseName === 'fx')
    )
      await loadModule('fx', 'fx', () => createEffects(game));
    else
      try {
        game.fx = await createEffects(game);
      } catch {
        game.fx = FALLBACKS.fx();
      }
    ((game.audio = FALLBACKS.audio()),
      (game.hud = FALLBACKS.hud()),
      (game.player = createStubPlayer(game)),
      (game.combat = createCombat(game)),
      (game.weapon = FALLBACKS.weapon()),
      (game.enemies = FALLBACKS.enemies()),
      (game.game = {
        state: 'showcase',
        update: () => !1,
        start() {},
      }));
    let frameDt = null;
    try {
      frameDt = await SHOWCASE_REGISTRY[showcaseName].showcase(game);
    } catch (dt) {
      showFatalError(`showcase "${showcaseName}" threw: ${(dt && dt.stack) || dt}`);
    }
    ((game.showcaseInfo = frameDt || {}),
      frameDt &&
        frameDt.cam &&
        applyShot({
          cam: [...frameDt.cam, ...(frameDt.target || [0, 1, 0])].join(','),
        }));
  } else {
    if (
      (await setBootProgress('Stacking containers', 0.34),
      await loadModule('level', 'level', () => createLevel(game), !0),
      await setBootProgress('Raising the cranes', 0.5),
      await loadModule('backdrop', 'backdrop', () => createBackdrop(game)),
      await setBootProgress('Flooding the apron', 0.58),
      await loadModule('ground', 'ground', () => createGround(game)),
      game.ground.stub)
    ) {
      let now = createShadowMesh(
        new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
        game.mats.get('asphalt'),
        {
          cast: !1,
        },
      );
      game.scene.add(now);
    }
    (game.physics.build(),
      await setBootProgress('Loading tracers and smoke', 0.66),
      await loadModule('fx', 'fx', () => createEffects(game)),
      await loadModule('audio', 'audio', () =>
        params.noaudio ? FALLBACKS.audio() : createAudio(game),
      ),
      (game.player = createPlayer(game)),
      (game.combat = createCombat(game)),
      await setBootProgress('Checking the rifle', 0.74),
      await loadModule('weapon', 'weapon', () => createWeapon(game)),
      await setBootProgress('Waking the Harbormaster', 0.82),
      await loadModule('enemies', 'enemies', () => createEnemies(game)),
      await loadModule('hud', 'hud', () => createHUD(game)),
      (game.game = createGameFlow(game)));
  }
  await setBootProgress('Waiting for first light', 0.92);
  try {
    await game.render.onLevelReady();
  } catch (now) {
    console.error('[boot] render.onLevelReady failed: ' + ((now && now.stack) || now));
  }
  let fpsEma = 0;
  if (
    ((window.__stats = () => ({
      ...(game.render.stats ? game.render.stats() : {}),
      fps: fpsEma ? +(1 / fpsEma).toFixed(1) : 0,
      state: game.game && game.game.state,
    })),
    params.cam && applyShot(params),
    params.fov &&
      applyShot({
        fov: params.fov,
      }),
    !showcaseName && (params.shot || params.autostart))
  )
    try {
      game.game.start({
        skipIntro: !0,
      });
    } catch (now) {
      console.error('[boot] game.start failed', now);
    }
  (params.noweapon && game.weapon.setVisible && game.weapon.setVisible(!1),
    benchMode && enableBenchmark(game),
    await setBootProgress('Ready', 1),
    bootScreenEl.classList.add('done'),
    setTimeout(() => {
      bootScreenEl.hidden = !0;
    }, 700));
  let lastFrameTime = performance.now(),
    interiorWetness = 1,
    updateModule = (h, f) => {
      let p = game[h];
      if (p && p.update)
        try {
          p.update(f);
        } catch (d) {
          updateModule.err[h] ||
            ((updateModule.err[h] = 1),
            console.error(`[loop] ${h}.update threw: ${(d && d.stack) || d}`));
        }
    };
  ((updateModule.err = {}),
    game.renderer.setAnimationLoop(() => {
      let h = performance.now(),
        f = (h - lastFrameTime) / 1e3;
      ((lastFrameTime = h), (fpsEma = fpsEma ? fpsEma * 0.95 + f * 0.05 : f));
      let p = Math.min(f, 0.05);
      (params.dt && (p = +params.dt),
        (game.time.dt = p),
        (game.time.t += p),
        (game.time.real = h / 1e3),
        game.time.frame++,
        updateModule('input', p));
      let d = !1;
      try {
        d =
          game.game.update(p) !== !1 && game.game.state !== 'title' && game.game.state !== 'paused';
      } catch (v) {
        updateModule.err.game ||
          ((updateModule.err.game = 1),
          console.error('[loop] game.update threw: ' + ((v && v.stack) || v)));
      }
      if (showcaseName) {
        if (game.showcaseInfo.update)
          try {
            game.showcaseInfo.update(p);
          } catch (v) {
            updateModule.err.sc ||
              ((updateModule.err.sc = 1),
              console.error('[loop] showcase update threw: ' + ((v && v.stack) || v)));
          }
      } else
        d && (updateModule('player', p), updateModule('weapon', p), updateModule('enemies', p));
      if (
        game.weapon &&
        game.weapon.setWetness &&
        game.level &&
        game.level.interiorBoxes &&
        game.level.interiorBoxes[0]
      ) {
        let v = game.level.interiorBoxes[0],
          g = game.camera.position,
          x = g.x > v.min.x && g.x < v.max.x && g.z > v.min.z && g.z < v.max.z && g.y < v.max.y;
        interiorWetness += ((x ? 0.3 : 1) - interiorWetness) * Math.min(1, p * (x ? 0.25 : 0.6));
        try {
          game.weapon.setWetness(interiorWetness);
        } catch {}
      }
      (game.game.state !== 'paused' &&
        (updateModule('fx', p),
        updateModule('ground', p),
        updateModule('level', p),
        updateModule('backdrop', p),
        updateModule('mats', p)),
        updateModule('audio', p),
        updateModule('hud', p),
        camOverride &&
          (game.camera.position.copy(camOverride.pos), game.camera.lookAt(camOverride.look)),
        game.bench && game.bench.frame(f));
      try {
        game.render.frame(p);
      } catch (v) {
        updateModule.err.render ||
          ((updateModule.err.render = 1),
          console.error('[loop] render.frame threw: ' + ((v && v.stack) || v)));
      }
      (game.input.endFrame && game.input.endFrame(),
        window.__frames++,
        window.__frames === 2 && (window.__ready = !0));
    }));
}
