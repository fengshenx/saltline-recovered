// content/level/placement.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { createShadowMesh } from '../../assets/procedural/geometry.js';

import { addFootprintCollider, clampValue } from '../../audio/audio.js';

import { QUAY_DIMS, makeStaticGroup } from '../backdrop/backdrop.js';

import { SHED_BOUNDS } from './buildings.js';

import { PropAssembler } from '../props/detail-geometry.js';

import { addEuroPallet } from '../props/detailed-builders.js';

import { PI_TWO } from '../../core/math.js';

import { ts } from '../../misc.js';

import { addCylinderMesh, addRoundedBox } from '../../render/effects/effects.js';

/**
 * 8 种可用箱漆色名，用于随机上色与合法性校验（传入非法色名时回退到箱型默认色）
 */
export var CONTAINER_PAINT_COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'orange',
  'white',
  'grey',
  'teal',
];

/**
 * π 常量，布置表里用来表达整圈朝向
 */
export var PI = Math.PI;

/**
 * 叠放托盘垛（1..12 只，默认 8）：每层随机偏转与错位，中间层可能缺板条，最上层带倒角
 */
export function buildPalletStack(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'pallet_stack', opts.seed || 0),
    rand = assembler.rng,
    count = clampValue(opts.count | 0 || 8, 1, 12);
  for (let layerIndex = 0; layerIndex < count; layerIndex++) {
    let isTop = layerIndex === count - 1;
    (assembler.push({
      p: [
        layerIndex ? rand.range(-0.028, 0.028) : 0,
        layerIndex * 0.144,
        layerIndex ? rand.range(-0.022, 0.022) : 0,
      ],
      r: [
        0,
        rand.range(-0.035, 0.035) +
          (rand() < 0.3 ? PI_TWO : 0) +
          (isTop ? rand.range(-0.06, 0.06) : 0),
        0,
      ],
    }),
      addEuroPallet(assembler, rand, {
        broken: !isTop && rand() < 0.2,
        stamp: layerIndex % 3 === 0,
        bevel: isTop,
      }),
      assembler.pop());
  }
  return assembler.finish({
    size: [1.2, count * 0.144, 1],
  });
}

/**
 * 用角钢立柱、顶横梁和 chainlink 网片拼出的 2.2×1.25×1.2 m 笼式储物箱，配锈斑与磨损贴片，码头和堆场用它填充零散货位
 */
function buildMeshCage(ctx, placeX, placeZ, rotIdx = 0, paintKey = 'paint_blue', variantSeed = 1) {
  let cageGroup = makeStaticGroup(ctx, placeX, placeZ, rotIdx),
    cageW = 2.2,
    cageD = 1.2,
    cageH = 1.25,
    paintMat = ctx.M(paintKey),
    frameMat = ctx.M('steel_dark');
  addRoundedBox(ctx, cageGroup, frameMat, cageW, 0.05, cageD, 0, 0.13, 0);
  for (let sideSign of [-1, 1])
    addRoundedBox(
      ctx,
      cageGroup,
      paintMat,
      0.1,
      0.1,
      cageD,
      sideSign * (cageW / 2 - 0.25),
      0.05,
      0,
    );
  for (let sideSign of [-1, 1])
    for (let randFrac of [-1, 1])
      addRoundedBox(
        ctx,
        cageGroup,
        paintMat,
        0.07,
        cageH - 0.1,
        0.07,
        sideSign * (cageW / 2 - 0.035),
        0.1 + (cageH - 0.1) / 2,
        randFrac * (cageD / 2 - 0.035),
        0.008,
      );
  for (let sideSign of [-1, 1])
    (addRoundedBox(
      ctx,
      cageGroup,
      paintMat,
      cageW,
      0.06,
      0.06,
      0,
      cageH - 0.03,
      sideSign * (cageD / 2 - 0.03),
      0.008,
    ),
      addRoundedBox(
        ctx,
        cageGroup,
        paintMat,
        cageW,
        0.05,
        0.05,
        0,
        0.62,
        sideSign * (cageD / 2 - 0.03),
      ),
      addRoundedBox(
        ctx,
        cageGroup,
        ctx.M('chainlink'),
        cageW - 0.14,
        cageH - 0.25,
        0.012,
        0,
        0.15 + (cageH - 0.25) / 2,
        sideSign * (cageD / 2 - 0.035),
      ));
  for (let sideSign of [-1, 1])
    (addRoundedBox(
      ctx,
      cageGroup,
      paintMat,
      0.06,
      0.06,
      cageD,
      sideSign * (cageW / 2 - 0.03),
      cageH - 0.03,
      0,
      0.008,
    ),
      addRoundedBox(
        ctx,
        cageGroup,
        ctx.M('chainlink'),
        0.012,
        cageH - 0.25,
        cageD - 0.14,
        sideSign * (cageW / 2 - 0.035),
        0.15 + (cageH - 0.25) / 2,
        0,
      ));
  let wornMat = ctx.M('steel_worn'),
    rustMat = ctx.M('steel_rust');
  for (let sideSign = 0; sideSign < 14; sideSign++) {
    let randFrac = (sideSign * 0.618 + variantSeed * 0.37) % 1,
      randFracB = (sideSign * 0.414 + variantSeed * 0.11) % 1,
      dentLen = 1.5 + randFracB * 0.9;
    addCylinderMesh(
      ctx,
      cageGroup,
      sideSign % 3 ? wornMat : rustMat,
      0.014,
      dentLen,
      -cageW / 2 + 0.25 + randFrac * (cageW - 0.9),
      0.16 + (dentLen / 2) * 0.96,
      -cageD / 2 + 0.2 + randFracB * (cageD - 0.4),
      [0.1 * (randFracB - 0.5), 0, 0.28 * (randFrac - 0.3)],
      5,
    );
  }
  for (let sideSign = 0; sideSign < 6; sideSign++) {
    let randFrac = (sideSign * 0.37 + variantSeed * 0.2) % 1;
    addCylinderMesh(
      ctx,
      cageGroup,
      rustMat,
      0.035,
      0.42,
      cageW / 2 - 0.45 + (randFrac - 0.5) * 0.3,
      0.22 + sideSign * 0.05,
      (randFrac - 0.5) * 0.7,
      [Math.PI / 2 + randFrac, randFrac * 3, 0.2],
      6,
    );
  }
  return (
    addFootprintCollider(ctx, placeX, placeZ, rotIdx, cageW, cageD, cageH, 'metal'),
    cageGroup
  );
}

/**
 * 1.1×0.8×0.75 m 开口废料斗：角钢骨架、顶沿加强、内部深色底，四周散布凹痕，堆场与码头通用道具
 */
