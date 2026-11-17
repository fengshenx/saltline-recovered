// gameplay/enemies/enemies.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { mergeGeometries } from '../../assets/procedural/geometry.js';

import { createDroneModel, createWalkerModel } from '../../content/models/enemies.js';

import { segmentDistanceSq } from '../../core/math.js';

import { createRng } from '../../core/random.js';

import { GULL_TUNE, createDrone } from './drone.js';

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
      requestToken(enemyUnit) {
        if (enemyUnit.hasToken) return !0;
        let deltaTime = 0;
        for (let deltaX of list) deltaX.alive && deltaTime++;
        let tokenLimit = deltaTime > 5 ? AI_TUNE.maxTokensCrowd : AI_TUNE.maxTokens,
          playerOrPool = shared.t - shared.tokenT,
          tempFlag = enemyUnit.type === 'gull' ? 'hound' : 'gull',
          targetDelta =
            shared.lastType === enemyUnit.type &&
            shared.t - shared.wantT[tempFlag] < 0.5 &&
            playerOrPool < AI_TUNE.tokenGap * 2.2;
        return shared.tokens >= tokenLimit || playerOrPool < AI_TUNE.tokenGap || targetDelta
          ? ((shared.wantT[enemyUnit.type] = shared.t), !1)
          : (shared.tokens++,
            (shared.tokenT = shared.t),
            (shared.lastType = enemyUnit.type),
            (enemyUnit.hasToken = !0),
            !0);
      },
      releaseToken(enemyUnit) {
        enemyUnit.hasToken &&
          ((enemyUnit.hasToken = !1), (shared.tokens = Math.max(0, shared.tokens - 1)));
      },
      think(enemyUnit, deltaTime, tokenLimit) {
        let playerOrPool = ctx.player;
        if (enemyUnit.passive || !playerOrPool) {
          enemyUnit.los = !1;
          return;
        }
        if (((enemyUnit.senseT -= deltaTime), enemyUnit.senseT <= 0)) {
          enemyUnit.senseT = 0.11 + rand() * 0.08;
          let tempFlag = !1;
          if (playerOrPool.alive !== !1) {
            let targetDelta = playerOrPool.eye || playerOrPool.pos,
              deltaX = targetDelta.x - enemyUnit.sensor.x,
              deltaHeight = targetDelta.y - enemyUnit.sensor.y,
              deltaZ = targetDelta.z - enemyUnit.sensor.z,
              sightDistance = Math.hypot(deltaX, deltaHeight, deltaZ);
            if (sightDistance < AI_TUNE.sightRange) {
              let planarDistance = Math.hypot(deltaX, deltaZ) || 1e-4,
                facingDot = (deltaX * enemyUnit.fwd.x + deltaZ * enemyUnit.fwd.z) / planarDistance;
              (enemyUnit.mode === 'engage' || facingDot > SIGHT_COS_HALF || sightDistance < 3.5) &&
                (tempFlag = ctx.physics.lineOfSight(enemyUnit.sensor, targetDelta));
            }
          }
          enemyUnit.los = tempFlag;
        }
        (enemyUnit.los
          ? ((enemyUnit.seeT += deltaTime),
            (enemyUnit.noSeeT = 0),
            enemyUnit.lastKnown.copy(playerOrPool.pos),
            (enemyUnit.exposure = Math.min(1, enemyUnit.exposure + deltaTime * AI_TUNE.exposureUp)))
          : ((enemyUnit.noSeeT += deltaTime),
            (enemyUnit.seeT = Math.max(0, enemyUnit.seeT - deltaTime * 0.6)),
            (enemyUnit.exposure = Math.max(
              0,
              enemyUnit.exposure - deltaTime * AI_TUNE.exposureDown,
            ))),
          enemyUnit.mode === 'engage'
            ? (enemyUnit.noSeeT > AI_TUNE.loseSight || playerOrPool.alive === !1) &&
              ((enemyUnit.mode = 'search'),
              (enemyUnit.modeT = AI_TUNE.searchTime + rand() * 3),
              shared.releaseToken(enemyUnit))
            : enemyUnit.los &&
                enemyUnit.seeT > (enemyUnit.mode === 'patrol' ? tokenLimit : tokenLimit * 0.45)
              ? ((enemyUnit.mode = 'engage'),
                (enemyUnit.noSeeT = 0),
                ctx.events.emit('enemy:alert', {
                  enemy: enemyUnit,
                }),
                shared.rally(enemyUnit.pos, 18, playerOrPool.pos, enemyUnit))
              : enemyUnit.mode !== 'patrol' &&
                ((enemyUnit.modeT -= deltaTime),
                enemyUnit.modeT <= 0 &&
                  ((enemyUnit.mode = 'patrol'),
                  (enemyUnit.home.x = enemyUnit.pos.x),
                  (enemyUnit.home.z = enemyUnit.pos.z))));
      },
      rally(enemyUnit, deltaTime, tokenLimit, playerOrPool) {
        for (let tempFlag of list)
          tempFlag === playerOrPool ||
            !tempFlag.alive ||
            tempFlag.passive ||
            tempFlag.mode === 'engage' ||
            tempFlag.pos.distanceToSquared(enemyUnit) > deltaTime * deltaTime ||
            (tempFlag.lastKnown.copy(tokenLimit),
            (tempFlag.mode = 'investigate'),
            (tempFlag.modeT = 9 + rand() * 4));
      },
      provoke(enemyUnit) {
        let deltaTime = ctx.player;
        !deltaTime ||
          enemyUnit.passive ||
          !enemyUnit.alive ||
          (enemyUnit.mode !== 'engage' &&
            (enemyUnit.lastKnown.copy(deltaTime.pos),
            (enemyUnit.mode = 'investigate'),
            (enemyUnit.modeT = 10),
            (enemyUnit.seeT = 1),
            (enemyUnit.senseT = 0)),
          shared.rally(enemyUnit.pos, 20, deltaTime.pos, enemyUnit));
      },
      fireBolt(enemyUnit, deltaTime, tokenLimit) {
        let playerOrPool = null;
        for (let tempFlag = 0; tempFlag < bolts.length; tempFlag++)
          if (!bolts[tempFlag].on) {
            playerOrPool = bolts[tempFlag];
            break;
          }
        playerOrPool &&
          ((playerOrPool.on = !0),
          (playerOrPool.life = 1.3),
          playerOrPool.pos.copy(enemyUnit),
          playerOrPool.dir.copy(deltaTime),
          playerOrPool.from.copy(enemyUnit),
          (playerOrPool.len = 0));
      },
      addWreck(enemyUnit) {
        for (wrecks.push(enemyUnit); wrecks.length > AI_TUNE.maxWrecks;) {
          let deltaTime = wrecks.shift();
          deltaTime.active && (deltaTime.sink = 0.001);
        }
      },
      retire(enemyUnit) {
        enemyUnit._deactivate();
        let deltaTime = list.indexOf(enemyUnit);
        (deltaTime >= 0 && list.splice(deltaTime, 1),
          (deltaTime = wrecks.indexOf(enemyUnit)),
          deltaTime >= 0 && wrecks.splice(deltaTime, 1));
      },
    },
    gullDef = createDroneModel(),
    houndDef = createWalkerModel(),
    gullPool = [],
    houndPool = [];
  for (let enemyUnit = 0; enemyUnit < AI_TUNE.poolGulls; enemyUnit++) {
    let deltaTime = createDrone(shared, gullDef, materials, enemyUnit);
    (gullPool.push(deltaTime), group.add(deltaTime.rig.group));
  }
  for (let enemyUnit = 0; enemyUnit < AI_TUNE.poolHounds; enemyUnit++) {
    let deltaTime = createWalker(shared, houndDef, materials, enemyUnit);
    (houndPool.push(deltaTime), group.add(deltaTime.rig.group));
  }
  let bolts = [];
  for (let enemyUnit = 0; enemyUnit < AI_TUNE.maxBolts; enemyUnit++)
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
      spawn(enemyUnit, deltaTime, tokenLimit = {}) {
        let playerOrPool =
          enemyUnit === 'gull' ? gullPool : enemyUnit === 'hound' ? houndPool : null;
        if (!playerOrPool) return null;
        let tempFlag = null;
        for (let targetDelta of playerOrPool)
          if (!targetDelta.active) {
            tempFlag = targetDelta;
            break;
          }
        if (!tempFlag && enemyUnit === 'hound' && wrecks.length) {
          let targetDelta = wrecks[0];
          (shared.retire(targetDelta), (tempFlag = targetDelta));
        }
        return tempFlag
          ? ((tempFlag.id = nextId++),
            list.push(tempFlag),
            tempFlag._activate(deltaTime, tokenLimit),
            ctx.events.emit('enemy:spawn', {
              enemy: tempFlag,
            }),
            tempFlag)
          : null;
      },
      raycast(enemyUnit, deltaTime, tokenLimit = 300) {
        let playerOrPool = null;
        for (let tempFlag = 0; tempFlag < list.length; tempFlag++) {
          let targetDelta = list[tempFlag];
          if (!targetDelta.alive) continue;
          let deltaX = targetDelta.pos.x - enemyUnit.x,
            deltaHeight =
              targetDelta.pos.y + (targetDelta.type === 'hound' ? 0.6 : 0) - enemyUnit.y,
            deltaZ = targetDelta.pos.z - enemyUnit.z,
            sightDistance = deltaX * deltaTime.x + deltaHeight * deltaTime.y + deltaZ * deltaTime.z;
          sightDistance < -1.5 ||
            sightDistance > tokenLimit + 1.5 ||
            deltaX * deltaX +
              deltaHeight * deltaHeight +
              deltaZ * deltaZ -
              sightDistance * sightDistance >
              1.7 ||
            (playerOrPool ||
              (playerOrPool = {
                dist: 1 / 0,
                point: new THREE.Vector3(),
                normal: new THREE.Vector3(),
                enemy: null,
                part: 'body',
              }),
            targetDelta._raycast(enemyUnit, deltaTime, tokenLimit, playerOrPool));
        }
        return playerOrPool && playerOrPool.enemy ? playerOrPool : null;
      },
      aliveCount() {
        let enemyUnit = 0;
        for (let deltaTime of list) deltaTime.alive && enemyUnit++;
        return enemyUnit;
      },
      clear() {
        for (let enemyUnit of gullPool) enemyUnit.active && enemyUnit._deactivate();
        for (let enemyUnit of houndPool) enemyUnit.active && enemyUnit._deactivate();
        ((list.length = 0), (wrecks.length = 0), (shared.tokens = 0));
        for (let enemyUnit of bolts) enemyUnit.on = !1;
        ((boltMesh.count = 0),
          lightHandle && lightHandle.light && (lightHandle.light.intensity = 0));
      },
      alert(enemyUnit, deltaTime = 40) {
        for (let tokenLimit of list)
          !tokenLimit.alive ||
            tokenLimit.passive ||
            tokenLimit.mode === 'engage' ||
            tokenLimit.pos.distanceToSquared(enemyUnit) > deltaTime * deltaTime ||
            (tokenLimit.lastKnown.copy(enemyUnit),
            (tokenLimit.lastKnown.y = Math.max(0, enemyUnit.y - 1.6)),
            tokenLimit.mode === 'patrol' &&
              ctx.events.emit('enemy:alert', {
                enemy: tokenLimit,
                noise: !0,
              }),
            (tokenLimit.mode = 'investigate'),
            (tokenLimit.modeT = 9 + rand() * 4));
      },
      update(enemyUnit) {
        if (enemyUnit <= 0) return;
        (enemyUnit > 0.05 && (enemyUnit = 0.05),
          (shared.t += enemyUnit),
          (hearCooldown -= enemyUnit));
        let deltaTime = ctx.player;
        if (deltaTime) {
          let tokenLimit = deltaTime.vel
            ? Math.hypot(deltaTime.vel.x, deltaTime.vel.z)
            : deltaTime.speed || 0;
          shared.playerSpeed += (tokenLimit - shared.playerSpeed) * (1 - Math.exp(-6 * enemyUnit));
        }
        for (let tokenLimit = list.length - 1; tokenLimit >= 0; tokenLimit--)
          list[tokenLimit]._update(enemyUnit);
        (updateBolts(enemyUnit), updateGullLight(enemyUnit));
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
    ctx.events.on('weapon:fire', (enemyUnit) => {
      if (hearCooldown > 0) return;
      hearCooldown = 0.3;
      let deltaTime =
        (enemyUnit && (enemyUnit.origin || enemyUnit.muzzle)) || (ctx.player && ctx.player.pos);
      deltaTime && system.alert(deltaTime, AI_TUNE.hearRadius);
    }),
    ctx.events.on('explosion', (enemyUnit) => {
      enemyUnit && enemyUnit.pos && system.alert(enemyUnit.pos, 30);
    }),
    ctx.events.on('game:state', (enemyUnit) => {
      enemyUnit && enemyUnit.state === 'title' && system.clear();
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
    let vecX = enemies.spawn('hound', vec(0, 0, 0), {
        passive: !0,
        yaw: 0.8,
      }),
      vecY = enemies.spawn('gull', vec(-1.6, 3.4, -0.5), {
        passive: !0,
        hover: 3.4,
        patrolRadius: 0.02,
      });
    enemies.spawn('hound', vec(2.2, 0, -1.6), {
      passive: !0,
      yaw: -0.6,
      patrolLine: [vec(2.2, 0, -1.6), vec(3.4, 0, -3)],
    });
    for (let vecZ = 0; vecZ < 30; vecZ++) enemies.update(1 / 60);
    vecX.damage(999, vecX.pos, vec(0.6, 0, -0.8), 'body');
    for (let vecZ = 0; vecZ < 110; vecZ++) enemies.update(1 / 60);
    (vecY.damage(999, vecY.pos, vec(0, 0, 1), 'body'),
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
  for (let vecX = 0, vecY = Math.round(preSeconds * 60); vecX < vecY; vecX++)
    enemies.update(1 / 60);
  let frozen = !!ctx.params.efreeze;
  return {
    cam: camPos,
    target: camTarget,
    update(vecX) {
      frozen || enemies.update(vecX);
    },
  };
}
