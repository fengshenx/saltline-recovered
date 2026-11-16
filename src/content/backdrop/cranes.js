// content/backdrop/cranes.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import {
  MeshBatcher,
  beamBetween,
  boxFromBounds,
  cylinderFromAxis,
  planeAt,
  strutBetween,
  strutsAlongPath,
} from '../../assets/procedural/geometry.js';

import {
  TINT_PANEL,
  TINT_PANEL_DARK,
  TINT_WHITE,
  TINT_YELLOW,
  addRailing,
  makeBeaconGeo,
} from './backdrop.js';

import { newVec3 } from '../../core/math.js';

import { MATERIAL_LOOKUP_CACHE, getTintedMaterial } from '../../render/materials/materials.js';

/**
 * 按文本+字体参数取（并缓存）铭牌材质，失败时退回 paint_white，保证贴图缺失不会打断道具生成
 */
export function getLabelMaterial(ctx, text, opts) {
  let cache = MATERIAL_LOOKUP_CACHE.get(ctx.mats);
  cache || ((cache = new Map()), MATERIAL_LOOKUP_CACHE.set(ctx.mats, cache));
  let cacheKey = 'L|' + text + '|' + JSON.stringify(opts || {});
  if (!cache.has(cacheKey)) {
    let entry;
    try {
      entry = ctx.mats.label(text, opts || {});
    } catch {
      entry = null;
    }
    cache.set(
      cacheKey,
      entry && entry.material
        ? entry
        : {
            material: ctx.mats.get('paint_white'),
            aspect: Math.max(1, text.length * 0.6),
          },
    );
  }
  return cache.get(cacheKey);
}

/**
 * 按贴花名取（并缓存）贴花材质，同样带 paint_white 兜底
 */
export function getDecalMaterial(ctx, decalName) {
  let decalCache = MATERIAL_LOOKUP_CACHE.get(ctx.mats);
  decalCache || ((decalCache = new Map()), MATERIAL_LOOKUP_CACHE.set(ctx.mats, decalCache));
  let cacheKey = 'D|' + decalName;
  if (!decalCache.has(cacheKey)) {
    let decalEntry;
    try {
      decalEntry = ctx.mats.decal(decalName);
    } catch {
      decalEntry = null;
    }
    decalCache.set(
      cacheKey,
      decalEntry && decalEntry.material
        ? decalEntry
        : {
            material: ctx.mats.get('paint_white'),
            aspect: 1,
          },
    );
  }
  return decalCache.get(cacheKey);
}

/**
 * 岸桥第一排支腿的 x 坐标（与码头轨道对齐）
 */
var CRANE_PORTAL_X0 = 18.5;

/**
 * 岸桥第二排支腿的 x 坐标，两排间距由轨道决定，不可随意改
 */
var CRANE_PORTAL_X1 = 28.5;

/**
 * 岸桥门架沿 z 方向的半跨（支腿 z 偏移），决定横梁与梯子位置
 */
var CRANE_PORTAL_HALF_Z = 5.4;

/**
 * 岸桥主梁下弦高度
 */
var CRANE_GIRDER_Y0 = 21.2;

/**
 * 岸桥主梁上弦高度，与下弦一起围出主梁箱型断面
 */
var CRANE_GIRDER_Y1 = 22.8;

/**
 * 岸桥臂架/大梁沿 z 方向的半宽，决定轨道与栏杆的横向位置
 */
var CRANE_BOOM_HALF_Z = 1.8;

/**
 * 岸桥臂架（悬臂）起点 x，往岸内侧到这条线为止
 */
var CRANE_BOOM_X0 = 12;

/**
 * 岸桥臂架外伸末端 x，伸到水面之上；臂架端部的灯、栏杆、检修平台都以此为准
 */
var CRANE_BOOM_X1 = 62;

/**
 * 岸桥机房（贴 SALTLINE 04 铭牌的白色小室）所在 x，吊具从它下方垂到舱口
 */
var CRANE_HOUSE_X = 41;

/**
 * 搭建 4 支腿岸桥（SALTLINE 04）：门架、主梁、臂架、机房、走梯、检修平台、灯具与吊具，返回根节点、碰撞盒与吊具对象；带 into 选项时只往外部批处理器灌几何（远景用）
 */
