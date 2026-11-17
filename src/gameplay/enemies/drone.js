// gameplay/enemies/drone.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。
// 四旋翼无人机实体（作品内代号 gull，编号 G-xx）：GULL_* 常量与共享临时向量、createDrone 工厂。

import * as THREE from 'three';

import { buildSkinnedRig } from '../../animation/skeleton.js';

import { wrapAngle } from '../../core/math.js';

import { bl } from '../../misc.js';

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
  ].map((profilePt) => new THREE.Vector2(profilePt[0], profilePt[1]));
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
 * gull 敌机的完整实体工厂：装配蒙皮、注册 damage/_activate/_deactivate/_raycast/_update 接口，内部实现三态（巡逻/调查/交战）飞行 AI、云台瞄准、三连发点射与击落螺旋坠毁；对象池复用，不 new
 */
export function createDrone(ctx, rigDef, materials, index) {
  let gameState = ctx.G,
    rand = ctx.rng,
    lensMat = materials.lensBase.clone(),
    rig = buildSkinnedRig(
      rigDef,
      {
        shell: materials.shell,
        metal: materials.metal,
        glow: materials.glow,
        lens: lensMat,
        disc: materials.disc,
        cone: materials.cone,
      },
      {
        radius: 0.9,
        center: [0, 0, 0],
        extra: {
          def: rigDef.extra,
          radius: 10,
        },
      },
    ),
    bones = rig.bones;
  ((rig.group.rotation.order = 'YXZ'), (rig.group.visible = !1));
  let labelDef = gameState.mats.label('G-' + String(index + 11), {
      color: 'black',
      font: 'stencil',
      distress: 0.35,
    }),
    labelWidth = 0.105,
    labelHeight = Math.min(0.045, labelWidth / (labelDef.aspect || 3)),
    labelGeom = new THREE.PlaneGeometry(labelWidth, labelHeight);
  (labelGeom.rotateX(-Math.PI / 2), labelGeom.rotateY(Math.PI));
  let labelMesh = new THREE.Mesh(labelGeom, labelDef.material);
  (labelMesh.position.set(0, 0.0985, -0.085),
    (labelMesh.castShadow = !1),
    (labelMesh.receiveShadow = !0),
    bones.body.add(labelMesh));
  let gull = {
    id: 0,
    type: 'gull',
    pos: rig.group.position,
    alive: !1,
    hp: GULL_TUNE_ALIAS.hp,
    active: !1,
    rig: rig,
    lens: lensMat,
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    home: new THREE.Vector3(),
    lastKnown: new THREE.Vector3(),
    sensor: new THREE.Vector3(),
    fwd: new THREE.Vector3(0, 0, 1),
    muzzle: new THREE.Vector3(),
    mode: 'patrol',
    los: !1,
    seeT: 0,
    noSeeT: 0,
    senseT: 0,
    exposure: 0,
    modeT: 0,
    passive: !1,
    hasToken: !1,
    orbitA: 0,
    orbitDir: 1,
    orbitR: 16,
    alt: 6,
    hoverY: 0,
    phase: 0,
    ceil: 1e9,
    ceilT: 0,
    flipT: 0,
    avoid: new THREE.Vector3(),
    atk: 'idle',
    atkT: 0,
    cool: 1,
    shots: 0,
    smokeT: 0,
    feeler: 0,
    strobeT: 0,
    flare: 0,
    lensC: [GULL_LENS_IDLE[0], GULL_LENS_IDLE[1], GULL_LENS_IDLE[2]],
    dieT: 0,
    spin: 0,
    lostRotor: 0,
    gy: 0,
    gp: 0,
    loop: null,
    sweep: 0,
    thr: 1,
    damage(deltaTime, playerRef, currentTime, isEngaging) {
      return gull.alive
        ? ((gull.hp -= deltaTime),
          gameState.events.emit('enemy:hit', {
            enemy: gull,
            point: playerRef,
            part: isEngaging || 'body',
          }),
          currentTime &&
            (gull.vel.addScaledVector(currentTime, Math.min(3, deltaTime * 0.09)),
            (gull.roll += (rand() - 0.5) * 0.5),
            (gull.pitch += (rand() - 0.5) * 0.4)),
          ctx.provoke(gull),
          gull.hp <= 0 ? (killGull(currentTime), !0) : !1)
        : !1;
    },
    _activate(deltaTime, playerRef = {}) {
      ((gull.active = !0),
        (gull.alive = !0),
        (gull.hp = GULL_TUNE_ALIAS.hp),
        (gull.passive = !!playerRef.passive),
        gull.pos.copy(deltaTime),
        gull.home.copy(deltaTime),
        gull.vel.set(0, 0, 0),
        (gull.yaw = playerRef.yaw ?? rand() * 6.283),
        (gull.pitch = gull.roll = 0),
        (gull.mode = playerRef.state === 'alert' ? 'investigate' : 'patrol'),
        (gull.modeT = 8),
        gull.lastKnown.copy(
          playerRef.target || (gameState.player ? gameState.player.pos : deltaTime),
        ),
        (gull.los = !1),
        (gull.seeT = gull.noSeeT = 0),
        (gull.exposure = 0),
        (gull.senseT = rand() * 0.2),
        (gull.hasToken = !1),
        (gull.orbitDir = rand() < 0.5 ? 1 : -1),
        (gull.orbitR =
          GULL_TUNE_ALIAS.rangeMin +
          2 +
          rand() * (GULL_TUNE_ALIAS.rangeMax - GULL_TUNE_ALIAS.rangeMin - 5)),
        (gull.alt =
          playerRef.hover ??
          GULL_TUNE_ALIAS.altMin +
            0.8 +
            rand() * (GULL_TUNE_ALIAS.altMax - GULL_TUNE_ALIAS.altMin - 1.6)),
        (gull.hoverFixed = playerRef.hover != null),
        (gull.patrolR = playerRef.patrolRadius ?? 4 + rand() * 5),
        (gull.phase = rand() * 6.283),
        (gull.orbitA = rand() * 6.283),
        (gull.ceil = 1e9),
        (gull.flipT = 3 + rand() * 4),
        (gull.atk = 'idle'),
        (gull.cool = 1 + rand() * 1.5),
        (gull.dieT = 0),
        (gull.spin = 0),
        (gull.lostRotor = -1),
        (gull.flare = 0),
        (gull.thr = 1));
      for (let currentTime = 0; currentTime < 4; currentTime++)
        bones['rotor' + currentTime].scale.setScalar(1);
      if (
        (bones.lamp.scale.setScalar(1),
        bones.body.rotation.set(0, 0, 0),
        (rig.group.visible = !0),
        rig.group.rotation.set(0, gull.yaw, 0),
        gameState.audio && gameState.audio.loop && !gull.loop)
      )
        try {
          gull.loop = gameState.audio.loop('gull_rotor', {
            pos: gull.pos,
            gain: 0.5,
          });
        } catch {
          gull.loop = null;
        }
    },
    _deactivate() {
      if (
        ((gull.active = !1),
        (gull.alive = !1),
        (rig.group.visible = !1),
        ctx.releaseToken(gull),
        gull.loop)
      ) {
        try {
          gull.loop.stop();
        } catch {}
        gull.loop = null;
      }
    },
    _raycast(deltaTime, playerRef, currentTime, isEngaging) {
      let targetX = deltaTime.x - gull.pos.x,
        targetY = (deltaTime.y - gull.pos.y + 0.03) * 2.3,
        targetZ = deltaTime.z - gull.pos.z,
        horizontalSpeed = playerRef.x,
        steerMagnitude = playerRef.y * 2.3,
        speedTotal = playerRef.z,
        desiredYaw =
          horizontalSpeed * horizontalSpeed +
          steerMagnitude * steerMagnitude +
          speedTotal * speedTotal,
        yawDelta = targetX * horizontalSpeed + targetY * steerMagnitude + targetZ * speedTotal,
        yawCos = targetX * targetX + targetY * targetY + targetZ * targetZ - 0.5 * 0.5,
        yawSin = yawDelta * yawDelta - desiredYaw * yawCos;
      if (yawSin < 0) return !1;
      let lateralSteer = (-yawDelta - Math.sqrt(yawSin)) / desiredYaw;
      return lateralSteer < 0 || lateralSteer > currentTime || lateralSteer >= isEngaging.dist
        ? !1
        : ((isEngaging.dist = lateralSteer),
          (isEngaging.part = 'body'),
          (isEngaging.enemy = gull),
          isEngaging.point.copy(deltaTime).addScaledVector(playerRef, lateralSteer),
          isEngaging.normal.copy(isEngaging.point).sub(gull.pos),
          (isEngaging.normal.y *= 2.3),
          isEngaging.normal.normalize(),
          !0);
    },
    _update(deltaTime) {
      gull.alive ? updateAlive(deltaTime) : updateDead(deltaTime);
    },
  };
  function killGull(boundsMin) {
    ((gull.alive = !1),
      ctx.releaseToken(gull),
      (gull.dieT = 0),
      (gull.lostRotor = Math.floor(rand() * 4)),
      bones['rotor' + gull.lostRotor].scale.setScalar(1e-4),
      gullScratch
        .set(GULL_RIG.rotors[gull.lostRotor][0], 0.05, GULL_RIG.rotors[gull.lostRotor][2])
        .applyAxisAngle(AXIS_UP, gull.yaw)
        .add(gull.pos),
      gameState.fx.sparks(gullScratch, AXIS_UP, 14),
      gameState.fx.debris(gullScratch, {
        count: 3,
      }),
      gameState.fx.smoke(gullScratch, {
        size: 0.5,
        life: 1,
      }),
      (gull.spin = (rand() < 0.5 ? -1 : 1) * (5 + rand() * 3)),
      (gull.vel.y += 1.5),
      boundsMin && gull.vel.addScaledVector(boundsMin, 2.5),
      bones.lamp.scale.setScalar(1e-4),
      bones.strobeG.scale.setScalar(1e-4),
      bones.strobeR.scale.setScalar(1e-4),
      bones.strobeW.scale.setScalar(1e-4),
      lensMat.color.setRGB(0.3, 0.05, 0.02),
      gameState.events.emit('enemy:killed', {
        enemy: gull,
        pos: gull.pos,
        type: 'gull',
      }));
  }
  function updateDead(y) {
    ((gull.dieT += y),
      (gull.vel.y -= 9.5 * y),
      (gull.vel.x *= 1 - 0.4 * y),
      (gull.vel.z *= 1 - 0.4 * y),
      (gull.spin += Math.sign(gull.spin) * 7 * y),
      (gull.yaw += gull.spin * y),
      (gull.roll += gull.spin * 0.35 * y),
      (gull.pitch += 0.9 * y));
    let b = gull.vel.length(),
      m = b * y,
      A = gull.dieT > 5 || gull.pos.y < -3;
    if (!A && b > 0.01) {
      gullDir.copy(gull.vel).multiplyScalar(1 / b);
      let _ = gameState.physics.raycast(gull.pos, gullDir, m + 0.3);
      _ && (gull.pos.copy(_.point).addScaledVector(_.normal, 0.2), (A = !0));
    }
    (A || gull.pos.addScaledVector(gull.vel, y),
      rig.group.rotation.set(gull.pitch, gull.yaw, gull.roll));
    for (let _ = 0; _ < 4; _++)
      _ !== gull.lostRotor &&
        (bones['rotor' + _].rotation.y +=
          (_ % 3 === 0 ? 1 : -1) * 30 * Math.max(0.2, 1 - gull.dieT * 0.5) * y);
    ((gull.smokeT -= y),
      gull.smokeT <= 0 &&
        ((gull.smokeT = 0.045),
        gameState.fx.smoke(gull.pos, {
          size: 0.45,
          life: 1.3,
          color: 1381914,
          rise: 0.6,
        }),
        rand() < 0.5 &&
          (gullScratch.set(rand() - 0.5, rand(), rand() - 0.5).normalize(),
          gameState.fx.sparks(gull.pos, gullScratch, 3))),
      gull.loop &&
        (gull.loop.setPos(gull.pos),
        gull.loop.setPitch(Math.max(0.4, 1.25 - gull.dieT * 0.4)),
        gull.loop.setGain(0.5)),
      A &&
        (gameState.fx.explosion(gull.pos, 1.2),
        gameState.combat &&
          gameState.combat.explode &&
          gameState.combat.explode(
            gull.pos,
            GULL_TUNE_ALIAS.explodeRadius,
            GULL_TUNE_ALIAS.explodeDamage,
            'enemy',
          ),
        ctx.retire(gull)));
  }
  function updateAlive(y) {
    let b = gameState.player,
      m = ctx.t;
    (gull.fwd.set(Math.sin(gull.yaw), 0, Math.cos(gull.yaw)),
      gull.sensor.set(0, -0.17, 0.27).applyAxisAngle(AXIS_UP, gull.yaw).add(gull.pos),
      ctx.think(gull, y, 0.4));
    let A = gull.mode === 'engage',
      _ = gull.hp < GULL_TUNE_ALIAS.hp * 0.5,
      M = GULL_TUNE_ALIAS.patrolSpeed,
      E,
      w,
      S;
    if (A && b) {
      M = GULL_TUNE_ALIAS.maxSpeed;
      let P = gull.atk !== 'idle';
      ((gull.flipT -= y),
        gull.flipT <= 0 &&
          ((gull.flipT = 3 + rand() * 5),
          rand() < 0.6 && (gull.orbitDir = -gull.orbitDir),
          (gull.orbitR = bl(
            gull.orbitR + (rand() - 0.5) * 6,
            GULL_TUNE_ALIAS.rangeMin + 1,
            GULL_TUNE_ALIAS.rangeMax - 2,
          ))),
        gull.noSeeT > 1.5
          ? ((E = gull.lastKnown.x),
            (S = gull.lastKnown.z),
            (w = gull.lastKnown.y + gull.alt + 1),
            (gull.orbitA = Math.atan2(
              gull.pos.z - gull.lastKnown.z,
              gull.pos.x - gull.lastKnown.x,
            )))
          : ((gull.orbitA += ((gull.orbitDir * (P ? 0.9 : 3.6)) / gull.orbitR) * y),
            (E = b.pos.x + Math.cos(gull.orbitA) * gull.orbitR),
            (S = b.pos.z + Math.sin(gull.orbitA) * gull.orbitR),
            (w = b.pos.y + gull.alt)));
    } else
      gull.mode === 'investigate' || gull.mode === 'search'
        ? ((M = 5.5),
          (gull.orbitA += 0.5 * y),
          (E = gull.lastKnown.x + Math.cos(gull.orbitA) * 4.5),
          (S = gull.lastKnown.z + Math.sin(gull.orbitA) * 4.5),
          (w = gull.lastKnown.y + Math.min(gull.alt, 5.5)))
        : ((gull.orbitA += 0.28 * y * gull.orbitDir),
          (E = gull.home.x + Math.cos(gull.orbitA) * gull.patrolR),
          (S = gull.home.z + Math.sin(gull.orbitA) * gull.patrolR),
          (w = gull.hoverFixed ? gull.alt : gull.home.y));
    (w > gull.ceil && (w = gull.ceil),
      !gull.hoverFixed && w < 2.2 && (w = 2.2),
      gullSteer.set(
        (E - gull.pos.x) * 2.2 - gull.vel.x * 2.4,
        (w - gull.pos.y) * 5 - gull.vel.y * 3.6,
        (S - gull.pos.z) * 2.2 - gull.vel.z * 2.4,
      ),
      (gull.feeler = (gull.feeler + 1) % 3));
    let z = Math.hypot(gull.vel.x, gull.vel.z);
    if (gull.feeler === 0 && z > 0.6) {
      gullDir.set(gull.vel.x / z, 0, gull.vel.z / z);
      let P = 2.2 + z * 0.5,
        V = gameState.physics.raycast(gull.pos, gullDir, P);
      if (V) {
        let Y = 1 - V.dist / P;
        (gull.avoid.copy(V.normal).multiplyScalar(26 * Y),
          (gull.avoid.y += 9 * Y),
          Y > 0.5 && ((gull.orbitDir = -gull.orbitDir), (gull.flipT = 2.5)));
      }
    } else if (gull.feeler === 1) {
      let P = gameState.physics.raycast(gull.pos, AXIS_DOWN, 2.4);
      P && !gull.hoverFixed && (gull.avoid.y += (2.4 - P.dist) * 10);
    } else if (gull.feeler === 2 && ((gull.ceilT -= y * 3), gull.ceilT <= 0)) {
      gull.ceilT = 0.35;
      let P = gameState.physics.raycast(gull.pos, AXIS_UP, 4);
      gull.ceil = P ? gull.pos.y + P.dist - 1.3 : 1e9;
    }
    (gullSteer.add(gull.avoid),
      gull.avoid.multiplyScalar(Math.exp(-6 * y)),
      _ &&
        ((gullSteer.x += Math.sin(m * 7.3 + gull.phase) * 5),
        (gullSteer.z += Math.cos(m * 6.1 + gull.phase) * 5),
        (gullSteer.y += Math.sin(m * 9.7) * 3)));
    let H = gullSteer.length();
    (H > GULL_TUNE_ALIAS.accel && gullSteer.multiplyScalar(GULL_TUNE_ALIAS.accel / H),
      gull.vel.addScaledVector(gullSteer, y));
    let O = gull.vel.length();
    O > M && (gull.vel.multiplyScalar(M / O), (O = M));
    for (let P = 0; P < 3; P++) {
      let V = P === 0 ? gull.vel.x : P === 1 ? gull.vel.y : gull.vel.z;
      if (Math.abs(V) < 0.02) continue;
      let Y = V > 0 ? 1 : -1,
        L = P === 1 ? 0.35 : 0.62;
      gullDir.set(P === 0 ? Y : 0, P === 1 ? Y : 0, P === 2 ? Y : 0);
      let Z = gameState.physics.raycast(gull.pos, gullDir, Math.abs(V) * y + L);
      Z &&
        (gull.vel.setComponent(P, -V * 0.25),
        gull.avoid.setComponent(P, gull.avoid.getComponent(P) - Y * 8),
        Z.dist < L && gull.pos.setComponent(P, gull.pos.getComponent(P) - Y * (L - Z.dist)));
    }
    if ((gull.pos.addScaledVector(gull.vel, y), !gull.hoverFixed)) {
      let P = gameState.physics.groundHeight(gull.pos.x, gull.pos.z, gull.pos.y + 0.5) + 1.1;
      gull.pos.y < P && ((gull.pos.y = P), gull.vel.y < 0 && (gull.vel.y = 0));
    }
    let q = gull.yaw;
    if ((A || gull.mode === 'search' || gull.mode === 'investigate') && b) {
      let P = A && gull.noSeeT < 1.5 ? b.pos : gull.lastKnown;
      q = Math.atan2(P.x - gull.pos.x, P.z - gull.pos.z);
    } else z > 0.4 && (q = Math.atan2(gull.vel.x, gull.vel.z));
    let U = wrapAngle(q, gull.yaw);
    gull.yaw += bl(U, -3.2 * y, 3.2 * y);
    let T = Math.cos(gull.yaw),
      D = Math.sin(gull.yaw),
      C = gullSteer.x * D + gullSteer.z * T,
      G = gullSteer.x * T - gullSteer.z * D,
      j = bl(C * 0.04, -0.42, 0.42),
      N = bl(-G * 0.04, -0.42, 0.42);
    _ &&
      ((j += Math.sin(m * 11 + gull.phase) * 0.1),
      (N += Math.cos(m * 8.7 + gull.phase * 2) * 0.13));
    let Q = 1 - Math.exp(-7 * y);
    ((gull.pitch += (j - gull.pitch) * Q),
      (gull.roll += (N - gull.roll) * Q),
      rig.group.rotation.set(gull.pitch, gull.yaw, gull.roll),
      (bones.body.position.y =
        Math.sin(m * 2.1 + gull.phase) * 0.045 + Math.sin(m * 3.7 + gull.phase * 1.7) * 0.018),
      (gull.thr += (1 + bl(gullSteer.y * 0.03, -0.25, 0.4) + z * 0.02 - gull.thr) * Q));
    let K = 41 * gull.thr * y;
    ((bones.rotor0.rotation.y += K),
      (bones.rotor1.rotation.y -= K * 1.03),
      (bones.rotor2.rotation.y -= K * 0.98),
      (bones.rotor3.rotation.y += K * 1.01));
    let ie = (m * 0.9 + gull.phase * 0.1) % 1,
      F = ie < 0.05 || (ie > 0.13 && ie < 0.18) ? 1 : 1e-4;
    if (
      (bones.strobeR.scale.setScalar(F),
      bones.strobeG.scale.setScalar(F),
      bones.strobeW.scale.setScalar(ie > 0.5 && ie < 0.56 ? 1 : 1e-4),
      A && b)
    )
      gullAimPoint.set(b.pos.x, b.pos.y + 1.1, b.pos.z);
    else if (gull.mode !== 'patrol')
      ((gull.sweep += y),
        gullAimPoint.set(
          gull.lastKnown.x + Math.sin(gull.sweep * 0.9) * 3,
          gull.lastKnown.y,
          gull.lastKnown.z + Math.cos(gull.sweep * 0.7) * 3,
        ));
    else {
      gull.sweep += y;
      let P = gull.yaw + Math.sin(gull.sweep * 0.5 + gull.phase) * 0.9;
      gullAimPoint.set(
        gull.pos.x + Math.sin(P) * 5,
        gull.pos.y - (gull.hoverFixed ? 1.6 : 5),
        gull.pos.z + Math.cos(P) * 5,
      );
    }
    gullScratch.copy(gullAimPoint).sub(gull.sensor);
    let X = gullScratch.x * T - gullScratch.z * D,
      ne = gullScratch.x * D + gullScratch.z * T,
      re = gullScratch.y,
      $ = Math.atan2(X, ne),
      ue = bl(Math.atan2(-re, Math.hypot(X, ne)), -0.5, 1.5),
      me = 1 - Math.exp(-9 * y);
    ((gull.gy += wrapAngle($, gull.gy) * me),
      (gull.gp += (ue - gull.gp) * me),
      (bones.gimbalYaw.rotation.y = gull.gy),
      (bones.ball.rotation.x = gull.gp - gull.pitch),
      (bones.gun.rotation.x = bl(gull.gp, -0.2, 1.3) - gull.pitch));
    let ee = A ? GULL_LENS_ENGAGED : GULL_LENS_IDLE,
      B = 1 + gull.flare * 3.2 + (A ? 0 : Math.sin(m * 3 + gull.phase) * 0.15);
    for (let P = 0; P < 3; P++) gull.lensC[P] += (ee[P] - gull.lensC[P]) * (1 - Math.exp(-8 * y));
    if (
      (lensMat.color.setRGB(gull.lensC[0] * B, gull.lensC[1] * B, gull.lensC[2] * B),
      (gull.flare = Math.max(0, gull.flare - y * 1.5)),
      gull.muzzle.set(0, -0.12, 0.17).applyAxisAngle(AXIS_UP, gull.yaw).add(gull.pos),
      (gull.cool -= y),
      gull.atk === 'idle')
    )
      A &&
        gull.los &&
        gull.cool <= 0 &&
        b &&
        b.alive &&
        Math.abs(U) < 0.35 &&
        gull.pos.distanceTo(b.pos) < GULL_TUNE_ALIAS.fireRange &&
        ctx.requestToken(gull) &&
        ((gull.atk = 'tele'),
        (gull.atkT = GULL_TUNE_ALIAS.telegraph),
        gameState.events.emit('enemy:telegraph', {
          enemy: gull,
          type: 'gull',
          time: GULL_TUNE_ALIAS.telegraph,
          pos: gull.pos,
        }));
    else if (gull.atk === 'tele')
      ((gull.atkT -= y),
        (gull.flare = Math.min(1, gull.flare + y * 4.5)),
        A
          ? gull.atkT <= 0 &&
            ((gull.atk = 'burst'),
            (gull.shots = GULL_TUNE_ALIAS.burst),
            (gull.atkT = 0),
            (gull.lead = 0.2 + rand() * 0.65))
          : ((gull.atk = 'idle'), ctx.releaseToken(gull)));
    else if (gull.atk === 'burst' && ((gull.atkT -= y), (gull.flare = 1), gull.atkT <= 0)) {
      if (((gull.atkT = GULL_TUNE_ALIAS.burstGap), gull.shots--, b)) {
        let P = gull.muzzle.distanceTo(b.pos),
          V = P / GULL_TUNE_ALIAS.boltSpeed;
        (gullAimPoint.set(
          b.pos.x + b.vel.x * V * gull.lead,
          b.pos.y + 1.05,
          b.pos.z + b.vel.z * V * gull.lead,
        ),
          gullDir.copy(gullAimPoint).sub(gull.muzzle).normalize());
        let Y =
          (GULL_TUNE_ALIAS.spreadFar +
            (GULL_TUNE_ALIAS.spreadNear - GULL_TUNE_ALIAS.spreadFar) * gull.exposure) *
          (1 + ctx.playerSpeed * 0.45) *
          (_ ? 1.5 : 1);
        ((gullDir.x += (rand() - 0.5) * 2 * Y),
          (gullDir.y += (rand() - 0.5) * 2 * Y),
          (gullDir.z += (rand() - 0.5) * 2 * Y),
          gullDir.normalize(),
          ctx.fireBolt(gull.muzzle, gullDir, gull),
          gameState.fx.muzzleFlash(gull.muzzle, gullDir, {
            scale: 0.55,
          }),
          gameState.events.emit('enemy:fire', {
            enemy: gull,
            pos: gull.muzzle,
            dir: gullDir,
            type: 'gull',
          }),
          gull.vel.addScaledVector(gullDir, -0.35));
      }
      gull.shots <= 0 &&
        ((gull.atk = 'idle'),
        (gull.cool =
          GULL_TUNE_ALIAS.cooldown[0] +
          rand() * (GULL_TUNE_ALIAS.cooldown[1] - GULL_TUNE_ALIAS.cooldown[0])),
        ctx.releaseToken(gull));
    }
    (_ &&
      ((gull.smokeT -= y),
      gull.smokeT <= 0 &&
        ((gull.smokeT = 0.16),
        gameState.fx.smoke(gull.pos, {
          size: 0.3,
          life: 1.1,
          color: 2500652,
          rise: 0.8,
        }),
        rand() < 0.15 && gameState.fx.sparks(gull.pos, AXIS_DOWN, 2))),
      gull.loop &&
        (gull.loop.setPos(gull.pos),
        gull.loop.setPitch(0.85 + gull.thr * 0.2 + (_ ? Math.sin(m * 13) * 0.05 : 0))));
  }
  return gull;
}
