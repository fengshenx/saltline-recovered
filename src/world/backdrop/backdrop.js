// world/backdrop/backdrop.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { MeshBatcher, catenaryPoints, strutBetween, strutsAlongPath } from '../../core/geometry.js';

import { newVec3, toVec3 } from '../../core/math.js';

import { _b } from '../../misc.js';

import { buildQuayCrane } from './cranes.js';

import { createBlinkerBatch } from './geometry.js';

import { SHIP_DECK_Y, SHIP_LENGTH, buildContainerShip, buildMooringBoat } from './ships.js';

import { buildHarborSkyline, createGullFlock } from './sky.js';

/**
 * 在静态根节点下建一个带位移与朝向的空组，作为多部件道具（货架、叉车、板垛等）的装配锚点
 */
export function makeStaticGroup(ctx, x, z, yaw, s = 0) {
  let o = new THREE.Group();
  return (o.position.set(x, s, z), (o.rotation.y = yaw), ctx.staticRoot.add(o), o);
}

/**
 * 码头平台的关键尺寸：岸沿 x、舷梯 z、两条门机轨道 x、平台 z 范围
 */
export var QUAY_DIMS = {
  X: 30,
  LADDER_Z: 20,
  RAILS: [18.5, 28.5],
  Z0: -30,
  Z1: 28,
};

/**
 * 背景（远景）模块注册表，用 getter 惰性暴露 create/showcase 两个入口
 */
export var backdropModule = {};

/**
 * 沿折线加整套栏杆（立柱 + 上下横杆 + 可选中杆），按间距自动分柱，桥吊与船体的防护栏统一走它
 */
export function addRailing(
  ctx,
  mat,
  points,
  {
    h: railHeight = 1.1,
    post: postSpacing = 2.2,
    r: tubeRadius = 0.022,
    tint: tintColor,
    mid: hasMidRail = !0,
  } = {},
) {
  points = points.map(toVec3);
  for (let segIndex = 0; segIndex < points.length - 1; segIndex++) {
    let segStart = points[segIndex],
      segEnd = points[segIndex + 1],
      segLen = segStart.distanceTo(segEnd),
      postCount = Math.max(1, Math.round(segLen / postSpacing));
    for (let postIndex = segIndex === 0 ? 0 : 1; postIndex <= postCount; postIndex++) {
      let postPos = new THREE.Vector3().lerpVectors(segStart, segEnd, postIndex / postCount);
      ctx.add(
        mat,
        strutBetween(postPos, newVec3(postPos.x, postPos.y + railHeight, postPos.z), tubeRadius, 4),
        tintColor,
      );
    }
    (ctx.add(
      mat,
      strutBetween(
        newVec3(segStart.x, segStart.y + railHeight, segStart.z),
        newVec3(segEnd.x, segEnd.y + railHeight, segEnd.z),
        tubeRadius * 1.15,
        5,
      ),
      tintColor,
    ),
      hasMidRail &&
        ctx.add(
          mat,
          strutBetween(
            newVec3(segStart.x, segStart.y + railHeight * 0.5, segStart.z),
            newVec3(segEnd.x, segEnd.y + railHeight * 0.5, segEnd.z),
            tubeRadius * 0.9,
            4,
          ),
          tintColor,
        ));
  }
}

/**
 * 一个八面体小球，用作航空障碍灯/警示灯灯头，给定坐标即生成
 */
export var makeBeaconGeo = (x, y, z, n = 0.12) => {
  let s = new THREE.OctahedronGeometry(n, 0);
  return (s.translate(x, y, z), s);
};

/**
 * 浅灰面板的顶点色偏移三元组（RGB 通道各不同，制造冷暖层次），岸桥大面板通用
 */
export var TINT_PANEL = [0.82, 0.95, 1.12];

/**
 * 深灰/背光面的顶点色偏移三元组，用来区分主梁的框与板
 */
export var TINT_PANEL_DARK = [0.6, 0.72, 0.86];

/**
 * 黄色漆面（栏杆、护边）的顶点色偏移，让同一材质的护栏有轻微深浅变化
 */
export var TINT_YELLOW = [1, 0.95, 0.85];

/**
 * 白色漆面（机房外墙、舷窗框）的顶点色偏移
 */
export var TINT_WHITE = [0.95, 0.96, 0.97];

/**
 * 区间归一化 + smoothstep 的小工具，用于船体舷弧的平滑过渡
 */
var smoothstep01 = (edge0, edge1, value) => {
  let n = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return n * n * (3 - 2 * n);
};

/**
 * 舷弧：船首与船尾甲板相对中段抬高的量（两端各一项二次曲线），让船体侧影不是一条直板
 */