export function buildQuayCrane(ctx, lamps, craneOptions = {}) {
  let intoBatch = !!craneOptions.into,
    depthOffset = craneOptions.dz || 0,
    batcher = craneOptions.into || new MeshBatcher(),
    lampTarget = intoBatch
      ? {
          add(frameX, frameZ, segmentValue, spanExtent, offsetValue) {
            (frameX.translate(0, 0, depthOffset),
              lamps.add(frameX, frameZ, segmentValue, spanExtent, offsetValue));
          },
        }
      : lamps,
    greyPaint = getTintedMaterial(ctx, 'paint_grey'),
    yellowPaint = getTintedMaterial(ctx, 'paint_yellow'),
    whitePaint = getTintedMaterial(ctx, 'paint_white'),
    redPaint = getTintedMaterial(ctx, 'paint_red'),
    galvSteel = ctx.mats.get('steel_galv'),
    darkSteel = ctx.mats.get('steel_dark'),
    hazardPaint = ctx.mats.get('hazard_stripes'),
    glassMat = ctx.mats.get('glass'),
    lampMat = ctx.mats.emissive(16769716, 6),
    addGeom = (R, I, se) => batcher.add(R, I, se),
    colliders = [];
  if (intoBatch) {
    let frameX = new Map([
        [greyPaint.uuid, [0.2, 0.25, 0.31]],
        [yellowPaint.uuid, [0.72, 0.52, 0.12]],
        [whitePaint.uuid, [0.78, 0.78, 0.76]],
        [redPaint.uuid, [0.5, 0.14, 0.1]],
        [galvSteel.uuid, [0.5, 0.52, 0.54]],
        [darkSteel.uuid, [0.1, 0.1, 0.11]],
        [hazardPaint.uuid, [0.7, 0.5, 0.1]],
      ]),
      frameZ = craneOptions.mat;
    ((batcher.remap = (segmentValue, spanExtent) => {
      let offsetValue = frameX.get(segmentValue.uuid);
      return offsetValue
        ? [
            frameZ,
            spanExtent
              ? [
                  offsetValue[0] * spanExtent[0],
                  offsetValue[1] * spanExtent[1],
                  offsetValue[2] * spanExtent[2],
                ]
              : offsetValue,
          ]
        : null;
    }),
      (batcher.dz = depthOffset),
      (batcher.minSize = 2.6));
  }
  function addPortalFrame(R, I) {
    let se = R < 23.5 ? 1 : -1;
    for (let ae of [-1.12, 1.12]) {
      let k = I + ae;
      addGeom(
        yellowPaint,
        boxFromBounds(R - 0.3, 0.36, k - 0.98, R + 0.3, 0.84, k + 0.98, 0.04),
        TINT_YELLOW,
      );
      for (let ce of [-0.56, 0.56])
        (addGeom(darkSteel, cylinderFromAxis(0.33, 0.33, 0.14, 'x', R, 0.33, k + ce, 16)),
          addGeom(darkSteel, cylinderFromAxis(0.37, 0.37, 0.025, 'x', R - 0.085, 0.33, k + ce, 16)),
          addGeom(darkSteel, cylinderFromAxis(0.37, 0.37, 0.025, 'x', R + 0.085, 0.33, k + ce, 16)),
          addGeom(galvSteel, cylinderFromAxis(0.11, 0.11, 0.7, 'x', R, 0.33, k + ce, 8)));
      (addGeom(darkSteel, cylinderFromAxis(0.16, 0.16, 0.5, 'z', R + se * 0.5, 0.6, k, 10)),
        addGeom(
          yellowPaint,
          boxFromBounds(R + se * 0.3, 0.42, k - 0.56 - 0.16, R + se * 0.62, 0.8, k - 0.3, 0.03),
          TINT_YELLOW,
        ));
    }
    (addGeom(darkSteel, boxFromBounds(R - 0.2, 0.1, I - 0.22, R + 0.2, 0.9, I + 0.22, 0.03)),
      addGeom(
        greyPaint,
        boxFromBounds(R - 0.34, 0.9, I - 1.8, R + 0.34, 1.42, I + 1.8, 0.05),
        TINT_PANEL,
      ));
    for (let ae of [-1.12, 0, 1.12])
      addGeom(galvSteel, cylinderFromAxis(0.14, 0.14, 0.8, 'x', R, ae ? 1.08 : 1.22, I + ae, 10));
    addGeom(
      greyPaint,
      boxFromBounds(R - 0.54, 1.42, I - 0.54, R + 0.54, 1.6, I + 0.54, 0.03),
      TINT_PANEL_DARK,
    );
    for (let ae of [-1, 1]) {
      let k = I + ae * 2.1;
      (addGeom(
        yellowPaint,
        boxFromBounds(R - 0.16, 0.44, k - 0.12, R + 0.16, 0.8, k + 0.12, 0.02),
        TINT_YELLOW,
      ),
        addGeom(galvSteel, cylinderFromAxis(0.08, 0.08, 0.34, 'z', R, 0.62, k + ae * 0.28, 8)),
        addGeom(darkSteel, cylinderFromAxis(0.17, 0.15, 0.12, 'z', R, 0.62, k + ae * 0.5, 12)),
        addGeom(
          hazardPaint,
          boxFromBounds(R - 0.28, 0.04, k + ae * 0.13, R + 0.28, 0.4, k + ae * 0.16),
        ));
    }
    (colliders.push({
      min: [R - 0.5, 0, I - 2.7],
      max: [R + 0.5, 1.5, I + 2.7],
    }),
      colliders.push({
        min: [R - 0.62, 0, I - 0.62],
        max: [R + 0.62, 24, I + 0.62],
      }));
  }
  let legSegmentYs = [3.6, 7.6, 11.2, 12.5, 13.5, 17.2, 20.6, 23.8];
  for (let frameX of [CRANE_PORTAL_X0, CRANE_PORTAL_X1])
    for (let frameZ of [-CRANE_PORTAL_HALF_Z, CRANE_PORTAL_HALF_Z]) {
      (addPortalFrame(frameX, frameZ),
        addGeom(
          hazardPaint,
          boxFromBounds(frameX - 0.6, 1.6, frameZ - 0.6, frameX + 0.6, 3.6, frameZ + 0.6, 0.04),
        ));
      for (let segmentValue = 0; segmentValue < legSegmentYs.length - 1; segmentValue++)
        (addGeom(
          greyPaint,
          boxFromBounds(
            frameX - 0.6,
            legSegmentYs[segmentValue],
            frameZ - 0.6,
            frameX + 0.6,
            legSegmentYs[segmentValue + 1],
            frameZ + 0.6,
            0.05,
          ),
          TINT_PANEL,
        ),
          (segmentValue === 0 || segmentValue === 1 || segmentValue === 5) &&
            addGeom(
              greyPaint,
              boxFromBounds(
                frameX - 0.64,
                legSegmentYs[segmentValue] - 0.05,
                frameZ - 0.64,
                frameX + 0.64,
                legSegmentYs[segmentValue] + 0.05,
                frameZ + 0.64,
              ),
              TINT_PANEL_DARK,
            ));
    }
  let hazardDecal = ctx.mats.decal('hazard_voltage');
  for (let frameX of [-CRANE_PORTAL_HALF_Z, CRANE_PORTAL_HALF_Z]) {
    let frameZ = CRANE_PORTAL_X0 - 0.6;
    (addGeom(
      whitePaint,
      boxFromBounds(frameZ - 0.035, 1.72, frameX - 0.36, frameZ, 3.48, frameX + 0.36, 0.012),
      [0.62, 0.66, 0.7],
    ),
      addGeom(
        darkSteel,
        boxFromBounds(frameZ - 0.05, 1.66, frameX - 0.42, frameZ - 0.005, 1.72, frameX + 0.42),
      ),
      addGeom(
        darkSteel,
        boxFromBounds(frameZ - 0.05, 3.48, frameX - 0.42, frameZ - 0.005, 3.54, frameX + 0.42),
      ),
      addGeom(
        darkSteel,
        boxFromBounds(frameZ - 0.05, 1.66, frameX - 0.42, frameZ - 0.005, 3.54, frameX - 0.36),
      ),
      addGeom(
        darkSteel,
        boxFromBounds(frameZ - 0.05, 1.66, frameX + 0.36, frameZ - 0.005, 3.54, frameX + 0.42),
      ),
      addGeom(
        galvSteel,
        strutBetween(
          [frameZ - 0.08, 2.45, frameX + 0.26],
          [frameZ - 0.08, 2.75, frameX + 0.26],
          0.014,
          5,
        ),
      ));
    for (let segmentValue of [2, 3.2])
      addGeom(
        darkSteel,
        boxFromBounds(
          frameZ - 0.06,
          segmentValue - 0.07,
          frameX - 0.37,
          frameZ - 0.03,
          segmentValue + 0.07,
          frameX - 0.33,
        ),
      );
    (addGeom(galvSteel, boxFromBounds(frameZ - 0.3, 1.5, frameX - 0.4, frameZ, 1.56, frameX + 0.4)),
      addGeom(
        galvSteel,
        boxFromBounds(frameZ - 0.3, 1, frameX - 0.4, frameZ - 0.02, 1.05, frameX + 0.4),
      ),
      addGeom(hazardDecal.material, planeAt(0.3, 0.3, frameZ - 0.04, 3.1, frameX, -Math.PI / 2)));
  }
  for (let frameX of [CRANE_PORTAL_X0, CRANE_PORTAL_X1]) {
    addGeom(
      greyPaint,
      boxFromBounds(
        frameX - 0.45,
        3.6,
        -CRANE_PORTAL_HALF_Z + 0.6,
        frameX + 0.45,
        4.6,
        CRANE_PORTAL_HALF_Z - 0.6,
        0.05,
      ),
      TINT_PANEL,
    );
    for (let frameZ of [-2.4, 0, 2.4])
      addGeom(
        greyPaint,
        boxFromBounds(frameX - 0.48, 3.58, frameZ - 0.03, frameX + 0.48, 4.62, frameZ + 0.03),
        TINT_PANEL_DARK,
      );
  }
  (addGeom(
    yellowPaint,
    cylinderFromAxis(1.15, 1.15, 0.06, 'x', CRANE_PORTAL_X0 - 0.62, 5.85, -2.2, 24),
    TINT_YELLOW,
  ),
    addGeom(
      yellowPaint,
      cylinderFromAxis(1.15, 1.15, 0.06, 'x', CRANE_PORTAL_X0 - 1.02, 5.85, -2.2, 24),
      TINT_YELLOW,
    ),
    addGeom(
      darkSteel,
      cylinderFromAxis(0.7, 0.7, 0.36, 'x', CRANE_PORTAL_X0 - 0.82, 5.85, -2.2, 20),
    ),
    addGeom(
      galvSteel,
      cylinderFromAxis(0.12, 0.12, 0.9, 'x', CRANE_PORTAL_X0 - 0.6, 5.85, -2.2, 8),
    ),
    addGeom(
      greyPaint,
      boxFromBounds(CRANE_PORTAL_X0 - 0.5, 4.6, -2.5, CRANE_PORTAL_X0 + 0.3, 5.9, -1.9, 0.03),
      TINT_PANEL_DARK,
    ),
    addGeom(
      darkSteel,
      strutBetween(
        [CRANE_PORTAL_X0 - 0.82, 4.75, -2.2 + 1],
        [CRANE_PORTAL_X0 - 0.82, 0.02, -1.2 + 0.3],
        0.035,
        6,
      ),
    ),
    addGeom(
      galvSteel,
      boxFromBounds(CRANE_PORTAL_X0 - 1, 0, -1.15, CRANE_PORTAL_X0 - 0.64, 0.5, -0.65, 0.02),
    ),
    colliders.push({
      min: [CRANE_PORTAL_X0 - 1, 0, -1.15],
      max: [CRANE_PORTAL_X0 - 0.64, 0.5, -0.65],
    }),
    addGeom(
      whitePaint,
      boxFromBounds(CRANE_PORTAL_X0 - 0.42, 4.6, 1, CRANE_PORTAL_X0 + 0.42, 6.3, 3.6, 0.03),
      TINT_WHITE,
    ));
  for (let frameX of [1.65, 2.3, 2.95])
    addGeom(
      darkSteel,
      boxFromBounds(
        CRANE_PORTAL_X0 - 0.44,
        4.7,
        frameX - 0.01,
        CRANE_PORTAL_X0 - 0.42,
        6.2,
        frameX + 0.01,
      ),
    );
  addGeom(
    galvSteel,
    boxFromBounds(CRANE_PORTAL_X0 - 0.47, 5.6, 1.2, CRANE_PORTAL_X0 - 0.42, 6.1, 1.55),
  );
  for (let frameX of [-CRANE_PORTAL_HALF_Z, CRANE_PORTAL_HALF_Z]) {
    addGeom(
      greyPaint,
      boxFromBounds(
        CRANE_PORTAL_X0 + 0.6,
        12.5,
        frameX - 0.45,
        CRANE_PORTAL_X1 - 0.6,
        13.5,
        frameX + 0.45,
        0.05,
      ),
      TINT_PANEL,
    );
    for (let segmentValue of [21, 23.5, 26])
      addGeom(
        greyPaint,
        boxFromBounds(
          segmentValue - 0.03,
          12.48,
          frameX - 0.48,
          segmentValue + 0.03,
          13.52,
          frameX + 0.48,
        ),
        TINT_PANEL_DARK,
      );
    let frameZ = Math.sign(frameX);
    (addGeom(
      greyPaint,
      beamBetween(
        [CRANE_PORTAL_X0 + 0.5, 9.6, frameX],
        [CRANE_PORTAL_X0 + 3.4, 12.6, frameX],
        0.4,
        0.4,
        0.03,
      ),
      TINT_PANEL,
    ),
      addGeom(
        greyPaint,
        beamBetween(
          [CRANE_PORTAL_X1 - 0.5, 9.6, frameX],
          [CRANE_PORTAL_X1 - 3.4, 12.6, frameX],
          0.4,
          0.4,
          0.03,
        ),
        TINT_PANEL,
      ));
    for (let segmentValue of [CRANE_PORTAL_X0, CRANE_PORTAL_X1])
      addGeom(
        greyPaint,
        beamBetween(
          [segmentValue, 9.6, frameX - frameZ * 0.5],
          [segmentValue, 12.6, frameX - frameZ * 3.4],
          0.4,
          0.4,
          0.03,
        ),
        TINT_PANEL,
      );
    (addGeom(
      greyPaint,
      strutBetween(
        [CRANE_PORTAL_X1 - 0.4, 13.7, frameX],
        [CRANE_PORTAL_X0 + 0.4, 22.7, frameX],
        0.2,
        10,
      ),
      TINT_PANEL,
    ),
      addGeom(
        greyPaint,
        strutBetween(
          [CRANE_PORTAL_X0 + 0.4, 13.7, frameX],
          [CRANE_PORTAL_X1 - 0.4, 22.7, frameX],
          0.2,
          10,
        ),
        TINT_PANEL,
      ),
      addGeom(
        greyPaint,
        boxFromBounds(23.5 - 0.5, 17.7, frameX - 0.24, 23.5 + 0.5, 18.7, frameX + 0.24, 0.03),
        TINT_PANEL_DARK,
      ),
      addGeom(
        greyPaint,
        boxFromBounds(
          CRANE_PORTAL_X0 + 0.6,
          22.95,
          frameX - 0.35,
          CRANE_PORTAL_X1 - 0.6,
          23.7,
          frameX + 0.35,
          0.04,
        ),
        TINT_PANEL,
      ));
  }
  for (let frameX of [CRANE_PORTAL_X0, CRANE_PORTAL_X1]) {
    (addGeom(
      greyPaint,
      boxFromBounds(
        frameX - 0.45,
        12.5,
        -CRANE_PORTAL_HALF_Z + 0.6,
        frameX + 0.45,
        13.5,
        CRANE_PORTAL_HALF_Z - 0.6,
        0.05,
      ),
      TINT_PANEL,
    ),
      addGeom(
        greyPaint,
        boxFromBounds(
          frameX - 0.45,
          22.8,
          -CRANE_PORTAL_HALF_Z + 0.6,
          frameX + 0.45,
          23.8,
          CRANE_PORTAL_HALF_Z - 0.6,
          0.05,
        ),
        TINT_PANEL,
      ));
    for (let frameZ of [-1, 1])
      addGeom(
        greyPaint,
        beamBetween(
          [frameX, 20.2, frameZ * (CRANE_PORTAL_HALF_Z - 0.5)],
          [frameX, 22.8, frameZ * (CRANE_BOOM_HALF_Z + 1.2)],
          0.36,
          0.36,
          0.03,
        ),
        TINT_PANEL,
      );
  }
  (addGeom(
    galvSteel,
    boxFromBounds(CRANE_PORTAL_X0 + 0.9, 13.5, 4.05, CRANE_PORTAL_X1 - 0.9, 13.55, 4.95),
  ),
    addRailing(
      batcher,
      yellowPaint,
      [
        [CRANE_PORTAL_X0 + 0.9, 13.55, 4.08],
        [CRANE_PORTAL_X1 - 0.9, 13.55, 4.08],
      ],
      {
        tint: TINT_YELLOW,
      },
    ),
    addGeom(
      galvSteel,
      boxFromBounds(CRANE_PORTAL_X0 + 0.45, 13.45, -4.6, CRANE_PORTAL_X0 + 1.25, 13.5, 4.05),
    ),
    addRailing(
      batcher,
      yellowPaint,
      [
        [CRANE_PORTAL_X0 + 1.22, 13.5, -4.6],
        [CRANE_PORTAL_X0 + 1.22, 13.5, 4.05],
      ],
      {
        tint: TINT_YELLOW,
      },
    ));
  let boomEndX = CRANE_PORTAL_X1 + 1.3;
  for (let frameX of [-1, 1]) {
    let frameZ = frameX * CRANE_BOOM_HALF_Z,
      segmentValue = [
        CRANE_BOOM_X0,
        15.4,
        CRANE_PORTAL_X0,
        22,
        25.2,
        CRANE_PORTAL_X1,
        boomEndX - 0.15,
        boomEndX + 0.15,
        34.6,
        39.2,
        43.8,
        48.4,
        53,
        57.6,
        CRANE_BOOM_X1,
      ];
    for (let offsetAlong = 0; offsetAlong < segmentValue.length - 1; offsetAlong++)
      offsetAlong !== 6 &&
        (addGeom(
          greyPaint,
          boxFromBounds(
            segmentValue[offsetAlong],
            CRANE_GIRDER_Y0,
            frameZ - 0.45,
            segmentValue[offsetAlong + 1],
            CRANE_GIRDER_Y1,
            frameZ + 0.45,
            0.05,
          ),
          TINT_PANEL,
        ),
        offsetAlong > 0 &&
          offsetAlong !== 7 &&
          addGeom(
            greyPaint,
            boxFromBounds(
              segmentValue[offsetAlong] - 0.035,
              CRANE_GIRDER_Y0 - 0.05,
              frameZ - 0.5,
              segmentValue[offsetAlong] + 0.035,
              CRANE_GIRDER_Y1 + 0.05,
              frameZ + 0.5,
            ),
            TINT_PANEL_DARK,
          ));
    (addGeom(
      greyPaint,
      boxFromBounds(
        boomEndX - 0.7,
        CRANE_GIRDER_Y1 - 0.1,
        frameZ - 0.52,
        boomEndX + 0.7,
        CRANE_GIRDER_Y1 + 0.55,
        frameZ - 0.4,
        0.03,
      ),
      TINT_PANEL_DARK,
    ),
      addGeom(
        greyPaint,
        boxFromBounds(
          boomEndX - 0.7,
          CRANE_GIRDER_Y1 - 0.1,
          frameZ + 0.4,
          boomEndX + 0.7,
          CRANE_GIRDER_Y1 + 0.55,
          frameZ + 0.52,
          0.03,
        ),
        TINT_PANEL_DARK,
      ),
      addGeom(
        galvSteel,
        cylinderFromAxis(0.16, 0.16, 1.2, 'z', boomEndX, CRANE_GIRDER_Y1 + 0.22, frameZ, 12),
      ),
      addGeom(
        darkSteel,
        boxFromBounds(
          CRANE_BOOM_X0 + 0.3,
          CRANE_GIRDER_Y1,
          frameZ - frameX * 0.32 - 0.05,
          CRANE_BOOM_X1 - 0.3,
          CRANE_GIRDER_Y1 + 0.09,
          frameZ - frameX * 0.32 + 0.05,
        ),
      ));
    let spanExtent = frameZ + frameX * 0.45,
      offsetValue = frameZ + frameX * 1.35;
    addGeom(
      galvSteel,
      boxFromBounds(
        CRANE_BOOM_X0 + 0.2,
        21.86,
        Math.min(spanExtent, offsetValue),
        CRANE_BOOM_X1 - 0.2,
        21.9,
        Math.max(spanExtent, offsetValue),
      ),
    );
    for (let offsetAlong = CRANE_BOOM_X0 + 0.6; offsetAlong < CRANE_BOOM_X1; offsetAlong += 2.45)
      (addGeom(
        greyPaint,
        beamBetween([offsetAlong, 21.84, spanExtent], [offsetAlong, 21.3, spanExtent], 0.07, 0.07),
        TINT_PANEL_DARK,
      ),
        addGeom(
          greyPaint,
          beamBetween(
            [offsetAlong, 21.82, offsetValue],
            [offsetAlong, 21.36, spanExtent],
            0.06,
            0.08,
          ),
          TINT_PANEL_DARK,
        ));
    (addRailing(
      batcher,
      yellowPaint,
      [
        [CRANE_BOOM_X0 + 0.2, 21.9, offsetValue - frameX * 0.03],
        [CRANE_BOOM_X1 - 0.2, 21.9, offsetValue - frameX * 0.03],
      ],
      {
        post: 2.45,
        tint: TINT_YELLOW,
      },
    ),
      addGeom(
        yellowPaint,
        boxFromBounds(
          CRANE_BOOM_X0 + 0.2,
          21.9,
          offsetValue - frameX * 0.03 - 0.008,
          CRANE_BOOM_X1 - 0.2,
          22.02,
          offsetValue - frameX * 0.03 + 0.008,
        ),
        TINT_YELLOW,
      ));
    for (let offsetAlong of [44, 58])
      addGeom(
        greyPaint,
        boxFromBounds(
          offsetAlong - 0.18,
          CRANE_GIRDER_Y1,
          frameZ - 0.2,
          offsetAlong + 0.18,
          CRANE_GIRDER_Y1 + 1.5,
          frameZ + 0.2,
          0.03,
        ),
        TINT_PANEL,
      );
  }
  for (let frameX of [44, 58])
    addGeom(
      greyPaint,
      boxFromBounds(
        frameX - 0.2,
        CRANE_GIRDER_Y1 + 1.2,
        -CRANE_BOOM_HALF_Z - 0.3,
        frameX + 0.2,
        CRANE_GIRDER_Y1 + 1.6,
        CRANE_BOOM_HALF_Z + 0.3,
        0.04,
      ),
      TINT_PANEL,
    );
  for (let frameX of [CRANE_BOOM_X0 + 0.25, CRANE_BOOM_X1 - 0.25]) {
    addGeom(
      greyPaint,
      boxFromBounds(
        frameX - 0.25,
        CRANE_GIRDER_Y0 + 0.1,
        -CRANE_BOOM_HALF_Z + 0.45,
        frameX + 0.25,
        CRANE_GIRDER_Y1 - 0.1,
        CRANE_BOOM_HALF_Z - 0.45,
        0.05,
      ),
      TINT_PANEL,
    );
    let frameZ = frameX < 30 ? 1 : -1;
    for (let segmentValue of [-0.8, 0.8])
      addGeom(
        darkSteel,
        cylinderFromAxis(0.14, 0.14, 0.4, 'x', frameX + frameZ * 0.45, 22, segmentValue, 10),
      );
  }
  (addGeom(
    galvSteel,
    boxFromBounds(
      CRANE_BOOM_X1 - 0.1,
      21.86,
      -CRANE_BOOM_HALF_Z - 1.35,
      CRANE_BOOM_X1 + 0.9,
      21.9,
      CRANE_BOOM_HALF_Z + 1.35,
    ),
  ),
    addRailing(
      batcher,
      yellowPaint,
      [
        [CRANE_BOOM_X1 - 0.1, 21.9, -CRANE_BOOM_HALF_Z - 1.32],
        [CRANE_BOOM_X1 + 0.87, 21.9, -CRANE_BOOM_HALF_Z - 1.32],
        [CRANE_BOOM_X1 + 0.87, 21.9, CRANE_BOOM_HALF_Z + 1.32],
        [CRANE_BOOM_X1 - 0.1, 21.9, CRANE_BOOM_HALF_Z + 1.32],
      ],
      {
        post: 1.4,
        tint: TINT_YELLOW,
      },
    ),
    addGeom(
      galvSteel,
      strutBetween([CRANE_BOOM_X1 + 0.6, 21.9, 0], [CRANE_BOOM_X1 + 0.6, 25.2, 0], 0.035, 6),
    ),
    addGeom(
      galvSteel,
      strutBetween([CRANE_BOOM_X1 + 0.6, 24.8, -0.45], [CRANE_BOOM_X1 + 0.6, 24.8, 0.45], 0.015, 4),
    ),
    lampTarget.add(
      makeBeaconGeo(CRANE_BOOM_X1 + 0.6, 25.32, 0, 0.13),
      [9, 0.5, 0.25],
      2.6,
      0.5,
      0.45,
    ),
    addGeom(darkSteel, cylinderFromAxis(0.1, 0.12, 0.1, 'y', CRANE_BOOM_X1 + 0.6, 25.2, 0, 8)));
  let apexX = 27.6,
    apexY = 30,
    apexHalfZ = 1.5;
  for (let frameX of [-1, 1]) {
    (addGeom(
      greyPaint,
      beamBetween(
        [CRANE_PORTAL_X1, 23.8, frameX * CRANE_PORTAL_HALF_Z],
        [apexX, apexY, frameX * apexHalfZ],
        0.55,
        0.55,
        0.04,
      ),
      TINT_PANEL,
    ),
      addGeom(
        greyPaint,
        beamBetween(
          [CRANE_PORTAL_X0, 23.8, frameX * CRANE_PORTAL_HALF_Z],
          [apexX, apexY, frameX * apexHalfZ],
          0.5,
          0.5,
          0.04,
        ),
        TINT_PANEL,
      ));
    for (let [frameZ, segmentValue] of [
      [44, 0.1],
      [58, 0.1],
    ]) {
      let spanExtent = newVec3(apexX + 0.3, apexY, frameX * apexHalfZ),
        offsetValue = newVec3(frameZ, CRANE_GIRDER_Y1 + 1.45, frameX * CRANE_BOOM_HALF_Z);
      addGeom(greyPaint, strutBetween(spanExtent, offsetValue, segmentValue, 8), TINT_PANEL);
      let offsetAlong = spanExtent.clone().lerp(offsetValue, 0.5);
      addGeom(
        greyPaint,
        boxFromBounds(
          offsetAlong.x - 0.3,
          offsetAlong.y - 0.16,
          offsetAlong.z - 0.14,
          offsetAlong.x + 0.3,
          offsetAlong.y + 0.16,
          offsetAlong.z + 0.14,
          0.03,
        ),
        TINT_PANEL_DARK,
      );
    }
    (addGeom(
      darkSteel,
      strutBetween(
        [apexX + 0.2, apexY + 0.35, frameX * 0.9],
        [50, CRANE_GIRDER_Y1 + 0.2, frameX * 1],
        0.022,
        5,
      ),
    ),
      addGeom(
        darkSteel,
        cylinderFromAxis(0.5, 0.5, 0.18, 'z', apexX, apexY + 0.25, frameX * 0.9, 16),
      ));
  }
  addGeom(
    greyPaint,
    boxFromBounds(
      apexX - 0.45,
      apexY - 0.35,
      -apexHalfZ - 0.5,
      apexX + 0.45,
      apexY + 0.3,
      apexHalfZ + 0.5,
      0.05,
    ),
    TINT_PANEL,
  );
  {
    let frameX = (k, ce) =>
        newVec3(
          CRANE_PORTAL_X1 + (apexX - CRANE_PORTAL_X1) * k,
          23.8 + (apexY - 23.8) * k,
          ce * (CRANE_PORTAL_HALF_Z + (apexHalfZ - CRANE_PORTAL_HALF_Z) * k),
        ),
      frameZ = (k, ce) =>
        newVec3(
          CRANE_PORTAL_X0 + (apexX - CRANE_PORTAL_X0) * k,
          23.8 + (apexY - 23.8) * k,
          ce * (CRANE_PORTAL_HALF_Z + (apexHalfZ - CRANE_PORTAL_HALF_Z) * k),
        );
    (addGeom(greyPaint, beamBetween(frameX(0.5, -1), frameX(0.5, 1), 0.3, 0.3, 0.02), TINT_PANEL),
      addGeom(
        greyPaint,
        beamBetween(frameZ(0.55, -1), frameZ(0.55, 1), 0.3, 0.3, 0.02),
        TINT_PANEL,
      ),
      addGeom(greyPaint, strutBetween(frameZ(0.55, -1), frameX(0.5, -1), 0.09, 6), TINT_PANEL),
      addGeom(greyPaint, strutBetween(frameZ(0.55, 1), frameX(0.5, 1), 0.09, 6), TINT_PANEL));
    let segmentValue = frameX(0.02, 1),
      spanExtent = frameX(0.97, 1);
    for (let offsetValue of [-0.22, 0.22])
      addGeom(
        galvSteel,
        strutBetween(
          [segmentValue.x - 0.42, segmentValue.y, segmentValue.z + offsetValue],
          [spanExtent.x - 0.42, spanExtent.y, spanExtent.z + offsetValue],
          0.02,
          4,
        ),
      );
    for (let offsetValue = 0.03; offsetValue < 1; offsetValue += 0.045) {
      let offsetAlong = segmentValue.clone().lerp(spanExtent, offsetValue);
      addGeom(
        galvSteel,
        strutBetween(
          [offsetAlong.x - 0.42, offsetAlong.y, offsetAlong.z - 0.22],
          [offsetAlong.x - 0.42, offsetAlong.y, offsetAlong.z + 0.22],
          0.012,
          4,
        ),
      );
    }
  }
  addGeom(
    greyPaint,
    boxFromBounds(
      CRANE_BOOM_X0 + 0.05,
      CRANE_GIRDER_Y1,
      -3.6,
      CRANE_BOOM_X0 + 0.55,
      CRANE_GIRDER_Y1 + 0.4,
      3.6,
      0.04,
    ),
    TINT_PANEL,
  );
  for (let frameX of [-1, 1])
    (addGeom(
      greyPaint,
      boxFromBounds(
        CRANE_BOOM_X0 + 0.08,
        CRANE_GIRDER_Y1 + 0.4,
        frameX * 3.3 - 0.2,
        CRANE_BOOM_X0 + 0.52,
        CRANE_GIRDER_Y1 + 1,
        frameX * 3.3 + 0.2,
        0.03,
      ),
      TINT_PANEL_DARK,
    ),
      addGeom(
        greyPaint,
        strutBetween(
          [apexX - 0.3, apexY, frameX * apexHalfZ],
          [CRANE_BOOM_X0 + 0.3, CRANE_GIRDER_Y1 + 0.8, frameX * 3.3],
          0.1,
          8,
        ),
        TINT_PANEL,
      ),
      addGeom(
        galvSteel,
        cylinderFromAxis(
          0.12,
          0.12,
          0.6,
          'z',
          CRANE_BOOM_X0 + 0.3,
          CRANE_GIRDER_Y1 + 0.8,
          frameX * 3.3,
          10,
        ),
      ));
  (addGeom(
    galvSteel,
    boxFromBounds(
      apexX - 1,
      apexY + 0.3,
      -apexHalfZ - 0.6,
      apexX + 1,
      apexY + 0.34,
      apexHalfZ + 0.6,
    ),
  ),
    addRailing(
      batcher,
      yellowPaint,
      [
        [apexX - 0.98, apexY + 0.34, -apexHalfZ - 0.58],
        [apexX + 0.98, apexY + 0.34, -apexHalfZ - 0.58],
        [apexX + 0.98, apexY + 0.34, apexHalfZ + 0.58],
        [apexX - 0.98, apexY + 0.34, apexHalfZ + 0.58],
        [apexX - 0.98, apexY + 0.34, -apexHalfZ - 0.58],
      ],
      {
        post: 1.2,
        tint: TINT_YELLOW,
      },
    ),
    addGeom(galvSteel, strutBetween([apexX, apexY + 0.34, 0], [apexX, apexY + 2, 0], 0.045, 6)),
    addGeom(galvSteel, strutBetween([apexX, apexY + 2, 0], [apexX, apexY + 3.6, 0], 0.016, 4)),
    addGeom(
      galvSteel,
      strutBetween([apexX - 0.5, apexY + 1.5, 0], [apexX + 0.5, apexY + 1.5, 0], 0.018, 4),
    ));
  for (let frameX of [-0.5, 0.5])
    (addGeom(darkSteel, cylinderFromAxis(0.1, 0.12, 0.1, 'y', apexX + frameX, apexY + 1.56, 0, 8)),
      lampTarget.add(
        makeBeaconGeo(apexX + frameX, apexY + 1.72, 0, 0.15),
        [10, 0.5, 0.25],
        2.6,
        0,
        0.45,
      ));
  let houseX0 = 20.4,
    houseX1 = 27.9,
    houseY0 = CRANE_GIRDER_Y1,
    houseY1 = 26,
    houseHalfZ = 2.9;
  (addGeom(
    whitePaint,
    boxFromBounds(houseX0, houseY0, -houseHalfZ, houseX1, houseY1, houseHalfZ, 0.06),
    TINT_WHITE,
  ),
    addGeom(
      greyPaint,
      boxFromBounds(
        houseX0 - 0.15,
        houseY0 - 0.12,
        -houseHalfZ - 0.15,
        houseX1 + 0.15,
        houseY0 + 0.1,
        houseHalfZ + 0.15,
        0.03,
      ),
      TINT_PANEL_DARK,
    ),
    addGeom(
      galvSteel,
      boxFromBounds(
        houseX0 - 0.2,
        houseY1,
        -houseHalfZ - 0.2,
        houseX1 + 0.2,
        houseY1 + 0.12,
        houseHalfZ + 0.2,
        0.03,
      ),
    ));
  for (let frameX = houseX0 + 1.3; frameX < houseX1; frameX += 1.3)
    for (let frameZ of [-1, 1])
      addGeom(
        whitePaint,
        boxFromBounds(
          frameX - 0.02,
          houseY0 + 0.1,
          frameZ * houseHalfZ - 0.015,
          frameX + 0.02,
          houseY1,
          frameZ * houseHalfZ + 0.015,
        ),
        [0.7, 0.72, 0.74],
      );
  function addRollerDoor(R, I, se, ae, k, ce) {
    let ve = [boxFromBounds(-ae / 2, -k / 2, 0, ae / 2, k / 2, 0.02)],
      _e = Math.round(k / 0.12);
    for (let Te = 0; Te < _e; Te++) {
      let Pe = boxFromBounds(-ae / 2 + 0.03, -0.012, 0, ae / 2 - 0.03, 0.012, 0.11);
      (Pe.rotateX(0.7), Pe.translate(0, -k / 2 + (Te + 0.5) * (k / _e), 0.03), ve.push(Pe));
    }
    for (let Te of ve) (Te.rotateY(ce), Te.translate(R, I, se));
    (addGeom(darkSteel, ve.shift()), addGeom(galvSteel, ve));
  }
  for (let frameX of [-1, 1])
    for (let frameZ of [houseX0 + 1.4, houseX0 + 3.9, houseX0 + 6.1])
      addRollerDoor(
        frameZ,
        24.5,
        frameX * (houseHalfZ + 0.005),
        1.5,
        1.3,
        frameX > 0 ? 0 : Math.PI,
      );
  (addRollerDoor(houseX0 - 0.005, 23.75, -1.9, 1.4, 1.1, -Math.PI / 2),
    addGeom(
      whitePaint,
      boxFromBounds(houseX0 - 0.03, houseY0 + 0.15, 0.8, houseX0, houseY0 + 2.15, 1.7, 0.01),
      [0.6, 0.64, 0.68],
    ),
    addGeom(
      galvSteel,
      strutBetween(
        [houseX0 - 0.06, houseY0 + 1, 1.55],
        [houseX0 - 0.06, houseY0 + 1.3, 1.55],
        0.014,
        5,
      ),
    ),
    addGeom(
      galvSteel,
      boxFromBounds(houseX0 - 0.9, houseY0 + 0.05, 0.3, houseX0, houseY0 + 0.1, 2.2),
    ),
    addRailing(
      batcher,
      yellowPaint,
      [
        [houseX0, houseY0 + 0.1, 0.32],
        [houseX0 - 0.88, houseY0 + 0.1, 0.32],
        [houseX0 - 0.88, houseY0 + 0.1, 2.18],
        [houseX0, houseY0 + 0.1, 2.18],
      ],
      {
        post: 1,
        tint: TINT_YELLOW,
      },
    ));
  let logoADecal = ctx.mats.decal('logo_a');
  (addGeom(
    logoADecal.material,
    planeAt(1.1 * Math.min(3, logoADecal.aspect || 1), 1.1, houseX0 - 0.012, 25.2, 0, -Math.PI / 2),
  ),
    addRailing(
      batcher,
      yellowPaint,
      [
        [houseX0, houseY1 + 0.12, -houseHalfZ],
        [houseX1, houseY1 + 0.12, -houseHalfZ],
        [houseX1, houseY1 + 0.12, houseHalfZ],
        [houseX0, houseY1 + 0.12, houseHalfZ],
        [houseX0, houseY1 + 0.12, -houseHalfZ],
      ],
      {
        post: 1.95,
        tint: TINT_YELLOW,
      },
    ));
  for (let frameX of [houseX0 + 1.9, houseX0 + 5.6])
    (addGeom(galvSteel, cylinderFromAxis(0.28, 0.28, 0.5, 'y', frameX, houseY1 + 0.37, -1.2, 10)),
      addGeom(galvSteel, cylinderFromAxis(0.1, 0.5, 0.22, 'y', frameX, houseY1 + 0.72, -1.2, 10)));
  (addGeom(darkSteel, cylinderFromAxis(0.13, 0.13, 1.6, 'y', houseX0 + 3.7, houseY1 + 0.9, 1.9, 8)),
    addGeom(
      darkSteel,
      cylinderFromAxis(0.2, 0.14, 0.2, 'y', houseX0 + 3.7, houseY1 + 1.75, 1.9, 8),
    ),
    addGeom(
      whitePaint,
      boxFromBounds(houseX0 + 5.4, houseY1 + 0.12, 0.4, houseX0 + 6.7, houseY1 + 0.85, 1.8, 0.03),
      [0.7, 0.72, 0.75],
    ),
    addGeom(
      galvSteel,
      strutBetween(
        [houseX0 + 0.3, houseY1 + 0.12, 2.5],
        [houseX0 + 0.3, houseY1 + 1.9, 2.5],
        0.03,
        5,
      ),
    ),
    lampTarget.add(
      makeBeaconGeo(houseX0 + 0.3, houseY1 + 2.02, 2.5, 0.13),
      [9, 0.5, 0.25],
      2.6,
      0.25,
      0.45,
    ));
  let stairZ0 = 6.15,
    stairZ1 = 6.97,
    stairZ2 = 7.8,
    stairX0 = [19.4, 20.6],
    stairX1 = [26.4, 27.6];
  function addStairFlight(R, I, se, ae, k, ce) {
    let ve = ae - I,
      _e = Math.max(2, Math.round(ve / 0.21));
    for (let Te of [k + 0.03, ce - 0.03]) {
      (addGeom(galvSteel, beamBetween([R, I - 0.12, Te], [se, ae - 0.12, Te], 0.05, 0.24)),
        addGeom(yellowPaint, strutBetween([R, I + 1, Te], [se, ae + 1, Te], 0.024, 5), TINT_YELLOW),
        addGeom(
          yellowPaint,
          strutBetween([R, I + 0.5, Te], [se, ae + 0.5, Te], 0.018, 4),
          TINT_YELLOW,
        ));
      for (let Pe = 0; Pe <= 4; Pe++) {
        let Re = Pe / 4,
          Fe = R + (se - R) * Re,
          ze = I + ve * Re;
        addGeom(
          yellowPaint,
          strutBetween([Fe, ze - 0.05, Te], [Fe, ze + 1, Te], 0.02, 4),
          TINT_YELLOW,
        );
      }
    }
    for (let Te = 1; Te <= _e; Te++) {
      let Pe = (Te - 0.5) / _e,
        Re = R + (se - R) * Pe,
        Fe = I + ve * (Te / _e);
      addGeom(galvSteel, boxFromBounds(Re - 0.13, Fe - 0.03, k + 0.06, Re + 0.13, Fe, ce - 0.06));
    }
  }
  function addStairLanding(R, I, se, ae) {
    (addGeom(galvSteel, boxFromBounds(R, se - 0.05, stairZ0, I, se, stairZ2)),
      addGeom(galvSteel, boxFromBounds(R, se - 0.2, stairZ0, I, se - 0.05, stairZ0 + 0.06)),
      addGeom(galvSteel, boxFromBounds(R, se - 0.2, stairZ2 - 0.06, I, se - 0.05, stairZ2)));
    let k = ae > 0 ? I - 0.03 : R + 0.03,
      ce = ae > 0 ? R : I;
    addRailing(
      batcher,
      yellowPaint,
      [
        [ce, se, stairZ2 - 0.03],
        [k, se, stairZ2 - 0.03],
        [k, se, stairZ0 + 0.03],
      ],
      {
        post: 0.9,
        tint: TINT_YELLOW,
      },
    );
  }
  let landingYs = [3.6, 6.9, 10.2, 13.5, 16.8, 20.1];
  for (let frameX = 0; frameX < 5; frameX++)
    frameX % 2 === 0
      ? (addStairLanding(stairX0[0], stairX0[1], landingYs[frameX], -1),
        addStairFlight(
          stairX0[1],
          landingYs[frameX],
          stairX1[0],
          landingYs[frameX + 1],
          stairZ0,
          stairZ1,
        ))
      : (addStairLanding(stairX1[0], stairX1[1], landingYs[frameX], 1),
        addStairFlight(
          stairX1[0],
          landingYs[frameX],
          stairX0[1],
          landingYs[frameX + 1],
          stairZ1,
          stairZ2,
        ));
  (addStairLanding(stairX1[0], stairX1[1], landingYs[5], 1),
    addStairFlight(stairX1[0], landingYs[5], 23.4, 21.9, stairZ1, stairZ2),
    addGeom(galvSteel, boxFromBounds(22.5, 21.85, CRANE_BOOM_HALF_Z + 1.35, 23.4, 21.9, stairZ2)),
    addRailing(
      batcher,
      yellowPaint,
      [
        [22.53, 21.9, CRANE_BOOM_HALF_Z + 1.4],
        [22.53, 21.9, stairZ2 - 0.03],
        [23.37, 21.9, stairZ2 - 0.03],
      ],
      {
        post: 1.3,
        tint: TINT_YELLOW,
      },
    ),
    addRailing(
      batcher,
      yellowPaint,
      [
        [23.37, 21.9, CRANE_BOOM_HALF_Z + 1.4],
        [23.37, 21.9, stairZ1],
      ],
      {
        post: 1.3,
        tint: TINT_YELLOW,
      },
    ),
    addGeom(galvSteel, boxFromBounds(stairX1[0], 13.45, 4.95, stairX1[1], 13.5, stairZ0)));
  for (let frameX of [stairX0[0], stairX1[1]])
    for (let frameZ of [stairZ0 - 0.05, stairZ2 + 0.05])
      addGeom(
        greyPaint,
        boxFromBounds(frameX - 0.07, 3.3, frameZ - 0.07, frameX + 0.07, 21.4, frameZ + 0.07),
        TINT_PANEL,
      );
  for (let frameX = 0; frameX < landingYs.length; frameX++) {
    let frameZ = landingYs[frameX] - 0.25;
    addGeom(
      greyPaint,
      boxFromBounds(
        stairX0[0],
        frameZ - 0.06,
        stairZ2 + 0,
        stairX1[1],
        frameZ + 0.06,
        stairZ2 + 0.1,
      ),
      TINT_PANEL_DARK,
    );
    for (let segmentValue of [stairX0[0], stairX1[1]])
      addGeom(
        greyPaint,
        boxFromBounds(
          segmentValue - 0.05,
          frameZ - 0.06,
          5.9,
          segmentValue + 0.05,
          frameZ + 0.06,
          stairZ2 + 0.1,
        ),
        TINT_PANEL_DARK,
      );
    if (frameX < landingYs.length - 1) {
      let segmentValue = landingYs[frameX + 1] - 0.25;
      (addGeom(
        greyPaint,
        strutBetween(
          [stairX0[0], frameZ, stairZ2 + 0.05],
          [stairX1[1], segmentValue, stairZ2 + 0.05],
          0.03,
          5,
        ),
        TINT_PANEL,
      ),
        addGeom(
          greyPaint,
          strutBetween(
            [stairX1[1], frameZ, stairZ2 + 0.05],
            [stairX0[0], segmentValue, stairZ2 + 0.05],
            0.03,
            5,
          ),
          TINT_PANEL,
        ));
    }
  }
  {
    let frameX = stairX0[0] - 0.05,
      frameZ = 7.35;
    for (let spanExtent of [-0.22, 0.22])
      addGeom(
        galvSteel,
        strutBetween(
          [frameX, 0.05, frameZ + spanExtent],
          [frameX, 4.75, frameZ + spanExtent],
          0.022,
          5,
        ),
      );
    for (let spanExtent = 0.3; spanExtent < 4.7; spanExtent += 0.3)
      addGeom(
        galvSteel,
        strutBetween(
          [frameX, spanExtent, frameZ - 0.22],
          [frameX, spanExtent, frameZ + 0.22],
          0.012,
          4,
        ),
      );
    let segmentValue = (ae) => {
      let k = [];
      for (let ce = 0; ce <= 8; ce++) {
        let ve = (Math.PI * ce) / 8;
        k.push(newVec3(frameX - Math.sin(ve) * 0.7, ae, frameZ - Math.cos(ve) * 0.36));
      }
      return k;
    };
    for (let spanExtent = 2.3; spanExtent <= 4.75; spanExtent += 0.6)
      addGeom(galvSteel, strutsAlongPath(segmentValue(spanExtent), 0.012, 4));
    for (let spanExtent = 1; spanExtent < 8; spanExtent += 1.5) {
      let offsetValue = (Math.PI * spanExtent) / 8;
      addGeom(
        galvSteel,
        strutBetween(
          [frameX - Math.sin(offsetValue) * 0.7, 2.3, frameZ - Math.cos(offsetValue) * 0.36],
          [frameX - Math.sin(offsetValue) * 0.7, 4.75, frameZ - Math.cos(offsetValue) * 0.36],
          0.01,
          4,
        ),
      );
    }
    colliders.push({
      min: [frameX - 0.72, 0, frameZ - 0.4],
      max: [frameX + 0.05, 4.7, frameZ + 0.4],
      bulletOnly: !1,
    });
  }
  addGeom(
    darkSteel,
    boxFromBounds(
      13,
      21.02,
      -CRANE_BOOM_HALF_Z - 0.95,
      CRANE_HOUSE_X - 1.2,
      21.12,
      -CRANE_BOOM_HALF_Z - 0.85,
    ),
  );
  for (let frameX = 13.5; frameX < CRANE_HOUSE_X - 1.2; frameX += 3.3)
    addGeom(
      darkSteel,
      boxFromBounds(
        frameX - 0.03,
        21.1,
        -CRANE_BOOM_HALF_Z - 0.93,
        frameX + 0.03,
        21.86,
        -CRANE_BOOM_HALF_Z - 0.87,
      ),
    );
  {
    let segmentValue = (CRANE_HOUSE_X - 1.6 - 13.6) / 15;
    for (let spanExtent = 0; spanExtent < 15; spanExtent++) {
      let offsetValue = 13.6 + spanExtent * segmentValue,
        offsetAlong = 1.1 + 0.25 * Math.sin(spanExtent * 2.1);
      addGeom(
        darkSteel,
        boxFromBounds(
          offsetValue - 0.1,
          20.9,
          -CRANE_BOOM_HALF_Z - 0.98,
          offsetValue + 0.1,
          21.02,
          -CRANE_BOOM_HALF_Z - 0.82,
        ),
      );
      for (let geometryList of [-0.05, 0.05]) {
        let segmentCount = [];
        for (let slatIndex = 0; slatIndex <= 7; slatIndex++) {
          let segmentIndex = slatIndex / 7;
          segmentCount.push(
            newVec3(
              offsetValue + segmentValue * segmentIndex,
              20.92 - offsetAlong * (1 - (2 * segmentIndex - 1) ** 2),
              -CRANE_BOOM_HALF_Z - 0.9 + geometryList,
            ),
          );
        }
        addGeom(darkSteel, strutsAlongPath(segmentCount, 0.03, 4));
      }
    }
  }
  function addLampBar(R, I, se, ae, k = 'z') {
    let ce = ae * 0.46;
    k === 'z'
      ? addGeom(darkSteel, boxFromBounds(R - 0.03, I, se - ce / 2, R + 0.03, I + 0.06, se + ce / 2))
      : addGeom(
          darkSteel,
          boxFromBounds(R - ce / 2, I, se - 0.03, R + ce / 2, I + 0.06, se + 0.03),
        );
    for (let ve = 0; ve < ae; ve++) {
      let _e = (ve - (ae - 1) / 2) * 0.46,
        Te = k === 'z' ? R : R + _e,
        Pe = k === 'z' ? se + _e : se;
      (addGeom(
        darkSteel,
        boxFromBounds(Te - 0.17, I - 0.2, Pe - 0.17, Te + 0.17, I, Pe + 0.17, 0.02),
      ),
        addGeom(
          lampMat,
          boxFromBounds(Te - 0.14, I - 0.215, Pe - 0.14, Te + 0.14, I - 0.2, Pe + 0.14),
        ));
    }
  }
  for (let frameX of [33, 47.5, 59.5])
    for (let frameZ of [-1, 1])
      addLampBar(frameX, 21.3, frameZ * (CRANE_BOOM_HALF_Z + 1.3), 3, 'x');
  for (let frameX of [-1, 1])
    (addLampBar(23.5, 12.28, frameX * (CRANE_PORTAL_HALF_Z - 0.2), 4, 'x'),
      addLampBar(15, 21.3, frameX * (CRANE_BOOM_HALF_Z + 1.3), 2, 'x'));
  (addLampBar(CRANE_PORTAL_X1 + 0.1, 12.28, 0, 3, 'z'),
    addLampBar(CRANE_PORTAL_X0 - 0.1, 12.28, 0, 3, 'z'),
    addLampBar(apexX + 0.6, apexY - 0.55, 0, 3, 'z'),
    addGeom(
      yellowPaint,
      boxFromBounds(CRANE_HOUSE_X - 2.3, 21.35, -1.25, CRANE_HOUSE_X + 2.3, 22.2, 1.25, 0.06),
      TINT_YELLOW,
    ),
    addGeom(
      yellowPaint,
      boxFromBounds(CRANE_HOUSE_X - 1.6, 20.7, -1.1, CRANE_HOUSE_X + 1.6, 21.35, 1.1, 0.05),
      TINT_YELLOW,
    ));
  for (let frameX of [-1.8, 1.8])
    for (let frameZ of [-1, 1])
      (addGeom(
        darkSteel,
        cylinderFromAxis(0.24, 0.24, 0.16, 'z', CRANE_HOUSE_X + frameX, 22.42, frameZ * 1.3, 12),
      ),
        addGeom(
          yellowPaint,
          boxFromBounds(
            CRANE_HOUSE_X + frameX - 0.35,
            22.1,
            frameZ * 1.3 - 0.14,
            CRANE_HOUSE_X + frameX + 0.35,
            22.5,
            frameZ * 1.3 + 0.14,
            0.03,
          ),
          TINT_YELLOW,
        ));
  (addGeom(darkSteel, cylinderFromAxis(0.42, 0.42, 1.5, 'z', CRANE_HOUSE_X - 0.9, 22.35, 0, 14)),
    addGeom(darkSteel, cylinderFromAxis(0.42, 0.42, 1.5, 'z', CRANE_HOUSE_X + 0.9, 22.35, 0, 14)));
  let cabX0 = CRANE_HOUSE_X + 0.25,
    cabX1 = CRANE_HOUSE_X + 2.65,
    cabZ0 = 2.35,
    cabZ1 = 4.4,
    cabY0 = 18.3,
    cabY1 = 20.7;
  for (let frameX of [cabX0 + 0.12, cabX1 - 0.3]) {
    addGeom(
      yellowPaint,
      boxFromBounds(frameX - 0.12, 20.88, -1, frameX + 0.12, 21.16, cabZ1, 0.03),
      TINT_YELLOW,
    );
    for (let frameZ of [cabZ0 + 0.1, cabZ1 - 0.1])
      addGeom(
        yellowPaint,
        boxFromBounds(frameX - 0.06, cabY1, frameZ - 0.06, frameX + 0.06, 20.9, frameZ + 0.06),
        TINT_YELLOW,
      );
  }
  (addGeom(
    whitePaint,
    boxFromBounds(cabX0, cabY0, cabZ0, cabX1, cabY0 + 0.14, cabZ1, 0.03),
    TINT_WHITE,
  ),
    addGeom(
      whitePaint,
      boxFromBounds(
        cabX0 - 0.08,
        cabY1 - 0.02,
        cabZ0 - 0.08,
        cabX1 + 0.12,
        cabY1 + 0.12,
        cabZ1 + 0.08,
        0.03,
      ),
      TINT_WHITE,
    ),
    addGeom(
      whitePaint,
      boxFromBounds(cabX0, cabY0 + 0.14, cabZ0, cabX0 + 0.08, cabY1, cabZ1),
      TINT_WHITE,
    ));
  for (let frameX of [cabZ0, cabZ1 - 0.06])
    (addGeom(
      whitePaint,
      boxFromBounds(cabX0, cabY0 + 0.14, frameX, cabX1 - 0.5, cabY0 + 0.95, frameX + 0.06),
      TINT_WHITE,
    ),
      addGeom(
        glassMat,
        boxFromBounds(
          cabX0 + 0.08,
          cabY0 + 0.95,
          frameX + 0.02,
          cabX1 - 0.06,
          cabY1,
          frameX + 0.04,
        ),
      ),
      addGeom(
        glassMat,
        boxFromBounds(
          cabX1 - 0.5,
          cabY0 + 0.14,
          frameX + 0.02,
          cabX1 - 0.06,
          cabY0 + 0.95,
          frameX + 0.04,
        ),
      ));
  for (let frameX of [cabX1 - 0.06])
    for (let frameZ of [cabZ0, cabZ1 - 0.06, (cabZ0 + cabZ1) / 2 - 0.03])
      addGeom(
        whitePaint,
        boxFromBounds(frameX, cabY0 + 0.14, frameZ, frameX + 0.06, cabY1, frameZ + 0.06),
        TINT_WHITE,
      );
  (addGeom(
    glassMat,
    boxFromBounds(cabX1 - 0.04, cabY0 + 0.14, cabZ0 + 0.06, cabX1 - 0.02, cabY1, cabZ1 - 0.06),
  ),
    addGeom(
      glassMat,
      boxFromBounds(cabX1 - 0.9, cabY0 + 0.02, cabZ0 + 0.3, cabX1 - 0.1, cabY0 + 0.04, cabZ1 - 0.3),
    ),
    addGeom(
      darkSteel,
      boxFromBounds(cabX0 + 0.9, cabY0 + 0.14, 3.1, cabX0 + 1.45, cabY0 + 0.6, 3.65, 0.04),
    ),
    addGeom(
      darkSteel,
      boxFromBounds(cabX0 + 0.82, cabY0 + 0.6, 3.1, cabX0 + 0.96, cabY0 + 1.35, 3.65, 0.04),
    ));
  for (let frameX of [2.75, 4])
    (addGeom(
      darkSteel,
      boxFromBounds(
        cabX0 + 1.2,
        cabY0 + 0.14,
        frameX - 0.16,
        cabX0 + 1.75,
        cabY0 + 0.85,
        frameX + 0.16,
        0.03,
      ),
    ),
      lampTarget.add(
        boxFromBounds(
          cabX0 + 1.3,
          cabY0 + 0.855,
          frameX - 0.1,
          cabX0 + 1.6,
          cabY0 + 0.865,
          frameX + 0.1,
        ),
        [0.75, 0.5, 0.26],
        0,
      ));
  (lampTarget.add(
    boxFromBounds(cabX0 + 0.5, cabY1 - 0.045, 3, cabX0 + 1.5, cabY1 - 0.03, 3.2),
    [0.75, 0.5, 0.26],
    0,
  ),
    addLampBar(cabX1 + 0.15, cabY0 + 0.1, 3.37, 2, 'z'),
    addGeom(galvSteel, boxFromBounds(cabX0 - 0.9, cabY0 + 0.1, cabZ0, cabX0, cabY0 + 0.14, cabZ1)),
    addRailing(
      batcher,
      yellowPaint,
      [
        [cabX0, cabY0 + 0.14, cabZ0 + 0.03],
        [cabX0 - 0.87, cabY0 + 0.14, cabZ0 + 0.03],
        [cabX0 - 0.87, cabY0 + 0.14, cabZ1 - 0.03],
        [cabX0, cabY0 + 0.14, cabZ1 - 0.03],
      ],
      {
        post: 1,
        tint: TINT_YELLOW,
      },
    ));
  let nameLabel = ctx.mats.label('SALTLINE 04', {
      color: 'white',
      font: 'stencil',
      distress: 0.35,
    }),
    labelAspect = Math.max(1, nameLabel.aspect || 6);
  {
    let frameX = Math.min(1.15, 8.6 / labelAspect);
    for (let frameZ of [-1, 1])
      addGeom(
        nameLabel.material,
        planeAt(
          frameX * labelAspect,
          frameX,
          36.9,
          22,
          frameZ * (CRANE_BOOM_HALF_Z + 0.453),
          frameZ > 0 ? 0 : Math.PI,
        ),
      );
  }
  {
    let frameX = Math.min(0.86, 9.4 / labelAspect);
    addGeom(
      nameLabel.material,
      planeAt(frameX * labelAspect, frameX, CRANE_PORTAL_X0 - 0.453, 13, 0, -Math.PI / 2),
    );
  }
  if (intoBatch) return ((batcher.remap = null), (batcher.dz = 0), (batcher.minSize = 0), null);
  let craneMesh = batcher.build({
    cast: !0,
    recv: !0,
  });
  craneMesh.name = 'crane';
  let spreaderBatch = new MeshBatcher(),
    addSpreaderGeom = (R, I, se) => spreaderBatch.add(R, I, se),
    spreaderDrop = 8.3;
  for (let frameX of [-0.9, 0.9])
    for (let frameZ of [-0.8, 0.8])
      addSpreaderGeom(
        darkSteel,
        strutBetween([frameX, 0, frameZ], [frameX * 0.8, -spreaderDrop, frameZ * 0.7], 0.022, 5),
      );
  addSpreaderGeom(
    yellowPaint,
    boxFromBounds(-0.95, -spreaderDrop - 0.55, -0.75, 0.95, -spreaderDrop, 0.75, 0.05),
    TINT_YELLOW,
  );
  for (let frameX of [-0.45, 0.45])
    addSpreaderGeom(
      darkSteel,
      cylinderFromAxis(0.3, 0.3, 0.12, 'z', 0, -spreaderDrop + 0.12, frameX, 12),
    );
  let spreaderTopY = -spreaderDrop - 0.55,
    spreaderUpperY = spreaderTopY - 0.34;
  for (let frameX of [-0.6, 0.6])
    addSpreaderGeom(
      yellowPaint,
      boxFromBounds(frameX - 0.16, spreaderUpperY, -6.02, frameX + 0.16, spreaderTopY, 6.02, 0.03),
      TINT_YELLOW,
    );
  for (let frameX of [-5.92, 5.92])
    addSpreaderGeom(
      yellowPaint,
      boxFromBounds(-1.22, spreaderUpperY, frameX - 0.14, 1.22, spreaderTopY, frameX + 0.14, 0.03),
      TINT_YELLOW,
    );
  addSpreaderGeom(
    yellowPaint,
    boxFromBounds(-0.9, spreaderUpperY - 0.02, -1.3, 0.9, spreaderTopY + 0.1, 1.3, 0.04),
    TINT_YELLOW,
  );
  for (let frameX of [-1.2, 1.2])
    for (let frameZ of [-6, 6])
      (addSpreaderGeom(
        darkSteel,
        boxFromBounds(
          frameX - 0.1,
          spreaderUpperY - 0.1,
          frameZ - 0.1,
          frameX + 0.1,
          spreaderUpperY + 0.05,
          frameZ + 0.1,
        ),
      ),
        addSpreaderGeom(
          yellowPaint,
          beamBetween(
            [frameX * 1.02, spreaderUpperY, frameZ * 1.01],
            [frameX * 1.22, spreaderUpperY - 0.55, frameZ * 1.04],
            0.28,
            0.03,
          ),
          TINT_YELLOW,
        ));
  let spreaderLowerY = spreaderUpperY - 0.08,
    spreaderFloorY = spreaderLowerY - 2.59,
    spreaderTint = [0.9, 0.82, 0.8];
  addSpreaderGeom(
    redPaint,
    boxFromBounds(-1.2, spreaderFloorY, -6.08, 1.2, spreaderLowerY, 6.08, 0.03),
    spreaderTint,
  );
  for (let frameX of [-1.22, 1.22])
    for (let frameZ = -5.7; frameZ <= 5.71; frameZ += 0.57)
      addSpreaderGeom(
        redPaint,
        boxFromBounds(
          frameX - 0.02,
          spreaderFloorY + 0.16,
          frameZ - 0.1,
          frameX + 0.02,
          spreaderLowerY - 0.12,
          frameZ + 0.1,
        ),
        spreaderTint,
      );
  for (let frameX of [-6.095, 6.095])
    for (let frameZ of [-1.22, 1.22])
      addSpreaderGeom(
        redPaint,
        boxFromBounds(
          frameZ - 0.08,
          spreaderFloorY,
          frameX - 0.08,
          frameZ + 0.08,
          spreaderLowerY,
          frameX + 0.08,
        ),
        [0.7, 0.62, 0.6],
      );
  for (let frameX of [-0.8, -0.3, 0.3, 0.8])
    addSpreaderGeom(
      darkSteel,
      strutBetween(
        [frameX, spreaderFloorY + 0.08, 6.1],
        [frameX, spreaderLowerY - 0.08, 6.1],
        0.02,
        5,
      ),
    );
  let spreaderMesh = spreaderBatch.build({
    cast: !0,
    recv: !0,
  });
  return (
    spreaderMesh.position.set(CRANE_HOUSE_X, 20.7, 0),
    (spreaderMesh.userData.noMerge = !0),
    (spreaderMesh.name = 'crane-spreader'),
    craneMesh.add(spreaderMesh),
    {
      root: craneMesh,
      spreader: spreaderMesh,
      colliders: colliders,
      tris: batcher.tris + spreaderBatch.tris,
    }
  );
}

