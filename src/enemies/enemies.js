// enemies/enemies.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { mergeGeometries } from '../core/geometry.js';

import { segmentDistanceSq } from '../core/math.js';

import { createRng } from '../core/random.js';

import { GULL_TUNE, createDrone } from './drone.js';

import { createDroneModel, createWalkerModel } from './models.js';

import { HOUND_TUNE, createWalker } from './walker.js';

/**
 * 敌人 AI 的共用调度参数：视野距离与视锥角、失去视野宽限、搜索时长、听觉半径、同时开火令牌上限与间隔、暴露度增减速率、各类型对象池容量与曳光弹/残骸上限
 */
export var AI_TUNE = {
  gull: GULL_TUNE,
  hound: HOUND_TUNE,
  sightRange: 45,
  sightCone: 200,
  loseSight: 4,
  searchTime: 8,
  hearRadius: 45,
  maxTokens: 2,
  maxTokensCrowd: 3,
  tokenGap: 1.25,
  exposureUp: 0.1,
  exposureDown: 0.45,
  poolGulls: 10,
  poolHounds: 8,
  maxWrecks: 5,
  maxBolts: 32,
};

/**
 * 视锥半角的余弦阈值，与玩家方向点乘直接比较即可判定是否在视野内（省掉逐帧 acos）
 */
var SIGHT_COS_HALF = Math.cos(((AI_TUNE.sightCone / 2) * Math.PI) / 180);

/**
 * gull 电浆弹本帧终点，用于与玩家胶囊做距离平方判定
 */
var boltEndPoint = new THREE.Vector3();

/**
 * AI 域预留的临时向量，当前代码里未被引用
 */
var boltSpare = new THREE.Vector3();

/**
 * gull 探照灯的方向向量，由云台偏航/俯仰推出，用来把共享点光源投到地面或玩家身上
 */
var gullLightDir = new THREE.Vector3();

/**
 * 电浆弹实例化时的朝向四元数暂存（把 +Z 对齐到弹道方向）
 */
var boltQuat = new THREE.Quaternion();

/**
 * 电浆弹写入 InstancedMesh 的变换矩阵暂存
 */
var boltMatrix = new THREE.Matrix4();

/**
 * 电浆弹实例的缩放暂存，Z 分量随生成后的飞行长度拉伸，做出拖尾
 */
var boltScale = new THREE.Vector3(1, 1, 1);

/**
 * 单位 Z 轴常量，作为电浆弹几何默认朝向的参考轴
 */
var AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * AI 域预留的向下单位向量，当前代码里未被引用
 */
var DOWN_SPARE = new THREE.Vector3(0, -1, 0);

/**
 * 玩家受击胶囊的下端点（脚踝高度），与上端点组成竖直胶囊
 */
var playerCapsuleLow = new THREE.Vector3();

/**
 * 玩家受击胶囊的上端点，蹲下时从 1.5m 收到 1.0m，让蹲伏真的能躲低飞的弹
 */
var playerCapsuleHigh = new THREE.Vector3();

/**
 * 敌人系统总装：按池容量预生成 gull/hound、统一调度开火令牌与警戒集结、维护电浆弹实例池与共享探照点光源，并对外提供 spawn/raycast/alert/clear/update 接口
 */