function buildSkipBin(ctx, binX, binZ, yawAngle = 0, paintName = 'paint_red') {
  let binGroup = makeStaticGroup(ctx, binX, binZ, yawAngle),
    binLength = 1.1,
    binWidth = 0.8,
    binHeight = 0.75,
    paintMat = ctx.M(paintName);
  for (let sideSign of [-1, 1])
    addRoundedBox(ctx, binGroup, paintMat, 0.09, 0.1, binWidth, sideSign * 0.36, 0.05, 0);
  addRoundedBox(ctx, binGroup, paintMat, binLength, 0.04, binWidth, 0, 0.12, 0);
  for (let sideSign of [-1, 1])
    addRoundedBox(
      ctx,
      binGroup,
      paintMat,
      binLength,
      binHeight - 0.1,
      0.03,
      0,
      0.1 + (binHeight - 0.1) / 2,
      sideSign * (binWidth / 2 - 0.015),
      0.006,
    );
  for (let sideSign of [-1, 1])
    addRoundedBox(
      ctx,
      binGroup,
      paintMat,
      0.03,
      binHeight - 0.1,
      binWidth,
      sideSign * (binLength / 2 - 0.015),
      0.1 + (binHeight - 0.1) / 2,
      0,
      0.006,
    );
  for (let sideSign of [-1, 1])
    for (let zSign of [-1, 1])
      addRoundedBox(
        ctx,
        binGroup,
        paintMat,
        0.06,
        binHeight,
        0.06,
        sideSign * (binLength / 2 - 0.02),
        binHeight / 2,
        zSign * (binWidth / 2 - 0.02),
        0.01,
      );
  addRoundedBox(
    ctx,
    binGroup,
    ctx.M('steel_dark'),
    binLength - 0.08,
    0.04,
    binWidth - 0.08,
    0,
    binHeight - 0.22,
    0,
  );
  let wornMat = ctx.M('steel_worn');
  for (let sideSign = 0; sideSign < 12; sideSign++) {
    let zSign = (sideSign * 0.618) % 1,
      dentV = (sideSign * 0.37) % 1;
    addRoundedBox(
      ctx,
      binGroup,
      wornMat,
      0.16,
      0.11,
      0.1,
      (zSign - 0.5) * (binLength - 0.3),
      binHeight - 0.16 + (sideSign % 3) * 0.03,
      (dentV - 0.5) * (binWidth - 0.25),
      0.012,
      [dentV, zSign * 3, zSign],
    );
  }
  return (
    addFootprintCollider(ctx, binX, binZ, yawAngle, binLength, binWidth, binHeight, 'metal'),
    binGroup
  );
}

/**
 * 枕木上分层码放并捆扎的细钢筋/管束（3.4 m 长，9 根），用低廉面数在堆场角落补出工地质感
 */
function buildRebarBundle(ctx, centerX, centerZ, rotY = 0, barCount = 9) {
  let bundleGroup = makeStaticGroup(ctx, centerX, centerZ, rotY),
    wornMat = ctx.M('steel_worn'),
    rustMat = ctx.M('steel_rust');
  for (let barIdx of [-1.1, 1.1])
    addRoundedBox(ctx, bundleGroup, 'wood_dark', 0.1, 0.08, 0.7, barIdx, 0.04, 0, 0.008);
  for (let barIdx = 0; barIdx < barCount; barIdx++) {
    let tierIdx = barIdx < 5 ? 0 : 1,
      tierSlot = tierIdx ? barIdx - 5 : barIdx;
    addCylinderMesh(
      ctx,
      bundleGroup,
      barIdx % 2 ? wornMat : rustMat,
      0.016,
      3.4 + (barIdx % 3) * 0.12,
      ((barIdx % 3) - 1) * 0.06,
      0.1 + tierIdx * 0.03,
      (tierSlot - (tierIdx ? 1.5 : 2)) * 0.045 + tierIdx * 0.02,
      [0, 0.01 * (barIdx - 4), Math.PI / 2],
      5,
    );
  }
  for (let barIdx = 0; barIdx < barCount; barIdx += 3)
    addRoundedBox(ctx, bundleGroup, rustMat, 0.07, 0.05, 0.03, 1.72, 0.11, (barIdx - 4) * 0.02);
  return bundleGroup;
}

/**
 * 橡胶三角挡轮块，斜面贴黄色反光条；摆在叉车与货车轮胎下，暗示车辆是作业中而非摆设
 */
function buildWheelChock(ctx, posX, posZ, yaw = 0) {
  let group = makeStaticGroup(ctx, posX, posZ, yaw),
    chockShape = new THREE.Shape();
  (chockShape.moveTo(-0.16, 0),
    chockShape.lineTo(0.16, 0),
    chockShape.lineTo(0.16, 0.05),
    chockShape.lineTo(-0.1, 0.19),
    chockShape.lineTo(-0.16, 0.19),
    chockShape.closePath());
  let chockGeo = new THREE.ExtrudeGeometry(chockShape, {
    depth: 0.2,
    bevelEnabled: !1,
  });
  return (
    chockGeo.translate(0, 0, -0.1),
    group.add(createShadowMesh(chockGeo, ctx.M('rubber'))),
    addRoundedBox(ctx, group, 'paint_yellow', 0.012, 0.16, 0.18, -0.166, 0.1, 0),
    group
  );
}

/**
 * 行车道指示牌：镀锌立杆 + 黄底模版字标牌（LANE 1/2/3），带碰撞盒，用来给堆场分区命名
 */
function buildLaneSignpost(ctx, signX, signZ, text, faceDir = 'x-', postHeight = 3.2) {
  let isAlongX = faceDir[0] === 'x';
  (ctx.cyl('steel_galv', 0.045, postHeight, signX, postHeight / 2, signZ, {
    seg: 8,
  }),
    ctx.box('steel_dark', 0.3, 0.02, 0.3, signX, 0.01, signZ));
  let signWidth = 1.1,
    signHeight = 0.62,
    signThickness = 0.03;
  ctx.box(
    'paint_yellow',
    isAlongX ? signThickness : signWidth,
    signHeight,
    isAlongX ? signWidth : signThickness,
    signX,
    postHeight - signHeight / 2 - 0.05,
    signZ,
    {
      bevel: 0.01,
    },
  );
  let sideSign = faceDir[1] === '+' ? 1 : -1,
    labelX = isAlongX ? signX + sideSign * (signThickness / 2 + 0.003) : signX,
    labelZ = isAlongX ? signZ : signZ + sideSign * (signThickness / 2 + 0.003);
  (ctx.label(text, 0.4, labelX, postHeight - signHeight / 2 - 0.05, labelZ, faceDir, {
    color: 'black',
    font: 'stencil',
    distress: 0.35,
  }),
    ctx.col(signX - 0.06, 0, signZ - 0.06, signX + 0.06, postHeight, signZ + 0.06, 'metal', {
      noNav: !0,
    }));
}

/**
 * 枕木上分层堆叠的 10.4×4.2 m 板料垛（每层带吊装缺口、黄色护角与橡胶挡边），返回垛高供上层堆叠
 */
