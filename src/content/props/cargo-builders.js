// content/props/cargo-builders.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import {
  HALF_PI,
  boxGeometry,
  createCylinderBetween,
  createDecalPlane,
  createHollowPolygonExtrusion,
  createRibbonFromPolyline,
  createRoundedBeamBetween,
  createSphereGeometryWorldUV,
  createTorusGeometryWorldUV,
  cylinderGeometry,
  ensurePolygonCCW,
  mapVertices,
  revolveProfileGeometry,
  tubeGeometry,
} from '../../assets/procedural/geometry.js';

import { clampValue } from '../../audio/audio.js';

import { resolvePaintColorAlias } from '../level/buildings.js';

import { createTireProfileGeometry } from './parts-geometry.js';

import {
  PropAssembler,
  recomputeSmoothNormals,
  roundedBoxGeometry,
  roundedBoxGeometryGrid,
} from './detail-geometry.js';

import { PI_TWO, valueNoise3D } from '../../core/math.js';

/**
 * 集装箱外部宽度 2.438m（ISO 标准），集装箱生成器里所有横向尺寸都从它派生
 */
export var CONTAINER_WIDTH = 2.438;

/**
 * 箱体的假材质键 {body:true}：整个箱体（波纹板、门、角柱）共用一个键才能合并成一个带顶点色的 Mesh，真正的漆材质在出实例时替换
 */
export var CONTAINER_BODY_MATERIAL_KEY = {
  body: !0,
};

/**
 * 磨损变体数 6：seed 取模后共 6 种几何缓存，兼顾多样性与内存
 */
export var CONTAINER_VARIANT_COUNT = 6;

/**
 * 集装箱零件缓存（材质库 → key → parts），key 由箱型/变体/开门角度/磨损档组成，同参数只建一次几何
 */
export var CONTAINER_PARTS_CACHE = new Map();

/**
 * 角件沿箱长方向的尺寸 0.178m，决定角柱与角件的贴合位置
 */
export var CORNER_BLOCK_LENGTH = 0.178;

/**
 * 上/下角件高度 0.118m，也是门框横档的基准高度
 */
export var CORNER_BLOCK_HEIGHT = 0.118;

/**
 * 角件沿箱宽方向的尺寸 0.162m，决定角柱离侧板的距离
 */
export var CORNER_BLOCK_DEPTH = 0.162;

/**
 * 侧板压型参数 {节距 0.278, 深度 0.036, 平台 0.072, 斜坡 0.068}，集装箱侧壁波纹的唯一真源
 */
export var SIDE_CORRUGATION = {
  P: 0.278,
  d: 0.036,
  fo: 0.072,
  sl: 0.068,
};

/**
 * 端门面压型参数（更密更浅的波纹），与侧板参数区分开才符合真实箱体
 */
export var FRONT_CORRUGATION = {
  P: 0.209,
  d: 0.02,
  fo: 0.09,
  sl: 0.03,
};

/**
 * 顶板压型参数，波距更大、深度更浅
 */
export var ROOF_CORRUGATION = {
  P: 0.25,
  d: 0.042,
  fo: 0.07,
  sl: 0.06,
};

/**
 * 装一只叉车轮：轮胎断面回转体 + 黄色轮辋 + 轮毂螺栓，按 ±side 决定轴向；第十个参数在源码中未使用
 */
function addForkliftWheel(
  builder,
  wheelX,
  radius,
  width,
  trackZ,
  side,
  rimRadius,
  segments,
  unused,
  rand,
) {
  let tireGeo = createTireProfileGeometry(radius, width, rimRadius, segments);
  (builder.push({
    p: [wheelX, radius, side > 0 ? trackZ - width / 2 : -(trackZ - width / 2)],
    r: [side > 0 ? HALF_PI : -HALF_PI, 0, 0],
  }),
    builder.push({
      r: [0, rand() * 6, 0],
    }));
  let noiseSeed = rand() * 20;
  builder.add('tire', tireGeo, null, (vtxRadius, azimuth, vtxHeight) => {
    let radDist = Math.hypot(vtxRadius, vtxHeight);
    return radDist < rimRadius + 0.01
      ? 0.45
      : 0.78 + 0.22 * valueNoise3D(Math.atan2(vtxHeight, vtxRadius) * 3 + noiseSeed, radDist * 30);
  });
  let rimFaceZ = width * 0.8;
  (builder.add(
    'paint_yellow',
    revolveProfileGeometry(
      [
        [rimRadius + 0.006, rimFaceZ + 0.012],
        [rimRadius - 0.012, rimFaceZ + 0.016],
        [rimRadius - 0.03, rimFaceZ - 0.02],
        [rimRadius * 0.62, rimFaceZ - 0.05],
        [rimRadius * 0.5, rimFaceZ - 0.02],
        [rimRadius * 0.42, rimFaceZ - 0.012],
        [0, rimFaceZ - 0.012],
      ],
      14,
    ),
    null,
    (vtxRadius, azimuth, vtxHeight) =>
      Math.hypot(vtxRadius, vtxHeight) > rimRadius * 0.7 ? [0.55, 0.5, 0.42] : [0.8, 0.78, 0.7],
  ),
    builder.add(
      'steel_dark',
      revolveProfileGeometry(
        [
          [0, width * 0.2],
          [rimRadius + 0.004, width * 0.2],
        ],
        10,
      ),
      null,
      0.4,
    ),
    builder.add(
      'steel_dark',
      cylinderGeometry(rimRadius * 0.2, rimRadius * 0.24, 0.035, 8),
      {
        p: [0, rimFaceZ, 0],
      },
      0.7,
    ));
  for (let vtxRadius = 0; vtxRadius < 6; vtxRadius++) {
    let azimuth = (vtxRadius * PI_TWO) / 3;
    builder.add(
      'steel_galv',
      cylinderGeometry(0.011, 0.012, 0.016, 6),
      {
        p: [
          Math.cos(azimuth) * rimRadius * 0.33,
          rimFaceZ - 0.006,
          Math.sin(azimuth) * rimRadius * 0.33,
        ],
      },
      rand.range(0.5, 0.8),
    );
  }
  (builder.pop(), builder.pop());
}

/**
 * 平衡重叉车：四轮、配重、护顶架、座椅与方向盘、机罩、可升降的门架与货叉（forksUp 控制举升高度）、侧贴编号与 SALTLINE 标识
 */