export async function createEnemies(ctx) {
  let rand = createRng(+((ctx.params && ctx.params.eseed) || 9001)),
    list = [],
    wrecks = [],
    group = new THREE.Group();
  ((group.name = 'enemies'), ctx.scene.add(group));
  let whiteEmissive = ctx.mats.emissive(16777215, 1),
    glowMat =
      whiteEmissive && whiteEmissive.isMeshBasicMaterial
        ? whiteEmissive.clone()
        : new THREE.MeshBasicMaterial();
  (glowMat.color.setRGB(1, 1, 1), (glowMat.vertexColors = !0), (glowMat.needsUpdate = !0));
  let alertEmissive = ctx.mats.emissive(16752704, 6),
    lensMat =
      alertEmissive && alertEmissive.isMeshBasicMaterial
        ? alertEmissive
        : new THREE.MeshBasicMaterial({
            color: 16752704,
          }),
    toneMapped =
      whiteEmissive && whiteEmissive.toneMapped !== void 0 ? whiteEmissive.toneMapped : !0,
    materials = {
      shell: ctx.mats.get('armor_white', {
        triplanar: !0,
        vertexColors: !0,
      }),
      metal: ctx.mats.get('gunmetal', {
        triplanar: !0,
        vertexColors: !0,
      }),
      glow: glowMat,
      lensBase: lensMat,
      disc: new THREE.MeshBasicMaterial({
        color: 789775,
        transparent: !0,
        opacity: 0.42,
        depthWrite: !1,
        side: THREE.DoubleSide,
        toneMapped: toneMapped,
      }),
      cone: new THREE.ShaderMaterial({
        uniforms: {
          uColor: {
            value: new THREE.Color(1, 0.9, 0.74),
          },
          uGain: {
            value: 0.085,
          },
        },
        vertexShader: `
        #include <common>
        #include <skinning_pars_vertex>
        varying float vT; varying vec3 vN; varying vec3 vV;
        void main() {
          #include <beginnormal_vertex>
          #include <skinbase_vertex>
          #include <skinnormal_vertex>
          #include <begin_vertex>
          #include <skinning_vertex>
          vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
          vN = normalMatrix * objectNormal; vV = -mv.xyz; vT = 1.0 - uv.y;
          gl_Position = projectionMatrix * mv;
        }`,
        fragmentShader: `
        uniform vec3 uColor; uniform float uGain;
        varying float vT; varying vec3 vN; varying vec3 vV;
        void main() {
          float f = abs(dot(normalize(vN), normalize(vV)));
          f = f * f * (3.0 - 2.0 * f);
          float t = clamp(vT, 0.0, 1.0);
          float k = pow(1.0 - t, 1.7) * (0.35 + 0.65 * smoothstep(0.0, 0.06, t));
          gl_FragColor = vec4(uColor * (uGain * f * k), 1.0);
        }`,
        transparent: !0,
        blending: THREE.AdditiveBlending,
        depthWrite: !1,
        side: THREE.DoubleSide,
        fog: !1,
      }),
    },
    shared = {
      G: ctx,
      rng: rand,
      list: list,
      t: 0,
      playerSpeed: 0,
      tokens: 0,
      tokenT: -9,
      lastType: '',
      wantT: {
        gull: -9,
        hound: -9,
      },
      mergeSimple: (T) => mergeGeometries(T, !1),
      requestToken(T) {
        if (T.hasToken) return !0;
        let D = 0;
        for (let Q of list) Q.alive && D++;
        let C = D > 5 ? AI_TUNE.maxTokensCrowd : AI_TUNE.maxTokens,
          G = shared.t - shared.tokenT,
          j = T.type === 'gull' ? 'hound' : 'gull',
          N =
            shared.lastType === T.type &&
            shared.t - shared.wantT[j] < 0.5 &&
            G < AI_TUNE.tokenGap * 2.2;
        return shared.tokens >= C || G < AI_TUNE.tokenGap || N
          ? ((shared.wantT[T.type] = shared.t), !1)
          : (shared.tokens++,
            (shared.tokenT = shared.t),
            (shared.lastType = T.type),
            (T.hasToken = !0),
            !0);
      },
      releaseToken(T) {
        T.hasToken && ((T.hasToken = !1), (shared.tokens = Math.max(0, shared.tokens - 1)));
      },
      think(T, D, C) {
        let G = ctx.player;
        if (T.passive || !G) {
          T.los = !1;
          return;
        }
        if (((T.senseT -= D), T.senseT <= 0)) {
          T.senseT = 0.11 + rand() * 0.08;
          let j = !1;
          if (G.alive !== !1) {
            let N = G.eye || G.pos,
              Q = N.x - T.sensor.x,
              K = N.y - T.sensor.y,
              ie = N.z - T.sensor.z,
              F = Math.hypot(Q, K, ie);
            if (F < AI_TUNE.sightRange) {
              let X = Math.hypot(Q, ie) || 1e-4,
                ne = (Q * T.fwd.x + ie * T.fwd.z) / X;
              (T.mode === 'engage' || ne > SIGHT_COS_HALF || F < 3.5) &&
                (j = ctx.physics.lineOfSight(T.sensor, N));
            }
          }
          T.los = j;
        }
        (T.los
          ? ((T.seeT += D),
            (T.noSeeT = 0),
            T.lastKnown.copy(G.pos),
            (T.exposure = Math.min(1, T.exposure + D * AI_TUNE.exposureUp)))
          : ((T.noSeeT += D),
            (T.seeT = Math.max(0, T.seeT - D * 0.6)),
            (T.exposure = Math.max(0, T.exposure - D * AI_TUNE.exposureDown))),
          T.mode === 'engage'
            ? (T.noSeeT > AI_TUNE.loseSight || G.alive === !1) &&
              ((T.mode = 'search'),
              (T.modeT = AI_TUNE.searchTime + rand() * 3),
              shared.releaseToken(T))
            : T.los && T.seeT > (T.mode === 'patrol' ? C : C * 0.45)
              ? ((T.mode = 'engage'),
                (T.noSeeT = 0),
                ctx.events.emit('enemy:alert', {
                  enemy: T,
                }),
                shared.rally(T.pos, 18, G.pos, T))
              : T.mode !== 'patrol' &&
                ((T.modeT -= D),
                T.modeT <= 0 && ((T.mode = 'patrol'), (T.home.x = T.pos.x), (T.home.z = T.pos.z))));
      },
      rally(T, D, C, G) {
        for (let j of list)
          j === G ||
            !j.alive ||
            j.passive ||
            j.mode === 'engage' ||
            j.pos.distanceToSquared(T) > D * D ||
            (j.lastKnown.copy(C), (j.mode = 'investigate'), (j.modeT = 9 + rand() * 4));
      },
      provoke(T) {
        let D = ctx.player;
        !D ||
          T.passive ||
          !T.alive ||
          (T.mode !== 'engage' &&
            (T.lastKnown.copy(D.pos),
            (T.mode = 'investigate'),
            (T.modeT = 10),
            (T.seeT = 1),
            (T.senseT = 0)),
          shared.rally(T.pos, 20, D.pos, T));
      },
      fireBolt(T, D, C) {
        let G = null;
        for (let j = 0; j < bolts.length; j++)
          if (!bolts[j].on) {
            G = bolts[j];
            break;
          }
        G &&
          ((G.on = !0), (G.life = 1.3), G.pos.copy(T), G.dir.copy(D), G.from.copy(T), (G.len = 0));
      },
      addWreck(T) {
        for (wrecks.push(T); wrecks.length > AI_TUNE.maxWrecks;) {
          let D = wrecks.shift();
          D.active && (D.sink = 0.001);
        }
      },
      retire(T) {
        T._deactivate();
        let D = list.indexOf(T);
        (D >= 0 && list.splice(D, 1), (D = wrecks.indexOf(T)), D >= 0 && wrecks.splice(D, 1));
      },
    },
    gullDef = createDroneModel(),
    houndDef = createWalkerModel(),
    gullPool = [],
    houndPool = [];
  for (let T = 0; T < AI_TUNE.poolGulls; T++) {
    let D = createWalker(shared, gullDef, materials, T);
    (gullPool.push(D), group.add(D.rig.group));
  }
  for (let T = 0; T < AI_TUNE.poolHounds; T++) {
    let D = createDrone(shared, houndDef, materials, T);
    (houndPool.push(D), group.add(D.rig.group));
  }
  let bolts = [];
  for (let T = 0; T < AI_TUNE.maxBolts; T++)
    bolts.push({
      on: !1,
      life: 0,
      len: 0,
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      from: new THREE.Vector3(),
    });
  let boltGeom = new THREE.CylinderGeometry(0.016, 0.03, 1, 6, 1);
  (boltGeom.rotateX(Math.PI / 2), boltGeom.translate(0, 0, -0.5));
  let boltEmissiveSource = ctx.mats.emissive(16738858, 14),
    boltMaterial =
      boltEmissiveSource && boltEmissiveSource.isMeshBasicMaterial
        ? boltEmissiveSource
        : new THREE.MeshBasicMaterial({
            color: new THREE.Color(16738858).multiplyScalar(14),
          }),
    boltMesh = new THREE.InstancedMesh(boltGeom, boltMaterial, AI_TUNE.maxBolts);
  ((boltMesh.frustumCulled = !1),
    (boltMesh.castShadow = !1),
    (boltMesh.receiveShadow = !1),
    (boltMesh.count = 0),
    boltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage),
    group.add(boltMesh));
  let hitResult = {
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    dist: 0,
    surface: 'concrete',
    enemy: null,
    part: null,
    dir: new THREE.Vector3(),
    from: 'enemy',
  };
  function updateBolts(T) {
    let D = ctx.player,
      C = 0;
    for (let G = 0; G < bolts.length; G++) {
      let j = bolts[G];
      if (!j.on) continue;
      let N = AI_TUNE.gull.boltSpeed * T;
      j.life -= T;
      let Q = ctx.physics.raycast(j.pos, j.dir, N),
        K = Q ? Q.dist : N,
        ie = !1;
      if (
        (D &&
          D.alive !== !1 &&
          (boltEndPoint.copy(j.pos).addScaledVector(j.dir, K),
          playerCapsuleLow.set(D.pos.x, D.pos.y + 0.35, D.pos.z),
          playerCapsuleHigh.set(D.pos.x, D.pos.y + (D.crouching ? 1 : 1.5), D.pos.z),
          segmentDistanceSq(j.pos, boltEndPoint, playerCapsuleLow, playerCapsuleHigh) <
            0.36 * 0.36 && (ie = !0)),
        ie)
      ) {
        (D.damage(AI_TUNE.gull.boltDamage, j.from), (j.on = !1));
        continue;
      }
      if (Q) {
        (hitResult.point.copy(Q.point),
          hitResult.normal.copy(Q.normal),
          (hitResult.dist = Q.dist),
          (hitResult.surface = Q.surface),
          hitResult.dir.copy(j.dir),
          ctx.events.emit('impact', hitResult),
          (j.on = !1));
        continue;
      }
      if (j.life <= 0) {
        j.on = !1;
        continue;
      }
      (j.pos.addScaledVector(j.dir, N),
        (j.len = Math.min(1.5, j.len + N)),
        boltQuat.setFromUnitVectors(AXIS_Z, j.dir),
        boltScale.set(1, 1, Math.max(0.2, j.len)),
        boltMatrix.compose(j.pos, boltQuat, boltScale),
        boltMesh.setMatrixAt(C++, boltMatrix));
    }
    (C || boltMesh.count) && ((boltMesh.count = C), (boltMesh.instanceMatrix.needsUpdate = !0));
  }
  let lightHandle = null,
    lightReady = !1,
    lightT = 0,
    lightPos = new THREE.Vector3(),
    lightGain = 0;
  function updateGullLight(centerX) {
    if (!lightReady) {
      lightReady = !0;
      try {
        lightHandle =
          ctx.render && ctx.render.lightPool && ctx.render.lightPool.acquire
            ? ctx.render.lightPool.acquire()
            : null;
      } catch {
        lightHandle = null;
      }
      lightHandle &&
        lightHandle.light &&
        (lightHandle.light.color.setRGB(1, 0.9, 0.75), (lightHandle.light.distance = 9));
    }
    if (!lightHandle || !lightHandle.light) return;
    let centerY = null,
      radius = 3600,
      rotation = ctx.camera ? ctx.camera.position : null;
    for (let segmentCount of list) {
      if (segmentCount.type !== 'gull' || !segmentCount.alive) continue;
      let segmentScale = rotation ? segmentCount.pos.distanceToSquared(rotation) : 0;
      segmentScale < radius && ((radius = segmentScale), (centerY = segmentCount));
    }
    let jitter = 0;
    if (centerY) {
      if (((lightT -= centerX), lightT <= 0)) {
        lightT = 0.1;
        let segmentCount = centerY.yaw + centerY.gy,
          segmentScale = Math.cos(centerY.gp);
        gullLightDir
          .set(
            Math.sin(segmentCount) * segmentScale,
            -Math.sin(centerY.gp),
            Math.cos(segmentCount) * segmentScale,
          )
          .normalize();
        let tracePolygon = ctx.physics.raycast(centerY.sensor, gullLightDir, 14);
        (lightPos
          .copy(centerY.sensor)
          .addScaledVector(gullLightDir, (tracePolygon ? tracePolygon.dist : 8) - 0.6),
          (lightGain = tracePolygon ? 1 : 0.3));
      }
      ((jitter = 26 * lightGain),
        lightHandle.light.position.lerp(lightPos, 1 - Math.exp(-12 * centerX)));
    }
    lightHandle.light.intensity +=
      (jitter - lightHandle.light.intensity) * (1 - Math.exp(-8 * centerX));
  }
  let nextId = 1,
    hearCooldown = 0,
    system = {
      list: list,
      TUNE: AI_TUNE,
      spawn(T, D, C = {}) {
        let G = T === 'gull' ? gullPool : T === 'hound' ? houndPool : null;
        if (!G) return null;
        let j = null;
        for (let N of G)
          if (!N.active) {
            j = N;
            break;
          }
        if (!j && T === 'hound' && wrecks.length) {
          let N = wrecks[0];
          (shared.retire(N), (j = N));
        }
        return j
          ? ((j.id = nextId++),
            list.push(j),
            j._activate(D, C),
            ctx.events.emit('enemy:spawn', {
              enemy: j,
            }),
            j)
          : null;
      },
      raycast(T, D, C = 300) {
        let G = null;
        for (let j = 0; j < list.length; j++) {
          let N = list[j];
          if (!N.alive) continue;
          let Q = N.pos.x - T.x,
            K = N.pos.y + (N.type === 'hound' ? 0.6 : 0) - T.y,
            ie = N.pos.z - T.z,
            F = Q * D.x + K * D.y + ie * D.z;
          F < -1.5 ||
            F > C + 1.5 ||
            Q * Q + K * K + ie * ie - F * F > 1.7 ||
            (G ||
              (G = {
                dist: 1 / 0,
                point: new THREE.Vector3(),
                normal: new THREE.Vector3(),
                enemy: null,
                part: 'body',
              }),
            N._raycast(T, D, C, G));
        }
        return G && G.enemy ? G : null;
      },
      aliveCount() {
        let T = 0;
        for (let D of list) D.alive && T++;
        return T;
      },
      clear() {
        for (let T of gullPool) T.active && T._deactivate();
        for (let T of houndPool) T.active && T._deactivate();
        ((list.length = 0), (wrecks.length = 0), (shared.tokens = 0));
        for (let T of bolts) T.on = !1;
        ((boltMesh.count = 0),
          lightHandle && lightHandle.light && (lightHandle.light.intensity = 0));
      },
      alert(T, D = 40) {
        for (let C of list)
          !C.alive ||
            C.passive ||
            C.mode === 'engage' ||
            C.pos.distanceToSquared(T) > D * D ||
            (C.lastKnown.copy(T),
            (C.lastKnown.y = Math.max(0, T.y - 1.6)),
            C.mode === 'patrol' &&
              ctx.events.emit('enemy:alert', {
                enemy: C,
                noise: !0,
              }),
            (C.mode = 'investigate'),
            (C.modeT = 9 + rand() * 4));
      },
      update(T) {
        if (T <= 0) return;
        (T > 0.05 && (T = 0.05), (shared.t += T), (hearCooldown -= T));
        let D = ctx.player;
        if (D) {
          let C = D.vel ? Math.hypot(D.vel.x, D.vel.z) : D.speed || 0;
          shared.playerSpeed += (C - shared.playerSpeed) * (1 - Math.exp(-6 * T));
        }
        for (let C = list.length - 1; C >= 0; C--) list[C]._update(T);
        (updateBolts(T), updateGullLight(T));
      },
      debug: {
        ctx: shared,
        gulls: gullPool,
        hounds: houndPool,
        wrecks: wrecks,
        bolts: bolts,
        mats: materials,
        tris: {
          gull: gullDef.tris + gullDef.extra.tris,
          hound: houndDef.tris,
        },
      },
    };
  return (
    ctx.events.on('weapon:fire', (T) => {
      if (hearCooldown > 0) return;
      hearCooldown = 0.3;
      let D = (T && (T.origin || T.muzzle)) || (ctx.player && ctx.player.pos);
      D && system.alert(D, AI_TUNE.hearRadius);
    }),
    ctx.events.on('explosion', (T) => {
      T && T.pos && system.alert(T.pos, 30);
    }),
    ctx.events.on('game:state', (T) => {
      T && T.state === 'title' && system.clear();
    }),
    system
  );
}

