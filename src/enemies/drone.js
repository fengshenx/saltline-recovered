// enemies/drone.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { clampHound, rayCapsule, raySphere, springStep, wrapAngleHound } from '../core/math.js';

import {
  HOUND_GAIT_PAIRS,
  HOUND_LENS_ENGAGED,
  HOUND_LENS_IDLE,
  HOUND_RIG_ALIAS,
  HOUND_TUNE_ALIAS,
  HOUND_UP,
  LEG_IK_OUT,
  houndAimPoint,
  houndBodyEnd,
  houndBodyStart,
  houndDir,
  houndScratch,
  houndTracerEnd,
} from './walker.js';

import { buildSkinnedRig, solveLegIK } from '../weapons/rig.js';

/**
 * gull 四旋翼机的锚点表：四个旋翼位置、云台/球机/机炮/枪口/探照灯的局部坐标，骨骼与部件摆放都引这张表
 */
export var GULL_RIG = {
  rotors: [
    [0.33, 0.035, 0.3],
    [-0.33, 0.035, 0.3],
    [0.33, 0.035, -0.3],
    [-0.33, 0.035, -0.3],
  ],
  gimbal: [0, -0.095, 0.275],
  ball: [0, -0.072, 0],
  gun: [0, -0.085, -0.1],
  muzzle: [0, -0.032, 0.27],
  lamp: [0, -0.066, 0.025],
};

/**
 * 用旋转体轮廓生成旋翼桨毂外罩（lathe），比堆圆柱更贴合曲线外壳，四个旋翼共用同一份几何
 */
export function createRotorBellGeometry() {
  let bellProfile = [
    [0.176, -0.036],
    [0.196, -0.032],
    [0.206, 0],
    [0.202, 0.03],
    [0.19, 0.04],
    [0.178, 0.032],
    [0.173, 0],
    [0.176, -0.036],
  ].map((e) => new THREE.Vector2(e[0], e[1]));
  return new THREE.LatheGeometry(bellProfile, 28);
}

/**
 * gull 的战斗数值：血量、电浆弹伤害/弹速、三连发间隔、预警时长、冷却区间、环绕半径/高度范围、散布与爆炸参数
 */
export var GULL_TUNE = {
  hp: 45,
  boltDamage: 7,
  boltSpeed: 70,
  burst: 3,
  burstGap: 0.12,
  telegraph: 0.55,
  cooldown: [1.9, 3.3],
  rangeMin: 12,
  rangeMax: 25,
  altMin: 4,
  altMax: 8,
  maxSpeed: 8,
  patrolSpeed: 3,
  accel: 11,
  spreadFar: 0.065,
  spreadNear: 0.018,
  fireRange: 42,
  explodeRadius: 3,
  explodeDamage: 30,
};

/**
 * GULL_TUNE 在 gull AI 作用域内的短别名，所有数值读取都走它，改表即改行为
 */
export var GULL_TUNE_ALIAS = GULL_TUNE;

/**
 * gull 每帧复用的临时向量（视线差、爆点、火花方向），避免在 AI 循环里分配对象
 */
export var gullScratch = new THREE.Vector3();

/**
 * gull 域预留的临时向量，当前代码里未被引用，保号以免后续改动破坏声明顺序
 */
var gullSpareA = new THREE.Vector3();

/**
 * gull 的临时方向向量（射线方向、射击方向），每帧复用
 */
export var gullDir = new THREE.Vector3();

/**
 * gull 的期望加速度蓄水池：把悬停、环绕、闪避、受伤抖动全部累加后再限幅成加速度，是飞行手感的核心中间量
 */
export var gullSteer = new THREE.Vector3();

/**
 * gull 域预留的临时向量，当前代码里未被引用
 */
var gullSpareB = new THREE.Vector3();

/**
 * gull 云台要看向的世界点（玩家、可疑点或巡逻扫视点），云台偏航/俯仰都朝它收敛
 */
export var gullAimPoint = new THREE.Vector3();

/**
 * 单位 Y 轴常量，用于把局部偏移按偏航角旋转到世界方向（applyAxisAngle）
 */
export var AXIS_UP = new THREE.Vector3(0, 1, 0);

/**
 * 单位 -Y 轴常量，作为向下探测（防撞天花板/地面）的射线方向
 */
export var AXIS_DOWN = new THREE.Vector3(0, -1, 0);

/**
 * gull 镜头在非交战态的 RGB 发光色，冷白光表示还在巡逻
 */
export var GULL_LENS_IDLE = [8, 4, 0.7];

/**
 * gull 镜头在交战态的 RGB 发光色，炽白偏红作为攻击预警的视觉语言
 */
export var GULL_LENS_ENGAGED = [14, 1, 0.35];

/**
 * hound 四足机的完整实体工厂：装配蒙皮与脚步 IK、注册 damage/_activate/_deactivate/_raycast/_update，内部实现巡逻/调查/交战状态机、A* 寻路跟随、掩体选点、预警-点射-扑咬三套攻击、程序化步态与死亡垮塌
 */