var deckSheerRise = (station) =>
  1.7 * Math.pow(Math.max(0, 1 - station / 20), 2) +
  0.5 * Math.pow(Math.max(0, (station - (SHIP_LENGTH - 12)) / 12), 2);

/**
 * 给定站号返回甲板高度（基高 + 舷弧）
 */
export var deckHeightAt = (station) => SHIP_DECK_Y + deckSheerRise(station);

/**
 * 给定站号返回甲板以上舷墙高度；船首尾处降到 0，用来让舷墙自然收头
 */
export var bulwarkHeightAt = (station) =>
  1.15 *
  (1 -
    smoothstep01(14.5, 18, station) +
    smoothstep01(SHIP_LENGTH - 10.5, SHIP_LENGTH - 8, station));

/**
 * 给定站号返回舷墙顶高度（甲板高度 + 舷墙高度），栏杆与系缆设备的落点
 */
export var bulwarkTopAt = (station) => deckHeightAt(station) + bulwarkHeightAt(station);

/**
 * 顶点色的归一化参考色；把普通颜色除以它就能把色值压到以 1 为基准的着色范围
 */
var TINT_REF_COLOR = new THREE.Color(12172214);

/**
 * 把 sRGB 整数色除以参考色得到顶点色三元组（可整体调亮/调暗），远景集装箱配色都走它
 */
export var normalizeTint = (hex, e = 1) => {
  let t = new THREE.Color(hex);
  return [(e * t.r) / TINT_REF_COLOR.r, (e * t.g) / TINT_REF_COLOR.g, (e * t.b) / TINT_REF_COLOR.b];
};

/**
 * 远景码头集装箱的 18 色归一化调色板（海运公司涂装），供堆场随机取色
 */
export var HARBOR_CONTAINER_COLORS = [
  8200729, 8200729, 6957596, 2047846, 2047846, 2307146, 2906692, 2906692, 11751962, 9062946,
  5922920, 5922920, 4146764, 2055523, 10121752, 8093308, 6962468, 6962468,
].map((i) => normalizeTint(i));

/**
 * 远景集装箱/建筑的原色调色板（10 色，直接当顶点色），用于仓库与货堆的大色块
 */
export var DISTANT_CONTAINER_COLORS = [
  [0.6, 0.17, 0.13],
  [0.17, 0.29, 0.5],
  [0.2, 0.42, 0.3],
  [0.76, 0.35, 0.12],
  [0.78, 0.6, 0.16],
  [0.8, 0.81, 0.78],
  [0.4, 0.43, 0.47],
  [0.16, 0.42, 0.45],
  [0.55, 0.2, 0.15],
  [0.2, 0.3, 0.45],
];

/**
 * 按到场景原点的距离压暗远景物体的系数，充当廉价的空气透视
 */
export var distanceFade = (x, z) => 1 - 0.6 * _b(38, 160, Math.hypot(x + 5, z));

/**
 * 背景可单独挑选的部件名（岸桥/货船/小艇/天际线），调试与展示入口按它筛选
 */
var BACKDROP_PARTS = ['crane', 'ship', 'boat', 'sky'];

/**
 * 组装远景：岸桥、KITTIWAKE 号、系泊小艇、对岸天际线与海鸥，统一驱动吊具晃动、雷达旋转、船体涌动，并注册背景碰撞盒
 */