function buildPlateStack(ctx, placeX, placeZ, layerCount = 2, rotated = !0, jitterAngle = 0.02) {
  let matNames = ['paint_grey', 'paint_teal', 'paint_grey', 'steel_rust'];
  for (let layerIdx = 0; layerIdx < layerCount; layerIdx++) {
    let layerGroup = makeStaticGroup(
        ctx,
        placeX + (layerIdx ? 0.12 * Math.sin(layerIdx * 2.1) : 0),
        placeZ + (layerIdx ? 0.18 * Math.cos(layerIdx * 1.7) : 0),
        (rotated ? Math.PI / 2 : 0) + jitterAngle * (layerIdx % 2 ? -1 : 1.3),
        0,
      ),
      layerBaseY = 0.1 + layerIdx * (0.5 + 0.1);
    for (let slotY of [-3.6, 0, 3.6])
      addRoundedBox(
        ctx,
        layerGroup,
        'wood_dark',
        0.14,
        0.1,
        4.2 - 0.2,
        slotY,
        layerBaseY - 0.1 / 2,
        0,
        0.01,
      );
    let plateMat = ctx.M(matNames[layerIdx % matNames.length]);
    (addRoundedBox(
      ctx,
      layerGroup,
      plateMat,
      10.4,
      0.5 - 0.08,
      4.2,
      0,
      layerBaseY + (0.5 - 0.08) / 2,
      0,
      0.03,
    ),
      addRoundedBox(
        ctx,
        layerGroup,
        plateMat,
        10.4 - 0.5,
        0.08,
        4.2 - 0.5,
        0,
        layerBaseY + 0.5 - 0.04,
        0,
        0.02,
      ));
    for (let slotY of [-1.4, -0.7, 0, 0.7, 1.4])
      addRoundedBox(
        ctx,
        layerGroup,
        plateMat,
        10.4 - 0.9,
        0.05,
        0.09,
        0,
        layerBaseY + 0.5 + 0.02,
        slotY,
        0.01,
      );
    for (let slotY of [-1, 1])
      for (let cornerSign of [-1, 1])
        (addRoundedBox(
          ctx,
          layerGroup,
          'steel_dark',
          0.32,
          0.12,
          0.32,
          slotY * (10.4 / 2 - 0.35),
          layerBaseY + 0.5 - 0.02,
          cornerSign * (4.2 / 2 - 0.35),
          0.02,
        ),
          addRoundedBox(
            ctx,
            layerGroup,
            'paint_yellow',
            0.5,
            0.5 - 0.1,
            0.02,
            slotY * (10.4 / 2 - 0.5),
            layerBaseY + (0.5 - 0.08) / 2,
            cornerSign * (4.2 / 2 + 0.006),
          ));
    for (let slotY of [-1, 1])
      addRoundedBox(
        ctx,
        layerGroup,
        'rubber',
        0.04,
        0.12,
        4.2 - 0.4,
        slotY * (10.4 / 2 + 0.01),
        layerBaseY + 0.1,
        0,
      );
  }
  let stackHeight = 0.1 + layerCount * (0.5 + 0.1),
    halfExtentX = (rotated ? 4.2 : 10.4) / 2 + 0.05,
    halfExtentZ = (rotated ? 10.4 : 4.2) / 2 + 0.05;
  return (
    ctx.col(
      placeX - halfExtentX,
      0,
      placeZ - halfExtentZ,
      placeX + halfExtentX,
      stackHeight,
      placeZ + halfExtentZ,
      'metal',
    ),
    ctx.metalRects.push([
      placeX - halfExtentX,
      placeZ - halfExtentZ,
      placeX + halfExtentX,
      placeZ + halfExtentZ,
    ]),
    stackHeight
  );
}

/**
 * 沿二维折线铺软管/电缆，跨度大于 2.2 m 时自动插点加垂坠和横向摆动，让地面线缆看起来是自然摊开的
 */
export function buildCableRun(
  ctx,
  points,
  tubeRadius = 0.025,
  materialName = 'rubber',
  fixedHeight = null,
) {
  let pathPoints = [];
  for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
    let point = points[pointIndex];
    if (
      (pathPoints.push([
        point[0],
        point.length > 2 ? point[2] : (fixedHeight ?? tubeRadius * 0.9),
        point[1],
      ]),
      pointIndex < points.length - 1)
    ) {
      let nextPoint = points[pointIndex + 1],
        deltaX = nextPoint[0] - point[0],
        deltaZ = nextPoint[1] - point[1],
        spanLen = Math.hypot(deltaX, deltaZ);
      if (spanLen > 2.2 && point.length < 3 && nextPoint.length < 3) {
        let splitCount = Math.floor(spanLen / 1.6);
        for (let splitIndex = 1; splitIndex < splitCount; splitIndex++) {
          let splitFrac = splitIndex / splitCount,
            swayAmount =
              Math.sin((pointIndex * 3.1 + splitIndex) * 2.3) * Math.min(0.28, spanLen * 0.04);
          pathPoints.push([
            point[0] + deltaX * splitFrac - (deltaZ / spanLen) * swayAmount,
            fixedHeight ?? tubeRadius * 0.9,
            point[1] + deltaZ * splitFrac + (deltaX / spanLen) * swayAmount,
          ]);
        }
      }
    }
  }
  return ctx.tube(materialName, pathPoints, tubeRadius, {
    radial: 6,
    cast: !1,
  });
}

/**
 * 混凝土底板上立起的灰色设备柱（给水/消防立管），正面贴黄黑警示条，配碰撞盒
 */
export function buildUtilityStandpipe(ctx, posX, posZ, yaw = 0) {
  let group = makeStaticGroup(ctx, posX, posZ, yaw);
  return (
    addRoundedBox(ctx, group, 'concrete', 0.7, 0.12, 0.5, 0, 0.06, 0, 0.015),
    addRoundedBox(ctx, group, 'paint_grey', 0.55, 0.9, 0.3, 0, 0.57, 0, 0.015),
    addRoundedBox(ctx, group, 'steel_dark', 0.5, 0.03, 0.34, 0, 1.03, 0),
    addRoundedBox(ctx, group, 'hazard_stripes', 0.3, 0.12, 0.01, 0, 0.8, 0.156),
    addFootprintCollider(ctx, posX, posZ, yaw, 0.7, 0.5, 1.05, 'metal'),
    group
  );
}

/**
 * 搭建码头岸沿：混凝土护面与墙身、门机轨道、系缆桩、舷梯、靠泊轮胎护舷与栏杆，返回中继节点与撤离点
 */