function buildForklift(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'forklift', opts.seed || 0),
    rand = assembler.rng,
    forksUp = clampValue(+opts.forksUp || 0, 0, 1),
    forkLift = forksUp * 1.5,
    halfForkLift = forkLift / 2,
    [paintMat, paintTint] = resolvePaintColorAlias(opts.color, 'yellow'),
    tintFn = (K = 1) =>
      typeof paintTint == 'number' ? paintTint * K : paintTint.map((ie) => ie * K),
    frameMaterialName = 'steel_dark',
    wearTint = () => rand.range(0.68, 0.95),
    unitNumber = opts.number || ['04', '07', '12', '22'][assembler.seed % 4],
    frontWheelRadius = 0.33,
    frontWheelWidth = 0.23,
    frontAxleX = 0.22,
    frontTrack = 0.47,
    rearWheelRadius = 0.27,
    rearWheelWidth = 0.18,
    rearAxleX = -1.1,
    rearTrack = 0.46;
  for (let vertexPoint of [1, -1])
    (addForkliftWheel(
      assembler,
      frontAxleX,
      frontWheelRadius,
      frontWheelWidth,
      frontTrack,
      vertexPoint,
      0.195,
      24,
      0,
      rand,
    ),
      addForkliftWheel(
        assembler,
        rearAxleX,
        rearWheelRadius,
        rearWheelWidth,
        rearTrack,
        vertexPoint,
        0.155,
        20,
        0,
        rand,
      ));
  (assembler.add(
    frameMaterialName,
    createCylinderBetween(
      [frontAxleX, frontWheelRadius, -0.4],
      [frontAxleX, frontWheelRadius, 0.4],
      0.07,
      8,
    ),
    null,
    0.5,
  ),
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.12, 0.1, 0.78, 0.01),
      {
        p: [rearAxleX, rearWheelRadius, 0],
      },
      0.5,
    ),
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(1.95, 0.34, 0.68, 0.02),
      {
        p: [-0.425, 0.37, 0],
      },
      0.55,
    ));
  for (let vertexPoint of [1, -1]) {
    (assembler.add(
      paintMat,
      roundedBoxGeometry(0.6, 0.3, 0.17, 0.02),
      {
        p: [-0.47, 0.4, vertexPoint * 0.42],
      },
      tintFn(0.92),
    ),
      assembler.add(
        'diamond_plate',
        roundedBoxGeometry(0.3, 0.012, 0.16, 0.003),
        {
          p: [-0.32, 0.556, vertexPoint * 0.42],
        },
        0.7,
      ),
      assembler.add(
        frameMaterialName,
        cylinderGeometry(0.03, 0.03, 0.02, 8),
        {
          p: [-0.62, 0.56, vertexPoint * 0.42],
        },
        0.6,
      ));
    let arcPointsBuffer = [],
      partPointA = frontWheelRadius + 0.035,
      partPointB = frontWheelRadius + 0.06;
    for (let arcSampleIndex = 0; arcSampleIndex <= 7; arcSampleIndex++) {
      let arcSampleAngle = 0.12 + ((PI_TWO - 0.5) * arcSampleIndex) / 7;
      arcPointsBuffer.push([
        frontAxleX + Math.cos(arcSampleAngle) * partPointB,
        frontWheelRadius + Math.sin(arcSampleAngle) * partPointB,
      ]);
    }
    for (let arcSampleIndex = 7; arcSampleIndex >= 0; arcSampleIndex--) {
      let arcSampleAngle = 0.12 + ((PI_TWO - 0.5) * arcSampleIndex) / 7;
      arcPointsBuffer.push([
        frontAxleX + Math.cos(arcSampleAngle) * partPointA,
        frontWheelRadius + Math.sin(arcSampleAngle) * partPointA,
      ]);
    }
    assembler.add(
      paintMat,
      createHollowPolygonExtrusion(arcPointsBuffer, 0.27, {
        soft: 0.7,
      }),
      {
        p: [0, 0, vertexPoint * 0.475],
      },
      tintFn(0.95),
    );
  }
  assembler.add(
    'diamond_plate',
    boxGeometry(0.66, 0.016, 0.68),
    {
      p: [0.2, 0.548, 0],
    },
    0.6,
  );
  for (let vertexPoint of [-0.12, 0.1])
    assembler.add(
      'rubber',
      roundedBoxGeometry(0.1, 0.02, 0.07, 0.006),
      {
        p: [0.33, 0.6, vertexPoint],
        r: [0, 0, 0.5],
      },
      0.8,
    );
  let hoodGeo = roundedBoxGeometryGrid(0.62, 0.63, 1.12, 0.12, 3, 3, 3);
  (mapVertices(hoodGeo, (vertexPoint) => {
    if (vertexPoint.y > 0.1) {
      let arcPointsBuffer = (vertexPoint.y - 0.1) / 0.215;
      vertexPoint.x += 0.03 * arcPointsBuffer * (vertexPoint.x < 0 ? 1 : 0);
    }
  }),
    assembler.add(
      paintMat,
      recomputeSmoothNormals(hoodGeo),
      {
        p: [-1.39, 0.915, 0],
      },
      tintFn(0.97),
    ),
    assembler.add(
      paintMat,
      roundedBoxGeometry(0.56, 0.37, 0.64, 0.05),
      {
        p: [-1.4, 0.43, 0],
      },
      tintFn(0.85),
    ),
    assembler.add(
      'hazard_stripes',
      roundedBoxGeometry(0.014, 0.085, 0.84, 0.004),
      {
        p: [-1.702, 0.77, 0],
      },
      0.95,
    ),
    assembler.label(
      unitNumber,
      {
        color: 'black',
        font: 'stencil',
        distress: 0.35,
      },
      0.4,
      0.2,
      {
        p: [-1.703, 0.96, 0],
        r: [0, -HALF_PI, 0],
      },
    ));
  for (let vertexPoint of [1, -1])
    (assembler.add(
      ctx.mats.emissive(16722450, 0.16),
      roundedBoxGeometry(0.012, 0.05, 0.11, 0.004),
      {
        p: [-1.69, 1.1, vertexPoint * 0.37],
      },
      1,
      {
        raw: !0,
      },
    ),
      assembler.add(
        frameMaterialName,
        roundedBoxGeometry(0.016, 0.066, 0.126, 0.004),
        {
          p: [-1.684, 1.1, vertexPoint * 0.37],
        },
        0.4,
      ),
      assembler.label(
        'SALTLINE',
        {
          color: 'black',
          font: 'sans',
          distress: 0.3,
        },
        0.42,
        0.085,
        {
          p: [-1.39, 0.99, vertexPoint * 0.5625],
          r: [0, vertexPoint > 0 ? 0 : PI_TWO, 0],
        },
      ),
      assembler.add(
        frameMaterialName,
        roundedBoxGeometry(0.06, 0.05, 0.02, 0.004),
        {
          p: [-1.67, 0.44, vertexPoint * 0.05],
        },
        0.5,
      ));
  (assembler.add(
    'steel_worn',
    cylinderGeometry(0.02, 0.02, 0.13, 8),
    {
      p: [-1.68, 0.44, 0],
    },
    0.7,
  ),
    assembler.add(
      paintMat,
      roundedBoxGeometry(0.98, 0.46, 0.94, 0.04),
      {
        p: [-0.59, 0.79, 0],
      },
      tintFn(),
    ));
  for (let vertexPoint of [1, -1]) {
    (assembler.label(
      unitNumber,
      {
        color: 'black',
        font: 'stencil',
        distress: 0.35,
      },
      0.3,
      0.19,
      {
        p: [-0.84, 0.8, vertexPoint * 0.4715],
        r: [0, vertexPoint > 0 ? 0 : PI_TWO, 0],
      },
    ),
      assembler.add(
        frameMaterialName,
        boxGeometry(0.34, 0.2, 0.004),
        {
          p: [-0.36, 0.8, vertexPoint * 0.47],
        },
        0.2,
      ));
    for (let arcPointsBuffer = 0; arcPointsBuffer < 5; arcPointsBuffer++)
      assembler.add(
        paintMat,
        boxGeometry(0.34, 0.03, 0.006),
        {
          p: [-0.36, 0.72 + arcPointsBuffer * 0.04, vertexPoint * 0.474],
          r: [vertexPoint * 0.5, 0, 0],
        },
        tintFn(0.85),
      );
  }
  assembler.add(
    frameMaterialName,
    roundedBoxGeometry(0.4, 0.05, 0.4, 0.01),
    {
      p: [-0.54, 1.045, 0],
    },
    0.5,
  );
  let seatGeo = roundedBoxGeometryGrid(0.46, 0.1, 0.46, 0.04, 3, 3, 3);
  (mapVertices(seatGeo, (vertexPoint) => {
    vertexPoint.y > 0 &&
      (vertexPoint.y -= 0.018 * Math.cos(vertexPoint.x * 5) * Math.cos(vertexPoint.z * 5));
  }),
    assembler.add(
      'rubber',
      recomputeSmoothNormals(seatGeo),
      {
        p: [-0.53, 1.115, 0],
      },
      1,
    ));
  let backrestGeo = roundedBoxGeometryGrid(0.1, 0.5, 0.44, 0.04, 3, 4, 3);
  (mapVertices(backrestGeo, (vertexPoint) => {
    vertexPoint.x > 0 && (vertexPoint.x -= 0.02 * Math.cos(vertexPoint.z * 5.5));
  }),
    assembler.add(
      'rubber',
      recomputeSmoothNormals(backrestGeo),
      {
        p: [-0.8, 1.39, 0],
        r: [0, 0, 0.16],
      },
      1,
    ));
  for (let vertexPoint of [1, -1])
    assembler.add(
      frameMaterialName,
      createRoundedBeamBetween(
        [-0.78, 1.08, vertexPoint * 0.24],
        [-0.82, 1.3, vertexPoint * 0.24],
        0.03,
        0.012,
        0.004,
      ),
      null,
      0.5,
    );
  assembler.add(
    paintMat,
    createHollowPolygonExtrusion(
      [
        [0.2, 0.55],
        [0.54, 0.55],
        [0.54, 1],
        [0.46, 1.12],
        [0.3, 1.14],
        [0.21, 1.02],
      ],
      0.7,
      {
        soft: 0.5,
      },
    ),
    null,
    tintFn(),
  );
  let steerColumnAngle = Math.atan2(0.12, 0.09);
  (assembler.push({
    p: [0.253, 1.082, 0],
    r: [0, 0, steerColumnAngle],
  }),
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.012, 0.13, 0.44, 0.004),
      {
        p: [-0.006, 0, 0],
      },
      0.45,
    ),
    assembler.add(
      ctx.mats.emissive(9429168, 0.3),
      createDecalPlane(0.09, 0.05),
      {
        p: [-0.0135, 0.01, 0.1],
        r: [0, -HALF_PI, 0],
      },
      1,
      {
        raw: !0,
        cast: !1,
      },
    ),
    assembler.decal(ctx.mats.decal('csc_plate'), 0.09, {
      p: [-0.0135, 0, -0.12],
      r: [0, -HALF_PI, 0],
    }),
    assembler.add(
      'plastic_red',
      cylinderGeometry(0.016, 0.016, 0.02, 8),
      {
        p: [-0.02, 0, 0.19],
        r: [0, 0, HALF_PI],
      },
      0.9,
    ),
    assembler.add(
      'steel_bare',
      cylinderGeometry(0.009, 0.009, 0.02, 6),
      {
        p: [-0.018, -0.03, -0.01],
        r: [0, 0, HALF_PI],
      },
      0.9,
    ),
    assembler.pop());
  let mastBase = [0.3, 1.1, 0.04],
    mastTop = [0.1, 1.31, 0.04];
  (assembler.add(frameMaterialName, createCylinderBetween(mastBase, mastTop, 0.024, 8), null, 0.5),
    assembler.push({
      p: mastTop,
      r: [0, 0, Math.atan2(mastTop[1] - mastBase[1], mastTop[0] - mastBase[0])],
    }),
    assembler.add(
      'rubber',
      createTorusGeometryWorldUV(0.165, 0.014, 6, 18),
      {
        r: [0, HALF_PI, 0],
      },
      1,
    ));
  for (let vertexPoint = 0; vertexPoint < 3; vertexPoint++) {
    let arcPointsBuffer = (vertexPoint * PI_TWO * 2) / 3 + 0.5;
    assembler.add(
      frameMaterialName,
      createCylinderBetween(
        [-0.01, 0, 0],
        [0, Math.cos(arcPointsBuffer) * 0.16, Math.sin(arcPointsBuffer) * 0.16],
        0.009,
        5,
      ),
      null,
      0.5,
    );
  }
  (assembler.add(
    frameMaterialName,
    cylinderGeometry(0.035, 0.04, 0.03, 10),
    {
      p: [-0.005, 0, 0],
      r: [0, 0, HALF_PI],
    },
    0.5,
  ),
    assembler.add(
      'rubber',
      cylinderGeometry(0.016, 0.014, 0.045, 8),
      {
        p: [0.03, 0.16, 0.02],
        r: [0, 0, HALF_PI],
      },
      1,
    ),
    assembler.pop());
  for (let vertexPoint = 0; vertexPoint < 3; vertexPoint++) {
    let arcPointsBuffer = -0.2 - vertexPoint * 0.055,
      partPointA = [0.33, 1.12, arcPointsBuffer],
      partPointB = [0.25 - vertexPoint * 0.012, 1.3 - vertexPoint * 0.01, arcPointsBuffer - 0.01];
    (assembler.add(
      'steel_bare',
      createCylinderBetween(partPointA, partPointB, 0.007, 5),
      null,
      0.8,
    ),
      assembler.add(
        'rubber',
        createSphereGeometryWorldUV(0.02, 7, 5),
        {
          p: partPointB,
        },
        1,
      ));
  }
  {
    let vertexPoint = [0.3, 1.1, 0.27],
      arcPointsBuffer = [0.2, 1.24, 0.29];
    (assembler.add(
      'steel_bare',
      createCylinderBetween(vertexPoint, arcPointsBuffer, 0.008, 5),
      null,
      0.8,
    ),
      assembler.add(
        'plastic_red',
        cylinderGeometry(0.016, 0.016, 0.07, 7),
        {
          p: arcPointsBuffer,
          r: [0, 0, 0.6],
        },
        0.9,
      ));
  }
  let mastTopY = 2.045,
    colliders = [];
  for (let vertexPoint of [1, -1]) {
    let arcPointsBuffer = [0.47, 1.08, vertexPoint * 0.4],
      partPointA = [0.27, mastTopY, vertexPoint * 0.46],
      partPointB = [-1, 1, vertexPoint * 0.44],
      arcSampleIndex = [-0.95, mastTopY, vertexPoint * 0.46];
    (assembler.add(
      frameMaterialName,
      createRoundedBeamBetween(arcPointsBuffer, partPointA, 0.06, 0.05, 0.01),
      null,
      wearTint(),
    ),
      assembler.add(
        frameMaterialName,
        createRoundedBeamBetween(partPointB, arcSampleIndex, 0.06, 0.05, 0.01),
        null,
        wearTint(),
      ),
      assembler.add(
        frameMaterialName,
        createRoundedBeamBetween(
          [0.3, mastTopY, vertexPoint * 0.46],
          [-0.98, mastTopY, vertexPoint * 0.46],
          0.05,
          0.06,
          0.01,
        ),
        null,
        wearTint(),
      ),
      assembler.add(
        frameMaterialName,
        roundedBoxGeometry(0.09, 0.012, 0.08, 0.003),
        {
          p: [0.47, 1.085, vertexPoint * 0.4],
        },
        0.5,
      ),
      assembler.add(
        frameMaterialName,
        roundedBoxGeometry(0.09, 0.012, 0.08, 0.003),
        {
          p: [-1, 1.024, vertexPoint * 0.44],
        },
        0.5,
      ));
    let arcSampleAngle = 0.36,
      sideMountOffset = 1.66;
    (assembler.add(
      frameMaterialName,
      roundedBoxGeometryGrid(0.085, 0.1, 0.13, 0.02, 3, 3, 3),
      {
        p: [arcSampleAngle + 0.045, sideMountOffset, vertexPoint * 0.47],
      },
      0.45,
    ),
      assembler.add(
        ctx.mats.emissive(16773330, 0.7),
        roundedBoxGeometry(0.006, 0.075, 0.105, 0.002),
        {
          p: [arcSampleAngle + 0.089, sideMountOffset, vertexPoint * 0.47],
        },
        1,
        {
          raw: !0,
        },
      ),
      assembler.add(
        frameMaterialName,
        createCylinderBetween(
          [0.385, 1.5, vertexPoint * 0.42],
          [0.42, 1.52, vertexPoint * 0.57],
          0.008,
          5,
        ),
        null,
        0.5,
      ),
      assembler.add(
        frameMaterialName,
        roundedBoxGeometry(0.022, 0.17, 0.1, 0.006),
        {
          p: [0.42, 1.52, vertexPoint * 0.573],
          r: [0, vertexPoint * 0.25, 0],
        },
        0.5,
      ),
      assembler.add(
        'steel_bare',
        boxGeometry(0.002, 0.15, 0.084),
        {
          p: [0.408, 1.52, vertexPoint * 0.57],
          r: [0, vertexPoint * 0.25, 0],
        },
        1,
      ),
      colliders.push(
        {
          min: [-1.03, 1, vertexPoint > 0 ? 0.41 : -0.5],
          max: [-0.92, mastTopY, vertexPoint > 0 ? 0.5 : -0.41],
          surface: 'metal',
        },
        {
          min: [0.24, 1.08, vertexPoint > 0 ? 0.37 : -0.5],
          max: [0.5, mastTopY, vertexPoint > 0 ? 0.5 : -0.37],
          surface: 'metal',
        },
      ));
  }
  for (let vertexPoint of [0.28, -0.96])
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.05, 0.06, 0.92, 0.01),
      {
        p: [vertexPoint, mastTopY, 0],
      },
      wearTint(),
    );
  for (let vertexPoint = 0; vertexPoint < 8; vertexPoint++)
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.03, 0.028, 0.9, 0.006),
      {
        p: [-0.83 + vertexPoint * 0.139, mastTopY + 0.012, 0],
      },
      wearTint(),
    );
  (assembler.add(
    frameMaterialName,
    tubeGeometry(
      [
        [0.44, 1.2, 0.44],
        [0.47, 1.25, 0.49],
        [0.41, 1.55, 0.5],
        [0.36, 1.6, 0.455],
      ],
      0.011,
      5,
      !1,
      0.5,
    ),
    null,
    0.5,
  ),
    assembler.add(
      frameMaterialName,
      cylinderGeometry(0.045, 0.05, 0.03, 10),
      {
        p: [-0.86, mastTopY + 0.045, 0.3],
      },
      0.5,
    ),
    assembler.add(
      ctx.mats.emissive(16747026, 0.9),
      revolveProfileGeometry(
        [
          [0.04, 0],
          [0.04, 0.06],
          [0.03, 0.082],
          [0, 0.09],
        ],
        10,
      ),
      {
        p: [-0.86, mastTopY + 0.06, 0.3],
      },
      1,
      {
        raw: !0,
      },
    ));
  let forkTipX = -1.4,
    forkY = 1.23 + 0.05 + 0.155;
  for (let vertexPoint of [-0.2, 0.2])
    (assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.3, 0.07, 0.04, 0.008),
      {
        p: [forkTipX, 1.262, vertexPoint],
      },
      0.5,
    ),
      assembler.add(
        frameMaterialName,
        cylinderGeometry(0.159, 0.159, 0.035, 16, !0),
        {
          p: [forkTipX, forkY, vertexPoint],
          r: [HALF_PI, 0, 0],
        },
        0.35,
      ));
  (assembler.add(
    'steel_galv',
    revolveProfileGeometry(
      [
        [0, -0.37],
        [0.08, -0.36],
        [0.132, -0.33],
        [0.155, -0.27],
        [0.155, 0.27],
        [0.132, 0.33],
        [0.08, 0.36],
        [0, 0.37],
      ],
      16,
    ),
    {
      p: [forkTipX, forkY, 0],
      r: [HALF_PI, 0, 0],
    },
    (vertexPoint, arcPointsBuffer, partPointA) =>
      0.8 + 0.2 * valueNoise3D(vertexPoint * 8, arcPointsBuffer * 8, partPointA * 8),
  ),
    assembler.add(
      'steel_galv',
      cylinderGeometry(0.09, 0.09, 0.07, 12, !0),
      {
        p: [forkTipX, forkY, 0.39],
        r: [HALF_PI, 0, 0],
      },
      0.7,
    ),
    assembler.add(
      'steel_galv',
      cylinderGeometry(0.02, 0.02, 0.05, 8),
      {
        p: [forkTipX, forkY, 0.39],
        r: [HALF_PI, 0, 0],
      },
      0.9,
    ),
    assembler.add(
      'rubber',
      tubeGeometry(
        [
          [forkTipX, forkY, 0.41],
          [forkTipX + 0.05, forkY - 0.02, 0.46],
          [forkTipX + 0.2, forkY - 0.15, 0.44],
          [-1.07, 1.1, 0.38],
          [-1, 0.98, 0.36],
        ],
        0.012,
        5,
        !1,
        0.5,
      ),
      null,
      1,
    ),
    assembler.push({
      p: [forkTipX, forkY, 0],
      r: [0, 0, 0.7],
    }),
    assembler.cdecal(ctx.mats.decal('hazard_flammable'), 0.157, 0.12, {
      p: [0, 0, -0.05],
      r: [-HALF_PI, 0, 0],
    }),
    assembler.cdecal(
      ctx.mats.label('LPG', {
        color: 'red',
        font: 'stencil',
        distress: 0.3,
      }),
      0.157,
      0.16,
      {
        p: [0, 0, 0.14],
        r: [-HALF_PI, 0, 0],
      },
    ),
    assembler.pop());
  let railFrontX = 0.6,
    railBackX = 0.73,
    railHalfSpanZ = 0.375,
    railBottomY = 0.08,
    railTopY = 2.02;
  for (let vertexPoint of [1, -1]) {
    let arcPointsBuffer = vertexPoint * railHalfSpanZ,
      partPointA = [
        [railFrontX, arcPointsBuffer],
        [railBackX, arcPointsBuffer],
        [railBackX, arcPointsBuffer - vertexPoint * 0.065],
        [railBackX - 0.014, arcPointsBuffer - vertexPoint * 0.065],
        [railBackX - 0.014, arcPointsBuffer - vertexPoint * 0.014],
        [railFrontX + 0.014, arcPointsBuffer - vertexPoint * 0.014],
        [railFrontX + 0.014, arcPointsBuffer - vertexPoint * 0.065],
        [railFrontX, arcPointsBuffer - vertexPoint * 0.065],
      ];
    (assembler.add(
      frameMaterialName,
      createHollowPolygonExtrusion(
        ensurePolygonCCW(
          partPointA.map((polygonVertexPoint) => [polygonVertexPoint[0], -polygonVertexPoint[1]]),
        ),
        railTopY - railBottomY,
        {
          soft: 0,
        },
      ),
      {
        p: [0, (railBottomY + railTopY) / 2, 0],
        r: [-HALF_PI, 0, 0],
      },
      wearTint(),
    ),
      assembler.add(
        frameMaterialName,
        roundedBoxGeometry(0.085, 1.86, 0.036, 0.006),
        {
          p: [0.665, 0.13 + halfForkLift + 0.93, vertexPoint * 0.335],
        },
        wearTint() * 1.25,
      ),
      assembler.decal(ctx.mats.decal('hazard_general'), 0.1, {
        p: [0.665, 1.3, vertexPoint * (railHalfSpanZ + 0.002)],
        r: [0, vertexPoint > 0 ? 0 : PI_TWO, 0],
      }));
    let partPointB = [0.36, 0.66, vertexPoint * 0.3],
      arcSampleIndex = [0.6, 0.86, vertexPoint * 0.33],
      arcSampleAngle = [0.5, 0.777, vertexPoint * 0.317];
    (assembler.add(
      frameMaterialName,
      createCylinderBetween(partPointB, arcSampleAngle, 0.034, 8, !0),
      null,
      0.55,
    ),
      assembler.add(
        'steel_bare',
        createCylinderBetween(arcSampleAngle, arcSampleIndex, 0.018, 6),
        null,
        1,
      ));
    let sideMountOffset = vertexPoint * 0.13,
      hoseLoopTopY = 1.9 + halfForkLift,
      hoseLoopRadius = 0.055,
      handrailPathPoints = [
        [0.725, 0.5 + forkLift, sideMountOffset],
        [0.725, hoseLoopTopY, sideMountOffset],
      ];
    for (let polygonVertexPoint = 0.5; polygonVertexPoint < PI_TWO; polygonVertexPoint += 0.55)
      handrailPathPoints.push([
        0.67 + Math.cos(polygonVertexPoint) * hoseLoopRadius,
        hoseLoopTopY + Math.sin(polygonVertexPoint) * hoseLoopRadius,
        sideMountOffset,
      ]);
    handrailPathPoints.push([0.615, hoseLoopTopY, sideMountOffset], [0.615, 1, sideMountOffset]);
    let beamSegmentIndex = 0;
    for (
      let polygonVertexPoint = 0;
      polygonVertexPoint < handrailPathPoints.length - 1;
      polygonVertexPoint++
    ) {
      let segmentStartPoint = handrailPathPoints[polygonVertexPoint],
        segmentEndPoint = handrailPathPoints[polygonVertexPoint + 1],
        segmentLength = Math.hypot(
          segmentEndPoint[0] - segmentStartPoint[0],
          segmentEndPoint[1] - segmentStartPoint[1],
        ),
        segmentDivisions = Math.max(1, Math.round(segmentLength / 0.058));
      for (let stitchIndex = 0; stitchIndex < segmentDivisions; stitchIndex++, beamSegmentIndex++) {
        let segmentStartParam = stitchIndex / segmentDivisions,
          segmentEndParam = (stitchIndex + 0.86) / segmentDivisions,
          lerpOnSegment = (R) => [
            segmentStartPoint[0] + (segmentEndPoint[0] - segmentStartPoint[0]) * R,
            segmentStartPoint[1] + (segmentEndPoint[1] - segmentStartPoint[1]) * R,
            sideMountOffset,
          ];
        assembler.add(
          'steel_worn',
          createRoundedBeamBetween(
            lerpOnSegment(segmentStartParam),
            lerpOnSegment(segmentEndParam),
            0.011,
            beamSegmentIndex % 2 ? 0.034 : 0.022,
            0,
            !0,
          ),
          null,
          beamSegmentIndex % 2 ? 0.55 : 0.75,
        );
      }
    }
    assembler.add(
      frameMaterialName,
      cylinderGeometry(hoseLoopRadius - 0.006, hoseLoopRadius - 0.006, 0.04, 12),
      {
        p: [0.67, hoseLoopTopY, sideMountOffset],
        r: [HALF_PI, 0, 0],
      },
      0.7,
    );
  }
  (assembler.add(
    frameMaterialName,
    roundedBoxGeometry(0.04, 0.09, 0.78, 0.008),
    {
      p: [railFrontX - 0.012, 1.96, 0],
    },
    wearTint(),
  ),
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.04, 0.12, 0.78, 0.008),
      {
        p: [railFrontX - 0.012, 0.42, 0],
      },
      wearTint(),
    ),
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.07, 0.09, 0.66, 0.008),
      {
        p: [0.665, 1.99 + halfForkLift, 0],
      },
      wearTint(),
    ),
    assembler.add(
      frameMaterialName,
      cylinderGeometry(0.048, 0.048, 1.15, 10),
      {
        p: [0.645, 0.72, 0],
      },
      0.6,
    ),
    assembler.add(
      frameMaterialName,
      cylinderGeometry(0.055, 0.055, 0.05, 10),
      {
        p: [0.645, 1.3, 0],
      },
      0.5,
    ),
    assembler.add(
      'steel_bare',
      cylinderGeometry(0.027, 0.027, 0.64 + halfForkLift, 8, !0),
      {
        p: [0.645, 1.31 + (0.64 + halfForkLift) / 2, 0],
      },
      1,
    ),
    assembler.label(
      'MAX 2500 kg',
      {
        color: 'yellow',
        font: 'stencil',
        distress: 0.3,
      },
      0.5,
      0.05,
      {
        p: [railFrontX - 0.033, 0.42, 0],
        r: [0, -HALF_PI, 0],
      },
    ));
  for (let vertexPoint of [0.21, 0.245])
    assembler.add(
      'rubber',
      tubeGeometry(
        [
          [0.6, 1.25, vertexPoint],
          [0.59, 1.65 + halfForkLift * 0.6, vertexPoint],
          [0.655, 1.86 + halfForkLift, vertexPoint + 0.005],
          [0.735, 1.6 + halfForkLift * 1.2, vertexPoint],
          [0.74, 0.56 + forkLift, vertexPoint],
        ],
        0.011,
        5,
        !1,
        0.5,
      ),
      null,
      1,
    );
  assembler.push({
    p: [0, forkLift, 0],
  });
  let carriageBaseY = 0.06;
  for (let vertexPoint of [carriageBaseY + 0.12, carriageBaseY + 0.5])
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.04, 0.1, 1.02, 0.008),
      {
        p: [0.755, vertexPoint, 0],
      },
      wearTint(),
    );
  assembler.add(
    'hazard_stripes',
    boxGeometry(0.003, 0.06, 0.4),
    {
      p: [0.7765, carriageBaseY + 0.5, 0],
    },
    0.9,
  );
  for (let vertexPoint of [1, -1])
    (assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.03, 0.5, 0.06, 0.006),
      {
        p: [0.745, carriageBaseY + 0.31, vertexPoint * 0.3],
      },
      wearTint(),
    ),
      assembler.add(
        frameMaterialName,
        roundedBoxGeometry(0.11, 0.36, 0.022, 0.005),
        {
          p: [0.685, carriageBaseY + 0.31, vertexPoint * 0.305],
        },
        wearTint(),
      ),
      assembler.add(
        frameMaterialName,
        roundedBoxGeometry(0.03, 0.78, 0.04, 0.006),
        {
          p: [0.755, carriageBaseY + 0.94, vertexPoint * 0.5],
        },
        wearTint(),
      ),
      assembler.add(
        'steel_worn',
        cylinderGeometry(0.04, 0.04, 0.03, 10),
        {
          p: [0.67, carriageBaseY + 0.2, vertexPoint * 0.325],
          r: [HALF_PI, 0, 0],
        },
        0.7,
      ));
  (assembler.add(
    frameMaterialName,
    roundedBoxGeometry(0.03, 0.04, 1.04, 0.006),
    {
      p: [0.755, carriageBaseY + 1.33, 0],
    },
    wearTint(),
  ),
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.02, 0.03, 1, 0.004),
      {
        p: [0.755, carriageBaseY + 0.94, 0],
      },
      wearTint(),
    ));
  for (let vertexPoint = -2; vertexPoint <= 2; vertexPoint++)
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.02, 0.76, 0.02, 0.004),
      {
        p: [0.755, carriageBaseY + 0.94, vertexPoint * 0.165],
      },
      wearTint(),
    );
  let carriageOffset = 0.035;
  for (let vertexPoint of [1, -1]) {
    let arcPointsBuffer = createHollowPolygonExtrusion(
      [
        [0.777, carriageOffset],
        [1.45, carriageOffset],
        [1.7, carriageOffset + 0.006],
        [1.7, carriageOffset + 0.016],
        [0.87, carriageOffset + 0.046],
        [0.826, carriageOffset + 0.075],
        [0.822, carriageOffset + 0.62],
        [0.777, carriageOffset + 0.62],
      ],
      0.1,
      {
        soft: 0.45,
      },
    );
    (assembler.add(
      'steel_worn',
      arcPointsBuffer,
      {
        p: [0, 0, vertexPoint * 0.26],
      },
      (partPointA, partPointB, arcSampleIndex) => {
        let arcSampleAngle = clampValue((partPointA - 0.8) / 0.9, 0, 1),
          sideMountOffset = valueNoise3D(partPointA * 14, arcSampleIndex * 30 + vertexPoint);
        return (0.5 + 0.5 * arcSampleAngle) * (0.8 + 0.2 * sideMountOffset);
      },
    ),
      assembler.add(
        frameMaterialName,
        roundedBoxGeometry(0.075, 0.05, 0.112, 0.006),
        {
          p: [0.772, carriageBaseY + 0.575, vertexPoint * 0.26],
        },
        0.55,
      ),
      assembler.add(
        frameMaterialName,
        roundedBoxGeometry(0.03, 0.04, 0.112, 0.006),
        {
          p: [0.79, carriageBaseY + 0.07, vertexPoint * 0.26],
        },
        0.55,
      ));
  }
  assembler.pop();
  let totalHeight = Math.max(2.2, 0.06 + forkLift + 1.36, 2.04 + halfForkLift);
  return assembler.finish({
    size: [3.4, totalHeight, 1.25],
    colliders: [
      {
        min: [-1.7, 0, -0.6],
        max: [0.58, 1.24, 0.6],
        surface: 'metal',
      },
      {
        min: [-1.56, 1.24, -0.4],
        max: [-1.22, 1.6, 0.4],
        surface: 'metal',
      },
      {
        min: [-0.88, 1.24, -0.24],
        max: [-0.7, 1.66, 0.24],
        surface: 'rubber',
      },
      {
        min: [0.56, 0, -0.42],
        max: [0.78, 2.04 + halfForkLift, 0.42],
        surface: 'metal',
      },
      {
        min: [0.72, forkLift, -0.53],
        max: [0.8, forkLift + 1.42, 0.53],
        surface: 'metal',
      },
      {
        min: [0.8, forkLift, -0.33],
        max: [1.7, forkLift + 0.1, 0.33],
        surface: 'metal',
      },
      {
        min: [-1.02, 2, -0.5],
        max: [0.32, 2.1, 0.5],
        surface: 'metal',
      },
      ...colliders,
    ],
  });
}

