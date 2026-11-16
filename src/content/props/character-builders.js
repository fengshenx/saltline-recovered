// content/props/character-builders.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  HALF_PI,
  boxGeometry,
  createPlaneGeometryOffsetUVAlt,
  createRibbonFromPolyline,
  flipGeometryWinding,
  mapVertices,
  removeGeometryGroup,
  tubeGeometry,
} from '../../assets/procedural/geometry.js';

import { clampValue } from '../../audio/audio.js';

import { createSandbagGeometry, smoothstepRangeAlt2 } from './basic-builders.js';

import {
  PropAssembler,
  recomputeSmoothNormals,
  roundedBoxGeometry,
  roundedBoxGeometryGrid,
} from './detail-geometry.js';

import { addEuroPallet } from './detailed-builders.js';

import { PI_TWO, valueNoise3D } from '../../core/math.js';

/**
 * 盖篷布的托盘货垛：托盘上四块高低不一的木箱把篷布顶成起伏曲面，篷布网格带褶皱/雨积水噪声、四周垂边与压绳，边角挂钢扣
 */
function buildTarpCargo(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'tarp_cargo', opts.seed || 0),
    rand = assembler.rng,
    noiseSeed = assembler.seed * 1.7,
    palletHeight = 0.144,
    loadBlocks = [
      [-1.06, -0.12, -0.58, 0.58, rand.range(0.98, 1.12)],
      [-0.06, 1.06, -0.58, 0.12, rand.range(1.32, 1.42)],
      [0.02, 0.62, 0.16, 0.58, rand.range(0.72, 0.86)],
      [0.66, 1.06, 0.18, 0.56, rand.range(0.5, 0.62)],
    ];
  for (let gridRow of [-0.6, 0.6])
    (assembler.push({
      p: [gridRow, 0, 0],
      r: [0, 0, 0],
    }),
      addEuroPallet(assembler, rand, {
        stamp: !1,
      }),
      assembler.pop());
  for (let gridRow of loadBlocks) {
    let gridCol = gridRow[1] - gridRow[0],
      cellIndex = gridRow[3] - gridRow[2],
      cellId = gridRow[4] - palletHeight,
      gridCursor = (gridRow[0] + gridRow[1]) / 2,
      vertexId = (gridRow[2] + gridRow[3]) / 2,
      basePointX = rand.range(0.7, 0.95);
    (assembler.add(
      'wood_pallet',
      roundedBoxGeometry(gridCol, cellId, cellIndex, 0.006),
      {
        p: [gridCursor, palletHeight + cellId / 2, vertexId],
      },
      [basePointX, basePointX * 0.95, basePointX * 0.88],
    ),
      assembler.add(
        'wood_pallet',
        boxGeometry(gridCol + 0.012, 0.07, cellIndex + 0.012),
        {
          p: [gridCursor, palletHeight + 0.04, vertexId],
        },
        basePointX * 0.75,
      ));
  }
  let uvScale = 1.9,
    gridX = 22,
    gridZ = 14,
    minX = -1.125,
    maxX = 1.125,
    minZ = -0.645,
    maxZ = 0.645,
    skirtSteps = 5,
    tarpHeightAt = (N, Q) => {
      let K = 0.3;
      for (let ie of loadBlocks) {
        let F = Math.max(ie[0] - N, 0, N - ie[1]),
          X = Math.max(ie[2] - Q, 0, Q - ie[3]),
          ne = Math.hypot(F, X);
        K = Math.max(K, ie[4] - 0.95 * ne - 0.9 * ne * ne);
      }
      return (
        K +
        0.016 +
        0.022 * valueNoise3D(N * 5 + noiseSeed, Q * 5) +
        0.008 * Math.sin(N * 23 + Q * 7 + noiseSeed) +
        0.006 * Math.sin(Q * 31 - N * 5)
      );
    },
    positions = [],
    uvs = [],
    indices = [],
    gridIndex = (N, Q) => Q * (gridX + 1) + N;
  for (let gridRow = 0; gridRow <= gridZ; gridRow++)
    for (let gridCol = 0; gridCol <= gridX; gridCol++) {
      let cellIndex = minX + ((maxX - minX) * gridCol) / gridX,
        cellId = minZ + ((maxZ - minZ) * gridRow) / gridZ;
      (positions.push(cellIndex, tarpHeightAt(cellIndex, cellId), cellId),
        uvs.push(cellIndex * uvScale, cellId * uvScale));
    }
  for (let gridRow = 0; gridRow < gridZ; gridRow++)
    for (let gridCol = 0; gridCol < gridX; gridCol++) {
      let cellIndex = gridIndex(gridCol, gridRow),
        cellId = gridIndex(gridCol + 1, gridRow),
        gridCursor = gridIndex(gridCol + 1, gridRow + 1),
        vertexId = gridIndex(gridCol, gridRow + 1);
      indices.push(cellIndex, vertexId, cellId, cellId, vertexId, gridCursor);
    }
  let perimeterLoop = [];
  for (let gridRow = 0; gridRow < gridX; gridRow++) perimeterLoop.push([gridRow, 0, 0, -1]);
  for (let gridRow = 0; gridRow < gridZ; gridRow++) perimeterLoop.push([gridX, gridRow, 1, 0]);
  for (let gridRow = gridX; gridRow > 0; gridRow--) perimeterLoop.push([gridRow, gridZ, 0, 1]);
  for (let gridRow = gridZ; gridRow > 0; gridRow--) perimeterLoop.push([0, gridRow, -1, 0]);
  let perimeterCount = perimeterLoop.length,
    baseVertexCount = (gridX + 1) * (gridZ + 1),
    cornerIndexMap = new Map(),
    tearAngle = rand() * perimeterCount;
  perimeterLoop.forEach((gridRow, gridCol) => {
    cornerIndexMap.set(gridRow[0] + ',' + gridRow[1], gridCol);
    let cellIndex =
        (gridRow[0] === 0 || gridRow[0] === gridX) && (gridRow[1] === 0 || gridRow[1] === gridZ),
      cellId = gridRow[2],
      gridCursor = gridRow[3];
    cellIndex &&
      ((cellId = gridRow[0] === 0 ? -0.707 : 0.707),
      (gridCursor = gridRow[1] === 0 ? -0.707 : 0.707));
    let vertexId = gridIndex(gridRow[0], gridRow[1]),
      basePointX = positions[vertexId * 3],
      basePointY = positions[vertexId * 3 + 1],
      baseZ = positions[vertexId * 3 + 2],
      tearDistance = Math.abs(gridCol - tearAngle);
    tearDistance = Math.min(tearDistance, perimeterCount - tearDistance);
    let skirtDrop =
        0.17 +
        0.07 * Math.sin(gridCol * 0.55 + noiseSeed) +
        0.07 * valueNoise3D(gridCol * 0.31 + noiseSeed, 2.2) +
        0.3 * Math.exp((-tearDistance * tearDistance) / 14),
      skirtSeed = rand() * 6;
    for (let skirtStep = 1; skirtStep <= skirtSteps; skirtStep++) {
      let skirtT = skirtStep / skirtSteps,
        skirtY =
          basePointY +
          (skirtDrop - basePointY) * (0.25 * skirtT + 0.75 * skirtT * skirtT) -
          (skirtStep === 1 ? 0.02 : 0),
        tensionSag =
          (gridRow[0] === 5 || gridRow[0] === 16) && gridRow[2] === 0
            ? 0.035 * Math.sin(Math.PI * skirtT)
            : 0,
        lateralWobble =
          skirtT *
            (0.04 * Math.sin(gridCol * 1.7 + skirtSeed * 0.2) +
              0.028 * Math.sin(gridCol * 0.83 + 1.3 + noiseSeed)) +
          0.02 * skirtT * valueNoise3D(gridCol * 0.8, skirtStep * 0.9 + noiseSeed) -
          tensionSag,
        skirtOffset =
          (skirtStep === 1 ? 0.028 : 0.04 + 0.03 * skirtT) +
          lateralWobble +
          (cellIndex ? 0.012 * skirtT : 0),
        skirtX = clampValue(basePointX + cellId * skirtOffset, -1.2, 1.2),
        skirtZ = clampValue(baseZ + gridCursor * skirtOffset, -0.7, 0.7),
        hemDrop = basePointY - skirtY;
      (positions.push(skirtX, skirtY, skirtZ),
        uvs.push(
          (basePointX + cellId * (skirtOffset + hemDrop)) * uvScale,
          (baseZ + gridCursor * (skirtOffset + hemDrop)) * uvScale,
        ));
    }
  });
  let vertexIndexAt = (N, Q) =>
    Q === 0
      ? gridIndex(perimeterLoop[N][0], perimeterLoop[N][1])
      : baseVertexCount + N * skirtSteps + (Q - 1);
  for (let gridRow = 0; gridRow < perimeterCount; gridRow++)
    for (let gridCol = 0; gridCol < skirtSteps; gridCol++) {
      let cellIndex = (gridRow + 1) % perimeterCount,
        cellId = vertexIndexAt(gridRow, gridCol),
        gridCursor = vertexIndexAt(cellIndex, gridCol),
        vertexId = vertexIndexAt(cellIndex, gridCol + 1),
        basePointX = vertexIndexAt(gridRow, gridCol + 1);
      indices.push(cellId, gridCursor, basePointX, gridCursor, vertexId, basePointX);
    }
  let tarpGeo = new THREE.BufferGeometry();
  (tarpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3)),
    tarpGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2)),
    tarpGeo.setIndex(indices),
    tarpGeo.computeVertexNormals());
  let normalAttr = tarpGeo.attributes.normal,
    posAttr = tarpGeo.attributes.position,
    offsetAlongNormal = (N, Q) => [
      posAttr.getX(N) + normalAttr.getX(N) * Q,
      posAttr.getY(N) + normalAttr.getY(N) * Q,
      posAttr.getZ(N) + normalAttr.getZ(N) * Q,
    ],
    edgePaths = [];
  for (let gridRow of [5, 16]) {
    let gridCol = [],
      cellIndex = cornerIndexMap.get(gridRow + ',0'),
      cellId = cornerIndexMap.get(gridRow + ',' + gridZ);
    gridCol.push([posAttr.getX(vertexIndexAt(cellIndex, skirtSteps)), 0.11, -0.52]);
    for (let gridCursor = skirtSteps; gridCursor >= 1; gridCursor--)
      gridCol.push(offsetAlongNormal(vertexIndexAt(cellIndex, gridCursor), 0.007));
    for (let gridCursor = 0; gridCursor <= gridZ; gridCursor++)
      gridCol.push(offsetAlongNormal(gridIndex(gridRow, gridCursor), 0.007));
    for (let gridCursor = 1; gridCursor <= skirtSteps; gridCursor++)
      gridCol.push(offsetAlongNormal(vertexIndexAt(cellId, gridCursor), 0.007));
    (gridCol.push([posAttr.getX(vertexIndexAt(cellId, skirtSteps)), 0.11, 0.52]),
      edgePaths.push(gridCol));
  }
  let strapZ = 6,
    strapPath = [],
    strapStart = cornerIndexMap.get('0,' + strapZ),
    strapEnd = cornerIndexMap.get(gridX + ',' + strapZ);
  strapPath.push([-1.1, 0.1, posAttr.getZ(vertexIndexAt(strapStart, skirtSteps))]);
  for (let gridRow = skirtSteps; gridRow >= 1; gridRow -= 2)
    strapPath.push(offsetAlongNormal(vertexIndexAt(strapStart, gridRow), 0.012));
  for (let gridRow = 0; gridRow <= gridX; gridRow += 2)
    strapPath.push(offsetAlongNormal(gridIndex(gridRow, strapZ), 0.012));
  for (let gridRow = 1; gridRow <= skirtSteps; gridRow += 2)
    strapPath.push(offsetAlongNormal(vertexIndexAt(strapEnd, gridRow), 0.012));
  (strapPath.push([1.1, 0.1, posAttr.getZ(vertexIndexAt(strapEnd, skirtSteps))]),
    assembler.add(
      assembler.mat('tarp', {
        doubleSide: !0,
      }),
      tarpGeo,
      null,
      (gridRow, gridCol, cellIndex) => {
        let cellId = valueNoise3D(gridRow * 2.3 + noiseSeed, gridCol * 2.3, cellIndex * 2.3),
          gridCursor = valueNoise3D(gridRow * 11, gridCol * 11, cellIndex * 11 + noiseSeed);
        return (
          (0.72 + 0.28 * cellId) *
          (0.9 + 0.1 * gridCursor) *
          (0.8 + 0.2 * smoothstepRangeAlt2(0.15, 0.6, gridCol))
        );
      },
    ));
  for (let gridRow of edgePaths) {
    assembler.add(
      'paint_orange',
      createRibbonFromPolyline(gridRow, [0.024, 0, 0]),
      null,
      [1, 0.82, 0.5],
    );
    let gridCol = gridRow[gridRow.length - 4];
    (assembler.add(
      'steel_worn',
      roundedBoxGeometry(0.065, 0.1, 0.03, 0.006),
      {
        p: [gridCol[0], gridCol[1], gridCol[2] + 0.014],
        r: [0.25, 0, 0],
      },
      0.8,
    ),
      assembler.add(
        'steel_dark',
        roundedBoxGeometry(0.02, 0.09, 0.012, 0.003),
        {
          p: [gridCol[0] + 0.03, gridCol[1] + 0.06, gridCol[2] + 0.04],
          r: [0.9, 0, 0],
        },
        0.8,
      ));
  }
  assembler.add('rope', tubeGeometry(strapPath, 0.009, 4, !1, 0.5), null, 0.85);
  let reportedSize = [2.4, 1.5, 1.4],
    cargoTopY = Math.max(...loadBlocks.map((gridRow) => gridRow[4])) + 0.04;
  return assembler.finish({
    size: reportedSize,
    colliders: [
      {
        min: [-1.2, 0, -0.7],
        max: [1.2, cargoTopY, 0.7],
        surface: 'dirt',
      },
    ],
  });
}