export function buildQuayApron(ctx) {
  let {
      M: matLit,
      box: addBox,
      slab: addSlab,
      cyl: addCyl,
      rod: addRod,
      tube: addTube,
      col: addCollider,
      add: addGeometry,
      place: placeProp,
    } = ctx,
    { X: quayX, LADDER_Z: ladderZ, Z0: quayZ0, Z1: quayZ1 } = QUAY_DIMS,
    concreteMat = matLit('concrete'),
    dirtyConcreteMat = matLit('concrete_dirty'),
    wornSteelMat = matLit('steel_worn'),
    darkSteelMat = matLit('steel_dark'),
    galvMat = matLit('steel_galv'),
    yellowPaintMat = matLit('paint_yellow'),
    ladderZ0 = ladderZ - 0.42,
    ladderZ1 = ladderZ + 0.42;
  for (let [E, w] of [
    [quayZ0 - 1, ladderZ0],
    [ladderZ1, quayZ1 + 1],
  ])
    (addSlab(concreteMat, quayX - 0.65, -0.7, E, quayX, 0.028, w, {
      bevel: 0.03,
    }),
      addSlab(wornSteelMat, quayX - 0.07, -0.16, E, quayX + 0.022, 0.036, w, {
        bevel: 0.012,
      }),
      addSlab(yellowPaintMat, quayX - 0.66, 0, E, quayX - 0.5, 0.032, w),
      addSlab(dirtyConcreteMat, quayX - 0.55, -4.2, E, quayX - 0.02, -0.7, w));
  (addSlab(concreteMat, quayX - 0.65, -0.7, ladderZ0, quayX - 0.38, 0.028, ladderZ1),
    addSlab(dirtyConcreteMat, quayX - 0.55, -4.2, ladderZ0, quayX - 0.38, -0.7, ladderZ1));
  for (let E of [ladderZ0, ladderZ1])
    addSlab(wornSteelMat, quayX - 0.38, -0.16, E - 0.02, quayX + 0.02, 0.034, E + 0.02);
  for (let E = quayZ0 + 4; E < quayZ1; E += 6)
    Math.abs(E - ladderZ) < 1 ||
      (addSlab(darkSteelMat, quayX - 0.03, -4.2, E - 0.02, quayX - 0.012, -0.2, E + 0.02, {
        cast: !1,
      }),
      ctx.decal('rust_run', 0.7, quayX - 0.015, -1.3, E + 1.4, 'x+'));
  (addCollider(quayX - 0.65, -4.2, quayZ0 - 1, quayX, 0.028, quayZ1 + 1, 'concrete', {
    noNav: !0,
  }),
    addCollider(quayX + 0.03, -5, quayZ0 - 2, quayX + 0.7, 8, quayZ1 + 2, 'concrete', {
      playerOnly: !0,
    }));
  {
    let E = quayX - 0.12;
    for (let S of [-1, 1]) {
      let z = ladderZ + S * 0.26;
      (addTube(
        matLit('paint_yellow'),
        [
          [E, -3.9, z],
          [E, 0.2, z],
          [E, 0.95, z],
          [E - 0.12, 1.12, z],
          [E - 0.5, 1.12, z],
          [E - 0.62, 0.95, z],
          [E - 0.62, 0.03, z],
        ],
        0.024,
        {
          radial: 7,
          tension: 0.2,
        },
      ),
        addBox(darkSteelMat, 0.12, 0.012, 0.12, E - 0.62, 0.034, z));
    }
    for (let S = -3.7; S < 0; S += 0.3)
      addRod(galvMat, [E, S, ladderZ - 0.26], [E, S, ladderZ + 0.26], 0.014, {
        seg: 6,
      });
    for (let S of [-3, -1.6, -0.3])
      for (let z of [-1, 1])
        addRod(galvMat, [E, S, ladderZ + z * 0.26], [quayX - 0.38, S, ladderZ + z * 0.26], 0.012);
    let w = [[ladderZ - 2.6], [ladderZ - 0.9], [ladderZ + 0.9], [ladderZ + 2.6]];
    for (let [S] of w)
      (addCyl(yellowPaintMat, 0.032, 1.05, quayX - 0.82, 0.525, S, {
        seg: 8,
      }),
        addCyl(darkSteelMat, 0.09, 0.02, quayX - 0.82, 0.01, S, {
          seg: 10,
        }),
        addCyl(darkSteelMat, 0.045, 0.03, quayX - 0.82, 1.06, S, {
          seg: 8,
        }));
    for (let [S, z] of [
      [ladderZ - 2.6, ladderZ - 0.9],
      [ladderZ + 0.9, ladderZ + 2.6],
    ])
      for (let H of [0.98, 0.55])
        addTube(
          galvMat,
          [
            [quayX - 0.82, H, S],
            [quayX - 0.82, H - 0.1, (S + z) / 2 - 0.3],
            [quayX - 0.82, H - 0.12, (S + z) / 2 + 0.3],
            [quayX - 0.82, H, z],
          ],
          0.012,
          {
            radial: 5,
          },
        );
    ctx.label('BOAT STN 4', 0.2, quayX - 1.3, 0.006, ladderZ - 1.4, 'y+', {
      color: 'yellow',
      font: 'stencil',
      distress: 0.4,
    });
  }
  let tireGeo = new THREE.TorusGeometry(0.4, 0.16, 8, 16);
  tireGeo.rotateY(Math.PI / 2);
  for (let E = quayZ0 + 2.5, w = 0; E < quayZ1; E += 5, w++) {
    if (Math.abs(E - ladderZ) < 2) continue;
    (addSlab(matLit('wood_dark'), quayX + 0, -3.9, E - 0.16, quayX + 0.2, -0.25, E + 0.16, {
      bevel: 0.02,
    }),
      addSlab(darkSteelMat, quayX - 0.01, -0.5, E - 0.2, quayX + 0.215, -0.42, E + 0.2),
      addSlab(darkSteelMat, quayX - 0.01, -2.4, E - 0.2, quayX + 0.215, -2.32, E + 0.2));
    let S = E + 2.4;
    if (Math.abs(S - ladderZ) < 1.6 || S > quayZ1 - 0.5) continue;
    let z = -0.85 - (w % 3) * 0.18;
    (addGeometry(tireGeo.clone(), matLit('tire'), {
      p: [quayX + 0.17, z, S],
    }),
      w % 2 &&
        addGeometry(tireGeo.clone(), matLit('tire'), {
          p: [quayX + 0.17, z - 0.86, S + 0.05],
        }));
    for (let H of [-1, 1])
      addRod(
        galvMat,
        [quayX - 0.02, 0.02, S + H * 0.3],
        [quayX + 0.17, z + 0.36, S + H * 0.16],
        0.011,
        {
          seg: 5,
        },
      );
    addBox(darkSteelMat, 0.1, 0.03, 0.8, quayX - 0.06, 0.04, S);
  }
  let bollardZs = [-22, -12, -2, 9, 16.4, 25.6];
  for (let E of bollardZs)
    placeProp('bollard_mooring', 29.2, E, 0, {
      seed: Math.round(E + 40),
    });
  {
    let E = [...bollardZs.map((S) => [S - 1.1, S + 1.1]), [ladderZ - 3, ladderZ + 3]].sort(
        (S, z) => S[0] - z[0],
      ),
      w = quayZ0 + 0.3;
    for (let [S, z] of [...E, [quayZ1 - 0.3, quayZ1]]) {
      if (S - w > 1) {
        addSlab(yellowPaintMat, quayX - 0.4, 0.12, w, quayX - 0.2, 0.3, S, {
          bevel: 0.02,
        });
        for (let H = w + 0.3; H < S; H += 1.6)
          addSlab(darkSteelMat, quayX - 0.42, 0.028, H - 0.12, quayX - 0.18, 0.12, H + 0.12);
      }
      w = Math.max(w, z);
    }
  }
  for (let E of QUAY_DIMS.RAILS) {
    (addSlab(darkSteelMat, E - 0.19, 0, quayZ0 + 0.4, E + 0.19, 0.007, quayZ1 - 0.4, {
      cast: !1,
    }),
      addSlab(matLit('steel_rust'), E - 0.075, 0, quayZ0 + 0.4, E + 0.075, 0.018, quayZ1 - 0.4, {
        cast: !1,
      }),
      addSlab(wornSteelMat, E - 0.037, 0, quayZ0 + 0.4, E + 0.037, 0.034, quayZ1 - 0.4, {
        bevel: 0.008,
        cast: !1,
      }));
    for (let w = quayZ0 + 0.8; w < quayZ1 - 0.5; w += 0.9)
      for (let S of [-1, 1])
        addBox(darkSteelMat, 0.07, 0.022, 0.1, E + S * 0.115, 0.012, w, {
          cast: !1,
        });
    for (let [w, S] of [
      [quayZ0 + 0.75, 1],
      [quayZ1 - 0.75, -1],
    ])
      (addSlab(yellowPaintMat, E - 0.28, 0, w - 0.3, E + 0.28, 0.75, w + 0.3, {
        bevel: 0.03,
      }),
        addSlab(matLit('rubber'), E - 0.16, 0.3, w + S * 0.3, E + 0.16, 0.62, w + S * 0.42, {
          bevel: 0.03,
        }),
        addSlab(darkSteelMat, E - 0.34, 0, w - 0.38, E + 0.34, 0.04, w + 0.38),
        addCollider(E - 0.28, 0, w - 0.36, E + 0.28, 0.75, w + 0.36, 'metal'));
  }
  return (
    buildPlateStack(ctx, 23.3, -15.4, 2, !0, 0.02),
    buildPlateStack(ctx, 23.7, 14.4, 2, !0, -0.025),
    placeProp('jersey_barrier', 20.5, -4.7, Math.PI / 2 + 0.12, {
      seed: 31,
    }),
    placeProp('jersey_barrier', 25.3, 3.1, -0.2, {
      seed: 32,
    }),
    buildMeshCage(ctx, 25.7, -3.3, 0.08, 'paint_blue', 2),
    placeProp('sandbags', 20.6, 3, 1.25, {
      seed: 33,
    }),
    placeProp('barrel', 26.5, -1.7, 0, {
      seed: 34,
      color: 'red',
    }),
    placeProp('barrel', 26.9, -1.05, 0.5, {
      seed: 35,
    }),
    buildSkipBin(ctx, 20.55, 1.35, 0.12),
    placeProp('traffic_cone', 22, -1.9, 0, {
      seed: 36,
    }),
    placeProp('traffic_cone', 24.2, 1.7, 0, {
      seed: 37,
    }),
    ctx.stack(23.2, -28.6, [
      [
        20,
        'white',
        {
          reefer: !0,
        },
      ],
      [
        20,
        'white',
        {
          reefer: !0,
        },
      ],
    ]),
    ctx.stack(23, -25.95, [
      [
        20,
        'grey',
        {
          reefer: !0,
        },
      ],
    ]),
    placeProp('generator', 15, -26.6, 0.06, {
      seed: 41,
    }),
    placeProp('floodlight_stand', 16.4, -23.6, 0.3, {
      seed: 42,
    }),
    buildCableRun(
      ctx,
      [
        [16.1, -26.6],
        [18, -27.6],
        [19.2, -27.2],
        [19.6, -26.4],
      ],
      0.028,
    ),
    buildCableRun(
      ctx,
      [
        [15.6, -26],
        [16.2, -24.6],
        [16.4, -23.9],
      ],
      0.018,
    ),
    buildMeshCage(ctx, 27, -18.1, Math.PI / 2 + 0.05, 'paint_orange', 5),
    placeProp('tire_stack', 24.1, -9.5, 0, {
      seed: 43,
    }),
    placeProp('tire_stack', 25.05, -9.6, 0.5, {
      seed: 44,
    }),
    placeProp('cable_reel', 14.3, -12.9, 0.4, {
      seed: 45,
    }),
    placeProp('cable_reel', 15.6, -14.3, 1.9, {
      seed: 46,
    }),
    placeProp('pallet_stack', 20.3, -9.3, 0.1, {
      seed: 47,
    }),
    placeProp('crate_wood', 19.9, -22.6, 0.3, {
      seed: 48,
    }),
    placeProp('barrel', 12.75, -23.3, 0, {
      seed: 49,
      color: 'blue',
    }),
    placeProp('barrel', 12.9, -24.1, 0, {
      seed: 50,
      color: 'blue',
    }),
    placeProp('light_mast', 26.6, -28.7, 0, {
      seed: 51,
    }),
    placeProp('light_mast', 26.6, 26.7, 0, {
      seed: 52,
    }),
    buildMeshCage(ctx, 20.6, 22.4, 0.04, 'paint_blue', 7),
    buildMeshCage(ctx, 20.7, 24.2, -0.06, 'paint_orange', 9),
    buildSkipBin(ctx, 26.6, 5.5, 0.1),
    buildSkipBin(ctx, 26.7, 6.45, -0.15, 'paint_blue'),
    placeProp('crate_stack', 26.4, 23.6, 0.2, {
      seed: 53,
    }),
    placeProp('ibc_tote', 22.6, 26.3, 0.05, {
      seed: 54,
    }),
    placeProp('pallet_stack', 24, 26.2, 0.2, {
      seed: 55,
    }),
    placeProp('barrel', 22.6, 20.3, 0, {
      seed: 56,
      color: 'yellow',
    }),
    placeProp('barrel', 23.4, 20.4, 0, {
      seed: 57,
    }),
    placeProp('tarp_cargo', 20.3, 12.6, Math.PI / 2, {
      seed: 59,
    }),
    buildRebarBundle(ctx, 19.6, 17.5, Math.PI / 2 + 0.05),
    buildWheelChock(ctx, 19.6, 10.4, 0.4),
    buildWheelChock(ctx, 20.5, 16.1, -2.6),
    placeProp('traffic_cone', 28.2, 18.2, 0, {
      seed: 60,
    }),
    placeProp('traffic_cone', 28.3, 21.8, 0, {
      seed: 61,
    }),
    buildCableRun(
      ctx,
      [
        [28.9, 6.2],
        [28.6, 9.5],
        [28.95, 13],
        [28.7, 16.6],
        [28.3, 17.4],
        [28.6, 17.9],
        [28.9, 17.3],
      ],
      0.022,
    ),
    {
      relayPos: new THREE.Vector3(23, 0, 0),
      extraction: new THREE.Vector3(29, 0, ladderZ),
    }
  );
}

