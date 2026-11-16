// app/flow.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { clamp, damp, saturate, smoothstep } from '../core/math.js';

import { createMenus } from '../ui/menus.js';

/**
 * 任务节奏表：开场时长、重生开场时长、交互距离与朝向阈值、切断中继耗时、开场巡逻数量、三波敌人配置、同时存活上限、刷怪间隔与远距离阈值、全暗后的追击强度、标题镜头速度与 FOV
 */
var MISSION_FLOW = {
  introSeconds: 3.5,
  retryIntroSeconds: 1.3,
  interactRange: 2.2,
  interactFacing: 0.45,
  cutSeconds: 2.4,
  patrol: {
    gull: 2,
    hound: 1,
  },
  waves: [
    {
      gull: 3,
      hound: 1,
    },
    {
      gull: 3,
      hound: 2,
    },
    {
      gull: 4,
      hound: 3,
    },
  ],
  maxAlive: 9,
  spawnStagger: 0.85,
  spawnFar: 18,
  pursuitEvery: 7,
  pursuitMinAlive: 4,
  pursuitExtra: 5,
  titleSpeed: 1.15,
  titleFov: 50,
};

/**
 * 八个方位的英文全称，用于把刷怪方向换算成无线电/警示里的口语方位
 */
var COMPASS_NAMES = [
  'NORTH',
  'NORTH-EAST',
  'EAST',
  'SOUTH-EAST',
  'SOUTH',
  'SOUTH-WEST',
  'WEST',
  'NORTH-WEST',
];

/**
 * Control 的无线电台词表：开场简报、首次接敌、切断一/二中继、全暗撤离、重伤、通关，是唯一的剧情文本源
 */
var CONTROL_RADIO_LINES = {
  intro:
    'Breacher, this is Control. The Harbormaster holds the berth. Cut its three uplinks \u2014 yard, shed, quay.',
  contact: 'It has seen you. Gulls fly, Hounds walk. Put them down.',
  cut: [
    'One relay dark. It felt that \u2014 machines inbound.',
    'Two dark. It is throwing everything it has left at you.',
  ],
  all: 'All three dark. The boat is holding at the quay ladder, south end. Run.',
  low: 'You are hit hard. Get behind steel and breathe.',
  done: 'Breacher is aboard. Saltline is dark. Good work.',
};

/**
 * 游戏主流程状态机：title/intro/playing/paused/dead/complete 六态推进，串联标题镜头、中继交互与切断、按镜头方向刷怪、全暗后的追击压力、音频强度与后处理淡入淡出，并输出胜负结算
 */