/**
 * 沙袋墙：交错层叠（偶数层 3 只、奇数层 5 只顺砌），每只随机尺寸/颜色/微倾，两侧补上缝合边，顶层扣掉一只留缺口
 */
function buildSandbags(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'sandbags', opts.seed || 0),
    rand = assembler.rng,
    bagHeight = 0.18,
    courses = clampValue(opts.courses | 0 || 5, 1, 7),
    fabricMat = assembler.mat(SANDBAG_MATERIAL[0], SANDBAG_MATERIAL[1]),
    addBag = (l, c, u, h) => {
      let f = bagHeight * rand.range(1.02, 1.12),
        p = rand() < 0.3 ? rand.range(0.55, 0.75) : rand.range(0.82, 1),
        d = rand() * 30,
        v = {
          p: [
            u[0] + rand.range(-0.012, 0.012),
            u[1] + f / 2 - 0.004,
            u[2] + rand.range(-0.012, 0.012),
          ],
          r: [rand.range(-0.03, 0.03), h + rand.range(-0.06, 0.06), 0],
        };
      assembler.add(fabricMat, createSandbagGeometry(l, f, c, rand), v, (g, x, y) => {
        let b = valueNoise3D(g * 7 + d, x * 7, y * 7);
        return [p * (0.85 + 0.15 * b), p * (0.84 + 0.15 * b), p * (0.8 + 0.16 * b)];
      });
      for (let g of [1, -1])
        assembler.add(
          fabricMat,
          createRibbonFromPolyline(
            [
              [g * (l / 2 - 0.004), rand.range(-0.008, 0.008), -c * 0.27],
              [g * (l / 2 - 0.002), rand.range(-0.008, 0.008), c * 0.27],
            ],
            [g * 0.009, 0.001, 0],
          ),
          v,
          p * 0.9,
        );
    };
  for (let bagLength = 0; bagLength < courses; bagLength++) {
    let bagDepth = bagLength * bagHeight,
      isTopCourse = bagLength === courses - 1;
    if (bagLength % 2 === 0)
      for (let bagIndex = 0; bagIndex < 3; bagIndex++)
        for (let heightJitter of [1, -1])
          (isTopCourse && bagIndex === 2 && heightJitter === 1 && courses > 2) ||
            addBag(0.655, 0.3, [(bagIndex - 1) * 0.655, bagDepth, heightJitter * 0.148], 0);
    else
      for (let bagIndex = 0; bagIndex < 5; bagIndex++)
        (isTopCourse && bagIndex === 0 && courses > 2) ||
          addBag(0.585, 0.385, [(bagIndex - 2) * 0.392, bagDepth, 0], HALF_PI);
  }
  return assembler.finish({
    size: [2, courses * bagHeight, 0.6],
    surface: 'dirt',
  });
}