function buildBackdrop(game, { only: onlyPart = null, showcase = !1 } = {}) {
  let wantPart = (b) => !onlyPart || onlyPart === b,
    backdropRoot = new THREE.Group();
  backdropRoot.name = 'backdrop';
  let lamps = createBlinkerBatch(),
    boatPos = new THREE.Vector3(31.5, -1.6, 21);
  showcase && boatPos.set(24, 0.34, 15);
  let boat = null,
    crane = null,
    ship = null,
    skyline = null,
    gulls = null;
  if (
    (wantPart('boat') &&
      ((boat = buildMooringBoat(game, lamps)),
      boat.root.position.copy(boatPos),
      (boat.root.rotation.y = -Math.PI / 2),
      backdropRoot.add(boat.root)),
    boat && !showcase)
  ) {
    let partName = new MeshBatcher(),
      ropeMat = game.mats.get('rope');
    (partName.add(
      ropeMat,
      strutsAlongPath(
        catenaryPoints(newVec3(3.2, 0.95, 0.05), newVec3(4.6, 2.12, 2.3), 0.22, 7),
        0.016,
        5,
      ),
    ),
      partName.add(
        ropeMat,
        strutsAlongPath(
          catenaryPoints(newVec3(-3.25, 0.82, 0.95), newVec3(-4.6, 2.12, 2.3), 0.2, 7),
          0.016,
          5,
        ),
      ),
      boat.root.add(
        partName.build({
          cast: !1,
          recv: !1,
        }),
      ));
  }
  (wantPart('crane') && ((crane = buildQuayCrane(game, lamps)), backdropRoot.add(crane.root)),
    wantPart('ship') && ((ship = buildContainerShip(game, lamps)), backdropRoot.add(ship.root)),
    wantPart('sky') &&
      ((skyline = buildHarborSkyline(game, lamps)), backdropRoot.add(skyline.root)),
    (wantPart('sky') || wantPart('crane')) &&
      ((gulls = createGullFlock(game, lamps.uTime, 12)), backdropRoot.add(gulls)));
  let lampMesh = lamps.build();
  (lampMesh &&
    ((lampMesh.name = 'backdrop-lamps'), (lampMesh.frustumCulled = !1), backdropRoot.add(lampMesh)),
    game.scene.add(backdropRoot));
  let colliders = [],
    addCollider = (b, m) => {
      game.physics &&
        game.physics.addBox &&
        colliders.push(
          game.physics.addBox(b.min, b.max, {
            surface: m,
            tag: 'backdrop',
            noNav: !!b.noNav,
          }),
        );
    };
  if (crane) for (let partName of crane.colliders) addCollider(partName, 'metal');
  if (ship) for (let partName of ship.colliders) addCollider(partName, 'metal');
  boat &&
    !showcase &&
    addCollider(
      {
        min: [30.25, -1.7, 17.4],
        max: [32.8, -0.7, 24.6],
      },
      'rubber',
    );
  let triCount = 0,
    meshCount = 0;
  backdropRoot.traverse((b) => {
    if (b.isMesh) {
      meshCount++;
      let m = b.geometry;
      triCount += (m.index ? m.index.count : m.attributes.position.count) / 3;
    }
  });
  let elapsed = 0;
  function update(b) {
    if (((elapsed += b), (lamps.uTime.value = elapsed), crane)) {
      let m = crane.spreader;
      ((m.rotation.x = 0.012 * Math.sin(elapsed * 0.52) + 0.004 * Math.sin(elapsed * 1.31 + 1)),
        (m.rotation.z = 0.009 * Math.sin(elapsed * 0.41 + 1.1)));
    }
    (ship && (ship.radar.rotation.y = elapsed * 1.9),
      boat &&
        ((boat.root.position.y =
          boatPos.y +
          (showcase ? 0 : 0.05 * Math.sin(elapsed * 1.15) + 0.025 * Math.sin(elapsed * 2.3 + 1.3))),
        (boat.hullGrp.rotation.x =
          0.05 * Math.sin(elapsed * 0.9 + 0.4) + 0.016 * Math.sin(elapsed * 2.1)),
        (boat.hullGrp.rotation.z = 0.02 * Math.sin(elapsed * 1.3 + 2))));
  }
  return (
    update(0),
    {
      update: update,
      root: backdropRoot,
      boat: boat ? boat.root : new THREE.Object3D(),
      crane: crane ? crane.root : null,
      ship: ship ? ship.root : null,
      skyline: skyline ? skyline.root : null,
      gulls: gulls,
      lamps: lampMesh,
      colliders: colliders,
      spreader: crane ? crane.spreader : null,
      boatBase: boatPos,
      extractionPoint: new THREE.Vector3(30, 0, 20),
      shipName: 'KITTIWAKE',
      craneId: 'SALTLINE 04',
      stats: {
        tris: Math.round(triCount),
        drawCalls: meshCount,
      },
    }
  );
}

/**
 * 背景模块的 create 入口：正式游戏里按全量建远景
 */
export async function createBackdrop(game) {
  return buildBackdrop(game, {});
}

/**
 * 背景模块的 showcase 入口：按 URL 参数只建单个部件并给出对应机位，供美术逐个检查
 */
export function showcaseBackdrop(game) {
  let partName =
      game.params && BACKDROP_PARTS.includes(game.params.bshow) ? game.params.bshow : null,
    backdrop = buildBackdrop(game, {
      only: partName,
      showcase: !0,
    });
  console.log('[backdrop] ' + JSON.stringify(backdrop.stats));
  let shotMap = {
    crane: {
      cam: [0, 1.7, 27],
      target: [33, 13, 0],
    },
    ship: {
      cam: [24, 1.7, -2],
      target: [38, 9, -24],
    },
    boat: {
      cam: [19.5, 1.7, 11.5],
      target: [24, 0.9, 15],
    },
    sky: {
      cam: [-32, 1.7, 6],
      target: [30, 9, 0],
    },
  };
  return {
    ...(shotMap[partName] || shotMap.crane),
    update: (s) => backdrop.update(s),
  };
}