/**
 * 叉车货叉举升高度（0.535 m），托盘与木箱按此高度摆放成被叉起的状态
 */
var FORKLIFT_FORK_Y = 0.535;

/**
 * 布置表里随手构造 Vector3 的简写别名
 */
export var vec3 = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * 堆场布置表：集装箱堆位、灯柱、围挡、杂物与地面标线的 place/stack 调用清单，是把美术意图落成坐标的地方
 */
export function placeYardLayout(ctx) {
  let placeProp = ctx.place,
    stackContainers = ctx.stack;
  (stackContainers(-19.45, -5.12, [
    [20, 'green'],
    [20, 'grey'],
    [20, 'orange'],
  ]),
    stackContainers(-13.3, -5.12, [
      [
        20,
        'white',
        {
          reefer: !0,
          flip: !0,
        },
      ],
    ]),
    stackContainers(3.7, -5.12, [
      [
        20,
        'blue',
        {
          doors: 0.8,
          flip: !0,
        },
      ],
      [20, 'white'],
    ]),
    stackContainers(13.53, -5.12, [
      [20, 'teal'],
      [20, 'grey'],
    ]),
    stackContainers(-19.45, 2.08, [[20, 'blue']]),
    stackContainers(-13.35, 2.08, [[20, 'red']]),
    stackContainers(0.8, 2.08, [
      [40, 'orange'],
      [40, 'teal'],
      [
        20,
        'blue',
        {
          dx: 3,
        },
      ],
    ]),
    stackContainers(12.3, 2.08, [
      [20, 'red'],
      [20, 'yellow'],
    ]),
    stackContainers(-21.1, 9.92, [[20, 'yellow']], 0, 0.3),
    stackContainers(
      -13.6,
      9.92,
      [
        [20, 'green'],
        [20, 'blue'],
        [20, 'orange'],
      ],
      0,
      0.3,
    ),
    stackContainers(
      -21.6,
      12.42,
      [
        [20, 'red'],
        [20, 'white'],
        [20, 'teal'],
      ],
      0,
      0.3,
    ),
    stackContainers(
      -15.4,
      12.42,
      [
        [
          20,
          'grey',
          {
            doors: 0.6,
          },
        ],
      ],
      0,
      0.3,
    ),
    stackContainers(4.43, 12.42, [[20, 'blue']], 0, 0),
    stackContainers(13.53, 12.42, [[20, 'green']], 0, 0),
    ctx.stairs(-0.1, 12.42, 0, 0, {
      seed: 9,
    }),
    ctx.catwalk(8.98, 12.42, 0, 2.54, {
      seed: 10,
    }));
  for (let s of [7.6, 10.36])
    for (let o of [11.86, 12.98]) ctx.rod('steel_galv', [s, 0, o], [s, 2.5, o], 0.035);
  (placeProp(
    'sandbags',
    15.95,
    12.42,
    ts,
    {
      seed: 61,
    },
    2.59,
  ),
    placeProp(
      'crate_wood',
      14.3,
      11.75,
      0.1,
      {
        seed: 62,
      },
      2.59,
    ),
    placeProp(
      'sandbags',
      2.3,
      11.75,
      0,
      {
        seed: 63,
      },
      2.59,
    ),
    stackContainers(-16.4, 20.12, [
      [40, 'grey'],
      [40, 'green'],
    ]),
    stackContainers(-2.25, 20.12, [[20, 'red']]),
    stackContainers(3.85, 20.12, [
      [20, 'white'],
      [20, 'blue'],
    ]),
    stackContainers(13.53, 20.12, [
      [20, 'orange'],
      [20, 'teal'],
      [20, 'red'],
    ]),
    stackContainers(-16.4, 22.62, [
      ['hc', 'teal'],
      [40, 'yellow'],
      [40, 'blue'],
    ]),
    stackContainers(0.8, 22.62, [
      [40, 'green'],
      ['hc', 'orange'],
    ]),
    stackContainers(13.53, 22.62, [
      [
        20,
        'grey',
        {
          doors: 0.4,
        },
      ],
    ]),
    stackContainers(
      -22.6,
      -19.2,
      [
        [40, 'red'],
        [40, 'white'],
      ],
      ts,
    ),
    stackContainers(
      -30.2,
      -18.4,
      [
        [
          20,
          'yellow',
          {
            doors: 0.5,
          },
        ],
      ],
      0.35,
      0,
    ),
    stackContainers(-31.2, 24.7, [
      [40, 'teal'],
      [40, 'orange'],
    ]));
  for (let [s, o] of [
    [-23.4, 0.5],
    [-23.4, 21.4],
    [17, -8.7],
    [17, 18.6],
    [-20.6, -11.6],
  ])
    placeProp('light_mast', s, o, 0, {
      seed: Math.round(s * 3 + o),
    });
  let cableRun = (rnd, hissLoop, bpLoop, bufLen = 0.018) => {
    let mixBuf = [];
    for (let dropBuf = 0; dropBuf <= 8; dropBuf++) {
      let workBuf = dropBuf / 8;
      mixBuf.push([
        rnd[0] + (hissLoop[0] - rnd[0]) * workBuf,
        rnd[1] + (hissLoop[1] - rnd[1]) * workBuf - bpLoop * 4 * workBuf * (1 - workBuf),
        rnd[2] + (hissLoop[2] - rnd[2]) * workBuf,
      ]);
    }
    ctx.tube('rubber', mixBuf, bufLen, {
      radial: 5,
      tension: 0.5,
    });
  };
  (cableRun([-23.4, 12.4, 0.5], [-20.6, 12.4, -11.6], 1.3),
    cableRun([-20.6, 11.8, -11.6], [-16.2, 7.25, -11.4], 0.9),
    cableRun([-23.4, 12, 0.5], [-27.6, 12.2, -0.9], 0.5),
    cableRun([17, 12.4, -8.7], [12.3, 7.3, -11.3], 1),
    buildRebarBundle(ctx, -20.9, 8.3, 0.02),
    buildWheelChock(ctx, -18.6, 3.75, 1.7),
    buildWheelChock(ctx, 0.4, 13.3, 0.3),
    placeProp('barrel', -19.6, 3.85, 0, {
      seed: 1,
      color: 'blue',
    }),
    placeProp('barrel', -18.9, 3.95, 0.7, {
      seed: 2,
      color: 'blue',
    }),
    placeProp('pallet_stack', -17.4, 4, 0.08, {
      seed: 3,
    }),
    placeProp('crate_stack', -14.3, 8.05, 0.04, {
      seed: 4,
    }),
    placeProp('ibc_tote', -12.95, 7.95, -0.05, {
      seed: 5,
    }));
  {
    let a = Math.cos(-0.22),
      l = -Math.sin(-0.22);
    placeProp('forklift', -8.6, 4.5, -0.22, {
      seed: 6,
      forksUp: 0.3,
    });
    let c = -8.6 + a * 1.42,
      u = 4.5 + l * 1.42;
    (placeProp(
      'pallet',
      c,
      u,
      -0.22,
      {
        seed: 7,
      },
      FORKLIFT_FORK_Y,
      {
        noCol: !0,
      },
    ),
      placeProp(
        'crate_wood',
        c,
        u,
        -0.22 + 0.05,
        {
          seed: 8,
        },
        FORKLIFT_FORK_Y + 0.144,
        {
          noCol: !0,
        },
      ),
      ctx.col(
        c - 0.62,
        FORKLIFT_FORK_Y - 0.1,
        u - 0.62,
        c + 0.62,
        FORKLIFT_FORK_Y + 1.15,
        u + 0.62,
        'wood',
      ),
      buildWheelChock(ctx, -8.6 - 1, 4.5 + 0.78, 0.2),
      buildWheelChock(ctx, -11.9, 3.6, 2.4));
  }
  (placeProp('jersey_barrier', -2.9, 5.3, 0.12, {
    seed: 11,
  }),
    placeProp('jersey_barrier', 5.6, 5, -0.1, {
      seed: 12,
    }),
    placeProp('sandbags', -1.7, 9.7, 0.5, {
      seed: 13,
    }),
    placeProp('ibc_tote', 5.9, 8.9, 0.1, {
      seed: 14,
    }),
    placeProp('ibc_tote', 5.95, 10.05, -0.05, {
      seed: 15,
    }),
    placeProp('barrel', 4.9, 9.7, 0, {
      seed: 16,
      color: 'red',
    }),
    placeProp('crate_stack', -3.9, 10.5, 0.1, {
      seed: 17,
    }),
    placeProp('crate_wood', -3.8, 9.35, -0.2, {
      seed: 18,
    }),
    placeProp('pallet_stack', -4.4, 11.8, 0.02, {
      seed: 19,
    }),
    placeProp('cable_reel', 4.2, 10.5, 0.3, {
      seed: 20,
    }),
    placeProp('tarp_cargo', 12.9, 10, 0.04, {
      seed: 21,
    }),
    placeProp('jersey_barrier', 11.6, 3.95, 0.03, {
      seed: 81,
    }),
    placeProp('ibc_tote', 15.2, 10.2, 0.1, {
      seed: 82,
    }));
  for (let [s, o] of [
    [0.2, 6.3],
    [2.9, 6.4],
    [2.9, 8.8],
    [0.1, 8.7],
  ])
    placeProp('traffic_cone', s, o, 0, {
      seed: Math.round(s * 9 + o * 5),
    });
  (buildSkipBin(ctx, -9.55, 9.3, 0.04),
    buildRebarBundle(ctx, -7.6, 11.9, ts + 0.06),
    buildSkipBin(ctx, 9.9, 12.9, ts, 'paint_blue'),
    placeProp('sign_post', -4.8, 3.72, ts, {
      seed: 22,
      sign: 'hazard_voltage',
    }),
    buildUtilityStandpipe(ctx, 0.9, 3.62, 0),
    buildCableRun(
      ctx,
      [
        [0.9, 3.9],
        [1.2, 5.2],
        [0.8, 6.2],
        [1.5, 7.1],
      ],
      0.03,
    ),
    placeProp('tarp_cargo', -13.5, -3.1, 0.05, {
      seed: 23,
    }),
    placeProp('pallet_stack', -20.6, -0.1, 0.2, {
      seed: 24,
    }),
    placeProp('tire_stack', -9.6, 0.2, 0, {
      seed: 25,
    }),
    placeProp('barrel', 4.5, 0.35, 0, {
      seed: 26,
      color: 'yellow',
    }),
    placeProp('barrel', 5.2, 0.3, 0.4, {
      seed: 27,
    }),
    placeProp('jersey_barrier', 12.2, 0.4, 0.03, {
      seed: 28,
    }),
    placeProp('crate_wood', 11.2, -3.3, 0.3, {
      seed: 29,
    }),
    placeProp('cardboard_boxes', -2, 0.3, 0.2, {
      seed: 30,
    }),
    buildMeshCage(ctx, -4.2, -3.2, 0.03, 'paint_orange', 3),
    placeProp('jersey_barrier', -0.9, -7.5, 0.1, {
      seed: 31,
    }),
    placeProp('sandbags', -6.7, -7.8, -0.1, {
      seed: 32,
    }),
    placeProp('dumpster', -12.3, -7.05, 0, {
      seed: 33,
    }),
    placeProp('gas_cylinders', 9.6, -10.45, 0, {
      seed: 34,
    }),
    placeProp('pallet_stack', 1.2, -9.9, 0.1, {
      seed: 35,
    }),
    placeProp('barrel', 2.2, -10.3, 0, {
      seed: 36,
      color: 'green',
    }),
    placeProp('cable_reel', -18.2, -8, 0.2, {
      seed: 37,
    }),
    placeProp('traffic_cone', -6.5, -9.9, 0, {
      seed: 38,
    }),
    placeProp('traffic_cone', -0.5, -9.9, 0, {
      seed: 39,
    }),
    buildCableRun(
      ctx,
      [
        [4.6, -10.9, 0.5],
        [4.7, -10.6, 0.05],
        [4.2, -9.2],
        [1, -8.4],
        [-2.6, -9.1],
        [-4.6, -6.4],
        [-5.9, -5.9],
      ],
      0.024,
    ),
    placeProp('pipe_stack', -16, 14.4, 0, {
      seed: 41,
    }),
    placeProp('crate_stack', -10.95, 18.25, 0.06, {
      seed: 42,
    }),
    placeProp('barrel', -3, 18.35, 0, {
      seed: 43,
      color: 'blue',
    }),
    placeProp('dumpster', 4.2, 14.55, 0.02, {
      seed: 44,
    }),
    placeProp('tire_stack', 10.95, 18.3, 0, {
      seed: 45,
    }),
    placeProp('ibc_tote', 12, 18.25, 0, {
      seed: 46,
    }),
    placeProp('pallet_stack', -12.3, 18.2, 0.1, {
      seed: 47,
    }),
    placeProp('tarp_cargo', -20.5, 18.05, 0.03, {
      seed: 48,
    }),
    placeProp('jersey_barrier', 0.6, 15.5, 0.12, {
      seed: 49,
    }),
    placeProp('tire_stack', -8, 26.9, 0, {
      seed: 51,
    }),
    placeProp('pallet_stack', 8.7, 27, 0.3, {
      seed: 52,
    }),
    placeProp('crate_wood', -2, 27, 0.2, {
      seed: 53,
    }),
    placeProp('barrel', 11.2, 27.1, 0, {
      seed: 54,
    }),
    placeProp('cardboard_boxes', -21, 26.9, 0.4, {
      seed: 55,
    }),
    buildSkipBin(ctx, 16, 26.9, 0.1),
    placeProp('pipe_stack', -30.5, -27, 0.03, {
      seed: 56,
    }),
    placeProp('pipe_stack', -30.2, -25.4, -0.02, {
      seed: 57,
    }),
    placeProp('dumpster', -17, -14, ts, {
      seed: 58,
    }),
    placeProp('tarp_cargo', -27.5, -11.6, 0.3, {
      seed: 59,
    }),
    placeProp('tarp_cargo', -29.9, -11, -0.2, {
      seed: 60,
    }),
    placeProp('cable_reel', -34.6, -22.5, 1, {
      seed: 64,
    }),
    placeProp('tire_stack', -25.4, -26.9, 0, {
      seed: 65,
    }),
    placeProp('gas_cylinders', -16.9, -20.4, ts, {
      seed: 66,
    }),
    placeProp('crate_stack', -34.8, -13.5, 0.2, {
      seed: 67,
    }),
    placeProp('barrel', -33.6, -13, 0, {
      seed: 68,
    }),
    buildMeshCage(ctx, -36.6, -26, ts, 'paint_blue', 4),
    placeProp('generator', -34.2, 14.2, 0.15, {
      seed: 71,
    }),
    placeProp('floodlight_stand', -31.4, 12.7, 0.55, {
      seed: 72,
    }),
    buildCableRun(
      ctx,
      [
        [-33.2, 14],
        [-32.4, 13.2],
        [-31.6, 12.9],
      ],
      0.02,
    ),
    placeProp('tire_stack', -36.6, 17.2, 0, {
      seed: 73,
    }),
    placeProp('tire_stack', -36.5, 18.3, 0.6, {
      seed: 74,
    }),
    placeProp('dumpster', -36.4, 21, ts, {
      seed: 75,
    }),
    placeProp('pallet_stack', -27.8, 16.6, 0.4, {
      seed: 76,
    }),
    placeProp('jerry_can', -33, 15.2, 0.4, {
      seed: 77,
    }),
    placeProp('jerry_can', -33.3, 15.35, 1.9, {
      seed: 78,
    }),
    placeProp('crate_wood', -28.6, 20.6, 0.1, {
      seed: 79,
    }),
    placeProp('ibc_tote', -26.6, 21.2, 0, {
      seed: 80,
    }),
    buildLaneSignpost(ctx, -22.9, -3.62, 'LANE 1', 'x-'),
    buildLaneSignpost(ctx, -22.95, 3.62, 'LANE 2', 'x-'),
    buildLaneSignpost(ctx, -25, 14, 'LANE 3', 'x-'),
    buildLaneSignpost(ctx, 16.9, 9.5, 'LANE 2', 'x+'),
    ctx.label('BERTH 4 WORKSHOP', 0.55, 4.2, 4.3, SHED_BOUNDS.Z1 + 0.064, 'z+', {
      color: 'white',
      font: 'stencil',
      distress: 0.45,
    }),
    ctx.decal('berth4', 3.2, -12, 3.4, SHED_BOUNDS.Z1 + 0.064, 'z+'),
    ctx.decal('rust_run', 1, 9, 3.2, SHED_BOUNDS.Z1 + 0.064, 'z+'),
    ctx.decal('grime_streak', 1.2, -14, 3.9, SHED_BOUNDS.Z1 + 0.064, 'z+'));
}