/**
 * 沙袋布材质配置（glove_fabric + 卡其色），复用帆布手套的织物着色
 */
var SANDBAG_MATERIAL = [
  'glove_fabric',
  {
    color: 9207134,
  },
];

/**
 * 单只纸箱：可选压溃/受潮顶点色、开箱（掀盖+外翻四片）、封箱胶带、贴纸铭牌与「此面朝上」箭头，是纸箱堆的基础件
 */
function addCardboardBox(
  builder,
  width,
  height,
  depth,
  transform,
  {
    crush: crushAmt = 0,
    damp: dampAmt = 0.3,
    open: isOpen = !1,
    tape: hasTape = !0,
    label: labelText = '',
    arrow: showArrow = !1,
    tint: tintMul = 1,
  } = {},
) {
  let rand = builder.rng,
    ctx = builder.G,
    noiseSeed = rand() * 40;
  builder.push(transform);
  let crushVertex = (_) => {
      if (!crushAmt) return;
      let M = clampValue(_.y / height, 0, 1),
        E = M * M;
      ((_.y -=
        crushAmt *
        height *
        0.32 *
        E *
        (0.55 + 0.45 * Math.cos(((PI_TWO * _.x) / width) * 0.9 + 0.5)) *
        (0.8 + 0.2 * Math.cos((PI_TWO * _.z) / depth))),
        (_.z *= 1 + 0.1 * crushAmt * Math.sin(PI_TWO * M)),
        (_.x +=
          0.12 * crushAmt * height * M + 0.02 * crushAmt * Math.sin(PI_TWO * M) * Math.sign(_.x)));
    },
    bodyGeo = roundedBoxGeometryGrid(width, height, depth, 0.007, 4, 5, 4, 'bottom');
  (isOpen && removeGeometryGroup(bodyGeo, 2),
    crushAmt && (mapVertices(bodyGeo, crushVertex), recomputeSmoothNormals(bodyGeo)));
  let dampLine = dampAmt * height,
    colorFn = (_, M, E) => {
      let w = valueNoise3D(_ * 6 + noiseSeed, M * 3, E * 6 + noiseSeed),
        S = smoothstepRangeAlt2(dampLine - 0.03, dampLine + 0.04, M + 0.08 * (w - 0.5)),
        z = (0.86 + 0.14 * valueNoise3D(_ * 13, M * 13 + noiseSeed, E * 13)) * tintMul;
      return [z * (0.5 + 0.5 * S), z * (0.47 + 0.53 * S), z * (0.42 + 0.58 * S)];
    };
  {
    let vertPoint = bodyGeo.attributes.position,
      heightRatio = new Float32Array(vertPoint.count * 3);
    for (let heightCurveSq = 0; heightCurveSq < vertPoint.count; heightCurveSq++) {
      let noiseSample = colorFn(
        vertPoint.getX(heightCurveSq),
        vertPoint.getY(heightCurveSq),
        vertPoint.getZ(heightCurveSq),
      );
      ((heightRatio[heightCurveSq * 3] = noiseSample[0]),
        (heightRatio[heightCurveSq * 3 + 1] = noiseSample[1]),
        (heightRatio[heightCurveSq * 3 + 2] = noiseSample[2]));
    }
    bodyGeo.setAttribute('color', new THREE.BufferAttribute(heightRatio, 3));
  }
  builder.add('cardboard', bodyGeo);
  let tapeOverhang = 0.0025;
  if (isOpen) {
    let vertPoint = Math.min(0.16, height * 0.6);
    builder.add(
      'cardboard',
      createPlaneGeometryOffsetUVAlt(width - 0.012, depth - 0.012),
      {
        p: [0, height - vertPoint, 0],
        r: [-HALF_PI, 0, 0],
      },
      0.45 * tintMul,
    );
    for (let [heightCurveSq, noiseSample, angleParam] of [
      [0, width, depth / 2],
      [PI_TWO, width, depth / 2],
      [HALF_PI, depth, width / 2],
      [-HALF_PI, depth, width / 2],
    ])
      builder.add(
        'cardboard',
        flipGeometryWinding(createPlaneGeometryOffsetUVAlt(noiseSample - 0.012, vertPoint)),
        {
          p: [
            Math.sin(heightCurveSq) * (angleParam - 0.006),
            height - vertPoint / 2,
            Math.cos(heightCurveSq) * (angleParam - 0.006),
          ],
          r: [0, heightCurveSq, 0],
        },
        0.55 * tintMul,
      );
    let heightRatio = (E, w, S) => {
      let z = Math.sin(S),
        H = Math.cos(S);
      return [E, w, z, H];
    };
    for (let heightCurveSq of [1, -1]) {
      let noiseSample = rand.range(0.3, 1.9),
        angleParam = depth / 2 - 0.01;
      builder.add(
        'cardboard',
        createRibbonFromPolyline(
          [
            [0, height, (heightCurveSq * depth) / 2],
            [
              0,
              height + Math.sin(noiseSample) * angleParam * 0.5,
              heightCurveSq * (depth / 2 + Math.cos(noiseSample) * angleParam * 0.5),
            ],
            [
              0,
              height + Math.sin(noiseSample) * angleParam,
              heightCurveSq * (depth / 2 + Math.cos(noiseSample) * angleParam + 0.01),
            ],
          ],
          [width / 2 - 0.004, 0, 0],
        ),
        null,
        0.9 * tintMul,
      );
    }
    for (let heightCurveSq of [1, -1]) {
      let noiseSample = rand.range(0.9, 2.3),
        angleParam = depth / 2 - 0.02;
      builder.add(
        'cardboard',
        createRibbonFromPolyline(
          [
            [(heightCurveSq * width) / 2, height, 0],
            [
              heightCurveSq * (width / 2 + Math.cos(noiseSample) * angleParam),
              height + Math.sin(noiseSample) * angleParam,
              0,
            ],
          ],
          [0, 0, depth / 2 - 0.004],
        ),
        null,
        0.82 * tintMul,
      );
    }
  } else if (hasTape) {
    let heightRatio = [];
    heightRatio.push([-width / 2 - tapeOverhang, height - 0.075, 0]);
    for (let noiseSample = 0; noiseSample <= 8; noiseSample++)
      heightRatio.push([
        (-0.5 + noiseSample / 8) * (width + 2 * tapeOverhang),
        height + tapeOverhang,
        0,
      ]);
    heightRatio.push([width / 2 + tapeOverhang, height - 0.075, 0]);
    let heightCurveSq = new THREE.Vector3();
    for (let noiseSample of heightRatio)
      (heightCurveSq.set(noiseSample[0], noiseSample[1], noiseSample[2]),
        crushVertex(heightCurveSq),
        (noiseSample[0] = heightCurveSq.x),
        (noiseSample[1] = heightCurveSq.y + (crushAmt ? 0.004 : 0)),
        (noiseSample[2] = heightCurveSq.z));
    builder.add('polymer_tan', createRibbonFromPolyline(heightRatio, [0, 0, 0.025], !1), null, 0.9);
  }
  let frontZ = depth / 2 + tapeOverhang,
    labelHeight = Math.min(0.055, height * 0.2);
  if (
    (labelText &&
      !crushAmt &&
      (builder.label(
        labelText,
        {
          color: 'black',
          font: 'sans',
          distress: 0.3,
        },
        width * 0.6,
        labelHeight,
        {
          p: [-width * 0.1, height * 0.62, frontZ],
        },
      ),
      builder.add(
        'paint_white',
        createPlaneGeometryOffsetUVAlt(0.11, 0.075),
        {
          p: [width * 0.26, height * 0.3, frontZ - 0.001],
        },
        0.9,
        {
          cast: !1,
        },
      ),
      builder.decal(ctx.mats.decal('numbers_0_9'), 0.095, {
        p: [width * 0.26, height * 0.3, frontZ + 6e-4],
      })),
    showArrow && !crushAmt)
  )
    for (let vertPoint of [1, -1])
      builder.decal(ctx.mats.decal('arrow'), Math.min(0.09, height * 0.3), {
        p: [vertPoint * (width / 2 + tapeOverhang), height * 0.55, vertPoint * depth * 0.2],
        r: [0, vertPoint * HALF_PI, HALF_PI],
      });
  builder.pop();
}

