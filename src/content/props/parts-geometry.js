// content/props/parts-geometry.js — 从 basic-builders.js 按职责拆出（原单文件 5000+ 行，注释与命名沿用还原产物）。

import { HALF_PI, mapVertices, removeGeometryGroup, revolveProfileGeometry } from '../../assets/procedural/geometry.js';
import { clampValue } from '../../audio/audio.js';
import { recomputeSmoothNormals, roundedBoxGeometryGrid } from './detail-geometry.js';
import { PI_TWO, valueNoise3D } from '../../core/math.js';

/**
 * 200L 油桶的回转剖面（含两圈加强箍），open 时给出开口桶沿的剖面
 */
export function barrelProfile(open) {
  let profilePts = [
    [0, 0.016],
    [0.262, 0.016],
    [0.262, 0.016],
    [0.268, 0.002],
    [0.288, 0],
    [0.295, 0.008],
    [0.295, 0.022],
    [0.284, 0.034],
  ];
  for (let hoopY of [0.305, 0.595])
    profilePts.push(
      [0.283, hoopY - 0.03],
      [0.291, hoopY - 0.018],
      [0.297, hoopY],
      [0.291, hoopY + 0.018],
      [0.283, hoopY + 0.03],
    );
  return (
    profilePts.push([0.284, 0.866], [0.295, 0.878], [0.295, 0.892], [0.288, 0.9], [0.268, 0.898]),
    open
      ? profilePts.push([0.268, 0.898], [0.272, 0.888], [0.272, 0.03], [0.272, 0.03], [0, 0.03])
      : profilePts.push([0.262, 0.884], [0.262, 0.884], [0, 0.884]),
    profilePts
  );
}

/**
 * 轮胎断面回转几何：带胎肩圆角与两道花纹槽的剖面，UV 沿胎面展开
 */
export function createTireProfileGeometry(outerRadius, width, rimRadius, radialSegs = 20) {
  let sidewallH = outerRadius - rimRadius,
    grooveDepth = Math.min(0.011, sidewallH * 0.08),
    profilePts = [
      [rimRadius, width * 0.18],
      [rimRadius + sidewallH * 0.45, width * 0.035],
      [outerRadius - sidewallH * 0.2, width * 0.02],
      [outerRadius - sidewallH * 0.06, width * 0.07],
      [outerRadius, width * 0.17],
      [outerRadius, width * 0.17],
      [outerRadius, width * 0.355],
      [outerRadius - grooveDepth, width * 0.385],
      [outerRadius, width * 0.415],
      [outerRadius, width * 0.585],
      [outerRadius - grooveDepth, width * 0.615],
      [outerRadius, width * 0.645],
      [outerRadius, width * 0.83],
      [outerRadius, width * 0.83],
      [outerRadius - sidewallH * 0.06, width * 0.93],
      [outerRadius - sidewallH * 0.2, width * 0.98],
      [rimRadius + sidewallH * 0.45, width * 0.965],
      [rimRadius, width * 0.82],
      [rimRadius, width * 0.82],
      [rimRadius, width * 0.18],
    ],
    tireGeo = revolveProfileGeometry(profilePts, radialSegs),
    uvAttr = tireGeo.attributes.uv,
    ptCount = profilePts.length,
    arcLens = [0];
  for (let ptIdx = 1; ptIdx < ptCount; ptIdx++)
    arcLens.push(
      arcLens[ptIdx - 1] +
        Math.hypot(
          profilePts[ptIdx][0] - profilePts[ptIdx - 1][0],
          profilePts[ptIdx][1] - profilePts[ptIdx - 1][1],
        ),
    );
  let treadMid = (arcLens[8] + arcLens[9]) / 2,
    treadHalf = treadMid - arcLens[4],
    innerHalf = arcLens[4] - arcLens[0],
    uTiles = Math.max(1, Math.round((2 * PI_TWO * outerRadius) / 0.5)) * 0.5;
  for (let ptIdx = 0; ptIdx < ptCount; ptIdx++) {
    let uOffset = ptIdx >= ptCount - 2 ? -(treadHalf + innerHalf) : arcLens[ptIdx] - treadMid,
      absOff = Math.abs(uOffset),
      vCoord =
        Math.sign(uOffset) *
        (absOff <= treadHalf + 1e-6
          ? (absOff / treadHalf) * 0.126
          : 0.126 + Math.min(1, (absOff - treadHalf) / innerHalf) * 0.022);
    for (let segIdx = 0; segIdx <= radialSegs; segIdx++)
      uvAttr.setXY(ptIdx * (radialSegs + 1) + segIdx, (segIdx / radialSegs) * uTiles, vCoord);
  }
  return tireGeo;
}

/**
 * smoothstepRange 的又一份模块内副本，用于纸箱受潮程度的分界过渡
 */
export var smoothstepRangeAlt2 = (edge0, edge1, x) => {
  let n = clampValue((x - edge0) / (edge1 - edge0), 0, 1);
  return n * n * (3 - 2 * n);
};

/**
 * 单只沙袋几何：圆角方块去顶盖后做「中间鼓、两端收、底面压扁」的变形，再叠值噪声做布褶
 */
export function createSandbagGeometry(width, height, depth, rand) {
  let bagGeo = removeGeometryGroup(
      roundedBoxGeometryGrid(width, height, depth, Math.min(height * 0.46, 0.075), 3, 3, 3),
      3,
    ),
    noiseOff = rand() * 9,
    skew = rand.range(-0.05, 0.05),
    sag = rand.range(0.4, 1);
  return (
    mapVertices(bagGeo, (vert) => {
      let normX = vert.x / (width / 2),
        normZ = vert.z / (depth / 2),
        normY = vert.y / (height / 2),
        taper = 1 - 0.22 * Math.pow(Math.abs(normX), 2.5);
      ((vert.z *= taper * (normY < 0 ? 1.05 : 1)),
        (vert.y = (vert.y + height / 2) * (1 - 0.3 * Math.pow(Math.abs(normX), 3)) - height / 2),
        normY > 0 && (vert.y += 0.016 * Math.cos(HALF_PI * normX) * Math.cos(HALF_PI * normZ)),
        (vert.y -=
          sag * 0.018 * Math.abs(normX) * Math.abs(normX) * (normY > -0.9 ? 1 : 0) +
          skew * vert.x * 0.3));
      let noise = valueNoise3D(vert.x * 9 + noiseOff, vert.y * 9, vert.z * 9 + noiseOff) - 0.5;
      ((vert.x += noise * 0.014),
        (vert.z += noise * 0.016),
        normY > -0.9 && (vert.y += noise * 0.014));
    }),
    recomputeSmoothNormals(bagGeo)
  );
}
