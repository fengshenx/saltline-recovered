// content/props/vehicles.js — 从 basic-builders.js 按职责拆出（原单文件 5000+ 行，注释与命名沿用还原产物）。

import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { HALF_PI, PartBuilder, catmullRomPath, je, loftProfileSurface, revolveProfileGeometry, tagPropUserData } from '../../assets/procedural/geometry.js';
import { clampValue, smoothstepRange } from '../../audio/audio.js';
import { PI } from '../level/placement.js';
import { getPropSize3 } from './registry.js';
import { valueNoise3D } from '../../core/math.js';

/**
 * 两轮手推车：底部承托板 + 后倾双竖梁 + 三道横梁 + 顶部手柄 + 橡胶车轮。
 * 竖梁后倾约 8°，让重心落在轮轴上方，与实物一致；承托板前缘上卷 8mm 便于铲进托盘。
 */
export function buildHandTruck(ctx, truckOpts = {}) {
  let builder = new PartBuilder(ctx),
    yellowPaint = builder.M('paint_yellow'),
    galvSteel = builder.M('steel_galv'),
    darkSteel = builder.M('steel_dark'),
    rubberMat = builder.M('rubber'),
    halfWidth = 0.2,
    railHeight = 1.2,
    railBaseY = 0.05,
    tilt = 0.14,
    baseZ = 0.06,
    railZ = (height) => baseZ - (height - railBaseY) * Math.tan(tilt);
  builder.box(yellowPaint, 0.5, 0.028, 0.28, 0, 0.034, 0.17, { r: 0.008 });
  builder.box(galvSteel, 0.44, 0.012, 0.02, 0, 0.05, 0.035, { r: 0.004 });
  for (let sideSign of [-1, 1]) {
    let railMidY = railBaseY + railHeight / 2;
    (builder.cyl(yellowPaint, 0.019, 0.019, railHeight, sideSign * halfWidth, railMidY, railZ(railMidY), {
      seg: 12,
      rot: [-tilt, 0, 0],
    }),
      builder.cyl(darkSteel, 0.023, 0.023, 0.035, sideSign * halfWidth, railBaseY, railZ(railBaseY), {
        seg: 12,
        rot: [-tilt, 0, 0],
      }));
  }
  for (let braceY of [0.34, 0.72, 1.08])
    builder.cyl(yellowPaint, 0.015, 0.015, halfWidth * 2, 0, braceY, railZ(braceY), {
      seg: 10,
      rot: [0, 0, HALF_PI],
    });
  let handleY = railBaseY + railHeight + 0.02;
  builder.cyl(galvSteel, 0.02, 0.02, halfWidth * 2 + 0.06, 0, handleY, railZ(handleY), {
    seg: 12,
    rot: [0, 0, HALF_PI],
  });
  for (let sideSign of [-1, 1])
    builder.cyl(rubberMat, 0.027, 0.027, 0.1, sideSign * (halfWidth - 0.03), handleY, railZ(handleY), {
      seg: 12,
      rot: [0, 0, HALF_PI],
    });
  let axleY = 0.17,
    axleZ = railZ(axleY) - 0.02;
  builder.cyl(darkSteel, 0.013, 0.013, 0.52, 0, axleY, axleZ, { seg: 10, rot: [0, 0, HALF_PI] });
  for (let sideSign of [-1, 1]) {
    (builder.cyl(rubberMat, 0.165, 0.165, 0.05, sideSign * 0.238, axleY, axleZ, {
      seg: 20,
      rot: [0, 0, HALF_PI],
    }),
      builder.cyl(galvSteel, 0.075, 0.075, 0.055, sideSign * 0.238, axleY, axleZ, {
        seg: 14,
        rot: [0, 0, HALF_PI],
      }));
  }
  return tagPropUserData(builder.group(), 'hand_truck', getPropSize3('hand_truck'), [
    {
      min: [-0.28, 0, -0.17],
      max: [0.28, 1.27, 0.31],
      surface: 'metal',
    },
  ]);
}

/**
 * 被遗弃的轿车：车身按 31 个截面沿车长放样。侧视轮廓在 A/C 柱处陡转形成挡风与后窗倾角，
 * 底部高度在四个轮位抬到 0.68 让轮子露出来（等效轮拱），车顶较腰线收窄 17% 形成肩线；
 * 车漆按三维噪声褪色、下沿叠锈，左前轮亏气、整车微倾
 */