/**
 * 敌人展示台：按 eshow 参数(gull/hound/both/fight/dead)摆出对应阵容并快进若干帧，让截图能直接看到飞行/行走/交火/击毁姿态
 */
export async function showcaseEnemies(ctx) {
  let enemies = await createEnemies(ctx);
  ctx.enemies = enemies;
  let vec = (l, c, u) => new THREE.Vector3(l, c, u),
    mode = ctx.params.eshow || 'both',
    camPos = [3, 1.45, 3.9],
    camTarget = [0.5, 0.95, 0],
    preSeconds = 2.6;
  if (mode === 'gull')
    (enemies.spawn('gull', vec(0, 1.6, 0), {
      passive: !0,
      hover: 1.6,
      patrolRadius: 0.02,
      yaw: 0.7,
    }),
      (camPos = [1.25, 1.95, 1.45]),
      (camTarget = [0, 1.52, 0]),
      (preSeconds = 1.2));
  else if (mode === 'hound')
    (enemies.spawn('hound', vec(0, 0, 0), {
      passive: !0,
      yaw: 0.9,
      patrolLine: [vec(1.6, 0, 1.3), vec(-1.6, 0, -1.3)],
    }),
      (camPos = [2.1, 1, 2.3]),
      (camTarget = [0.5, 0.62, 0.4]),
      (preSeconds = 1.25));
  else if (mode === 'fight')
    (enemies.spawn('hound', vec(-7, 0, -9), {
      state: 'alert',
    }),
      enemies.spawn('hound', vec(8, 0, -7), {
        state: 'alert',
      }),
      enemies.spawn('hound', vec(0, 0, -14), {
        state: 'alert',
      }),
      enemies.spawn('gull', vec(-5, 6, -13), {
        state: 'alert',
      }),
      enemies.spawn('gull', vec(9, 6, -11), {
        state: 'alert',
      }),
      (camPos = [5, 2.6, 10]),
      (camTarget = [0, 2.2, -5]),
      (preSeconds = 7));
  else if (mode === 'dead') {
    let posX = enemies.spawn('hound', vec(0, 0, 0), {
        passive: !0,
        yaw: 0.8,
      }),
      posY = enemies.spawn('gull', vec(-1.6, 3.4, -0.5), {
        passive: !0,
        hover: 3.4,
        patrolRadius: 0.02,
      });
    enemies.spawn('hound', vec(2.2, 0, -1.6), {
      passive: !0,
      yaw: -0.6,
      patrolLine: [vec(2.2, 0, -1.6), vec(3.4, 0, -3)],
    });
    for (let posZ = 0; posZ < 30; posZ++) enemies.update(1 / 60);
    posX.damage(999, posX.pos, vec(0.6, 0, -0.8), 'body');
    for (let posZ = 0; posZ < 110; posZ++) enemies.update(1 / 60);
    (posY.damage(999, posY.pos, vec(0, 0, 1), 'body'),
      (camPos = [2.6, 1.3, 3.2]),
      (camTarget = [0, 0.5, 0]),
      (preSeconds = 0.42));
  } else
    (enemies.spawn('gull', vec(-0.9, 2.2, -0.2), {
      passive: !0,
      hover: 2.2,
      patrolRadius: 0.25,
      yaw: 0.5,
    }),
      enemies.spawn('hound', vec(0.2, 0, 0.6), {
        passive: !0,
        yaw: 1.2,
        patrolLine: [vec(2.6, 0, 1.2), vec(-1.8, 0, 0.2)],
      }));
  ctx.params.epre != null && (preSeconds = +ctx.params.epre);
  for (let posX = 0, posY = Math.round(preSeconds * 60); posX < posY; posX++)
    enemies.update(1 / 60);
  let frozen = !!ctx.params.efreeze;
  return {
    cam: camPos,
    target: camTarget,
    update(l) {
      frozen || enemies.update(l);
    },
  };
}
