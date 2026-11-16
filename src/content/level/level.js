// content/level/level.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { mergeStaticMeshes } from '../../assets/procedural/geometry.js';

import { SHED_BOUNDS, buildLabelAtlas, buildWorkshopShed, createLevelKit } from './buildings.js';

import {
  buildCableRun,
  buildQuayApron,
  buildUtilityStandpipe,
  countMeshes,
  hasNoMergeAncestor,
  placeGateArea,
  placeYardLayout,
  vec3,
} from './placement.js';

import { ts } from '../../misc.js';

/**
 * 装配整张关卡：建建筑/码头/堆场，合并静态网格、换合批材质、建标签图集，产出出生点、任务点、敌人刷新点、分区、掩体与演出数据
 */
export async function createLevel(game) {
  let levelRoot = new THREE.Group();
  ((levelRoot.name = 'level'), game.scene.add(levelRoot));
  let ctx = createLevelKit(game);
  (placeYardLayout(ctx), placeGateArea(ctx));
  let shed = buildWorkshopShed(ctx),
    quay = buildQuayApron(ctx),
    relayYard = ctx.place(
      'relay_node',
      1.5,
      7.5,
      0.35,
      {
        seed: 1,
      },
      0,
    ),
    relayShed = ctx.place(
      'relay_node',
      shed.relayPos.x,
      shed.relayPos.z,
      ts * 0.9,
      {
        seed: 2,
      },
      SHED_BOUNDS.FLOOR,
    ),
    relayQuay = ctx.place(
      'relay_node',
      quay.relayPos.x,
      quay.relayPos.z,
      -0.2,
      {
        seed: 3,
      },
      0,
    );
  (buildCableRun(
    ctx,
    [
      [-2, -27.5, 1.2],
      [-2, -27.55, 0.08],
      [-1.4, -25.6],
      [-2.4, -23],
      [-1.9, -20.3],
    ],
    0.03,
    ctx.MI('rubber'),
    SHED_BOUNDS.FLOOR + 0.028,
  ),
    buildUtilityStandpipe(ctx, 20.4, -7.3, 0.2),
    buildCableRun(
      ctx,
      [
        [20.5, -7],
        [21.4, -4.9],
        [22.4, -2.6],
        [22.9, -0.7],
      ],
      0.03,
    ),
    ctx.staticRoot.updateMatrixWorld(!0));
  let detachList = [];
  ctx.staticRoot.traverse((sceneNode) => {
    sceneNode.userData &&
      sceneNode.userData.noMerge &&
      !(sceneNode.parent && hasNoMergeAncestor(sceneNode.parent, ctx.staticRoot)) &&
      detachList.push(sceneNode);
  });
  for (let sceneNode of detachList) ctx.dynRoot.attach(sceneNode);
  let materials = new Set();
  ctx.staticRoot.traverse((sceneNode) => {
    sceneNode.isMesh && !Array.isArray(sceneNode.material) && materials.add(sceneNode.material);
  });
  let colorSwap = new Map();
  for (let sceneNode of materials)
    if (!(
      !sceneNode.isMeshStandardMaterial ||
      sceneNode.vertexColors ||
      sceneNode.transparent ||
      !sceneNode.name ||
      !(game.mats.names || []).includes(sceneNode.name)
    ))
      try {
        let materialRef =
          sceneNode.userData && sceneNode.userData.interior
            ? {
                interior: !0,
              }
            : {};
        if (game.mats.get(sceneNode.name, materialRef) !== sceneNode) continue;
        let zoneName = game.mats.get(sceneNode.name, {
          ...materialRef,
          vertexColors: !0,
        });
        zoneName !== sceneNode && materials.has(zoneName) && colorSwap.set(sceneNode, zoneName);
      } catch {}
  ctx.staticRoot.traverse((sceneNode) => {
    if (!sceneNode.isMesh || Array.isArray(sceneNode.material)) return;
    let materialRef = colorSwap.get(sceneNode.material);
    materialRef && (sceneNode.material = materialRef);
    let zoneName = !sceneNode.material.transparent && !sceneNode.material.isMeshBasicMaterial;
    ((sceneNode.castShadow = zoneName),
      (sceneNode.receiveShadow = !sceneNode.material.isMeshBasicMaterial));
  });
  let labelAtlas = {
    count: 0,
    update() {},
  };
  try {
    labelAtlas = buildLabelAtlas(ctx.staticRoot);
  } catch (sceneNode) {
    console.error('[level] label atlas failed', sceneNode);
  }
  let mergedRoot = mergeStaticMeshes(ctx.staticRoot);
  ((mergedRoot.name = 'level-merged'), levelRoot.add(mergedRoot), levelRoot.add(ctx.dynRoot));
  for (let sceneNode of [relayYard, relayShed, relayQuay]) {
    for (let materialRef = sceneNode.children.length - 1; materialRef >= 0; materialRef--)
      sceneNode.remove(sceneNode.children[materialRef]);
    ctx.dynRoot.add(sceneNode);
  }
  let triCount = 0;
  mergedRoot.traverse((sceneNode) => {
    if (sceneNode.isMesh) {
      let materialRef = sceneNode.geometry;
      triCount +=
        (materialRef.index ? materialRef.index.count : materialRef.attributes.position.count) / 3;
    }
  });
  let playerStart = {
      pos: vec3(-32, 0, 6),
      yaw: -ts,
    },
    objectives = [
      {
        id: 'relay_a',
        label: 'Relay A \u2014 Yard',
        zone: 'yard',
        pos: vec3(1.5, 0, 7.5),
        object: relayYard,
      },
      {
        id: 'relay_b',
        label: 'Relay B \u2014 Shed',
        zone: 'shed',
        pos: vec3(shed.relayPos.x, SHED_BOUNDS.FLOOR, shed.relayPos.z),
        object: relayShed,
      },
      {
        id: 'relay_c',
        label: 'Relay C \u2014 Quay',
        zone: 'quay',
        pos: vec3(quay.relayPos.x, 0, quay.relayPos.z),
        object: relayQuay,
      },
    ],
    groundSpawn = (z, H, O) => ({
      pos: vec3(z, 0, H),
      zone: O,
      type: 'ground',
    }),
    airSpawn = (z, H, O, q) => ({
      pos: vec3(z, H, O),
      zone: q,
      type: 'air',
    }),
    enemySpawns = [
      groundSpawn(-19, -1.4, 'yard'),
      groundSpawn(3.5, -1.6, 'yard'),
      groundSpawn(14.2, 16.4, 'yard'),
      groundSpawn(-3.2, 16.6, 'yard'),
      groundSpawn(-16, 26, 'yard'),
      groundSpawn(6, 26, 'yard'),
      groundSpawn(4.2, -5.12, 'yard'),
      groundSpawn(-7.8, 21.4, 'yard'),
      groundSpawn(-11.3, 12.5, 'yard'),
      groundSpawn(17.5, 22.2, 'yard'),
      airSpawn(10, 11, 23.5, 'yard'),
      airSpawn(2, 11, 21.5, 'yard'),
      airSpawn(13, 9, 11, 'yard'),
      airSpawn(-4, 12.5, -4.5, 'yard'),
      airSpawn(9, 10, 1.5, 'yard'),
      airSpawn(-10, 12, 24.5, 'yard'),
      groundSpawn(-12.4, -24.8, 'shed'),
      groundSpawn(9.6, -25.3, 'shed'),
      groundSpawn(-13.4, -19.6, 'shed'),
      groundSpawn(4.6, -13.8, 'shed'),
      groundSpawn(-21, -27.2, 'shed'),
      groundSpawn(-18.6, -22, 'shed'),
      groundSpawn(13.6, -24, 'shed'),
      groundSpawn(-26.6, -15, 'shed'),
      airSpawn(-8, 5.4, -20.5, 'shed'),
      airSpawn(5, 5.2, -18, 'shed'),
      airSpawn(-20, 10.5, -20, 'shed'),
      airSpawn(14.5, 10, -22, 'shed'),
      airSpawn(-2, 12.5, -8.5, 'shed'),
      groundSpawn(27.7, -24.2, 'quay'),
      groundSpawn(18.3, -25.4, 'quay'),
      groundSpawn(27.2, -12.6, 'quay'),
      groundSpawn(20.2, 14, 'quay'),
      groundSpawn(23.4, 23.2, 'quay'),
      groundSpawn(18, 24.4, 'quay'),
      groundSpawn(27.4, 11.6, 'quay'),
      airSpawn(36, 9, 4, 'quay'),
      airSpawn(38, 11, -6, 'quay'),
      airSpawn(35, 8.5, 16, 'quay'),
      airSpawn(24, 12.5, 10.5, 'quay'),
      airSpawn(33.5, 10, 24.5, 'quay'),
      airSpawn(22, 13, -14, 'quay'),
    ],
    zones = [
      {
        name: 'gate',
        min: [-40, -30],
        max: [-24, 30],
      },
      {
        name: 'yard',
        min: [-24, -10],
        max: [16, 30],
      },
      {
        name: 'shed',
        min: [-24, -30],
        max: [16, -10],
      },
      {
        name: 'quay',
        min: [16, -30],
        max: [40, 30],
      },
    ],
    interiorBoxes = [
      {
        min: vec3(SHED_BOUNDS.X0, 0, SHED_BOUNDS.Z0),
        max: vec3(SHED_BOUNDS.X1, SHED_BOUNDS.RIDGE, SHED_BOUNDS.Z1),
      },
    ],
    cinematicPath = [
      {
        pos: [-34, 1.6, 6.2],
        look: [-12, 2.6, 6.6],
      },
      {
        pos: [-20, 1.3, 5.6],
        look: [0, 2.2, 7],
      },
      {
        pos: [-6.2, 2.1, 7.9],
        look: [2, 1.6, 7.6],
      },
      {
        pos: [-6.6, 2.5, 0.4],
        look: [-4, 2.6, -12],
      },
      {
        pos: [-4.4, 1.9, -8.6],
        look: [-2.4, 2.8, -19.5],
      },
      {
        pos: [-3.2, 2.2, -15],
        look: [-2, 2.2, -20.5],
      },
      {
        pos: [4.2, 2.6, -19.6],
        look: [12, 3.2, -19.5],
      },
      {
        pos: [15, 2, -19.5],
        look: [24, 3.5, -6],
      },
      {
        pos: [20.2, 1.7, -9],
        look: [23, 1.6, 0],
      },
      {
        pos: [25.9, 1.8, 1.5],
        look: [27.5, 1.2, 12],
      },
      {
        pos: [27.3, 1.8, 12],
        look: [29.6, 0.4, 20],
      },
      {
        pos: [28.4, 1.9, 17.2],
        look: [31.5, -0.8, 21],
      },
    ],
    coverPoints = [
      vec3(-33.9, 0, 3.8),
      vec3(-27.3, 0, 2.3),
      vec3(-19.2, 0, 4.7),
      vec3(-17.4, 0, 4.9),
      vec3(-12.5, 0, 7.2),
      vec3(-9.3, 0, 6.4),
      vec3(-6.3, 0, 7.3),
      vec3(-2.9, 0, 6.1),
      vec3(-2.9, 0, 4.5),
      vec3(5.6, 0, 5.8),
      vec3(5.6, 0, 4.2),
      vec3(-2.2, 0, 10.4),
      vec3(5, 0, 8.9),
      vec3(-4.8, 0, 10.6),
      vec3(7.5, 0, 7.7),
      vec3(9.2, 0, 4.4),
      vec3(-1, 0, 13.6),
      vec3(-13.5, 0, -1.5),
      vec3(-9.6, 0, -0.7),
      vec3(7.8, 0, -1.5),
      vec3(-4.2, 0, -2.2),
      vec3(-0.9, 0, -6.7),
      vec3(-6.7, 0, -7),
      vec3(1.2, 0, -8.9),
      vec3(-8.1, 0, 15.4),
      vec3(0.6, 0, 16.9),
      vec3(4.2, 0, 15.7),
      vec3(-16, 0, 15.6),
      vec3(12, 0, 17.2),
      vec3(2.9, 0, -17),
      vec3(4.2, 0, -15.3),
      vec3(6.9, 0, -20.6),
      vec3(-7.6, 0, -17.4),
      vec3(-8.3, 0, -14.3),
      vec3(9.6, 0, -21.9),
      vec3(-13.2, 0, -14.4),
      vec3(-11.6, 0, -18.6),
      vec3(0, 0, -25.8),
      vec3(-12.4, 0, -25.8),
      vec3(21.4, 0, -4.7),
      vec3(25.3, 0, 3.9),
      vec3(25.7, 0, -4.4),
      vec3(20.2, 0, -15.4),
      vec3(26.4, 0, -15.4),
      vec3(20.6, 0, 14.4),
      vec3(26.8, 0, 14.4),
      vec3(20.6, 0, 21.2),
      vec3(27.4, 0, 22.4),
      vec3(19.6, 0, -21.4),
      vec3(27, 0, -16.2),
      vec3(25.6, 0, 6),
      vec3(13.5, 2.59, 12.4),
      vec3(4.4, 2.59, 12.4),
      vec3(12.9, 0, 8.8),
      vec3(11.6, 0, 4.9),
    ],
    nav = game.physics.nav,
    snapToWalkable = (z) => {
      if (!(!nav || !nav.isWalkable || z.y > 0.2 || nav.isWalkable(z.x, z.z)))
        for (let H of [0.5, 1, 1.5, 2])
          for (let O = 0; O < 8; O++) {
            let q = z.x + Math.cos(O * 0.7854) * H,
              U = z.z + Math.sin(O * 0.7854) * H;
            if (nav.isWalkable(q, U)) {
              ((z.x = q), (z.z = U));
              return;
            }
          }
    };
  (coverPoints.forEach(snapToWalkable),
    enemySpawns.forEach((sceneNode) => {
      sceneNode.type === 'ground' && snapToWalkable(sceneNode.pos);
    }));
  let updateErrorLogged = !1;
  return {
    root: levelRoot,
    playerStart: playerStart,
    objectives: objectives,
    extraction: {
      pos: quay.extraction.clone(),
      radius: 2.5,
    },
    enemySpawns: enemySpawns,
    zones: zones,
    interiorBoxes: interiorBoxes,
    cinematicPath: cinematicPath,
    coverPoints: coverPoints,
    skylights: shed.skylights,
    shedLights: shed.lights,
    vantage: {
      stairsFoot: vec3(-2.2, 0, 12.4),
      roof: vec3(13.5, 2.59, 12.4),
    },
    stats: {
      labelsAtlased: labelAtlas.count,
      containers: ctx.placed.filter((sceneNode) => sceneNode.name.startsWith('container')).length,
      props: ctx.placed.length,
      tris: Math.round(triCount),
      meshes: mergedRoot.children.length + countMeshes(ctx.dynRoot),
    },
    placed: ctx.placed,
    groundSurfaceAt(sceneNode, materialRef) {
      return ctx.isMetal(sceneNode, materialRef) ? 'metal' : 'concrete';
    },
    update(sceneNode) {
      (shed.update(sceneNode), labelAtlas.update(sceneNode));
      for (let materialRef = 0; materialRef < ctx.updaters.length; materialRef++)
        try {
          ctx.updaters[materialRef](sceneNode);
        } catch (zoneName) {
          updateErrorLogged ||
            ((updateErrorLogged = !0), console.error('[level] prop update threw', zoneName));
        }
    },
  };
}

/**
 * 关卡模块的展示入口：只建关不跑游戏，返回固定机位与更新函数，供美术单独看结构
 */
export async function showcaseLevel(game) {
  let e = await createLevel(game);
  return {
    cam: [-32, 1.7, 6],
    target: [0, 2.4, 6.4],
    update: (t) => e.update(t),
  };
}