export function buildAbandonedSedan(ctx, sedanOpts = {}) {
  let builder = new PartBuilder(ctx),
    paintMat = builder.M('paint_red', {
      vertexColors: !0,
    }),
    glassMat = builder.M('glass', { doubleSide: !0 }),
    trimMat = builder.M('steel_dark'),
    chromeMat = builder.M('steel_galv'),
    rustMat = builder.M('steel_rust'),
    headlampMat = ctx.mats.emissive(15192520, 0.4),
    tailLampMat = ctx.mats.emissive(6555930, 0.35),
    tireMat = builder.M('tire'),
    plateMat = builder.M('paint_white'),
    noiseSeed = (((sedanOpts.seed | 0) % 7) + 1) * 0.61,
    SEDAN_KEYS = [
      [-2.2, 0.8, 0.34, 0.9, 0.94, 0.96],
      [-1.95, 0.86, 0.32, 0.93, 0.97, 0.95],
      [-1.75, 0.882, 0.31, 0.95, 1.0, 0.94],
      [-1.55, 0.888, 0.3, 0.96, 1.05, 0.92],
      [-1.35, 0.89, 0.3, 0.97, 1.19, 0.88],
      [-1.15, 0.89, 0.3, 0.98, 1.36, 0.82],
      [-0.95, 0.888, 0.3, 0.985, 1.428, 0.79],
      [-0.5, 0.885, 0.3, 0.99, 1.443, 0.78],
      [0, 0.885, 0.3, 0.99, 1.445, 0.78],
      [0.35, 0.883, 0.3, 0.99, 1.44, 0.78],
      [0.6, 0.88, 0.3, 0.985, 1.35, 0.8],
      [0.8, 0.878, 0.3, 0.98, 1.18, 0.85],
      [0.95, 0.875, 0.3, 0.975, 1.02, 0.93],
      [1.3, 0.87, 0.3, 0.955, 0.96, 0.96],
      [1.7, 0.86, 0.31, 0.93, 0.925, 0.96],
      [1.95, 0.845, 0.33, 0.9, 0.895, 0.96],
      [2.1, 0.82, 0.36, 0.87, 0.87, 0.95],
      [2.2, 0.78, 0.4, 0.83, 0.84, 0.94],
      [2.25, 0.71, 0.45, 0.78, 0.8, 0.93],
    ],
    bodyKeys = catmullRomPath(SEDAN_KEYS, 5),
    bodySection = catmullRomPath(
      [
        [1, 0],
        [1, 0.9],
        [0.94, 0.985],
        [0.62, 1],
        [0, 1],
        [-0.62, 1],
        [-0.94, 0.985],
        [-1, 0.9],
        [-1, 0],
        [0, 0],
      ],
      4,
      !0,
    ),
    bodyGeo = loftProfileSurface(
      bodySection,
      bodyKeys.map((key) => key[0]),
      (coordU, coordV, stationZ, rowIndex) => {
        let halfWidth = bodyKeys[rowIndex][1],
          sillY = bodyKeys[rowIndex][2],
          roofY = bodyKeys[rowIndex][4],
          narrow = bodyKeys[rowIndex][5],
          taper =
            (1 - 0.05 * smoothstepRange(0.14, 0, coordV)) *
            (1 - (1 - narrow) * smoothstepRange(0.5, 1, coordV));
        return [coordU * halfWidth * taper, sillY + coordV * (roofY - sillY), stationZ];
      },
      {
        closed: !0,
        caps: !0,
      },
    );
  // 轮拱：圆柱沿 X 轴贯穿车身做差集，切出拱形开口让轮胎嵌进去，否则轮子只能贴在平底上
  let archEvaluator = new Evaluator(),
    bodyBrush = new Brush(bodyGeo);
  bodyBrush.updateMatrixWorld(!0);
  for (let axleZ of [1.42, -1.41]) {
    let archGeometry = new THREE.CylinderGeometry(0.43, 0.43, 2.6, 24, 1);
    (archGeometry.rotateZ(HALF_PI), archGeometry.translate(0, 0.33, axleZ));
    let archBrush = new Brush(archGeometry);
    (archBrush.updateMatrixWorld(!0),
      (bodyBrush = archEvaluator.evaluate(bodyBrush, archBrush, SUBTRACTION)));
  }
  bodyGeo = bodyBrush.geometry;
  let bodyPos = bodyGeo.attributes.position,
    bodyColors = new Float32Array(bodyPos.count * 3);
  for (let vertexIdx = 0; vertexIdx < bodyPos.count; vertexIdx++) {
    let px = bodyPos.getX(vertexIdx),
      py = bodyPos.getY(vertexIdx),
      pz = bodyPos.getZ(vertexIdx),
      grain = valueNoise3D(px * 2.6 + noiseSeed, py * 2.1, pz * 1.4),
      grainFine = valueNoise3D(px * 7.3, py * 6.1 + noiseSeed, pz * 5.7),
      lowerFade = smoothstepRange(0.9, 0.42, py),
      rustMix = clampValue(lowerFade * 0.42 + (grain - 0.5) * 0.55 + (grainFine - 0.5) * 0.2, 0, 1),
      topFade = smoothstepRange(1.1, 1.43, py) * 0.45,
      sunBleach = smoothstepRange(0.4, 1.4, pz) * 0.14,
      paintR = 0.56 * (1 - topFade) + 0.66 * topFade,
      paintG = 0.14 * (1 - topFade) + 0.2 * topFade,
      paintB = 0.14 * (1 - topFade) + 0.16 * topFade;
    ((bodyColors[vertexIdx * 3] = (paintR + sunBleach) * (1 - rustMix) + 0.32 * rustMix),
      (bodyColors[vertexIdx * 3 + 1] = paintG * (1 - rustMix) + 0.16 * rustMix),
      (bodyColors[vertexIdx * 3 + 2] = paintB * (1 - rustMix) + 0.09 * rustMix));
  }
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(bodyColors, 3));
  bodyGeo.computeVertexNormals();
  builder.add(paintMat, bodyGeo);
  let sampleBody = (z) => {
      let keys = bodyKeys;
      if (z <= keys[0][0]) return keys[0].slice();
      if (z >= keys[keys.length - 1][0]) return keys[keys.length - 1].slice();
      let upper = 1;
      while (upper < keys.length - 1 && keys[upper][0] < z) upper++;
      let lower = keys[upper - 1],
        head = keys[upper],
        mix = clampValue((z - lower[0]) / (head[0] - lower[0] || 1), 0, 1);
      return lower.map((value, index) => (index === 0 ? z : value + (head[index] - value) * mix));
    },
    bodyTaper = (coordV, narrow) =>
      (1 - 0.05 * smoothstepRange(0.14, 0, coordV)) *
      (1 - (1 - narrow) * smoothstepRange(0.5, 1, coordV)),
    surfaceAt = (z, coordV, sideSign = 1) => {
      let frame = sampleBody(z);
      return [
        sideSign * frame[1] * bodyTaper(coordV, frame[5]),
        frame[2] + coordV * (frame[4] - frame[2]),
        z,
      ];
    },
    surfaceGeometry = (rows, cols, vertexAt) => {
      let positions = [],
        uvs = [],
        indices = [];
      for (let row = 0; row <= rows; row++)
        for (let col = 0; col <= cols; col++) {
          let point = vertexAt(row / rows, col / cols);
          (positions.push(point[0], point[1], point[2]), uvs.push(col / cols, row / rows));
        }
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++) {
          let corner = row * (cols + 1) + col;
          indices.push(corner, corner + cols + 1, corner + 1, corner + 1, corner + cols + 1, corner + cols + 2);
        }
      let geo = new THREE.BufferGeometry();
      return (
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)),
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)),
        geo.setIndex(indices),
        geo.computeVertexNormals(),
        geo
      );
    },
    roofSkin = (zFrom, zTo, uSpan, inset) =>
      surfaceGeometry(10, 8, (rowT, colT) => {
        let z = zFrom + (zTo - zFrom) * rowT,
          top = surfaceAt(z, 1, 1);
        return [(-uSpan + 2 * uSpan * colT) * (top[0] - inset), top[1] - inset, z];
      }),
    sideSkin = (sideSign, zFrom, zTo, vFrom, vTo, inset) =>
      surfaceGeometry(10, 6, (rowT, colT) => {
        let z = zFrom + (zTo - zFrom) * rowT,
          point = surfaceAt(z, vFrom + (vTo - vFrom) * colT, sideSign);
        return [point[0] - sideSign * inset, point[1], z];
      }),
    strutBetween = (mat, from, to, thickness, radius = 0.012) => {
      let spanZ = to[2] - from[2],
        spanY = to[1] - from[1];
      builder.box(
        mat,
        thickness,
        Math.hypot(spanZ, spanY),
        thickness,
        (from[0] + to[0]) / 2,
        (from[1] + to[1]) / 2,
        (from[2] + to[2]) / 2,
        { r: radius, rot: [Math.atan2(spanZ, spanY), 0, 0] },
      );
    };
  // 玻璃：挡风与后窗贴车身上表面，侧窗贴侧面；曲面由车身参数反算，位置随造型变化
  (builder.add(glassMat, roofSkin(0.96, 0.42, 0.62, 0.012)),
    builder.add(glassMat, roofSkin(-1.5, -0.96, 0.62, 0.012)));
  for (let sideSign of [-1, 1])
    (builder.add(glassMat, sideSkin(sideSign, 0.3, -0.06, 0.64, 0.95, 0.012)),
      builder.add(glassMat, sideSkin(sideSign, -0.14, -0.92, 0.64, 0.95, 0.012)));
  // 前脸：格栅条、大灯、转向灯、车标
  for (let grilleIdx = 0; grilleIdx < 5; grilleIdx++)
    builder.box(chromeMat, 0.74, 0.018, 0.045, 0, 0.58 + grilleIdx * 0.048, 2.24, { r: 0.006 });
  (builder.box(trimMat, 0.86, 0.055, 0.05, 0, 0.8, 2.238, { r: 0.014 }),
    builder.box(trimMat, 0.86, 0.05, 0.05, 0, 0.5, 2.238, { r: 0.014 }));
  builder.cyl(chromeMat, 0.058, 0.058, 0.024, 0, 0.87, 2.23, {
    seg: 16,
    rot: [HALF_PI, 0, 0],
  });
  for (let sideSign of [-1, 1]) {
    let mirror = surfaceAt(0.88, 0.66, sideSign),
      handle = surfaceAt(0.06, 0.6, sideSign),
      pillarTop = surfaceAt(0.42, 0.97, sideSign),
      pillarBase = surfaceAt(0.96, 0.62, sideSign),
      cTop = surfaceAt(-0.95, 0.97, sideSign),
      cBase = surfaceAt(-1.5, 0.66, sideSign);
    (builder.box(headlampMat, 0.32, 0.135, 0.09, sideSign * 0.47, 0.79, 2.2, { r: 0.022 }),
      builder.box(chromeMat, 0.35, 0.16, 0.05, sideSign * 0.47, 0.79, 2.19, { r: 0.03 }),
      builder.box(chromeMat, 0.11, 0.055, 0.06, sideSign * 0.72, 0.66, 2.19, { r: 0.008 }),
      builder.box(tailLampMat, 0.34, 0.14, 0.08, sideSign * 0.52, 0.83, -2.2, { r: 0.018 }),
      builder.box(trimMat, 0.05, 0.04, 0.1, mirror[0] + sideSign * 0.02, mirror[1], 0.9, { r: 0.01 }),
      builder.box(paintMat, 0.12, 0.1, 0.25, mirror[0] + sideSign * 0.08, mirror[1] + 0.02, 0.85, {
        r: 0.026,
      }),
      builder.box(trimMat, 0.12, 0.09, 0.02, mirror[0] + sideSign * 0.08, mirror[1] + 0.02, 0.73, {
        r: 0.012,
      }));
    (strutBetween(trimMat, pillarBase, pillarTop, 0.055, 0.014),
      strutBetween(trimMat, cBase, cTop, 0.055, 0.014),
      builder.box(trimMat, 0.05, 0.42, 0.05, sideSign * 0.855, 1.16, -0.1, { r: 0.012 }),
      builder.box(trimMat, 0.006, 0.5, 0.014, sideSign * 0.878, 0.62, 0.32, { r: 0.002 }),
      builder.box(trimMat, 0.006, 0.5, 0.014, sideSign * 0.882, 0.62, -0.16, { r: 0.002 }),
      builder.box(chromeMat, 0.03, 0.04, 0.16, handle[0] + sideSign * 0.014, handle[1] - 0.04, 0.06, {
        r: 0.008,
      }));
    for (let railIdx = 0; railIdx < 3; railIdx++) {
      let railFrom = surfaceAt(0.38 - railIdx * 0.45, 0.985, sideSign),
        railTo = surfaceAt(0.38 - (railIdx + 1) * 0.45, 0.985, sideSign);
      strutBetween(chromeMat, railFrom, railTo, 0.022, 0.006);
    }
    builder.box(trimMat, 0.022, 0.09, 2.5, sideSign * 0.862, 0.37, -0.05, { r: 0.012 });
    for (let axleZ of [1.42, -1.41]) {
      let archTrim = new THREE.TorusGeometry(0.45, 0.032, 6, 18, Math.PI);
      (archTrim.rotateY(HALF_PI),
        archTrim.translate(sideSign * 0.838, 0.33, axleZ),
        builder.add(trimMat, archTrim));
    }
    for (let beltIdx = 0; beltIdx < 3; beltIdx++) {
      let beltFrom = surfaceAt(1.4 - beltIdx * 1.05, 0.6, sideSign),
        beltTo = surfaceAt(1.4 - (beltIdx + 1) * 1.05, 0.6, sideSign);
      beltFrom[1] -= 0.02;
      beltTo[1] -= 0.02;
      strutBetween(trimMat, beltFrom, beltTo, 0.02, 0.004);
    }
  }
  // 保险杠、车牌、雨刷、排气、底盘、天线
  (builder.box(trimMat, 1.44, 0.16, 0.14, 0, 0.46, 2.24, { r: 0.022 }),
    builder.box(trimMat, 1.48, 0.17, 0.14, 0, 0.48, -2.22, { r: 0.022 }),
    builder.box(plateMat, 0.34, 0.11, 0.014, 0, 0.58, -2.3, { r: 0.003 }),
    builder.box(chromeMat, 0.44, 0.012, 0.018, 0.28, 1.0, 0.99, { r: 0.003, rot: [0, 0.22, 0] }),
    builder.box(chromeMat, 0.44, 0.012, 0.018, -0.28, 1.0, 0.99, { r: 0.003, rot: [0, -0.22, 0] }),
    builder.cyl(trimMat, 0.036, 0.036, 0.2, 0.44, 0.34, -2.26, { seg: 10, rot: [HALF_PI, 0, 0] }),
    builder.box(rustMat, 1.3, 0.16, 3.3, 0, 0.3, 0, { r: 0.02 }),
    builder.cyl(trimMat, 0.007, 0.007, 0.36, -0.5, 1.6, -0.72, { seg: 6 }));
  let rimGeo = revolveProfileGeometry(
      [
        [0.0, 0.05],
        [0.17, 0.05],
        [0.185, 0.02],
        [0.185, -0.02],
        [0.17, -0.05],
        [0.0, -0.05],
      ],
      16,
    ),
    WHEELS = [
      [-0.72, -1.41],
      [0.72, -1.41],
      [-0.72, 1.42],
      [0.72, 1.42],
    ];
  for (let wheelEntry of WHEELS) {
    let axleX = wheelEntry[0],
      axleZ = wheelEntry[1],
      isFlat = axleX < 0 && axleZ > 0,
      wheelRadius = isFlat ? 0.27 : 0.32;
    // je() 直接改写入参并返回同一引用，每个轮子都要独立 clone，否则变换会累积
    (builder.add(
      tireMat,
      je(
        createTireProfileGeometry(wheelRadius, 0.2, 0.185, 18),
        axleX,
        wheelRadius,
        axleZ,
        [0, 0, HALF_PI],
      ),
    ),
      builder.add(chromeMat, je(rimGeo.clone(), axleX, wheelRadius, axleZ, [0, 0, HALF_PI])));
  }
  let sedanGroup = builder.group();
  sedanGroup.rotation.z = 0.012;
  return tagPropUserData(sedanGroup, 'abandoned_sedan', getPropSize3('abandoned_sedan'), [
    {
      min: [-0.92, 0, -2.3],
      max: [0.92, 1.45, 2.25],
      surface: 'metal',
    },
  ]);
}