/**
 * 散堆纸箱道具：7 只大小不一的纸箱随机倾倒叠在一起，混合压溃、开箱、受潮三种状态
 */
function buildCardboardBoxes(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'cardboard_boxes', opts.seed || 0),
    rand = assembler.rng,
    jitter = () => rand.range(-0.015, 0.015),
    tint = () => rand.range(0.82, 1);
  return (
    addCardboardBox(
      assembler,
      0.5,
      0.38,
      0.44,
      {
        p: [-0.23 + jitter(), 0, -0.16 + jitter()],
        r: [0, rand.range(-0.05, 0.05), 0],
      },
      {
        damp: 0.45,
        label: 'FRAGILE',
        arrow: !0,
        tint: tint(),
      },
    ),
    addCardboardBox(
      assembler,
      0.42,
      0.33,
      0.4,
      {
        p: [0.26 + jitter(), 0, -0.17 + jitter()],
        r: [0, rand.range(-0.08, 0.08), 0],
      },
      {
        damp: 0.5,
        label: 'KEEP DRY',
        tint: tint(),
      },
    ),
    addCardboardBox(
      assembler,
      0.46,
      0.28,
      0.4,
      {
        p: [-0.24 + jitter(), 0.38, -0.15 + jitter()],
        r: [0, rand.range(-0.2, 0.2), 0],
      },
      {
        crush: 1,
        damp: 0.75,
        tint: tint() * 0.92,
      },
    ),
    addCardboardBox(
      assembler,
      0.33,
      0.26,
      0.32,
      {
        p: [0.27 + jitter(), 0.33, -0.18 + jitter()],
        r: [0, rand.range(-0.3, 0.3), 0],
      },
      {
        open: !0,
        damp: 0.1,
        label: '',
        arrow: !0,
        tint: tint(),
      },
    ),
    addCardboardBox(
      assembler,
      0.3,
      0.16,
      0.24,
      {
        p: [-0.26 + jitter(), 0.565, -0.16 + jitter()],
        r: [0.03, rand.range(-0.5, 0.5), -0.09],
      },
      {
        damp: 0.2,
        label: 'HX-2291',
        tint: tint(),
      },
    ),
    addCardboardBox(
      assembler,
      0.36,
      0.26,
      0.3,
      {
        p: [0.06 + jitter(), 0.105, 0.2],
        r: [0.62, rand.range(-0.25, 0.25), 0],
      },
      {
        damp: 0.9,
        crush: 0.25,
        tint: tint() * 0.85,
      },
    ),
    assembler.finish()
  );
}

/**
 * 登记篷布货垛、沙袋墙、散堆纸箱这三种软体/纸制品道具
 */
export function registerCharacterProps(register) {
  (register('tarp_cargo', (propCtx, propOpts = {}) => buildTarpCargo(propCtx, propOpts)),
    register('sandbags', (propCtx, propOpts = {}) => buildSandbags(propCtx, propOpts)),
    register('cardboard_boxes', (propCtx, propOpts = {}) =>
      buildCardboardBoxes(propCtx, propOpts),
    ));
}