/**
 * 大门与围栏区布置：铁丝网围栏（带门洞）、道闸、门卫房、隔离墩与指示牌
 */
export function placeGateArea(ctx) {
  let placeProp = ctx.place,
    fenceX = -38,
    fenceXMax = 30,
    zSouth = -30,
    zNorth = 28,
    gateZ0 = 2,
    gateZ1 = 8;
  function fenceRun(c, u, h, f, p) {
    let d = Math.hypot(h - c, f - u),
      v = Math.max(1, Math.round(d / 3.35)),
      g = d / (v * 3),
      x = Math.abs(h - c) > Math.abs(f - u);
    for (let y = 0; y < v; y++) {
      let b = (y + 0.5) / v,
        m = placeProp(
          'fence_panel',
          c + (h - c) * b,
          u + (f - u) * b,
          x ? 0 : ts,
          {
            seed: p + y,
            posts: y === v - 1 ? 'both' : 'left',
          },
          0,
          {
            noCol: !0,
          },
        );
      m.scale.x = g;
    }
    (ctx.col(
      Math.min(c, h) - 0.05,
      0,
      Math.min(u, f) - 0.05,
      Math.max(c, h) + 0.05,
      2.4,
      Math.max(u, f) + 0.05,
      'metal',
    ),
      ctx.col(
        Math.min(c, h) - 0.3,
        0,
        Math.min(u, f) - 0.3,
        Math.max(c, h) + 0.3,
        7,
        Math.max(u, f) + 0.3,
        'metal',
        {
          playerOnly: !0,
        },
      ));
  }
  (fenceRun(fenceX, zSouth, fenceXMax, zSouth, 100),
    fenceRun(fenceX, zNorth, fenceXMax, zNorth, 200),
    fenceRun(fenceX, zSouth, fenceX, gateZ0, 300),
    fenceRun(fenceX, gateZ1, fenceX, zNorth, 400));
  for (let posA of [gateZ0 - 0.1, gateZ1 + 0.1])
    (ctx.box('steel_dark', 0.22, 3.4, 0.22, fenceX, 1.7, posA, {
      bevel: 0.02,
    }),
      ctx.box('hazard_stripes', 0.26, 1.2, 0.26, fenceX, 0.6, posA, {
        bevel: 0.02,
      }),
      ctx.col(fenceX - 0.13, 0, posA - 0.13, fenceX + 0.13, 3.4, posA + 0.13, 'metal'));
  {
    let posA = gateZ1 + 3.3,
      posB = fenceX + 0.28;
    ctx.box('chainlink', 0.012, 2.1, 6, posB, 1.25, posA);
    for (let posC of [posA - 3, posA, posA + 3])
      ctx.box('steel_galv', 0.06, 2.2, 0.06, posB, 1.25, posC);
    for (let posC of [0.18, 2.32, 1.25]) ctx.box('steel_galv', 0.06, 0.06, 6.06, posB, posC, posA);
    (ctx.rod('steel_galv', [posB, 0.2, posA - 3], [posB, 2.3, posA], 0.018),
      ctx.rod('steel_galv', [posB, 0.2, posA + 3], [posB, 2.3, posA], 0.018),
      ctx.slab('steel_dark', posB - 0.05, 0, gateZ0 - 0.3, posB + 0.05, 0.03, posA + 3.2, {
        cast: !1,
      }));
    for (let posC of [posA - 2.4, posA + 2.4])
      ctx.cyl('rubber', 0.09, 0.05, posB, 0.1, posC, {
        axis: 'x',
        seg: 10,
      });
  }
  (ctx.col(fenceX - 0.4, 0, gateZ0, fenceX - 0.1, 7, gateZ1, 'metal', {
    playerOnly: !0,
  }),
    placeProp('guard_booth', -35.2, 0.35, 0, {
      seed: 1,
    }),
    placeProp('gate_arm', -36.3, 5, ts, {
      seed: 2,
    }));
  for (let [posA, posB] of [
    [-37, 1.75],
    [-34.4, 2.3],
    [-37, 8.3],
    [-35.6, 8.9],
    [-34.4, 9.9],
    [-33.5, -1.1],
  ])
    placeProp('bollard_post', posA, posB, 0, {
      seed: Math.round(posA * 11 + posB * 7),
    });
  (placeProp('jersey_barrier', -34.7, 3.75, ts + 0.08, {
    seed: 3,
  }),
    placeProp('jersey_barrier', -33.3, 8.3, ts - 0.06, {
      seed: 4,
    }),
    placeProp('jersey_barrier', -30.6, 10.4, 0.03, {
      seed: 5,
    }),
    placeProp('jersey_barrier', -27.3, 1.45, 0.05, {
      seed: 6,
    }),
    placeProp('jersey_barrier', -32.2, 1.45, -0.04, {
      seed: 7,
    }),
    placeProp('sign_post', -33.2, 9.6, ts, {
      seed: 8,
      sign: 'no_entry',
    }),
    placeProp('sign_post', -25.3, 1.1, ts, {
      seed: 9,
      sign: 'berth4',
    }),
    placeProp('sign_post', -36.6, -1.6, ts, {
      seed: 10,
      sign: 'hazard_general',
    }));
  for (let [posA, posB] of [
    [-34.6, 5.6],
    [-28.3, 2],
    [-33.2, 6.5],
    [-26.6, 9.8],
    [-31.8, 9.9],
  ])
    placeProp('traffic_cone', posA, posB, 0, {
      seed: Math.round(posA * 5 + posB * 3),
    });
  (placeProp('light_mast', -27.6, -0.9, 0, {
    seed: 11,
  }),
    placeProp('light_mast', -36.3, 12.4, 0, {
      seed: 12,
    }),
    placeProp('barrel', -33.9, 2, 0, {
      seed: 13,
      color: 'yellow',
    }),
    placeProp('pallet_stack', -36.4, 10.3, 0.2, {
      seed: 14,
    }),
    ctx.decal('no_entry', 0.7, fenceX + 0.34, 1.5, gateZ1 + 3.3, 'x+'),
    ctx.decal('arrow', 2.2, -30.5, 0.006, 6, 'y+', 0));
}

/**
 * 沿父链检查是否存在 noMerge 标记，判断该节点能否被静态合批吞掉（动态件必须留在 dynRoot）
 */
export function hasNoMergeAncestor(node, root) {
  for (; node && node !== root;) {
    if (node.userData && node.userData.noMerge) return !0;
    node = node.parent;
  }
  return !1;
}

/**
 * 递归统计子树网格数，用于关卡载入时的性能统计
 */
export function countMeshes(root) {
  let e = 0;
  return (
    root.traverse((t) => {
      t.isMesh && e++;
    }),
    e
  );
}