/**
 * 极简版门式起重机剪影（只有箱型轮廓，无细节），用缩放与朝向做成远处集装箱码头的成排岸桥，返回臂架端高度以便挂障碍灯
 */
export function buildDistantCrane(
  batcher,
  mat,
  baseX,
  baseZ,
  { s: scale = 1, up: boomUp = !1, tint = [0.3, 0.36, 0.44] } = {},
) {
  let partList = [],
    addBox = (c, u, h, f, p, d) => partList.push(boxFromBounds(c, u, h, f, p, d));
  for (let minX of [-5, 5])
    for (let minY of [-5.4, 5.4]) addBox(minX - 0.6, 0, minY - 0.6, minX + 0.6, 24, minY + 0.6);
  for (let minX of [-5.4, 5.4])
    (addBox(-5, 12.5, minX - 0.45, 5, 13.5, minX + 0.45),
      addBox(-5, 23, minX - 0.4, 5, 23.8, minX + 0.4),
      partList.push(beamBetween([-5, 13.5, minX], [5, 23, minX], 0.4, 0.4)));
  for (let minX of [-5, 5])
    (addBox(minX - 0.45, 12.5, -5.4, minX + 0.45, 13.5, 5.4),
      addBox(minX - 0.45, 22.8, -5.4, minX + 0.45, 23.8, 5.4),
      addBox(minX - 0.45, 3.6, -5.4, minX + 0.45, 4.6, 5.4));
  (addBox(-11.5, 21.2, -2.3, 6.3, 22.8, 2.3), addBox(-10.9, 22.8, -2.9, -3.1, 26, 2.9));
  for (let minX of [-1, 1])
    (partList.push(beamBetween([5, 23.8, minX * 5.4], [4.1, 30, minX * 1.5], 0.6, 0.6)),
      partList.push(beamBetween([-5, 23.8, minX * 5.4], [4.1, 30, minX * 1.5], 0.5, 0.5)));
  (addBox(3.6, 29.6, -2, 4.6, 30.4, 2),
    boomUp
      ? (partList.push(beamBetween([6.6, 22, 0], [10.5, 52, 0], 4.6, 1.6)),
        partList.push(beamBetween([4.1, 30, 0], [9.4, 44, 0], 0.3, 0.3)))
      : (addBox(6.6, 21.2, -2.3, 38.5, 22.8, 2.3),
        partList.push(beamBetween([4.1, 30, 0], [20.5, 24.3, 0], 0.3, 0.3)),
        partList.push(beamBetween([4.1, 30, 0], [34.5, 24.3, 0], 0.3, 0.3)),
        addBox(15, 18.3, 2.4, 19.5, 22.2, 4.4)));
  for (let minX of partList)
    (minX.scale(scale, scale, scale),
      minX.translate(baseX, 0, baseZ),
      batcher.add(mat, minX, tint));
  return boomUp
    ? [baseX + 10.5 * scale, 52.6 * scale, baseZ]
    : [baseX + 4.1 * scale, 31 * scale, baseZ];
}