export function createGameFlow(ctx) {
  let post = (ctx.render && ctx.render.post) || {},
    baseSaturation = typeof post.saturation == 'number' ? post.saturation : 1,
    player = ctx.player,
    level = ctx.level,
    hud = ctx.hud,
    input = ctx.input,
    safeCall = (P, V, ...Y) => {
      try {
        if (P && typeof P[V] == 'function') return P[V](...Y);
      } catch (L) {
        console.error(`[game] ${V} threw`, L);
      }
    },
    menus = createMenus(ctx, {
      deploy() {
        (safeCall(ctx.audio, 'resume'), input.requestLock(), startRun({}));
      },
      resume() {
        resumeGame(!0);
      },
      restart() {
        (safeCall(ctx.audio, 'resume'),
          input.requestLock(),
          run.retries++,
          startRun({
            quick: !0,
            keepRetries: !0,
          }));
      },
      retry() {
        (safeCall(ctx.audio, 'resume'),
          input.requestLock(),
          run.retries++,
          startRun({
            quick: !0,
            keepRetries: !0,
          }));
      },
      redeploy() {
        (safeCall(ctx.audio, 'resume'),
          input.requestLock(),
          startRun({
            quick: !0,
          }));
      },
    });
  menus.applySettings();
  let run = {
      time: 0,
      retries: 0,
      relays: [],
      cut: 0,
      allCut: !1,
      queue: [],
      waveHot: 0,
      alertT: 0,
      pursuitT: 0,
      pursuitLeft: 0,
      contactSaid: !1,
      lowSaid: !1,
      extractHint: 0,
      intensity: 0.15,
      used: new Map(),
    },
    stateTime = 0,
    introSeconds = MISSION_FLOW.introSeconds,
    introCardShown = !1,
    introRadioDone = !1,
    inputGraceT = 0,
    spareTimer = 0,
    lockSeen = !1,
    lastLookMode = '',
    lookMsgT = 0.8,
    probePos = new THREE.Vector3(),
    probeLook = new THREE.Vector3(),
    objectives = () => (level && level.objectives) || [],
    flow = {
      state: 'title',
      flow: MISSION_FLOW,
      run: run,
      menus: menus,
      start(P = {}) {
        startRun({
          skipIntro: !!P.skipIntro,
          quick: !!P.quick,
        });
      },
      pause() {
        pauseGame();
      },
      resume() {
        resumeGame(!1);
      },
      update: update,
      debugCut() {
        let P = run.relays.find((V) => !V.cut);
        P && cutRelay(P);
      },
    };
  function setFlowState(P) {
    let V = flow.state;
    P !== V &&
      ((flow.state = P),
      (stateTime = 0),
      ctx.events.emit('game:state', {
        state: P,
        prev: V,
      }));
  }
  let cinematic = {
    pos: [],
    look: [],
    len: 1,
    t: 0,
  };
  function buildCinematic() {
    let P = (level && level.cinematicPath) || [];
    if (
      ((cinematic.pos = P.map((Y) => new THREE.Vector3(...Y.pos))),
      (cinematic.look = P.map((Y) => new THREE.Vector3(...Y.look))),
      cinematic.pos.length < 2)
    ) {
      let Y = (level && level.playerStart && level.playerStart.pos) || new THREE.Vector3();
      ((cinematic.pos = [new THREE.Vector3(Y.x, 2.2, Y.z), new THREE.Vector3(Y.x + 8, 2, Y.z)]),
        (cinematic.look = [
          new THREE.Vector3(Y.x + 30, 2.5, Y.z - 2),
          new THREE.Vector3(Y.x + 40, 3, Y.z - 2),
        ]));
    }
    let V = 0;
    for (let Y = 1; Y < cinematic.pos.length; Y++)
      V += cinematic.pos[Y].distanceTo(cinematic.pos[Y - 1]);
    cinematic.len = Math.max(V, 4);
  }
  function samplePath(P, V, Y) {
    let L = P.length - 1,
      Z = clamp(V, 0, 1) * L,
      J = Math.min(L - 1, Math.floor(Z)),
      oe = Z - J,
      fe = P[Math.max(0, J - 1)],
      le = P[J],
      R = P[J + 1],
      I = P[Math.min(L, J + 2)],
      se = oe * oe,
      ae = se * oe,
      k = (ce, ve, _e, Te) =>
        0.5 *
        (2 * ve +
          (-ce + _e) * oe +
          (2 * ce - 5 * ve + 4 * _e - Te) * se +
          (-ce + 3 * ve - 3 * _e + Te) * ae);
    return Y.set(k(fe.x, le.x, R.x, I.x), k(fe.y, le.y, R.y, I.y), k(fe.z, le.z, R.z, I.z));
  }
  function updateTitleCam(P) {
    let V = Math.max(26, cinematic.len / MISSION_FLOW.titleSpeed);
    ((cinematic.t += P), cinematic.t >= V && (cinematic.t = 0));
    let Y = cinematic.t / V,
      L = Y * Y * (3 - 2 * Y) * 0.25 + Y * 0.75,
      Z = ctx.camera,
      J = ctx.time.t;
    (samplePath(cinematic.pos, L, probePos),
      samplePath(cinematic.look, L, probeLook),
      (probePos.x += Math.sin(J * 0.31) * 0.05),
      (probePos.y += Math.sin(J * 0.43 + 1.7) * 0.035),
      (probePos.z += Math.sin(J * 0.27 + 0.6) * 0.05),
      (probeLook.y += Math.sin(J * 0.19) * 0.12),
      (probeLook.x += Math.sin(J * 0.13 + 2) * 0.2),
      Z.position.copy(probePos),
      Z.lookAt(probeLook),
      (Z.rotation.z += Math.sin(J * 0.21) * 0.006),
      !ctx.params.fov &&
        Math.abs(Z.fov - MISSION_FLOW.titleFov) > 0.01 &&
        ((Z.fov = MISSION_FLOW.titleFov), Z.updateProjectionMatrix()),
      (post.fade = Math.max(
        1 - smoothstep(0, 1.8, cinematic.t),
        smoothstep(V - 1.6, V, cinematic.t),
      )));
  }
  function resetRun() {
    (safeCall(ctx.enemies, 'clear'),
      safeCall(ctx.fx, 'clear'),
      safeCall(ctx.combat, 'reset'),
      safeCall(ctx.weapon, 'reset'),
      (run.time = 0),
      (run.cut = 0),
      (run.allCut = !1),
      (run.queue.length = 0),
      (run.waveHot = 0),
      (run.alertT = 0),
      (run.pursuitT = 0),
      (run.pursuitLeft = 0),
      (run.contactSaid = !1),
      (run.lowSaid = !1),
      (run.extractHint = 0),
      run.used.clear(),
      (run.relays = objectives().map((P, V) => {
        let Y = (/([a-z0-9])$/i.exec(String(P.id || '')) || [
          0,
          String.fromCharCode(65 + V),
        ])[1].toUpperCase();
        return (
          setRelayState(P, 'live'),
          {
            o: P,
            id: P.id || 'relay_' + V,
            short: Y,
            t: 0,
            cut: !1,
            cutting: !1,
          }
        );
      })),
      player.reset(level.playerStart),
      hud.reset && hud.reset(),
      (post.saturation = baseSaturation),
      (post.flash = 0),
      refreshMarkers(),
      hud.setRelays && hud.setRelays(0, run.relays.length),
      spawnPatrols());
  }
  function setRelayState(P, V) {
    try {
      let Y = P && P.object && P.object.userData;
      Y && typeof Y.setState == 'function' && Y.setState(V);
    } catch (Y) {
      console.error('[game] relay setState threw', Y);
    }
  }
  function refreshMarkers() {
    if (!hud.setMarkers) return;
    let P = run.relays
      .filter((V) => !V.cut)
      .map((V) => ({
        id: V.id,
        short: V.short,
        label: V.o.label || 'Relay ' + V.short,
        pos: V.o.pos,
        kind: 'relay',
      }));
    (run.allCut &&
      level.extraction &&
      P.push({
        id: 'extract',
        short: 'EX',
        label: 'Boat',
        pos: level.extraction.pos,
        kind: 'extract',
      }),
      hud.setMarkers(P));
  }
  function startRun({ skipIntro: P = !1, quick: V = !1, keepRetries: Y = !1 } = {}) {
    if (
      (Y || (run.retries = 0),
      menus.show('none'),
      menus.locationCard(!1),
      safeCall(ctx.audio, 'setPaused', !1),
      resetRun(),
      safeCall(ctx.weapon, 'setVisible', !0),
      (lockSeen = !1),
      P)
    ) {
      ((post.fade = 0), beginPlay());
      return;
    }
    ((introSeconds = V ? MISSION_FLOW.retryIntroSeconds : MISSION_FLOW.introSeconds),
      (introCardShown = V),
      (introRadioDone = V),
      (player.enabled = !1),
      input.setGameplay && input.setGameplay(!1),
      hud.show(!1),
      (post.fade = 1),
      safeCall(ctx.audio, 'setIntensity', 0.15),
      setFlowState('intro'));
  }
  function beginPlay() {
    ((player.enabled = !0),
      hud.show(!0),
      input.setGameplay && input.setGameplay(!0),
      hud.setObjective(objectiveText()),
      setFlowState('playing'),
      refreshLookMode(!0));
  }
  function objectiveText() {
    if (run.allCut) return 'Get to the boat';
    let P = run.relays.length - run.cut;
    return run.cut === 0
      ? 'Cut the three uplink relays'
      : P === 1
        ? 'Cut the last relay'
        : `Cut the remaining ${P} relays`;
  }
  function refreshLookMode(P) {
    let V = input.describeMode ? input.describeMode() : '';
    (menus.setLookMode(V),
      !(!P && V === lastLookMode) &&
        ((lastLookMode = V),
        flow.state === 'playing' &&
        (input.mode === 'drag' ||
          (input.mode === 'lock' && !input.locked && !ctx.params.shot && !ctx.params.autostart))
          ? hud.message(V, input.mode === 'drag' ? 7 : 4)
          : flow.state === 'playing' && input.locked && hud.message('', 0)));
  }
  (input.onModeChange && input.onModeChange(() => refreshLookMode(!1)),
    ctx.events.on('input:lock', (P) => {
      if (P.locked) {
        ((lockSeen = !0), refreshLookMode(!1));
        return;
      }
      (flow.state === 'playing' && lockSeen && pauseGame(), (lockSeen = !1));
    }),
    document.addEventListener('visibilitychange', () => {
      document.hidden && flow.state === 'playing' && pauseGame();
    }),
    addEventListener('keydown', (P) => {
      flow.state !== 'title' ||
        menus.panelOpen ||
        (P.code !== 'Enter' && P.code !== 'NumpadEnter') ||
        (P.target && P.target.tagName === 'BUTTON') ||
        (safeCall(ctx.audio, 'resume'), input.requestLock(), startRun({}));
    }));
  function pauseGame() {
    flow.state === 'playing' &&
      (input.setGameplay && input.setGameplay(!1),
      input.exitLock(),
      safeCall(ctx.audio, 'setPaused', !0),
      menus.setLookMode(
        input.mode === 'drag'
          ? input.describeMode()
          : input.touch
            ? ''
            : 'Resume recaptures the mouse.',
      ),
      hud.show(!1),
      menus.show('paused'),
      (inputGraceT = 0.35),
      setFlowState('paused'));
  }
  function resumeGame(P) {
    flow.state === 'paused' &&
      (menus.show('none'),
      safeCall(ctx.audio, 'setPaused', !1),
      hud.show(!0),
      input.setGameplay && input.setGameplay(!0),
      (lockSeen = !1),
      input.requestLock(),
      setFlowState('playing'),
      setTimeout(() => refreshLookMode(!0), 700));
  }
  function spawnPoolFor(P) {
    let V = P === 'gull' ? 'air' : 'ground',
      Y = (level && level.enemySpawns) || [],
      L = Y.filter((Z) => Z.type === V);
    return L.length ? L : Y;
  }
  function pickSpawnPoint(
    P,
    { minDist: V = MISSION_FLOW.spawnFar, from: Y = player.pos, preferHidden: L = !0 } = {},
  ) {
    let Z = spawnPoolFor(P),
      J = null,
      oe = -1e9;
    for (let le of Z) {
      let R = Math.hypot(le.pos.x - Y.x, le.pos.z - Y.z),
        I = ctx.rng() * 1.5;
      if (((I += R >= V ? 2 + Math.min(1, (R - V) / 30) * 0.5 : -(V - R) / 4), L)) {
        (probePos.copy(le.pos), (probePos.y += P === 'gull' ? 0 : 1));
        let ae = !0;
        try {
          ae = ctx.physics.lineOfSight(probePos, player.eye);
        } catch {}
        ae || (I += 2.5);
      }
      let se = run.used.get(le);
      (se !== void 0 && run.time - se < 6 && (I -= 3), I > oe && ((oe = I), (J = le)));
    }
    let fe = new THREE.Vector3();
    if (J) {
      (run.used.set(J, run.time), fe.copy(J.pos));
      let le = (ctx.rng() - 0.5) * 2.4,
        R = (ctx.rng() - 0.5) * 2.4,
        I = P === 'gull';
      try {
        I || (I = ctx.physics.nav.isWalkable(fe.x + le, fe.z + R));
      } catch {
        I = !1;
      }
      I && ((fe.x += le), (fe.z += R));
    } else {
      let le = ctx.rng() * Math.PI * 2;
      fe.set(clamp(Y.x + Math.cos(le) * 26, -34, 26), 0, clamp(Y.z + Math.sin(le) * 26, -26, 24));
    }
    return (P === 'gull' && fe.y < 2.5 && (fe.y = 6 + ctx.rng() * 3), fe);
  }
  function spawnEnemy(P, V, Y) {
    let L = null;
    try {
      L = ctx.enemies.spawn(P, V, Y);
    } catch (Z) {
      console.error('[game] enemies.spawn threw', Z);
    }
    return L;
  }
  function spawnPatrols() {
    let P = (level.playerStart && level.playerStart.pos) || player.pos;
    for (let V of ['gull', 'hound'])
      for (let Y = 0; Y < MISSION_FLOW.patrol[V]; Y++)
        spawnEnemy(
          V,
          pickSpawnPoint(V, {
            minDist: 32,
            from: P,
            preferHidden: !0,
          }),
          {
            state: 'patrol',
          },
        );
  }
  function queueWave(P) {
    let V = MISSION_FLOW.waves[Math.min(P, MISSION_FLOW.waves.length - 1)],
      Y = [];
    for (let oe = 0; oe < V.gull; oe++) Y.push('gull');
    for (let oe = 0; oe < V.hound; oe++) Y.splice(Math.min(Y.length, 1 + oe * 2), 0, 'hound');
    let L = 0,
      Z = 0;
    (Y.forEach((oe, fe) => {
      let le = pickSpawnPoint(oe);
      ((L += le.x - player.pos.x),
        (Z += le.z - player.pos.z),
        run.queue.push({
          type: oe,
          pos: le,
          at: run.time + 1.6 + fe * MISSION_FLOW.spawnStagger,
        }));
    }),
      (run.waveHot = 30));
    let J = ((Math.atan2(L, -Z) * 180) / Math.PI + 360) % 360;
    hud.warn && hud.warn('Contact \u2014 ' + COMPASS_NAMES[Math.round(J / 45) % 8], 3.4);
  }
  function pumpSpawnQueue(P) {
    let V = aliveCount();
    for (let Y = 0; Y < run.queue.length; Y++) {
      let L = run.queue[Y];
      if (run.time < L.at) continue;
      if (V >= MISSION_FLOW.maxAlive) {
        L.at = run.time + 1;
        continue;
      }
      if (
        !spawnEnemy(L.type, L.pos, {
          state: 'alert',
          target: player.pos,
        }) &&
        !ctx.enemies.stub &&
        (L.tries = (L.tries || 0) + 1) < 6
      ) {
        L.at = run.time + 1.5;
        continue;
      }
      (run.queue.splice(Y, 1), safeCall(ctx.enemies, 'alert', player.pos, 60));
      break;
    }
    if (run.allCut) {
      if (
        ((run.pursuitT -= P),
        run.pursuitT <= 0 &&
          run.pursuitLeft > 0 &&
          !run.queue.length &&
          V < MISSION_FLOW.pursuitMinAlive)
      ) {
        ((run.pursuitT = MISSION_FLOW.pursuitEvery), run.pursuitLeft--);
        let Y = ctx.rng() < 0.6 ? 'gull' : 'hound';
        run.queue.push({
          type: Y,
          pos: pickSpawnPoint(Y),
          at: run.time + 0.5,
        });
      }
      run.pursuitT <= 0 && ((run.pursuitT = 4), safeCall(ctx.enemies, 'alert', player.pos, 90));
    }
  }
  function aliveCount() {
    try {
      return ctx.enemies.aliveCount
        ? ctx.enemies.aliveCount()
        : ctx.enemies.list.filter((P) => P.alive).length;
    } catch {
      return 0;
    }
  }
  function enemyNear(P) {
    let V = (ctx.enemies && ctx.enemies.list) || [];
    for (let Y = 0; Y < V.length; Y++) {
      let L = V[Y];
      if (L && L.alive && L.pos && Math.hypot(L.pos.x - player.pos.x, L.pos.z - player.pos.z) < P)
        return !0;
    }
    return !1;
  }
  (ctx.events.on('enemy:alert', () => {
    ((run.alertT = 10),
      flow.state === 'playing' &&
        !run.contactSaid &&
        ((run.contactSaid = !0), hud.radio && hud.radio(CONTROL_RADIO_LINES.contact, 3.2)));
  }),
    ctx.events.on('player:hit', () => {
      run.alertT = Math.max(run.alertT, 8);
    }),
    ctx.events.on('player:rescued', () => {
      flow.state === 'playing' && hud.message('Hauled out of the water', 2.5);
    }));
  function relayInRange() {
    let P = null,
      V = MISSION_FLOW.interactRange;
    for (let Y of run.relays) {
      if (Y.cut) continue;
      let L = Y.o.pos.x - player.pos.x,
        Z = Y.o.pos.z - player.pos.z,
        J = Math.hypot(L, Z);
      J > V ||
        Math.abs((Y.o.pos.y || 0) - player.pos.y) > 2.5 ||
        (J > 0.9 &&
          (L * player.forward.x + Z * player.forward.z) /
            (J * Math.max(0.2, Math.hypot(player.forward.x, player.forward.z))) <
            MISSION_FLOW.interactFacing) ||
        ((P = Y), (V = J));
    }
    return P;
  }
  function updateObjectives(P) {
    let V = player.alive ? relayInRange() : null;
    for (let L of run.relays)
      L.cut ||
        (L === V && input.down('interact')
          ? (L.cutting || ((L.cutting = !0), setRelayState(L.o, 'cutting')),
            (L.t += P / MISSION_FLOW.cutSeconds),
            ctx.events.emit('objective:progress', {
              id: L.id,
              t: Math.min(1, L.t),
            }),
            L.t >= 1 && cutRelay(L))
          : L.t > 0 &&
            ((L.t = Math.max(0, L.t - P * 1.6)),
            L.cutting &&
              ((L.cutting = !1),
              setRelayState(L.o, 'live'),
              ctx.events.emit('objective:progress', {
                id: L.id,
                t: 0,
              }))));
    V && !V.cut
      ? hud.setPrompt && hud.setPrompt('Cut relay ' + V.short, saturate(V.t))
      : hud.setPrompt && hud.setPrompt(null);
    let Y = level.extraction;
    if (Y && Y.pos) {
      let L = Math.hypot(Y.pos.x - player.pos.x, Y.pos.z - player.pos.z),
        Z = L < (Y.radius || 2.5) && Math.abs(Y.pos.y - player.pos.y) < 3.5;
      (Z && run.allCut && player.alive
        ? finishMission()
        : Z &&
          !run.allCut &&
          run.extractHint <= 0 &&
          ((run.extractHint = 8),
          hud.message('Relays still live \u2014 the boat will not wait under fire', 3.5)),
        (run.extractHint = Math.max(0, run.extractHint - P)));
    }
  }
  function cutRelay(P) {
    ((P.cut = !0), (P.cutting = !1), (P.t = 1), run.cut++, setRelayState(P.o, 'cut'));
    let V = run.relays.length;
    (ctx.events.emit('objective:done', {
      id: P.id,
      index: run.cut,
      total: V,
    }),
      hud.setRelays && hud.setRelays(run.cut, V),
      hud.setPrompt && hud.setPrompt(null),
      player.addShake(0.18),
      queueWave(run.cut - 1),
      run.cut >= V
        ? ((run.allCut = !0),
          (run.pursuitLeft = MISSION_FLOW.pursuitExtra),
          (run.pursuitT = 12),
          ctx.events.emit('objective:all', {}),
          hud.radio && hud.radio(CONTROL_RADIO_LINES.all, 4.5))
        : hud.radio &&
          hud.radio(
            CONTROL_RADIO_LINES.cut[Math.min(run.cut - 1, CONTROL_RADIO_LINES.cut.length - 1)],
            3.6,
          ),
      hud.setObjective(objectiveText()),
      refreshMarkers());
  }
  ctx.events.on('player:dead', () => {
    (flow.state !== 'playing' && flow.state !== 'paused') ||
      (input.setGameplay && input.setGameplay(!1),
      input.exitLock(),
      hud.setPrompt && hud.setPrompt(null),
      hud.show(!1),
      hud.clearRadio && hud.clearRadio(),
      menus.setDead({
        time: run.time,
        relays: run.cut,
        total: run.relays.length,
      }),
      setFlowState('dead'));
  });
  function finishMission() {
    ((player.invulnerable = !0),
      (player.enabled = !1),
      input.setGameplay && input.setGameplay(!1),
      input.exitLock(),
      hud.setPrompt && hud.setPrompt(null),
      hud.show(!1),
      ctx.events.emit('extraction:reached', {}),
      hud.clearRadio && hud.clearRadio(),
      hud.radio && hud.radio(CONTROL_RADIO_LINES.done, 2.2));
    let P = (ctx.combat && ctx.combat.stats) || {
        shots: 0,
        hits: 0,
        kills: 0,
      },
      V = P.shots > 0 ? clamp(P.hits / P.shots, 0, 1) : null,
      Y =
        (run.time < 270 ? 2 : run.time < 400 ? 1 : 0) +
        (V >= 0.5 ? 2 : V >= 0.3 ? 1 : 0) +
        (run.retries === 0 ? 1 : 0),
      L = ['Messy', 'Loud', 'Steady', 'Clean', 'Sharp', 'Surgical'][Y];
    (menus.setDebrief({
      time: run.time,
      accuracy: V,
      kills: P.kills || 0,
      retries: run.retries,
      rating: L,
    }),
      setFlowState('complete'));
  }
  function update(P) {
    switch (((stateTime += P), flow.state)) {
      case 'title':
        return (updateTitleCam(P), !1);
      case 'intro':
        return (
          (post.fade = 1 - smoothstep(0.25, Math.min(introSeconds, 2.6), stateTime)),
          !introCardShown && stateTime > 0.5 && ((introCardShown = !0), menus.locationCard(!0)),
          !introRadioDone &&
            stateTime > 1.3 &&
            ((introRadioDone = !0), hud.radio && hud.radio(CONTROL_RADIO_LINES.intro, 4.2)),
          stateTime > introSeconds - 0.6 &&
            !hud.root?.classList.contains('on') &&
            (hud.show(!0), hud.setObjective(objectiveText())),
          stateTime >= introSeconds && (menus.locationCard(!1), (post.fade = 0), beginPlay()),
          !0
        );
      case 'playing': {
        if (
          ((run.time += P),
          (post.fade = damp(post.fade || 0, 0, 6, P)),
          inputGraceT > 0 && (inputGraceT -= P),
          input.pressed('pause'))
        )
          return (pauseGame(), !1);
        if ((updateObjectives(P), flow.state !== 'playing')) return !0;
        (pumpSpawnQueue(P),
          (run.alertT = Math.max(0, run.alertT - P)),
          (run.waveHot = Math.max(0, run.waveHot - P)));
        let V = aliveCount();
        run.waveHot > 0 && V === 0 && !run.queue.length && run.waveHot < 24 && (run.waveHot = 0);
        let Y =
          run.allCut || run.queue.length || (run.waveHot > 0 && V > 0)
            ? 1
            : run.alertT > 0 || (V > 0 && enemyNear(26))
              ? 0.6
              : 0.15;
        return (
          Y !== run.intensity && ((run.intensity = Y), safeCall(ctx.audio, 'setIntensity', Y)),
          input.mode === 'lock' &&
          !input.locked &&
          !input.touch &&
          !ctx.params.shot &&
          !ctx.params.autostart
            ? ((lookMsgT -= P),
              lookMsgT <= 0 && ((lookMsgT = 2), hud.message(input.describeMode(), 2.6)))
            : (lookMsgT = 0.8),
          !run.lowSaid &&
            player.alive &&
            player.health < 30 &&
            ((run.lowSaid = !0), hud.radio && hud.radio(CONTROL_RADIO_LINES.low, 3)),
          !0
        );
      }
      case 'paused':
        return (
          inputGraceT > 0
            ? (inputGraceT -= P)
            : input.pressed('pause') && (menus.closePanel() || resumeGame(!1)),
          !1
        );
      case 'dead':
        return (
          (post.saturation = damp(post.saturation ?? 1, 0.12, 2.2, P)),
          (post.fade = damp(post.fade || 0, 0.55, 1.4, P)),
          stateTime > 1.5 &&
            menus.screen !== 'dead' &&
            (menus.show('dead'), safeCall(ctx.audio, 'setIntensity', 0.15)),
          !0
        );
      case 'complete':
        return (
          (post.fade = damp(post.fade || 0, 0.72, 0.9, P)),
          (post.saturation = damp(post.saturation ?? 1, baseSaturation * 0.7, 1, P)),
          stateTime > 3.3 &&
            menus.screen !== 'complete' &&
            (menus.show('complete'), safeCall(ctx.audio, 'setIntensity', 0.15)),
          !0
        );
    }
    return !1;
  }
  return (
    buildCinematic(),
    (player.enabled = !1),
    hud.show(!1),
    safeCall(ctx.weapon, 'setVisible', !1),
    input.setGameplay && input.setGameplay(!1),
    safeCall(ctx.audio, 'setIntensity', 0.15),
    ctx.params.shot || ctx.params.autostart || menus.show('title'),
    flow
  );
}