export function createDrone(ctx, rigDef, materials, index) {
  let simState = ctx.G,
    rand = ctx.rng,
    lensMat = materials.lensBase.clone(),
    rig = buildSkinnedRig(
      rigDef,
      {
        shell: materials.shell,
        metal: materials.metal,
        glow: materials.glow,
        lens: lensMat,
      },
      {
        radius: 1.5,
        center: [0, 0.6, 0],
      },
    ),
    bones = rig.bones;
  rig.group.visible = !1;
  let abdomenBones = [],
    thighBones = [],
    shinBones = [];
  for (let dt = 0; dt < 4; dt++)
    (abdomenBones.push(bones['abd' + HOUND_RIG_ALIAS.legs[dt]]),
      thighBones.push(bones['thigh' + HOUND_RIG_ALIAS.legs[dt]]),
      shinBones.push(bones['shin' + HOUND_RIG_ALIAS.legs[dt]]));
  let labelDef = simState.mats.label('H-' + String(index + 3).padStart(2, '0'), {
      color: 'black',
      font: 'stencil',
      distress: 0.3,
    }),
    labelWidth = 0.2,
    labelHeight = Math.min(0.085, labelWidth / (labelDef.aspect || 3)),
    labelPlaneR = new THREE.PlaneGeometry(labelWidth, labelHeight);
  (labelPlaneR.rotateY(Math.PI / 2), labelPlaneR.translate(0.1675, 0.03, -0.085));
  let labelPlaneL = new THREE.PlaneGeometry(labelWidth, labelHeight);
  (labelPlaneL.rotateY(-Math.PI / 2), labelPlaneL.translate(-0.1675, 0.03, -0.085));
  let labelGeom = ctx.mergeSimple([labelPlaneR, labelPlaneL]),
    labelMesh = new THREE.Mesh(labelGeom, labelDef.material);
  ((labelMesh.castShadow = !1), (labelMesh.receiveShadow = !0), bones.body.add(labelMesh));
  let feet = [0, 1, 2, 3].map(() => ({
      p: new THREE.Vector3(),
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      slide: new THREE.Vector3(),
    })),
    hound = {
      id: 0,
      type: 'hound',
      pos: rig.group.position,
      alive: !1,
      hp: HOUND_TUNE_ALIAS.hp,
      active: !1,
      rig: rig,
      lens: lensMat,
      feet: feet,
      yaw: 0,
      speed: 0,
      yawRate: 0,
      home: new THREE.Vector3(),
      lastKnown: new THREE.Vector3(),
      goal: new THREE.Vector3(),
      firePos: new THREE.Vector3(),
      firePlayer: new THREE.Vector3(),
      sensor: new THREE.Vector3(),
      fwd: new THREE.Vector3(0, 0, 1),
      muzzle: new THREE.Vector3(),
      headPos: new THREE.Vector3(),
      push: new THREE.Vector3(),
      mode: 'patrol',
      los: !1,
      seeT: 0,
      noSeeT: 0,
      senseT: 0,
      exposure: 0,
      modeT: 0,
      passive: !1,
      hasToken: !1,
      es: 'move',
      esT: 0,
      cool: 1,
      shots: 0,
      bursts: 0,
      lungeCd: 0,
      path: null,
      wp: 0,
      planT: 0,
      hasGoal: !1,
      waitT: 0,
      moveT: 0,
      stuckT: 0,
      sw: -1,
      swT: 0,
      swDur: 0.2,
      lastPair: 1,
      idleT: 0,
      lift: 0.08,
      sY: {
        x: 0,
        v: 0,
      },
      sP: {
        x: 0,
        v: 0,
      },
      sR: {
        x: 0,
        v: 0,
      },
      sL: {
        x: 0,
        v: 0,
      },
      sA: {
        x: 0,
        v: 0,
      },
      sA2: {
        x: 0,
        v: 0,
      },
      crouch: 0,
      tyaw: 0,
      tpitch: 0,
      hyaw: 0,
      hpitch: 0,
      flare: 0,
      lensC: [HOUND_LENS_IDLE[0], HOUND_LENS_IDLE[1], HOUND_LENS_IDLE[2]],
      smokeT: 0,
      phase: 0,
      scan: 0,
      dieT: 0,
      vy: 0,
      dieRoll: 0,
      diePitch: 0,
      wreck: !1,
      sink: 0,
      loop: null,
      prevSpeed: 0,
      maxSpeed: HOUND_TUNE_ALIAS.patrolSpeed,
      damage(T, D, C, G) {
        if (!hound.alive) return !1;
        if (
          ((hound.hp -= T),
          simState.events.emit('enemy:hit', {
            enemy: hound,
            point: D,
            part: G || 'body',
          }),
          C)
        ) {
          let j = Math.cos(hound.yaw),
            N = Math.sin(hound.yaw),
            Q = Math.min(1.6, T / 28),
            K = C.x * N + C.z * j,
            ie = C.x * j - C.z * N;
          ((hound.sL.v += ie * 1.4 * Q),
            (hound.sR.v += -ie * 3.2 * Q),
            (hound.sP.v += K * 2.4 * Q * (G === 'weak' ? 1.6 : 1)),
            (hound.sY.v -= 0.5 * Q));
        }
        return (ctx.provoke(hound), hound.hp <= 0 ? (killHound(C), !0) : !1);
      },
      _activate(T, D = {}) {
        ((hound.active = !0),
          (hound.alive = !0),
          (hound.wreck = !1),
          (hound.hp = HOUND_TUNE_ALIAS.hp),
          (hound.passive = !!D.passive),
          (hound.sink = 0),
          hound.pos.copy(T),
          (hound.pos.y = simState.physics.groundHeight(T.x, T.z, T.y + 1)),
          hound.home.copy(hound.pos),
          (hound.yaw = D.yaw ?? rand() * 6.283),
          (hound.speed = 0),
          (hound.yawRate = 0),
          hound.push.set(0, 0, 0),
          (hound.mode = D.state === 'alert' ? 'investigate' : 'patrol'),
          (hound.modeT = 10),
          (hound.modeSeen = hound.mode),
          hound.lastKnown.copy(D.target || (simState.player ? simState.player.pos : T)),
          (hound.los = !1),
          (hound.seeT = hound.noSeeT = 0),
          (hound.exposure = 0),
          (hound.senseT = rand() * 0.2),
          (hound.hasToken = !1),
          (hound.patrolR = D.patrolRadius ?? 7),
          (hound.patrolLine = D.patrolLine || null),
          (hound.patrolI = 0),
          (hound.es = 'move'),
          (hound.cool = 0.6 + rand()),
          (hound.lungeCd = 0.3),
          (hound.path = null),
          (hound.hasGoal = !1),
          (hound.waitT = rand() * 1.5),
          (hound.planT = 0),
          (hound.sw = -1),
          (hound.idleT = 0),
          (hound.crouch = 0),
          (hound.feelT = 0),
          (hound.blocked = !1),
          (hound.flare = 0),
          (hound.phase = rand() * 6.283),
          (hound.dieT = 0),
          (hound.tyaw = hound.hyaw = 0),
          (hound.tpitch = hound.hpitch = 0));
        for (let C of [hound.sY, hound.sP, hound.sR, hound.sL, hound.sA, hound.sA2])
          ((C.x = 0), (C.v = 0));
        for (let C = 0; C < 4; C++) footLocalPos(feet[C].p, C, hound.pos.x, hound.pos.z, hound.yaw);
        if (
          (bones.neck.rotation.set(0, 0, 0),
          bones.gun.rotation.set(0, 0, 0),
          (rig.group.visible = !0),
          poseRig(0.016),
          simState.audio && simState.audio.loop && !hound.loop)
        )
          try {
            hound.loop = simState.audio.loop('hound_servo', {
              pos: hound.pos,
              gain: 0,
            });
          } catch {
            hound.loop = null;
          }
      },
      _deactivate() {
        if (
          ((hound.active = !1),
          (hound.alive = !1),
          (hound.wreck = !1),
          (rig.group.visible = !1),
          ctx.releaseToken(hound),
          hound.loop)
        ) {
          try {
            hound.loop.stop();
          } catch {}
          hound.loop = null;
        }
      },
      _raycast(T, D, C, G) {
        let j = !1;
        raySphere(T, D, hound.headPos, 0.155, C, G) &&
          ((G.part = 'weak'), (G.enemy = hound), (j = !0));
        let N = Math.cos(hound.yaw),
          Q = Math.sin(hound.yaw),
          K = hound.pos.y + HOUND_RIG_ALIAS.stand + hound.sY.x - hound.crouch;
        return (
          houndBodyStart.set(hound.pos.x - Q * 0.45, K + 0.03, hound.pos.z - N * 0.45),
          houndBodyEnd.set(hound.pos.x + Q * 0.47, K + 0.03, hound.pos.z + N * 0.47),
          rayCapsule(T, D, houndBodyStart, houndBodyEnd, 0.27, C, G) &&
            ((G.part = 'body'), (G.enemy = hound), (j = !0)),
          (houndBodyStart.y = houndBodyEnd.y = hound.pos.y + (K - hound.pos.y) * 0.45),
          rayCapsule(T, D, houndBodyStart, houndBodyEnd, 0.25, C, G) &&
            ((G.part = 'body'), (G.enemy = hound), (j = !0)),
          j
        );
      },
      _update(T) {
        hound.alive ? updateAlive(T) : updateDead(T);
      },
    };
  function footLocalPos(T, D, C, G, j) {
    let N = HOUND_RIG_ALIAS.side[D] * HOUND_RIG_ALIAS.footX,
      Q = HOUND_RIG_ALIAS.footZ[D],
      K = Math.cos(j),
      ie = Math.sin(j);
    return (T.set(C + N * K + Q * ie, 0, G - N * ie + Q * K), T);
  }
  function setGoal(T, D) {
    (!D && hound.hasGoal && hound.goal.distanceToSquared(T) < 0.25) ||
      (hound.goal.copy(T), (hound.hasGoal = !0), (hound.planT = 0), (hound.stuckT = 0));
  }
  function replanPath() {
    hound.planT = HOUND_TUNE_ALIAS.replan + rand() * 0.15;
    let T = null;
    try {
      T = simState.physics.nav.findPath(hound.pos, hound.goal);
    } catch {
      T = null;
    }
    ((hound.path = T && T.length ? T : null),
      (hound.wp = 0),
      hound.path &&
        hound.path.length > 1 &&
        hound.path[0].distanceToSquared(hound.pos) < 0.36 &&
        (hound.wp = 1));
  }
  function advancePath(T, D) {
    if (!hound.hasGoal) return ((hound.maxSpeed = 0), !0);
    ((hound.planT -= T), hound.planT <= 0 && replanPath());
    let C = hound.goal;
    if (hound.path) {
      for (
        ;
        hound.wp < hound.path.length - 1 &&
        Math.hypot(hound.path[hound.wp].x - hound.pos.x, hound.path[hound.wp].z - hound.pos.z) <
          0.55;
      )
        hound.wp++;
      C = hound.path[Math.min(hound.wp, hound.path.length - 1)];
    }
    let G = hound.goal.x - hound.pos.x,
      j = hound.goal.z - hound.pos.z,
      N = Math.hypot(G, j);
    if (N < 0.45) return ((hound.hasGoal = !1), (hound.maxSpeed = 0), !0);
    let Q = C.x - hound.pos.x,
      K = C.z - hound.pos.z;
    hound.wantYaw = Math.atan2(Q, K);
    let ie = Math.abs(wrapAngleHound(hound.wantYaw, hound.yaw));
    return ((hound.maxSpeed = ie > 1.1 ? 0 : Math.min(D * (1 - ie * 0.5), 0.4 + N * 2.6)), !1);
  }
  function pickFirePos() {
    let T = simState.player;
    if (!T) return;
    let D = 1 / 0,
      C = T.eye || T.pos,
      G = (candidatePos, baseCost) => {
        let distToTarget = Math.hypot(candidatePos.x - T.pos.x, candidatePos.z - T.pos.z);
        if (
          distToTarget < HOUND_TUNE_ALIAS.rangeMin ||
          distToTarget > HOUND_TUNE_ALIAS.rangeMax ||
          (simState.physics.nav.isWalkable &&
            !simState.physics.nav.isWalkable(candidatePos.x, candidatePos.z))
        )
          return;
        let cost =
            Math.hypot(candidatePos.x - hound.pos.x, candidatePos.z - hound.pos.z) * 0.9 +
            baseCost +
            rand() * 3,
          dirX = candidatePos.x - T.pos.x,
          dirZ = candidatePos.z - T.pos.z;
        for (let ally of ctx.list) {
          if (ally === hound || !ally.alive || ally.type !== 'hound' || ally.mode !== 'engage')
            continue;
          let allyPos = ally.es === 'move' ? ally.firePos : ally.pos,
            allyDx = allyPos.x - T.pos.x,
            allyDz = allyPos.z - T.pos.z,
            alignDot =
              (dirX * allyDx + dirZ * allyDz) /
              (Math.hypot(dirX, dirZ) * Math.hypot(allyDx, allyDz) + 1e-4);
          (alignDot > 0.86 && (cost += (14 * (alignDot - 0.86)) / 0.14),
            Math.hypot(candidatePos.x - allyPos.x, candidatePos.z - allyPos.z) < 3 && (cost += 16));
        }
        cost >= D ||
          (houndAimPoint.set(candidatePos.x, candidatePos.y + 0.95, candidatePos.z),
          simState.physics.lineOfSight(houndAimPoint, C) || (cost += 22),
          cost < D &&
            ((D = cost), hound.firePos.set(candidatePos.x, candidatePos.y, candidatePos.z)));
      },
      j = simState.level && simState.level.coverPoints;
    if (j) for (let Q = 0; Q < j.length; Q++) G(j[Q], -2);
    for (let Q = 0; Q < 7; Q++) {
      let K = simState.physics.nav.randomPoint(T.pos, HOUND_TUNE_ALIAS.rangeMax);
      K && G(K, 0);
    }
    let N = Math.atan2(hound.pos.z - T.pos.z, hound.pos.x - T.pos.x);
    for (let Q = 0; Q < 5; Q++) {
      let K = N + (rand() - 0.5) * 2.6,
        ie =
          HOUND_TUNE_ALIAS.rangeMin +
          1 +
          rand() * (HOUND_TUNE_ALIAS.rangeMax - HOUND_TUNE_ALIAS.rangeMin - 2);
      (houndScratch.set(T.pos.x + Math.cos(K) * ie, T.pos.y, T.pos.z + Math.sin(K) * ie),
        (houndScratch.y = simState.physics.groundHeight(
          houndScratch.x,
          houndScratch.z,
          T.pos.y + 1,
        )),
        G(houndScratch, 1));
    }
    (D === 1 / 0 && hound.firePos.copy(hound.pos),
      hound.firePlayer.copy(T.pos),
      setGoal(hound.firePos, !0),
      (hound.es = 'move'),
      (hound.esT = 0),
      (hound.moveT = 0),
      (hound.bursts = 0));
  }
  function updateAlive(T) {
    let D = simState.player,
      C = ctx.t;
    (hound.fwd.set(Math.sin(hound.yaw), 0, Math.cos(hound.yaw)),
      hound.sensor.copy(hound.headPos),
      ctx.think(hound, T, 0.55),
      hound.mode !== hound.modeSeen &&
        ((hound.modeSeen = hound.mode),
        (hound.hasGoal = !1),
        (hound.path = null),
        (hound.waitT = 0),
        hound.mode === 'engage'
          ? pickFirePos()
          : (hound.es === 'tele' || hound.es === 'burst') &&
            (ctx.releaseToken(hound), (hound.es = 'move'))),
      (hound.wantYaw = hound.yaw),
      (hound.maxSpeed = 0),
      (hound.cool -= T),
      (hound.lungeCd -= T));
    let G = null,
      j = null,
      N = 0,
      Q = !1,
      K = D ? Math.hypot(D.pos.x - hound.pos.x, D.pos.z - hound.pos.z) : 1e9;
    if (hound.mode === 'patrol') {
      if (hound.hasGoal)
        advancePath(T, HOUND_TUNE_ALIAS.patrolSpeed) && (hound.waitT = 1.5 + rand() * 3);
      else if (((hound.waitT -= T), hound.waitT <= 0))
        if (hound.patrolLine)
          ((hound.patrolI = (hound.patrolI + 1) % hound.patrolLine.length),
            setGoal(hound.patrolLine[hound.patrolI], !0));
        else {
          let I = simState.physics.nav.randomPoint(hound.home, hound.patrolR);
          I ? setGoal(I, !0) : (hound.waitT = 1);
        }
    } else if (hound.mode === 'investigate' || hound.mode === 'search') {
      j = hound.lastKnown;
      let I = Math.hypot(hound.lastKnown.x - hound.pos.x, hound.lastKnown.z - hound.pos.z);
      I > 2.2
        ? (setGoal(hound.lastKnown),
          advancePath(T, I < 8 ? HOUND_TUNE_ALIAS.stalkSpeed : HOUND_TUNE_ALIAS.runSpeed))
        : ((hound.hasGoal = !1),
          (hound.scan += T),
          (hound.wantYaw = hound.yaw + Math.sin(hound.scan * 0.8) * 0.9),
          (j = null));
    } else if (D) {
      ((G = D.pos), (j = D.pos));
      let I = Math.atan2(D.pos.x - hound.pos.x, D.pos.z - hound.pos.z);
      switch (
        ((hound.es === 'move' || hound.es === 'aim' || hound.es === 'cool') &&
          K < HOUND_TUNE_ALIAS.lungeRange &&
          hound.lungeCd <= 0 &&
          D.alive &&
          ((hound.es = 'wind'),
          (hound.esT = 0.28),
          ctx.releaseToken(hound),
          simState.events.emit('enemy:telegraph', {
            enemy: hound,
            type: 'hound',
            time: 0.28,
            pos: hound.pos,
            melee: !0,
          })),
        hound.es)
      ) {
        case 'move': {
          hound.moveT += T;
          let se = advancePath(T, HOUND_TUNE_ALIAS.runSpeed),
            ae = K > HOUND_TUNE_ALIAS.rangeMin - 1 && K < HOUND_TUNE_ALIAS.rangeMax + 2;
          se || (hound.moveT > 1.4 && hound.los && ae && rand() < T * 0.7) || hound.moveT > 7
            ? ((hound.es = 'aim'), (hound.esT = 0), (hound.hasGoal = !1))
            : D.pos.distanceToSquared(hound.firePlayer) > 49 && pickFirePos();
          break;
        }
        case 'aim':
        case 'cool': {
          ((hound.wantYaw = I),
            (hound.esT += T),
            hound.los
              ? K < HOUND_TUNE_ALIAS.rangeMin - 3 && hound.esT > 0.8
                ? pickFirePos()
                : hound.cool <= 0 &&
                  D.alive &&
                  Math.abs(wrapAngleHound(I - hound.yaw, hound.tyaw)) < 0.14 &&
                  ctx.requestToken(hound) &&
                  ((hound.es = 'tele'),
                  (hound.esT = HOUND_TUNE_ALIAS.telegraph),
                  simState.events.emit('enemy:telegraph', {
                    enemy: hound,
                    type: 'hound',
                    time: HOUND_TUNE_ALIAS.telegraph,
                    pos: hound.pos,
                  }))
              : (hound.noSeeT > 1.1 || hound.esT > 3) && pickFirePos());
          break;
        }
        case 'tele': {
          ((hound.wantYaw = I),
            (hound.esT -= T),
            (hound.flare = Math.min(1, hound.flare + T * 5)),
            (N = 0.05),
            hound.esT <= 0 &&
              ((hound.es = 'burst'), (hound.shots = HOUND_TUNE_ALIAS.burst), (hound.esT = 0)));
          break;
        }
        case 'burst': {
          ((hound.wantYaw = I),
            (hound.esT -= T),
            (hound.flare = 1),
            (N = 0.05),
            hound.esT <= 0 && ((hound.esT = HOUND_TUNE_ALIAS.burstGap), hound.shots--, fireShot(D)),
            hound.shots <= 0 &&
              (ctx.releaseToken(hound),
              (hound.cool =
                HOUND_TUNE_ALIAS.cooldown[0] +
                rand() * (HOUND_TUNE_ALIAS.cooldown[1] - HOUND_TUNE_ALIAS.cooldown[0])),
              hound.bursts++,
              hound.bursts >= 1 + (rand() < 0.4 ? 1 : 0)
                ? pickFirePos()
                : ((hound.es = 'cool'), (hound.esT = 0))));
          break;
        }
        case 'wind': {
          ((hound.wantYaw = I),
            (hound.esT -= T),
            (N = 0.16),
            (hound.sP.v += 3 * T),
            hound.esT <= 0 &&
              ((hound.es = 'lunge'),
              (hound.esT = 0.36),
              (hound.speed = HOUND_TUNE_ALIAS.lungeSpeed),
              (hound.yaw = I)));
          break;
        }
        case 'lunge': {
          ((Q = !0),
            (hound.esT -= T),
            (hound.wantYaw = I),
            (hound.maxSpeed = HOUND_TUNE_ALIAS.lungeSpeed),
            (hound.speed = HOUND_TUNE_ALIAS.lungeSpeed),
            K < 1.35 &&
              D.alive &&
              (D.damage(HOUND_TUNE_ALIAS.lungeDamage, hound.pos),
              simState.events.emit('enemy:melee', {
                enemy: hound,
                pos: hound.pos,
              }),
              (hound.esT = 0),
              (hound.sP.v -= 4)),
            hound.esT <= 0 &&
              ((hound.es = 'recover'),
              (hound.esT = 0.55),
              (hound.lungeCd = HOUND_TUNE_ALIAS.lungeCooldown),
              (hound.speed *= 0.3)));
          break;
        }
        case 'recover': {
          ((hound.esT -= T), (hound.wantYaw = I), hound.esT <= 0 && pickFirePos());
          break;
        }
      }
    }
    let ie = wrapAngleHound(hound.wantYaw, hound.yaw),
      F = clampHound(ie * 6, -HOUND_TUNE_ALIAS.turnRate, HOUND_TUNE_ALIAS.turnRate) * (Q ? 2 : 1);
    ((hound.yawRate += (F - hound.yawRate) * (1 - Math.exp(-10 * T))),
      (hound.yaw += hound.yawRate * T));
    let X = hound.maxSpeed > hound.speed ? HOUND_TUNE_ALIAS.accel : -HOUND_TUNE_ALIAS.accel * 1.4;
    ((hound.prevSpeed = hound.speed),
      (hound.speed = Q
        ? hound.speed
        : clampHound(hound.speed + X * T, 0, Math.max(hound.maxSpeed, 0))),
      !Q && X < 0 && hound.speed < hound.maxSpeed && (hound.speed = hound.maxSpeed));
    let ne = Math.sin(hound.yaw),
      re = Math.cos(hound.yaw);
    for (let I of ctx.list) {
      if (I === hound || I.type !== 'hound' || !I.active) continue;
      let se = hound.pos.x - I.pos.x,
        ae = hound.pos.z - I.pos.z,
        k = Math.hypot(se, ae);
      if (k < 1.7 && k > 0.001) {
        let ce = ((1.7 - k) * 2.2) / k;
        ((hound.push.x += se * ce * T * 6), (hound.push.z += ae * ce * T * 6));
      }
    }
    if (D && !Q && K < 1.25 && K > 0.001) {
      let I = ((1.25 - K) * 3) / K;
      ((hound.push.x += (hound.pos.x - D.pos.x) * I * T * 6),
        (hound.push.z += (hound.pos.z - D.pos.z) * I * T * 6));
    }
    hound.push.multiplyScalar(Math.exp(-5 * T));
    let $ = hound.pos.x + (ne * hound.speed + hound.push.x) * T,
      ue = hound.pos.z + (re * hound.speed + hound.push.z) * T,
      me = simState.physics.nav;
    if (((hound.feelT -= T), hound.feelT <= 0 && hound.speed > 0.3)) {
      ((hound.feelT = 0.12),
        houndScratch.set(hound.pos.x, hound.pos.y + 0.55, hound.pos.z),
        houndDir.set(ne, 0, re));
      let I = simState.physics.raycast(houndScratch, houndDir, 0.75 + hound.speed * 0.12);
      hound.blocked = !!I;
    } else hound.speed <= 0.3 && (hound.blocked = !1);
    (((me.isWalkable && !me.isWalkable($, ue)) ||
      (hound.blocked && !Q) ||
      (hound.blocked && Q && hound.esT < 0.3)) &&
      (hound.blocked
        ? (($ = hound.pos.x + hound.push.x * T),
          (ue = hound.pos.z + hound.push.z * T),
          (hound.yawRate += (hound.phase > 3.14 ? 1 : -1) * 4 * T))
        : me.isWalkable($, hound.pos.z)
          ? (ue = hound.pos.z)
          : me.isWalkable(hound.pos.x, ue)
            ? ($ = hound.pos.x)
            : (($ = hound.pos.x), (ue = hound.pos.z)),
      (hound.speed *= 0.6),
      (hound.stuckT += T),
      hound.stuckT > 0.5 &&
        ((hound.stuckT = 0),
        (hound.planT = 0),
        hound.mode === 'engage' && hound.es === 'move'
          ? pickFirePos()
          : hound.mode === 'patrol' && (hound.hasGoal = !1))),
      (hound.pos.x = $),
      (hound.pos.z = ue),
      (hound.pos.y +=
        (simState.physics.groundHeight($, ue, hound.pos.y + 0.6) - hound.pos.y) *
        (1 - Math.exp(-12 * T))),
      updateGait(T),
      (hound.crouch += (N - hound.crouch) * (1 - Math.exp(-12 * T))));
    let ee = Math.cos(hound.yaw),
      B = Math.sin(hound.yaw),
      P = 0,
      V = 0,
      Y = 0,
      L = 0.05,
      Z = hound.pos.y + HOUND_RIG_ALIAS.stand + hound.sY.x - hound.crouch;
    if (G) {
      let I = G.x - hound.pos.x,
        se = G.z - hound.pos.z,
        ae = G.y + 1 - (Z + 0.25);
      ((P = Math.atan2(I * ee - se * B, I * B + se * ee)),
        (V = clampHound(Math.atan2(-ae, Math.hypot(I, se)), -0.9, 0.35)));
    } else ((hound.scan += T * 0.5), (P = Math.sin(hound.scan * 0.9 + hound.phase) * 1.1));
    if (j) {
      let I = j.x - hound.pos.x,
        se = j.z - hound.pos.z,
        ae = j.y + 1.2 - (Z + 0.2);
      ((Y = clampHound(Math.atan2(I * ee - se * B, I * B + se * ee), -1.2, 1.2)),
        (L = clampHound(Math.atan2(-ae, Math.hypot(I, se)), -0.6, 0.5)));
    } else
      Y = Math.sin(ctx.t * 0.7 + hound.phase) * 0.5 + clampHound(hound.yawRate * 0.25, -0.6, 0.6);
    let J = clampHound(4.5 * T, 0, 1);
    ((hound.tyaw += clampHound(wrapAngleHound(P, hound.tyaw), -J, J)),
      (hound.tpitch += (V - hound.tpitch) * (1 - Math.exp(-10 * T))));
    let oe = 1 - Math.exp(-7 * T);
    ((hound.hyaw += (Y - hound.hyaw) * oe), (hound.hpitch += (L - hound.hpitch) * oe), poseRig(T));
    let fe = (ctx.t * (hound.mode === 'patrol' ? 0.8 : 2.2) + hound.phase) % 1;
    bones.beacon.scale.setScalar(fe < 0.12 || (fe > 0.22 && fe < 0.3) ? 1 : 1e-4);
    let le = hound.mode === 'engage' ? HOUND_LENS_ENGAGED : HOUND_LENS_IDLE,
      R = 1 + hound.flare * 3.5;
    for (let I = 0; I < 3; I++) hound.lensC[I] += (le[I] - hound.lensC[I]) * (1 - Math.exp(-8 * T));
    (lensMat.color.setRGB(hound.lensC[0] * R, hound.lensC[1] * R, hound.lensC[2] * R),
      (hound.flare = Math.max(0, hound.flare - T * 2)),
      hound.hp < HOUND_TUNE_ALIAS.hp * HOUND_TUNE_ALIAS.smokeBelow &&
        ((hound.smokeT -= T),
        hound.smokeT <= 0 &&
          ((hound.smokeT = 0.2),
          houndBodyStart.set(hound.pos.x - ne * 0.3, Z + 0.2, hound.pos.z - re * 0.3),
          simState.fx.smoke(houndBodyStart, {
            size: 0.35,
            life: 1.3,
            color: 2303272,
            rise: 0.9,
          }),
          rand() < 0.2 && simState.fx.sparks(houndBodyStart, HOUND_UP, 3))),
      hound.loop &&
        (hound.loop.setPos(hound.pos),
        hound.loop.setGain(
          clampHound(0.12 + hound.speed * 0.12 + Math.abs(hound.yawRate) * 0.1, 0, 0.8),
        ),
        hound.loop.setPitch(0.8 + hound.speed * 0.08)));
  }
  function fireShot(T) {
    let D = Math.cos(hound.yaw + hound.tyaw),
      C = Math.sin(hound.yaw + hound.tyaw);
    (houndScratch.setFromMatrixPosition(bones.gun.matrixWorld),
      (houndScratch.lengthSq() < 1e-6 || Math.abs(houndScratch.x - hound.pos.x) > 2) &&
        houndScratch.set(hound.pos.x, hound.pos.y + HOUND_RIG_ALIAS.stand + 0.25, hound.pos.z),
      houndAimPoint.set(T.pos.x, T.pos.y + 1, T.pos.z),
      houndDir.copy(houndAimPoint).sub(houndScratch).normalize(),
      hound.muzzle.copy(houndScratch).addScaledVector(houndDir, 0.43));
    let G =
      (HOUND_TUNE_ALIAS.spreadFar +
        (HOUND_TUNE_ALIAS.spreadNear - HOUND_TUNE_ALIAS.spreadFar) * hound.exposure) *
      (1 + ctx.playerSpeed * 0.3);
    ((houndDir.x += (rand() - 0.5) * 2 * G),
      (houndDir.y += (rand() - 0.5) * 2 * G),
      (houndDir.z += (rand() - 0.5) * 2 * G),
      houndDir.normalize());
    let j = simState.physics.raycast(hound.muzzle, houndDir, 200),
      Q = simState.combat.enemyShot(hound.muzzle, houndDir, {
        damage: HOUND_TUNE_ALIAS.shotDamage,
        range: 200,
      })
        ? hound.muzzle.distanceTo(houndAimPoint)
        : j
          ? j.dist
          : 90;
    (houndTracerEnd.copy(hound.muzzle).addScaledVector(houndDir, Q),
      simState.fx.tracer(hound.muzzle, houndTracerEnd, {
        color: 16760944,
        speed: 260,
        width: 0.035,
      }),
      simState.fx.muzzleFlash(hound.muzzle, houndDir, {
        scale: 0.9,
      }),
      simState.render &&
        simState.render.lightPool &&
        simState.render.lightPool.flash(hound.muzzle, 16756832, 22, 7, 0.05),
      simState.events.emit('enemy:fire', {
        enemy: hound,
        pos: hound.muzzle,
        dir: houndDir,
        type: 'hound',
      }),
      (hound.sP.v += 1.1),
      (hound.sY.v -= 0.25));
  }
  function updateGait(centerX) {
    let centerY = Math.sin(hound.yaw) * hound.speed + hound.push.x,
      radius = Math.cos(hound.yaw) * hound.speed + hound.push.z,
      rotation = hound.speed > 0.15 || Math.abs(hound.yawRate) > 0.25;
    if (hound.sw < 0) {
      hound.idleT = rotation ? 0 : hound.idleT + centerX;
      let jitter = hound.speed + Math.abs(hound.yawRate) * 0.5,
        segmentCount = clampHound(0.27 - jitter * 0.026, 0.14, 0.27),
        segmentScale = -1,
        tracePolygon = 0;
      for (let targetCtx = 0; targetCtx < 2; targetCtx++) {
        let scaleMul = 0;
        for (let segIdx of HOUND_GAIT_PAIRS[targetCtx]) {
          footLocalPos(
            houndBodyStart,
            segIdx,
            hound.pos.x + centerY * segmentCount,
            hound.pos.z + radius * segmentCount,
            hound.yaw + hound.yawRate * segmentCount,
          );
          let angle = Math.hypot(
            houndBodyStart.x - feet[segIdx].p.x,
            houndBodyStart.z - feet[segIdx].p.z,
          );
          angle > scaleMul && (scaleMul = angle);
        }
        (targetCtx !== hound.lastPair && (scaleMul *= 1.25),
          scaleMul > tracePolygon && ((tracePolygon = scaleMul), (segmentScale = targetCtx)));
      }
      let toneBase = rotation ? 0.09 : hound.idleT > 0.25 ? 0.035 : 1e9;
      if (segmentScale >= 0 && tracePolygon > toneBase) {
        ((hound.sw = segmentScale),
          (hound.swT = 0),
          (hound.swDur = segmentCount),
          (hound.lift = 0.065 + Math.min(0.09, jitter * 0.02)));
        for (let targetCtx of HOUND_GAIT_PAIRS[segmentScale]) {
          let scaleMul = feet[targetCtx];
          (scaleMul.from.copy(scaleMul.p),
            footLocalPos(
              scaleMul.to,
              targetCtx,
              hound.pos.x + centerY * segmentCount * 1.5,
              hound.pos.z + radius * segmentCount * 1.5,
              hound.yaw + hound.yawRate * segmentCount * 1.5,
            ),
            (scaleMul.to.y = simState.physics.groundHeight(
              scaleMul.to.x,
              scaleMul.to.z,
              hound.pos.y + 0.6,
            )));
        }
      }
    } else {
      hound.swT += centerX / hound.swDur;
      let jitter = hound.swT >= 1 ? 1 : hound.swT,
        segmentCount = jitter * jitter * (3 - 2 * jitter);
      for (let segmentScale of HOUND_GAIT_PAIRS[hound.sw]) {
        let tracePolygon = feet[segmentScale];
        (tracePolygon.p.lerpVectors(tracePolygon.from, tracePolygon.to, segmentCount),
          (tracePolygon.p.y += Math.sin(Math.PI * jitter) * hound.lift));
      }
      if (hound.swT >= 1) {
        let segmentScale = feet[HOUND_GAIT_PAIRS[hound.sw][0]];
        (simState.events.emit('enemy:step', {
          pos: segmentScale.p,
          type: 'hound',
          enemy: hound,
          speed: hound.speed,
        }),
          (hound.sY.v -= 0.12 + hound.speed * 0.03),
          (hound.lastPair = hound.sw),
          (hound.sw = -1));
      }
    }
  }
  function poseRig(T) {
    let D = Math.cos(hound.yaw),
      C = Math.sin(hound.yaw),
      G = (feet[0].p.y + feet[1].p.y) * 0.5,
      j = (feet[2].p.y + feet[3].p.y) * 0.5,
      N = (feet[0].p.y + feet[2].p.y) * 0.5,
      Q = (feet[1].p.y + feet[3].p.y) * 0.5,
      K = (G + j) * 0.5 - hound.pos.y,
      ie = T > 0 ? (hound.speed - hound.prevSpeed) / T : 0,
      F = Math.atan2(j - G, 0.8) * 0.6 + clampHound(ie * 0.006, -0.07, 0.07),
      X =
        Math.atan2(N - Q, 0.55) * 0.6 + clampHound(hound.yawRate * hound.speed * 0.02, -0.12, 0.12),
      ne = K * 0.45 - Math.min(0.05, hound.speed * 0.011);
    (hound.alive || ((F = hound.diePitch), (X = hound.dieRoll), (ne = 0)),
      hound.alive &&
        (springStep(hound.sY, ne, 160, 17, T),
        springStep(hound.sP, F, 130, 15, T),
        springStep(hound.sR, X, 130, 15, T),
        springStep(hound.sL, 0, 110, 13, T)));
    let re = hound.alive ? Math.sin(ctx.t * 1.7 + hound.phase) * 0.004 : 0,
      $ = hound.sL.x,
      ue = HOUND_RIG_ALIAS.stand + hound.sY.x - hound.crouch + re,
      me = hound.sP.x,
      ee = hound.sR.x;
    ((rig.group.rotation.y = hound.yaw),
      bones.body.position.set($, ue, 0),
      bones.body.rotation.set(me, 0, ee),
      (bones.turret.rotation.y = hound.tyaw),
      (bones.gun.rotation.x = hound.tpitch - me * 0.5),
      bones.head.rotation.set(hound.hpitch, hound.hyaw, 0),
      springStep(hound.sA, clampHound(-ie * 0.03 - me, -0.6, 0.6), 60, 5, T),
      springStep(hound.sA2, clampHound(hound.yawRate * 0.12 - ee, -0.6, 0.6), 60, 5, T),
      bones.antenna.rotation.set(hound.sA.x, 0, hound.sA2.x));
    let B = Math.cos(me),
      P = Math.sin(me),
      V = Math.cos(ee),
      Y = Math.sin(ee);
    for (let L = 0; L < 4; L++) {
      let Z = feet[L].p,
        J = Z.x - hound.pos.x,
        oe = Z.y + HOUND_RIG_ALIAS.footR * 0.6 - hound.pos.y,
        fe = Z.z - hound.pos.z,
        le = J * D - fe * C - $,
        R = oe - ue,
        I = J * C + fe * D,
        se = R * B + I * P,
        ae = -R * P + I * B,
        k = le * V + se * Y,
        ce = -le * Y + se * V;
      (solveLegIK(
        LEG_IK_OUT,
        k - HOUND_RIG_ALIAS.side[L] * HOUND_RIG_ALIAS.hipX,
        ce - HOUND_RIG_ALIAS.hipY,
        ae - HOUND_RIG_ALIAS.fore[L] * HOUND_RIG_ALIAS.hipZ,
        HOUND_RIG_ALIAS.side[L],
        HOUND_RIG_ALIAS.l0,
        HOUND_RIG_ALIAS.L1,
        HOUND_RIG_ALIAS.L2 - HOUND_RIG_ALIAS.footR * 0.6,
      ),
        (abdomenBones[L].rotation.z = LEG_IK_OUT.abd),
        (thighBones[L].rotation.x = LEG_IK_OUT.hip),
        (shinBones[L].rotation.x = LEG_IK_OUT.knee));
    }
    (rig.group.updateMatrixWorld(!0), hound.headPos.setFromMatrixPosition(bones.head.matrixWorld));
  }
  function killHound(T) {
    ((hound.alive = !1),
      ctx.releaseToken(hound),
      (hound.dieT = 0),
      (hound.vy = 0),
      (hound.es = 'move'),
      bones.beacon.scale.setScalar(1e-4),
      (hound.dieRoll = (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 0.3)),
      (hound.diePitch = (rand() - 0.5) * 0.25),
      (hound.sR.v += hound.dieRoll * 3),
      (hound.sP.v += (rand() - 0.5) * 2));
    for (let D = 0; D < 4; D++) {
      let C = feet[D];
      hound.sw >= 0 && (C.p.y = hound.pos.y);
      let G = hound.yaw,
        j = HOUND_RIG_ALIAS.side[D] * (0.16 + rand() * 0.2),
        N = HOUND_RIG_ALIAS.fore[D] * (0.05 + rand() * 0.22) + (rand() - 0.5) * 0.1;
      C.slide.set(j * Math.cos(G) + N * Math.sin(G), 0, -j * Math.sin(G) + N * Math.cos(G));
    }
    ((hound.sw = -1),
      (hound.speed *= 0.3),
      houndBodyStart.copy(hound.headPos),
      simState.fx.sparks(houndBodyStart, HOUND_UP, 16),
      simState.fx.debris(houndBodyStart, {
        count: 4,
      }),
      simState.events.emit('enemy:killed', {
        enemy: hound,
        pos: hound.pos,
        type: 'hound',
      }),
      ctx.addWreck(hound));
  }
  function updateDead(T) {
    if (hound.sink > 0) {
      ((hound.sink += T), (hound.pos.y -= 0.22 * T), hound.sink > 3.2 && ctx.retire(hound));
      return;
    }
    hound.dieT += T;
    let D = hound.dieT;
    if (D < 2.2) {
      let C = 0.215 - HOUND_RIG_ALIAS.stand;
      ((hound.vy -= 9.8 * T * (D < 0.12 ? 0.3 : 1)),
        (hound.sY.x += hound.vy * T),
        hound.sY.x < C &&
          ((hound.sY.x = C),
          hound.vy < -1.2 &&
            (simState.events.emit('enemy:step', {
              pos: hound.pos,
              type: 'hound',
              enemy: hound,
              speed: 5,
              crash: !0,
            }),
            simState.fx.dust(hound.pos, HOUND_UP)),
          (hound.vy = -hound.vy * 0.22)),
        springStep(hound.sP, hound.diePitch, 60, 9, T),
        springStep(hound.sR, hound.dieRoll, 60, 9, T),
        springStep(hound.sL, 0, 40, 8, T));
      let G = Math.exp(-3.2 * T);
      for (let N = 0; N < 4; N++) {
        let Q = feet[N];
        ((Q.p.x += Q.slide.x * (1 - G)), (Q.p.z += Q.slide.z * (1 - G)), Q.slide.multiplyScalar(G));
      }
      ((hound.pos.x += Math.sin(hound.yaw) * hound.speed * T),
        (hound.pos.z += Math.cos(hound.yaw) * hound.speed * T),
        (hound.speed *= Math.exp(-5 * T)),
        (hound.hpitch += (0.55 - hound.hpitch) * (1 - Math.exp(-5 * T))),
        (hound.hyaw += (hound.dieRoll - hound.hyaw) * (1 - Math.exp(-3 * T))),
        (hound.tpitch += (0.3 - hound.tpitch) * (1 - Math.exp(-4 * T))));
      let j = D < 1.2 ? (Math.sin(D * 60) > 0.2 ? 1 - D / 1.2 : 0.05) : 0.02;
      (lensMat.color.setRGB(6 * j + 0.05, 0.6 * j + 0.01, 0.2 * j), poseRig(T));
    }
    if (D < 6.5)
      ((hound.smokeT -= T),
        hound.smokeT <= 0 &&
          ((hound.smokeT = D < 2 ? 0.09 : 0.2),
          houndBodyStart.set(
            hound.pos.x + (rand() - 0.5) * 0.4,
            hound.pos.y + 0.42,
            hound.pos.z + (rand() - 0.5) * 0.4,
          ),
          simState.fx.smoke(houndBodyStart, {
            size: 0.5 + rand() * 0.3,
            life: 1.8,
            color: 1513499,
            rise: 1.1,
          }),
          D < 4 &&
            rand() < 0.55 &&
            (houndBodyEnd.set(rand() - 0.5, 1, rand() - 0.5).normalize(),
            simState.fx.sparks(houndBodyStart, houndBodyEnd, D < 1 ? 8 : 3)),
          D < 3.5 &&
            rand() < 0.4 &&
            simState.fx.smoke(houndBodyStart, {
              size: 0.22,
              life: 0.45,
              color: 16742946,
              rise: 1.6,
            })));
    else if (!hound.wreck && ((hound.wreck = !0), hound.loop)) {
      try {
        hound.loop.stop();
      } catch {}
      hound.loop = null;
    }
    hound.loop && hound.loop.setGain(Math.max(0, 0.4 - D * 0.3));
  }
  return hound;
}