/**
 * 柴油发电机组：底架油箱、带百叶散热窗的机罩、控制面板（指示灯/急停/插座）、排气管与消声器，带 GEN-01 铭牌与油渍
 */
function buildGenerator(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'generator', opts.seed || 0),
    rand = assembler.rng,
    [paintMat, paintTint] = resolvePaintColorAlias(opts.color, 'yellow'),
    tintFn = (m = 1) =>
      typeof paintTint == 'number' ? paintTint * m : paintTint.map((A) => A * m),
    frameMaterialName = 'steel_dark',
    halfDepth = 0.46,
    frontX = 1.03,
    bodyBottomY = 0.3,
    bodyTopY = 1.16,
    bodyMidY = (bodyBottomY + bodyTopY) / 2;
  for (let tintScale of [1, -1]) {
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(2.2, 0.14, 0.1, 0.012),
      {
        p: [0, 0.07, tintScale * 0.4],
      },
      0.6,
    );
    for (let axisOffset of [-0.45, 0.45])
      assembler.add(
        frameMaterialName,
        boxGeometry(0.22, 0.075, 0.004),
        {
          p: [axisOffset, 0.075, tintScale * 0.451],
        },
        0.12,
      );
  }
  for (let tintScale of [-0.85, 0, 0.85])
    assembler.add(
      frameMaterialName,
      boxGeometry(0.1, 0.1, 0.72),
      {
        p: [tintScale, 0.07, 0],
      },
      0.55,
    );
  (assembler.add(
    frameMaterialName,
    roundedBoxGeometry(2.1, 0.17, 0.94, 0.012),
    {
      p: [0, 0.215, 0],
    },
    0.8,
  ),
    assembler.add(
      paintMat,
      roundedBoxGeometry(2.06, bodyTopY - bodyBottomY, halfDepth * 2, 0.025),
      {
        p: [0, bodyMidY, 0],
      },
      tintFn(),
    ),
    assembler.add(
      paintMat,
      roundedBoxGeometry(2.13, 0.045, 0.99, 0.014),
      {
        p: [0, bodyTopY + 0.02, 0],
      },
      tintFn(0.9),
    ));
  for (let tintScale of [-0.52, 0.52])
    assembler.add(
      paintMat,
      boxGeometry(0.04, 0.012, 0.95),
      {
        p: [tintScale, bodyTopY + 0.046, 0],
      },
      tintFn(0.85),
    );
  for (let tintScale of [1, -1]) {
    let axisOffset = tintScale > 0 ? 0 : PI_TWO;
    ([-0.66, 0, 0.66].forEach((panelOffsetX, panelIndex) => {
      (assembler.add(
        paintMat,
        roundedBoxGeometry(0.62, 0.72, 0.012, 0.006),
        {
          p: [panelOffsetX, bodyMidY + 0.01, tintScale * (halfDepth + 0.004)],
        },
        tintFn(rand.range(0.9, 1)),
      ),
        assembler.add(
          frameMaterialName,
          boxGeometry(0.03, 0.11, 0.016),
          {
            p: [panelOffsetX + 0.27, bodyMidY, tintScale * (halfDepth + 0.012)],
          },
          0.6,
        ),
        assembler.add(
          'steel_galv',
          boxGeometry(0.012, 0.03, 0.006),
          {
            p: [panelOffsetX + 0.27, bodyMidY + 0.03, tintScale * (halfDepth + 0.022)],
          },
          0.8,
        ));
      for (let ribCount of [-0.25, 0.25])
        assembler.add(
          'steel_galv',
          cylinderGeometry(0.009, 0.009, 0.06, 5, !0),
          {
            p: [panelOffsetX - 0.305, bodyMidY + ribCount, tintScale * (halfDepth + 0.012)],
          },
          0.7,
        );
      if (panelIndex > 0) {
        let ribCount = panelIndex === 2 ? 8 : 5,
          labelWidth = 0.42,
          labelY = panelIndex === 2 ? bodyMidY + 0.14 : bodyMidY - 0.16;
        assembler.add(
          frameMaterialName,
          boxGeometry(labelWidth, ribCount * 0.05, 0.004),
          {
            p: [panelOffsetX - 0.03, labelY, tintScale * (halfDepth + 0.0105)],
          },
          0.12,
        );
        for (let ribStep = 0; ribStep < ribCount; ribStep++)
          assembler.add(
            paintMat,
            boxGeometry(labelWidth, 0.04, 0.005),
            {
              p: [
                panelOffsetX - 0.03,
                labelY + (ribStep - (ribCount - 1) / 2) * 0.05,
                tintScale * (halfDepth + 0.018),
              ],
              r: [tintScale * 0.6, 0, 0],
            },
            tintFn(0.82),
          );
        panelIndex === 2 &&
          assembler.decal(ctx.mats.decal('rust_run'), 0.3, {
            p: [panelOffsetX - 0.03, labelY - 0.36, tintScale * (halfDepth + 0.011)],
            r: [0, axisOffset, 0],
          });
      }
    }),
      assembler.label(
        opts.label || 'GEN-0' + (1 + (assembler.seed % 2)),
        {
          color: 'black',
          font: 'stencil',
          distress: 0.35,
        },
        0.5,
        0.13,
        {
          p: [-0.66 * tintScale, bodyMidY + 0.17, tintScale * (halfDepth + 0.0108)],
          r: [0, axisOffset, 0],
        },
      ),
      assembler.decal(ctx.mats.decal('hazard_voltage'), 0.15, {
        p: [
          -0.66 * tintScale - tintScale * 0.18,
          bodyMidY - 0.17,
          tintScale * (halfDepth + 0.0108),
        ],
        r: [0, axisOffset, 0],
      }));
  }
  assembler.add(
    frameMaterialName,
    boxGeometry(0.004, 0.66, 0.74),
    {
      p: [frontX + 0.001, bodyMidY, 0],
    },
    0.1,
  );
  for (let tintScale = 0; tintScale < 11; tintScale++)
    assembler.add(
      paintMat,
      boxGeometry(0.006, 0.046, 0.74),
      {
        p: [frontX + 0.012, bodyMidY - 0.3 + tintScale * 0.06, 0],
        r: [0, 0, -0.6],
      },
      tintFn(0.8),
    );
  for (let tintScale of [1, -1])
    (assembler.add(
      paintMat,
      boxGeometry(0.03, 0.72, 0.03),
      {
        p: [frontX + 0.012, bodyMidY, tintScale * 0.385],
      },
      tintFn(0.9),
    ),
      assembler.add(
        paintMat,
        boxGeometry(0.03, 0.03, 0.8),
        {
          p: [frontX + 0.012, bodyMidY + tintScale * 0.345, 0],
        },
        tintFn(0.9),
      ));
  let rearX = -frontX - 0.004,
    socketX = 0.14;
  (assembler.add(
    frameMaterialName,
    roundedBoxGeometry(0.01, 0.44, 0.52, 0.004),
    {
      p: [rearX, 0.87, socketX],
    },
    0.45,
  ),
    assembler.add(
      paintMat,
      roundedBoxGeometry(0.075, 0.014, 0.56, 0.004),
      {
        p: [rearX - 0.03, 1.1, socketX],
        r: [0, 0, 0.12],
      },
      tintFn(0.9),
    ));
  for (let tintScale of [1, -1])
    assembler.add(
      paintMat,
      boxGeometry(0.06, 0.44, 0.012),
      {
        p: [rearX - 0.025, 0.87, socketX + tintScale * 0.268],
      },
      tintFn(0.9),
    );
  let panelX = rearX - 0.0055,
    panelNormal = [0, -HALF_PI, 0];
  (assembler.add(
    ctx.mats.emissive(8840104, 0.32),
    createDecalPlane(0.13, 0.07),
    {
      p: [panelX - 0.001, 0.99, socketX - 0.12],
      r: panelNormal,
    },
    1,
    {
      raw: !0,
      cast: !1,
    },
  ),
    assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.008, 0.09, 0.15, 0.003),
      {
        p: [panelX + 0.003, 0.99, socketX - 0.12],
      },
      0.3,
    ),
    assembler.add(
      'steel_galv',
      cylinderGeometry(0.02, 0.02, 0.012, 10),
      {
        p: [panelX - 0.004, 1, socketX + 0.19],
        r: [0, 0, HALF_PI],
      },
      0.7,
    ),
    assembler.add(
      ctx.mats.emissive(4063082, 3.2),
      cylinderGeometry(0.013, 0.013, 0.014, 10),
      {
        p: [panelX - 0.009, 1, socketX + 0.19],
        r: [0, 0, HALF_PI],
      },
      1,
      {
        raw: !0,
      },
    ),
    assembler.add(
      paintMat,
      cylinderGeometry(0.042, 0.042, 0.006, 12),
      {
        p: [panelX - 0.003, 0.8, socketX + 0.17],
        r: [0, 0, HALF_PI],
      },
      1,
    ),
    assembler.add(
      'plastic_red',
      revolveProfileGeometry(
        [
          [0, 0],
          [0.018, 0],
          [0.018, 0.018],
          [0.03, 0.02],
          [0.03, 0.034],
          [0.02, 0.042],
          [0, 0.044],
        ],
        10,
      ),
      {
        p: [panelX - 0.004, 0.8, socketX + 0.17],
        r: [0, 0, HALF_PI],
      },
      0.95,
    ));
  for (let tintScale = 0; tintScale < 3; tintScale++) {
    let axisOffset = socketX - 0.2 + tintScale * 0.105;
    (assembler.add(
      'aluminium',
      cylinderGeometry(0.04, 0.042, 0.012, 10),
      {
        p: [panelX - 0.004, 0.86, axisOffset],
        r: [0, 0, HALF_PI],
      },
      0.8,
    ),
      assembler.add(
        'aluminium',
        cylinderGeometry(0.034, 0.034, 0.002, 10),
        {
          p: [panelX - 0.0105, 0.86, axisOffset],
          r: [0, 0, HALF_PI],
        },
        1,
      ),
      assembler.add(
        frameMaterialName,
        boxGeometry(0.002, 0.028, 0.004),
        {
          p: [panelX - 0.0125, 0.868, axisOffset + 0.005],
          r: [rand.range(-1, 1), 0, 0],
        },
        0.3,
      ));
  }
  for (let tintScale = 0; tintScale < 5; tintScale++)
    assembler.add(
      tintScale === 0 ? 'plastic_red' : frameMaterialName,
      boxGeometry(0.014, 0.04, 0.022),
      {
        p: [panelX - 0.006, 0.74, socketX - 0.2 + tintScale * 0.03],
        r: [0, 0, rand() < 0.5 ? 0.25 : -0.25],
      },
      0.8,
    );
  (assembler.decal(ctx.mats.decal('hazard_voltage'), 0.13, {
    p: [-frontX - 0.002, 0.95, -0.28],
    r: panelNormal,
  }),
    assembler.label(
      'DANGER',
      {
        color: 'red',
        font: 'stencil',
        distress: 0.3,
      },
      0.22,
      0.05,
      {
        p: [-frontX - 0.002, 0.82, -0.28],
        r: panelNormal,
      },
    ));
  let socketColors = [
    ['plastic_red', 0.02],
    ['plastic_blue', 0.2],
    ['plastic_blue', -0.25],
  ];
  for (let [tintScale, axisOffset] of socketColors)
    (assembler.add(
      frameMaterialName,
      roundedBoxGeometry(0.02, 0.12, 0.1, 0.006),
      {
        p: [-frontX - 0.008, 0.5, axisOffset],
      },
      0.4,
    ),
      assembler.add(
        tintScale,
        createCylinderBetween(
          [-frontX - 0.01, 0.5, axisOffset],
          [-frontX - 0.06, 0.47, axisOffset],
          0.036,
          10,
          !0,
        ),
        null,
        0.9,
      ));
  (assembler.add(
    'plastic_blue',
    createCylinderBetween(
      [-frontX - 0.06, 0.47, 0.2],
      [-frontX - 0.068, 0.39, 0.2],
      0.03,
      8,
      !0,
      0.02,
    ),
    null,
    0.85,
  ),
    assembler.add(
      'rubber',
      tubeGeometry(
        [
          [-frontX - 0.066, 0.4, 0.2],
          [-frontX - 0.064, 0.25, 0.21],
          [-frontX - 0.05, 0.06, 0.26],
          [-frontX + 0.05, 0.016, 0.4],
          [-frontX + 0.3, 0.016, 0.478],
          [-0.35, 0.016, 0.486],
        ],
        0.014,
        5,
        !1,
        0.5,
      ),
      null,
      1,
    ));
  let capY = bodyTopY + 0.0425;
  (assembler.add(
    frameMaterialName,
    roundedBoxGeometry(0.2, 0.012, 0.14, 0.004),
    {
      p: [0, capY + 0.004, 0],
    },
    0.6,
  ),
    assembler.add(
      'steel_galv',
      createTorusGeometryWorldUV(0.045, 0.014, 5, 10),
      {
        p: [0, capY + 0.058, 0],
      },
      0.7,
    ));
  let exhaustPos = [0.72, capY, 0.24];
  return (
    assembler.add(
      'steel_rust',
      cylinderGeometry(0.062, 0.066, 0.025, 12),
      {
        p: [exhaustPos[0], capY + 0.012, exhaustPos[2]],
      },
      0.6,
    ),
    assembler.add(
      'steel_rust',
      cylinderGeometry(0.04, 0.04, 0.17, 12, !0),
      {
        p: [exhaustPos[0], capY + 0.085, exhaustPos[2]],
      },
      (tintScale, axisOffset) => 0.45 + 0.55 * clampValue((capY + 0.17 - axisOffset) / 0.17, 0, 1),
    ),
    assembler.add(
      'steel_rust',
      cylinderGeometry(0.034, 0.034, 0.002, 10),
      {
        p: [exhaustPos[0], capY + 0.15, exhaustPos[2]],
      },
      0.08,
    ),
    assembler.add(
      'steel_rust',
      cylinderGeometry(0.046, 0.046, 0.005, 12),
      {
        p: [exhaustPos[0] - 0.012, capY + 0.186, exhaustPos[2]],
        r: [0, 0, 0.5],
      },
      0.6,
    ),
    assembler.decal(ctx.mats.decal('scorch'), 0.3, {
      p: [exhaustPos[0], capY + 0.001, exhaustPos[2]],
      r: [-HALF_PI, 0, 0],
    }),
    assembler.add(
      frameMaterialName,
      createCylinderBetween([-0.72, 0.25, 0.46], [-0.72, 0.32, 0.5], 0.03, 8, !0),
      null,
      0.6,
    ),
    assembler.add(
      'plastic_red',
      createCylinderBetween([-0.72, 0.32, 0.5], [-0.72, 0.338, 0.51], 0.037, 10, !0),
      null,
      0.9,
    ),
    assembler.decal(ctx.mats.decal('hazard_flammable'), 0.11, {
      p: [-0.52, 0.215, 0.4712],
    }),
    assembler.label(
      'DIESEL',
      {
        color: 'white',
        font: 'stencil',
        distress: 0.4,
      },
      0.2,
      0.05,
      {
        p: [-0.34, 0.215, 0.4712],
      },
    ),
    assembler.finish({
      colliders: [
        {
          min: [-1.1, 0, -0.5],
          max: [1.1, 1.21, 0.5],
          surface: 'metal',
        },
      ],
    })
  );
}

/**
 * 工业垃圾箱：梯形箱体（环带挤出）+ 加强筋、一对盖板、四只脚轮、箱内探出的垃圾袋与纸板，侧面留污渍与泄漏痕
 */
function buildDumpster(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'dumpster', opts.seed || 0),
    rand = assembler.rng,
    [paintMat, paintTint] = resolvePaintColorAlias(opts.color, 'green'),
    tintFn = (M = 1) =>
      typeof paintTint == 'number' ? paintTint * M : paintTint.map((E) => E * M),
    halfLength = 0.89,
    sideLowY = 0.2,
    sideHighY = 1.12,
    topInnerX = 0.3,
    topOuterX = 0.5,
    bottomInnerX = -0.44,
    bottomOuterX = -0.5,
    wallThickness = 0.022,
    sideProfile = [
      [-topOuterX, sideHighY],
      [-topInnerX, sideLowY],
      [-bottomInnerX, sideLowY],
      [-bottomOuterX, sideHighY],
      [-bottomOuterX - wallThickness, sideHighY],
      [-bottomInnerX - wallThickness * 0.8, sideLowY + wallThickness],
      [-topInnerX + wallThickness * 0.8, sideLowY + wallThickness],
      [-topOuterX + wallThickness, sideHighY],
    ],
    noiseSeed = assembler.seed * 2.3;
  assembler.add(
    paintMat,
    createHollowPolygonExtrusion(sideProfile, halfLength * 2, {
      soft: 0,
    }),
    {
      r: [0, HALF_PI, 0],
    },
    (sideSign, tintChannel, lidWidth) => {
      let panelGeo =
        Math.abs(lidWidth) < 0.4 &&
        tintChannel > sideLowY + 0.01 &&
        tintChannel < sideHighY - 0.01 &&
        Math.abs(sideSign) < halfLength - 0.01;
      return tintFn(0.9 + 0.1 * valueNoise3D(sideSign * 3 + noiseSeed, tintChannel * 3));
    },
  );
  for (let sideSign of [1, -1]) {
    (assembler.add(
      paintMat,
      createHollowPolygonExtrusion(
        [
          [-topOuterX, sideHighY],
          [-topInnerX, sideLowY],
          [-bottomInnerX, sideLowY],
          [-bottomOuterX, sideHighY],
        ],
        wallThickness,
        {
          soft: 0,
        },
      ),
      {
        p: [sideSign * (halfLength - wallThickness / 2), 0, 0],
        r: [0, HALF_PI, 0],
      },
      tintFn(0.95),
    ),
      assembler.add(
        paintMat,
        roundedBoxGeometry(0.05, 0.045, topOuterX - bottomOuterX + 0.04, 0.008),
        {
          p: [sideSign * halfLength, sideHighY, 0],
        },
        tintFn(0.9),
      ));
    for (let tintChannel of [-0.22, 0.14])
      assembler.add(
        paintMat,
        roundedBoxGeometry(0.03, 0.84, 0.05, 0.006),
        {
          p: [sideSign * (halfLength + 0.012), 0.66, tintChannel],
        },
        tintFn(0.9),
      );
    (assembler.add(
      paintMat,
      roundedBoxGeometry(0.035, 0.1, 0.84, 0.008),
      {
        p: [sideSign * (halfLength + 0.014), 0.93, 0],
      },
      tintFn(0.85),
    ),
      assembler.add(
        'steel_worn',
        createCylinderBetween(
          [sideSign * (halfLength + 0.01), 0.93, 0.3],
          [sideSign * (halfLength + 0.065), 0.93, 0.3],
          0.03,
          10,
          !0,
        ),
        null,
        0.7,
      ),
      assembler.add(
        'steel_worn',
        cylinderGeometry(0.042, 0.042, 0.008, 10),
        {
          p: [sideSign * (halfLength + 0.064), 0.93, 0.3],
          r: [0, 0, HALF_PI],
        },
        0.6,
      ));
  }
  (assembler.add(
    paintMat,
    roundedBoxGeometry(halfLength * 2 + 0.04, 0.045, 0.05, 0.008),
    {
      p: [0, sideHighY, topOuterX],
    },
    tintFn(0.9),
  ),
    assembler.add(
      paintMat,
      roundedBoxGeometry(halfLength * 2 + 0.04, 0.045, 0.05, 0.008),
      {
        p: [0, sideHighY, bottomOuterX],
      },
      tintFn(0.9),
    ));
  let sideSlopeAngle = Math.atan2(topOuterX - topInnerX, sideHighY - sideLowY),
    frontSlopeAngle = Math.atan2(bottomOuterX - bottomInnerX, sideHighY - sideLowY);
  for (let sideSign of [-0.6, -0.2, 0.2, 0.6])
    (assembler.add(
      paintMat,
      createRoundedBeamBetween(
        [sideSign, sideLowY + 0.03, topInnerX + 0.022],
        [sideSign, sideHighY - 0.04, topOuterX + 0.012],
        0.055,
        0.03,
        0.006,
      ),
      null,
      tintFn(0.9),
    ),
      assembler.add(
        paintMat,
        createRoundedBeamBetween(
          [sideSign, sideLowY + 0.03, bottomInnerX - 0.016],
          [sideSign, sideHighY - 0.04, bottomOuterX - 0.012],
          0.055,
          0.03,
          0.006,
        ),
        null,
        tintFn(0.9),
      ));
  assembler.add(
    paintMat,
    createRoundedBeamBetween(
      [
        -halfLength,
        sideLowY + 0.5,
        topInnerX + 0.022 + (0.5 * (topOuterX - topInnerX)) / (sideHighY - sideLowY),
      ],
      [
        halfLength,
        sideLowY + 0.5,
        topInnerX + 0.022 + (0.5 * (topOuterX - topInnerX)) / (sideHighY - sideLowY),
      ],
      0.03,
      0.06,
      0.006,
    ),
    {
      r: [0, 0, 0],
    },
    tintFn(0.88),
  );
  let frontZAt = (length) =>
    topInnerX + ((length - sideLowY) * (topOuterX - topInnerX)) / (sideHighY - sideLowY) + 0.003;
  (assembler.label(
    opts.label || 'B4 WASTE ' + (11 + (assembler.seed % 2)),
    {
      color: 'white',
      font: 'stencil',
      distress: 0.5,
    },
    0.36,
    0.09,
    {
      p: [-0.4, 0.93, frontZAt(0.93)],
      r: [-sideSlopeAngle, 0, 0],
    },
  ),
    assembler.decal(ctx.mats.decal('grime_streak'), 0.36, {
      p: [0.4, 0.82, frontZAt(0.82)],
      r: [-sideSlopeAngle, 0, 0],
    }),
    assembler.decal(ctx.mats.decal('rust_run'), 0.3, {
      p: [0, 0.5, frontZAt(0.5)],
      r: [-sideSlopeAngle, 0, 0],
    }),
    assembler.decal(ctx.mats.decal('logo_c'), 0.26, {
      p: [0.4, 0.42, frontZAt(0.42)],
      r: [-sideSlopeAngle, 0, 0],
    }),
    assembler.decal(ctx.mats.decal('leak_stain'), 0.34, {
      p: [-0.4, 0.45, frontZAt(0.45)],
      r: [-sideSlopeAngle, 0, 0],
    }));
  let lidY = sideHighY + 0.045,
    lidZ = bottomOuterX - 0.02;
  assembler.add(
    'steel_galv',
    createCylinderBetween(
      [-halfLength - 0.02, lidY, lidZ],
      [halfLength + 0.02, lidY, lidZ],
      0.013,
      6,
      !0,
    ),
    null,
    0.7,
  );
  let addLid = (M, E) => {
    assembler.push({
      p: [M, lidY, lidZ],
      r: [E, 0, 0],
    });
    let w = 1.07,
      S = roundedBoxGeometryGrid(0.885, 0.04, w, 0.016, 3, 3, 4);
    (mapVertices(S, (H) => {
      H.y > 0 && (H.y += 0.018 * Math.cos((H.z / w) * PI_TWO) * Math.cos((H.x / 0.885) * PI_TWO));
    }),
      S.computeVertexNormals());
    let z = rand.range(0.75, 0.95);
    assembler.add(
      'plastic_grey',
      S,
      {
        p: [0, 0.005, w / 2],
      },
      z,
    );
    for (let H of [-0.26, 0.26])
      assembler.add(
        'plastic_grey',
        roundedBoxGeometry(0.07, 0.016, w - 0.16, 0.006),
        {
          p: [H, 0.036, w / 2],
        },
        z * 0.9,
      );
    assembler.add(
      'plastic_grey',
      roundedBoxGeometry(0.3, 0.035, 0.05, 0.01),
      {
        p: [0, 0.02, w + 0.01],
      },
      z * 0.8,
    );
    for (let H of [-0.3, 0.3])
      assembler.add(
        'plastic_grey',
        roundedBoxGeometry(0.08, 0.03, 0.09, 0.008),
        {
          p: [H, 0.005, 0.03],
        },
        z * 0.8,
      );
    assembler.pop();
  };
  (addLid(-0.45, 0), addLid(0.45, HALF_PI + 0.07 + rand.range(0, 0.05)));
  for (let [sideSign, tintChannel, lidWidth, panelGeo] of [
    [0.45, 0.93, 0.05, 1],
    [0.66, 0.9, -0.24, 0.8],
    [0.22, 0.86, -0.2, 0.85],
  ]) {
    let metalTint = roundedBoxGeometryGrid(
        0.46 * panelGeo,
        0.4 * panelGeo,
        0.42 * panelGeo,
        0.17 * panelGeo,
        3,
        3,
        3,
      ),
      vertex = rand() * 20;
    (mapVertices(metalTint, (bagVertex) => {
      let noiseOffset =
        valueNoise3D(bagVertex.x * 9 + vertex, bagVertex.y * 9, bagVertex.z * 9) - 0.5;
      ((bagVertex.x += noiseOffset * 0.06),
        (bagVertex.z += noiseOffset * 0.06),
        (bagVertex.y += noiseOffset * 0.04));
    }),
      assembler.add(
        'polymer_black',
        recomputeSmoothNormals(metalTint),
        {
          p: [sideSign, tintChannel, lidWidth],
          r: [rand() * 0.5, rand() * 6, 0],
        },
        0.8,
      ));
  }
  assembler.add(
    'cardboard',
    createRibbonFromPolyline(
      [
        [0.2, 0.9, 0.2],
        [0.24, 1.14, 0.26],
        [0.3, 1.2, 0.33],
      ],
      [0.16, 0, -0.05],
    ),
    null,
    0.7,
  );
  for (let sideSign of [-0.7, 0.7])
    for (let tintChannel of [-0.3, 0.17]) {
      (assembler.push({
        p: [sideSign, 0, tintChannel],
        r: [0, rand() * 6, 0],
      }),
        assembler.add(
          'steel_galv',
          roundedBoxGeometry(0.13, 0.012, 0.11, 0.003),
          {
            p: [0, 0.194, 0],
          },
          0.7,
        ));
      for (let lidWidth of [1, -1])
        assembler.add(
          'steel_galv',
          createRoundedBeamBetween(
            [0, 0.19, lidWidth * 0.034],
            [0.035, 0.08, lidWidth * 0.034],
            0.05,
            0.006,
            0,
            !0,
          ),
          null,
          0.65,
        );
      (assembler.add(
        'rubber',
        cylinderGeometry(0.08, 0.08, 0.045, 14),
        {
          p: [0.035, 0.08, 0],
          r: [HALF_PI, 0, 0],
        },
        0.9,
      ),
        assembler.add(
          'steel_galv',
          cylinderGeometry(0.035, 0.035, 0.05, 8),
          {
            p: [0.035, 0.08, 0],
            r: [HALF_PI, 0, 0],
          },
          0.6,
        ),
        assembler.pop());
    }
  return assembler.finish({
    colliders: [
      {
        min: [-0.95, 0.05, -0.56],
        max: [0.95, 1.2, 0.55],
        surface: 'metal',
      },
    ],
  });
}

/**
 * 维修工具车：五层抽屉（其中一层半开并露出工具）、铝把手、万向轮，台面上散放扳手/螺丝刀/油壶/手套，带 MAINT 铭牌
 */
function buildToolboxCart(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'toolbox_cart', opts.seed || 0),
    rand = assembler.rng,
    [paintMat, paintTint] = resolvePaintColorAlias(opts.color, 'red'),
    tintFn = (y = 1) =>
      typeof paintTint == 'number' ? paintTint * y : paintTint.map((b) => b * y),
    centerX = 0.04,
    bodyLength = 0.74,
    bodyBottomY = 0.125,
    bodyTopY = 0.785,
    halfDepth = 0.23;
  (assembler.add(
    paintMat,
    roundedBoxGeometry(bodyLength, bodyTopY - bodyBottomY, halfDepth * 2, 0.012),
    {
      p: [centerX, (bodyBottomY + bodyTopY) / 2, 0],
    },
    tintFn(),
  ),
    assembler.add(
      'steel_dark',
      roundedBoxGeometry(bodyLength + 0.01, 0.02, halfDepth * 2 + 0.01, 0.006),
      {
        p: [centerX, bodyBottomY + 0.004, 0],
      },
      0.5,
    ));
  let drawerHeights = [0.075, 0.075, 0.1, 0.13, 0.19],
    openDrawerIndex = 1 + (assembler.seed % 3),
    drawerCursor = bodyTopY - 0.03;
  (drawerHeights.forEach((tintScale, channelValue) => {
    let drawerSlideOut = channelValue === openDrawerIndex ? 0.05 : rand() < 0.3 ? 0.004 : 0,
      drawerCenterY = drawerCursor - tintScale / 2;
    if (
      (assembler.add(
        paintMat,
        roundedBoxGeometry(bodyLength - 0.05, tintScale - 0.01, 0.014, 0.004),
        {
          p: [centerX, drawerCenterY, halfDepth + 0.005 + drawerSlideOut],
        },
        tintFn(rand.range(0.9, 1)),
      ),
      assembler.add(
        'aluminium',
        roundedBoxGeometry(bodyLength - 0.09, 0.016, 0.016, 0.004),
        {
          p: [centerX, drawerCenterY + tintScale / 2 - 0.02, halfDepth + 0.019 + drawerSlideOut],
        },
        0.85,
      ),
      drawerSlideOut > 0.01)
    ) {
      (assembler.add(
        'steel_dark',
        boxGeometry(bodyLength - 0.07, tintScale - 0.02, drawerSlideOut),
        {
          p: [centerX, drawerCenterY, halfDepth + drawerSlideOut / 2],
        },
        0.4,
      ),
        assembler.add(
          'polymer_black',
          boxGeometry(bodyLength - 0.08, 0.004, drawerSlideOut),
          {
            p: [centerX, drawerCenterY + tintScale / 2 - 0.012, halfDepth + drawerSlideOut / 2],
          },
          0.3,
        ));
      for (let toolIndex = 0; toolIndex < 4; toolIndex++)
        assembler.add(
          'steel_bare',
          createCylinderBetween(
            [
              centerX - 0.25 + toolIndex * 0.15,
              drawerCenterY + tintScale / 2 - 0.016,
              halfDepth + 0.008,
            ],
            [
              centerX - 0.23 + toolIndex * 0.15,
              drawerCenterY + tintScale / 2 - 0.014,
              halfDepth + drawerSlideOut - 0.012,
            ],
            0.007,
            5,
            !0,
          ),
          null,
          0.8,
        );
    }
    drawerCursor -= tintScale;
  }),
    assembler.add(
      'steel_bare',
      cylinderGeometry(0.011, 0.011, 0.008, 8),
      {
        p: [centerX + bodyLength / 2 - 0.06, bodyTopY - 0.016, halfDepth + 0.004],
        r: [HALF_PI, 0, 0],
      },
      0.8,
    ),
    assembler.add(
      'rubber',
      boxGeometry(bodyLength - 0.04, 0.006, halfDepth * 2 - 0.04),
      {
        p: [centerX, bodyTopY + 0.003, 0],
      },
      0.9,
    ),
    assembler.add(
      paintMat,
      roundedBoxGeometry(bodyLength, 0.03, 0.014, 0.004),
      {
        p: [centerX, bodyTopY + 0.013, -halfDepth + 0.007],
      },
      tintFn(0.95),
    ));
  for (let tintScale of [1, -1])
    assembler.add(
      paintMat,
      roundedBoxGeometry(0.014, 0.03, halfDepth * 2, 0.004),
      {
        p: [centerX + tintScale * (bodyLength / 2 - 0.007), bodyTopY + 0.013, 0],
      },
      tintFn(0.95),
    );
  assembler.add(
    'aluminium',
    tubeGeometry(
      [
        [centerX - bodyLength / 2, 0.56, -0.17],
        [-0.41, 0.6, -0.17],
        [-0.435, 0.73, -0.17],
        [-0.435, 0.73, 0.17],
        [-0.41, 0.6, 0.17],
        [centerX - bodyLength / 2, 0.56, 0.17],
      ],
      0.012,
      6,
      !1,
      0.2,
    ),
    null,
    0.85,
  );
  for (let tintScale of [1, -1])
    for (let channelValue of [1, -1]) {
      (assembler.push({
        p: [centerX + tintScale * (bodyLength / 2 - 0.07), 0, channelValue * (halfDepth - 0.06)],
        r: [0, tintScale > 0 ? rand() * 6 : 0, 0],
      }),
        assembler.add(
          'steel_galv',
          roundedBoxGeometry(0.08, 0.008, 0.07, 0.002),
          {
            p: [0, 0.119, 0],
          },
          0.7,
        ));
      for (let drawerSlideOut of [1, -1])
        assembler.add(
          'steel_galv',
          createRoundedBeamBetween(
            [0, 0.117, drawerSlideOut * 0.022],
            [0.02, 0.05, drawerSlideOut * 0.022],
            0.035,
            0.004,
            0,
            !0,
          ),
          null,
          0.65,
        );
      (assembler.add(
        'rubber',
        cylinderGeometry(0.05, 0.05, 0.03, 12),
        {
          p: [0.02, 0.05, 0],
          r: [HALF_PI, 0, 0],
        },
        0.9,
      ),
        assembler.add(
          'steel_galv',
          cylinderGeometry(0.02, 0.02, 0.034, 6),
          {
            p: [0.02, 0.05, 0],
            r: [HALF_PI, 0, 0],
          },
          0.6,
        ),
        assembler.pop());
    }
  (assembler.label(
    opts.label || 'MAINT ' + (1 + (assembler.seed % 2)),
    {
      color: 'white',
      font: 'stencil',
      distress: 0.4,
    },
    0.3,
    0.07,
    {
      p: [centerX + bodyLength / 2 + 0.002, 0.6, 0],
      r: [0, HALF_PI, 0],
    },
  ),
    assembler.decal(ctx.mats.decal('logo_d'), 0.2, {
      p: [centerX + bodyLength / 2 + 0.002, 0.42, 0],
      r: [0, HALF_PI, 0],
    }),
    assembler.decal(ctx.mats.decal('grime_streak'), 0.3, {
      p: [centerX, 0.45, -halfDepth - 0.002],
      r: [0, PI_TWO, 0],
    }));
  let topY = bodyTopY + 0.006;
  (assembler.push({
    p: [centerX - 0.18, topY, 0.08],
    r: [0, 0.5, 0],
  }),
    assembler.add(
      'steel_bare',
      roundedBoxGeometry(0.2, 0.006, 0.02, 0.002),
      {
        p: [0, 0.004, 0],
      },
      0.9,
    ),
    assembler.add(
      'steel_bare',
      createTorusGeometryWorldUV(0.016, 0.006, 4, 10),
      {
        p: [0.11, 0.005, 0],
        r: [HALF_PI, 0, 0],
      },
      0.9,
    ),
    assembler.add(
      'steel_bare',
      createTorusGeometryWorldUV(0.017, 0.006, 4, 7, PI_TWO * 1.4),
      {
        p: [-0.112, 0.005, 0],
        r: [HALF_PI, 0, 2.2],
      },
      0.9,
    ),
    assembler.pop(),
    assembler.push({
      p: [centerX + 0.02, topY, -0.1],
      r: [0, -0.3, 0],
    }),
    assembler.add(
      'wood_pallet',
      createCylinderBetween([-0.14, 0.014, 0], [0.12, 0.016, 0], 0.012, 6, !0, 0.01),
      null,
      0.9,
    ),
    assembler.add(
      'steel_dark',
      roundedBoxGeometry(0.032, 0.03, 0.1, 0.006),
      {
        p: [0.125, 0.017, 0.005],
      },
      0.8,
    ),
    assembler.pop(),
    assembler.push({
      p: [centerX + 0.2, topY, 0.1],
      r: [0, 0.12, 0],
    }),
    assembler.add(
      'polymer_black',
      roundedBoxGeometry(0.22, 0.014, 0.05, 0.004),
      {
        p: [0, 0.007, 0],
      },
      0.6,
    ));
  for (let tintScale = 0; tintScale < 6; tintScale++)
    assembler.add(
      'steel_bare',
      cylinderGeometry(0.008 + tintScale * 0.0014, 0.008 + tintScale * 0.0014, 0.03, 8),
      {
        p: [-0.085 + tintScale * 0.034, 0.029, 0],
      },
      0.9,
    );
  (assembler.pop(),
    assembler.add(
      'plastic_blue',
      cylinderGeometry(0.032, 0.032, 0.13, 12),
      {
        p: [centerX + 0.28, topY + 0.065, -0.12],
      },
      0.9,
    ),
    assembler.add(
      'steel_bare',
      revolveProfileGeometry(
        [
          [0.032, 0],
          [0.028, 0.012],
          [0.014, 0.018],
          [0.014, 0.018],
          [0.014, 0.03],
          [0, 0.03],
        ],
        10,
      ),
      {
        p: [centerX + 0.28, topY + 0.13, -0.12],
      },
      0.9,
    ),
    assembler.add(
      'plastic_red',
      cylinderGeometry(0.012, 0.012, 0.014, 8),
      {
        p: [centerX + 0.28, topY + 0.165, -0.12],
      },
      0.95,
    ),
    assembler.add(
      'paint_yellow',
      createCylinderBetween(
        [centerX - 0.3, topY + 0.012, -0.13],
        [centerX - 0.2, topY + 0.012, -0.16],
        0.014,
        7,
        !0,
      ),
      null,
      0.9,
    ),
    assembler.add(
      'steel_bare',
      createCylinderBetween(
        [centerX - 0.2, topY + 0.012, -0.16],
        [centerX - 0.08, topY + 0.01, -0.196],
        0.004,
        5,
        !0,
      ),
      null,
      0.9,
    ));
  let gloveGeo = roundedBoxGeometryGrid(0.2, 0.02, 0.15, 0.009, 4, 3, 4),
    gloveNoise = rand() * 9;
  return (
    mapVertices(gloveGeo, (tintScale) => {
      ((tintScale.y +=
        0.012 *
        valueNoise3D(tintScale.x * 30 + gloveNoise, tintScale.z * 30) *
        (tintScale.y > 0 ? 1 : 0)),
        (tintScale.x += 0.012 * (valueNoise3D(tintScale.z * 20, gloveNoise) - 0.5)));
    }),
    assembler.add(
      assembler.mat('glove_fabric', {
        color: 8203044,
      }),
      recomputeSmoothNormals(gloveGeo),
      {
        p: [centerX - 0.26, topY + 0.01, 0.12],
        r: [0, 0.8, 0],
      },
      0.9,
    ),
    assembler.finish()
  );
}

/**
 * 登记叉车、发电机、垃圾箱、工具车这四件大型可交互感道具
 */
export function registerCargoProps(register) {
  (register('forklift', (e, t = {}) => buildForklift(e, t)),
    register('generator', (e, t = {}) => buildGenerator(e, t)),
    register('dumpster', (e, t = {}) => buildDumpster(e, t)),
    register('toolbox_cart', (e, t = {}) => buildToolboxCart(e, t)));
}
