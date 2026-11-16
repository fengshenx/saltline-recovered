// weapons/weapon.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { LAYER_VIEWMODEL, LAYER_WORLD } from '../core/config.js';

import { RingMeshBuilder, triangleCount } from '../core/geometry.js';

import {
  clamp,
  damp,
  eulerQuat,
  lerp,
  makeSpring,
  quatFromDirection,
  quatFromPitch,
  quatFromYaw,
  saturate,
  signedPow,
  smoothRange,
  smootherStep,
  stepSpring,
} from '../core/math.js';

import { Quat, Vec3 } from '../core/three-types.js';

import { createMarkingsMesh } from '../enemies/models.js';

import { um } from '../misc.js';

import { PAC9_DAMAGE, PAC9_DIMENSIONS, PAC9_MAG_SIZE, buildPac9Geometry } from './geometry.js';

import {
  buildGloveHand,
  createMuzzleFlash,
  createOpticLens,
  patchPac9DetailMaterial,
} from './rig.js';

/**
 * 武器模块的导出壳，通过 getter 暴露 TUNE 数值表、create 工厂与 showcase 展示场景
 */
export var weaponModule = {};

/**
 * 手套顶点色调：朝上/朝外受光面的 HDR 亮度值，与其它 TONE 常量一起充当无贴图 AO 的色阶
 */
var GLOVE_TONE_TOP = [31, 21.5, 12.5];

/**
 * 手套指节条/织带的中等亮度色调
 */
export var GLOVE_TONE_BAR = [5.6, 5.3, 5];

/**
 * 掌背护板（guard）的偏暗色调，贴合橡胶护片质感
 */
export var GLOVE_TONE_GUARD = [3.2, 3.1, 3];

/**
 * 手指/指缝侧向面的中间调，比顶面暗一档形成圆柱明暗过渡
 */
var GLOVE_TONE_SIDE = [12.5, 10, 7.6];

/**
 * 通用中亮色阶，用于过渡环与指节中段
 */
var GLOVE_TONE_MID = [16, 11, 6.6];

/**
 * 边缘/凹缝的暗色阶，压出指节之间的阴影线
 */
var GLOVE_TONE_EDGE = [3, 2.6, 2.2];

/**
 * 缝线与指节褶皱的高亮色阶，用来让缝线在暗部仍能读出来
 */
export var GLOVE_TONE_SEAM = [36, 27, 16];

/**
 * 袖口褶皱的柔和中间调
 */
export var GLOVE_TONE_SOFT = [20, 14, 8.4];

/**
 * 袖口主体色阶（偏暗），与褶皱高光形成布料层次
 */
export var GLOVE_TONE_CUFF = [4.8, 4.5, 4.2];

/**
 * 袖口拉环/魔术贴拉片的暖色阶
 */
export var GLOVE_TONE_PULLTAB = [30, 9.5, 2.2];

/**
 * 袖子本体的冷暗色阶，让袖管退到最后面
 */
export var GLOVE_TONE_SLEEVE = [5, 6.9, 9];

/**
 * 腕带主体色阶，配合噪声做织物色差
 */
export var GLOVE_TONE_STRAP = [30, 9.5, 2.2];

/**
 * 腕表表带段色阶，是手套上唯一的金属配件区域
 */
export var GLOVE_TONE_WATCH = [26, 26, 25];

/**
 * 手套生成过程中反复复用的临时向量，避免上万次环采样时分配
 */
export var SCRATCH_VEC3 = new Vec3();

/**
 * 手指基准朝向（-Z），每根手指的朝向都由它按四元数旋转得到
 */
var NEG_Z_DIR = new Vec3(0, 0, -1);

/**
 * 四根手指的根部坐标、三节长度与四道半径，是手套手指建模的唯一尺寸来源（拇指另有单独参数）
 */
export var FINGER_SEGMENTS = [
  {
    base: [-0.031, 0, -0.094],
    len: [0.044, 0.026, 0.022],
    rad: [0.0096, 0.009, 0.0083, 0.0076],
  },
  {
    base: [-0.0105, 0.001, -0.099],
    len: [0.049, 0.03, 0.023],
    rad: [0.0097, 0.0091, 0.0084, 0.0077],
  },
  {
    base: [0.0105, 0, -0.095],
    len: [0.045, 0.028, 0.022],
    rad: [0.0094, 0.0088, 0.0081, 0.0074],
  },
  {
    base: [0.03, -0.002, -0.086],
    len: [0.035, 0.021, 0.02],
    rad: [0.0084, 0.0078, 0.0072, 0.0066],
  },
];

/**
 * 16 个不均匀的环向采样角（度转弧度）：掌心/掌背两侧加密、指缝处稀疏，让指节截面出现平面与棱角而不是光滑圆柱
 */
var RING_ANGLES = [12, 34, 44, 68, 90, 112, 136, 146, 168, 192, 220, 245, 270, 295, 320, 348].map(
  (i) => (i * Math.PI) / 180,
);

/**
 * 每环顶点数（等于 RING_ANGLES 长度），RingMeshBuilder 构造时要用
 */
var RING_COUNT = RING_ANGLES.length;

/**
 * 指腹加厚垫的径向外扩量，只在 pad 标记的环上加出去一点点
 */
var PAD_RING_OFFSET = 0.0012;

/**
 * 指节之间的过渡环位置（0..1 归一化弧长，6 个），在关节处额外插环让弯曲不塌陷
 */
var KNUCKLE_RINGS = [0.14, 0.22, 0.27, 0.73, 0.78, 0.88];

/**
 * 三节的默认凸起系数（指根、中节、指尖），控制指节鼓包强度
 */
var FINGER_BUMP = [0.1, 0.17, 0.1];

/**
 * 手指曲面生成器：沿三节骨骼逐环推椭圆截面（可加 pad/stitch/saddle/edge 等表面特征），并按朝向做环间裁切，产出带顶点色的管状手指几何
 */
function buildFinger(spec) {
  let builder = new RingMeshBuilder(RING_COUNT),
    { base: basePoint, qs: jointQuats, len: segmentLengths, rad: segmentRadii } = spec,
    pads = spec.pads || [1, 1, 0],
    patchJoint = spec.patchJ ?? 1,
    bump = spec.bump || FINGER_BUMP,
    tipW = spec.tipW || 1,
    tipH = spec.tipH || 1,
    segmentBases = [],
    segmentDirs = [],
    cursor = basePoint.clone();
  for (let segIdx = 0; segIdx < 3; segIdx++)
    (segmentBases.push(cursor.clone()),
      segmentDirs.push(NEG_Z_DIR.clone().applyQuaternion(jointQuats[segIdx + 1])),
      cursor.addScaledVector(segmentDirs[segIdx], segmentLengths[segIdx]));
  let rootDir = NEG_Z_DIR.clone().applyQuaternion(jointQuats[0]),
    dirAt = (M) => (M ? segmentDirs[M - 1] : rootDir),
    bisectors = [0, 1, 2].map((M) => new Vec3().addVectors(dirAt(M), segmentDirs[M]).normalize()),
    projectAlong = (M, E) =>
      (M.x - segmentBases[E].x) * bisectors[E].x +
      (M.y - segmentBases[E].y) * bisectors[E].y +
      (M.z - segmentBases[E].z) * bisectors[E].z,
    clampPrev = (M, E) => {
      let w = projectAlong(M, E);
      w > 0 && M.addScaledVector(dirAt(E), -w / dirAt(E).dot(bisectors[E]));
    },
    clampNext = (length, strokeW) => {
      let branchDepth = projectAlong(length, strokeW);
      branchDepth < 0 &&
        length.addScaledVector(
          segmentDirs[strokeW],
          -branchDepth / segmentDirs[strokeW].dot(bisectors[strokeW]),
        );
    },
    tmpPos = new Vec3(),
    tmpQuat = new Quat(),
    emitRing = (M, E, w, S) => {
      let z = S.kD || 1,
        H = S.kP || 1,
        O = S.ao || 1;
      for (let q = 0; q < RING_COUNT; q++) {
        let U = Math.cos(RING_ANGLES[q]),
          T = Math.sin(RING_ANGLES[q]),
          D = q >= 1 && q <= 7,
          C = q >= 2 && q <= 6,
          G = w * U,
          j = T > 0 ? w * 0.96 * T * (C ? z : 1 + (z - 1) * 0.4) : w * 0.98 * T * H;
        (S.pad && C && ((G += U * PAD_RING_OFFSET), (j += T * PAD_RING_OFFSET)),
          (G *= S.wx || 1),
          (j *= S.wy || 1),
          tmpPos.set(G, j, 0).applyQuaternion(M).add(E),
          S.a >= 0 && clampPrev(tmpPos, S.a),
          S.b >= 0 && clampNext(tmpPos, S.b));
        let N = D ? GLOVE_TONE_TOP : q >= 10 && q <= 14 ? GLOVE_TONE_SIDE : GLOVE_TONE_MID,
          Q = O;
        (S.pad && C ? (N = GLOVE_TONE_BAR) : S.patch && C && ((N = GLOVE_TONE_MID), (Q *= 0.9)),
          ((S.pad && D && !C) || (S.edge && D)) && (N = GLOVE_TONE_EDGE),
          S.saddle && q >= 8 && ((N = GLOVE_TONE_SIDE), (Q *= 0.9)),
          S.stitch && D && ((N = GLOVE_TONE_SEAM), (Q *= 0.8)),
          (q === 0 || q === 8 || q === 9 || q === 15) && (Q *= 0.72),
          q >= 9 && (Q *= S.aoP || 1),
          builder.v(tmpPos, N, Q));
      }
    };
  (emitRing(
    jointQuats[0],
    SCRATCH_VEC3.copy(segmentBases[0]).addScaledVector(rootDir, -(spec.rootBack || 0.012) - 0.002),
    1e-5,
    {
      a: 0,
      b: -1,
      ao: spec.rootAo || 0.5,
    },
  ),
    builder.collapse(),
    emitRing(
      jointQuats[0],
      SCRATCH_VEC3.copy(segmentBases[0]).addScaledVector(rootDir, -(spec.rootBack || 0.012)),
      segmentRadii[0] * (spec.rootK || 1),
      {
        a: 0,
        b: -1,
        ao: spec.rootAo || 0.5,
        saddle: spec.saddle,
      },
    ));
  for (let segIdx = 0; segIdx < 3; segIdx++) {
    for (let ringIdx = 0; ringIdx < 4; ringIdx++) {
      let ringRadius = ringIdx / 3;
      (tmpQuat.slerpQuaternions(jointQuats[segIdx], jointQuats[segIdx + 1], ringRadius),
        emitRing(
          tmpQuat,
          SCRATCH_VEC3.copy(segmentBases[segIdx]).addScaledVector(
            ringIdx < 2 ? dirAt(segIdx) : segmentDirs[segIdx],
            (ringIdx - 1.5) * 4e-4,
          ),
          segmentRadii[segIdx],
          {
            a: ringRadius < 0.5 ? segIdx : -1,
            b: ringRadius < 0.5 ? -1 : segIdx,
            kD: 1 + bump[segIdx] * (ringIdx === 0 || ringIdx === 3 ? 0.55 : 1),
            patch: segIdx === patchJoint,
            saddle: spec.saddle && segIdx < 2,
            wx: segIdx === 2 ? 1 + (tipW - 1) * 0.5 : 1,
            wy: segIdx === 2 ? 1 + (tipH - 1) * 0.5 : 1,
            ao: segIdx === 0 && !spec.rootAo ? 0.62 + 0.1 * ringIdx : 1,
            aoP: ringIdx === 1 || ringIdx === 2 ? 0.55 : 0.8,
          },
        ));
    }
    if (segIdx < 2)
      for (let ringIdx = 0; ringIdx < KNUCKLE_RINGS.length; ringIdx++) {
        let ringRadius = KNUCKLE_RINGS[ringIdx],
          ringOpts =
            (segmentRadii[segIdx] +
              (segmentRadii[segIdx + 1] - segmentRadii[segIdx]) * ringRadius) *
            (1 - 0.06 * Math.sin(Math.PI * ringRadius));
        emitRing(
          jointQuats[segIdx + 1],
          SCRATCH_VEC3.copy(segmentBases[segIdx]).addScaledVector(
            segmentDirs[segIdx],
            segmentLengths[segIdx] * ringRadius,
          ),
          ringOpts,
          {
            a: segIdx + 1,
            b: segIdx,
            pad: pads[segIdx] && (ringIdx === 2 || ringIdx === 3),
            edge: pads[segIdx] && (ringIdx === 1 || ringIdx === 4),
            saddle: spec.saddle && segIdx === 0,
            ao: segIdx === 0 && !spec.rootAo ? 0.86 + 0.14 * smoothRange(0, 0.5, ringRadius) : 1,
          },
        );
      }
    else {
      let ringIdx = segmentRadii[3],
        ringRadius = segmentLengths[2] - ringIdx;
      (emitRing(
        jointQuats[3],
        SCRATCH_VEC3.copy(segmentBases[2]).addScaledVector(segmentDirs[2], segmentLengths[2] * 0.2),
        segmentRadii[2] * 0.97,
        {
          a: -1,
          b: 2,
          stitch: 1,
          wx: tipW,
          wy: tipH,
        },
      ),
        emitRing(
          jointQuats[3],
          SCRATCH_VEC3.copy(segmentBases[2]).addScaledVector(
            segmentDirs[2],
            segmentLengths[2] * 0.42,
          ),
          (segmentRadii[2] + ringIdx) * 0.5,
          {
            a: -1,
            b: 2,
            kP: 1.08,
            wx: tipW,
            wy: tipH,
          },
        ));
      for (let ringOpts of [0, 0.6, 1.05, 1.36])
        emitRing(
          jointQuats[3],
          SCRATCH_VEC3.copy(segmentBases[2]).addScaledVector(
            segmentDirs[2],
            ringRadius + ringIdx * 1.08 * Math.sin(ringOpts),
          ),
          ringIdx * Math.cos(ringOpts),
          {
            a: -1,
            b: -1,
            kP: 1.06,
            wx: tipW,
            wy: tipH,
          },
        );
      (emitRing(
        jointQuats[3],
        SCRATCH_VEC3.copy(segmentBases[2]).addScaledVector(
          segmentDirs[2],
          ringRadius + ringIdx * 1.08,
        ),
        1e-5,
        {
          a: -1,
          b: -1,
        },
      ),
        builder.collapse());
    }
  }
  return builder.geo();
}

/**
 * 把尺寸表里的一行（根部+长度+半径）和四元数姿态装配成 buildFinger 的入参，指尖多一个偏摆量
 */
export function buildFingerFromSpec(spec, pose) {
  let quats = [quatFromYaw(pose[3] || 0)];
  for (let jointIndex = 0; jointIndex < 3; jointIndex++)
    quats.push(quats[jointIndex].clone().multiply(quatFromPitch(-pose[jointIndex])));
  return buildFinger({
    base: new Vec3(spec.base[0], spec.base[1], spec.base[2]),
    qs: quats,
    len: spec.len,
    rad: spec.rad,
  });
}

/**
 * 拇指生成器：把三节方向转成四元数后套用 buildFinger，并开启 saddle/patch/tip 收窄等拇指专属参数
 */
export function buildThumb(thumbDirs) {
  let dirVecs = thumbDirs.map((o) => new Vec3(o[0], o[1], o[2]).normalize()),
    splayDir = new Vec3(-0.72, 0.69, 0),
    quats = [],
    spanVec = dirVecs[2].clone().sub(dirVecs[0]);
  spanVec.length() > 0.12 && splayDir.multiplyScalar(0.25).addScaledVector(spanVec.normalize(), -1);
  for (let segIdx = 0; segIdx < 3; segIdx++)
    quats.push(quatFromDirection(dirVecs[segIdx], splayDir));
  return (
    quats.unshift(quats[0].clone()),
    buildFinger({
      base: new Vec3(-0.028, -0.007, -0.014),
      qs: quats,
      len: [0.044, 0.031, 0.026],
      rad: [0.0165, 0.0118, 0.011, 0.01],
      pads: [0, 1, 0],
      patchJ: 2,
      bump: [0, 0.2, 0.2],
      tipW: 1.12,
      tipH: 0.86,
      saddle: 1,
      rootBack: 0.01,
      rootK: 0.72,
      rootAo: 0.9,
    })
  );
}

/**
 * 掌根（手腕侧）的 Z 基准，掌面截面与贴合高度都以它为零点
 */
var PALM_WRIST_Z = 0.006;

/**
 * 掌面沿横向 x 的 Z 轮廓（抛物线），决定掌心是弧形而不是平板
 */
export var palmProfileZ = (x) => -0.0975 + 0.0125 * Math.pow((x + 0.008) / 0.04, 2);

/**
 * 掌面轮廓往里偏 6mm 的内层曲线，用于把表面参数归一化到掌根
 */
var palmProfileZInner = (x) => palmProfileZ(x) + 0.006;

/**
 * 掌面半宽随掌根到指尖的渐变，指尖处收窄
 */
var palmHalfWidth = (t) => 0.029 + 0.014 * smoothRange(0.05, 0.85, t);

/**
 * 掌背侧的截面半径随长度变化（靠手腕更厚）
 */
var palmTopRadius = (t) => 0.0185 - 0.0065 * smoothRange(0.1, 1, t);

/**
 * 掌心侧的截面半径，带正弦起伏表现掌垫，比掌背略鼓
 */
var palmBottomRadius = (t) =>
  0.0185 + 0.003 * Math.sin(Math.PI * um(t * 1.6)) - 0.0055 * smoothRange(0.3, 1, t);

/**
 * 给定(x,z)求掌背表面高度，护板与指节条要贴在这个高度上才不会穿模
 */
export function palmTopY(x, z) {
  let t = um((PALM_WRIST_Z - z) / (PALM_WRIST_Z - palmProfileZInner(x))),
    n = Math.min(0.999, Math.abs(x / palmHalfWidth(t)));
  return palmTopRadius(t) * Math.pow(1 - Math.pow(n, 2.5), 0.4);
}

/**
 * 给定(x,z)求掌心（下方）表面高度，掌根垫片用它贴合
 */
export function palmBottomY(acrossX, alongZ) {
  let profileT = um((PALM_WRIST_Z - alongZ) / (PALM_WRIST_Z - palmProfileZInner(acrossX))),
    halfWidth = palmHalfWidth(profileT),
    normX = Math.min(0.999, Math.abs(acrossX / halfWidth));
  return (
    palmBottomRadius(profileT) *
    Math.pow(1 - Math.pow(normX, 2.5), 0.4) *
    (1 + 0.14 * Math.max(0, acrossX / halfWidth) * Math.sin(Math.PI * profileT))
  );
}

/**
 * 手掌主体：12 个纵向截面 × 24 环推超椭圆截面，指尖端收口，产出带明暗色阶的掌心几何
 */
export function buildPalm() {
  let ringBuilder = new RingMeshBuilder(24),
    scratchVec = new Vec3(),
    profile = [
      [0, 0, 1, 1],
      [0.1, 0, 1, 1],
      [0.22, 0, 1, 1],
      [0.36, 0, 1, 1],
      [0.5, 0, 1, 1],
      [0.64, 0, 1, 1],
      [0.77, 0, 1, 1],
      [0.89, 0, 1, 1],
      [1, 0, 1, 1],
      [1, -0.005, 0.8, 1],
      [1, -0.009, 0.45, 0.985],
      [1, -0.0105, 0.04, 0.97],
    ];
  for (let [station, zOffset, radiusScale, widthScale] of profile) {
    let halfWidth = palmHalfWidth(station) * widthScale,
      topRadius = palmTopRadius(station) * radiusScale,
      bottomRadius = palmBottomRadius(station) * radiusScale;
    for (let ringIdx = 0; ringIdx < 24; ringIdx++) {
      let ringAngle = ((ringIdx + 0.5) / 24) * Math.PI * 2,
        cosA = Math.cos(ringAngle),
        sinA = Math.sin(ringAngle),
        xCoord = halfWidth * signedPow(cosA, 0.8),
        yCoord =
          sinA >= 0
            ? topRadius * signedPow(sinA, 0.8)
            : bottomRadius *
              signedPow(sinA, 0.8) *
              (1 + 0.14 * Math.max(0, xCoord / halfWidth) * Math.sin(Math.PI * station));
      scratchVec.set(
        xCoord,
        yCoord,
        PALM_WRIST_Z + (palmProfileZInner(xCoord) - PALM_WRIST_Z) * station + zOffset,
      );
      let toneColor = sinA > 0.3 ? GLOVE_TONE_TOP : sinA < -0.3 ? GLOVE_TONE_SIDE : GLOVE_TONE_MID,
        toneShade = 1;
      (station === 0.1 && sinA > 0.3 && ((toneColor = GLOVE_TONE_SEAM), (toneShade = 0.75)),
        zOffset < 0 && ((toneColor = GLOVE_TONE_MID), (toneShade = 0.7 + zOffset * 30)),
        sinA < -0.3 && (toneShade *= 0.82 + 0.18 * Math.abs(cosA)),
        ringBuilder.v(scratchVec, toneColor, toneShade));
    }
  }
  return ringBuilder.geo();
}

/**
 * 拇指与食指之间的虎口连接体：沿拇指方向做 7 段椭圆扫掠并收口，最后按有向体积修正索引朝向
 */
export function buildThumbWeb(thumbDir) {
  let ringBuilder = new RingMeshBuilder(12),
    ringPoint = new Vec3(),
    sectionCenter = new Vec3(),
    innerPoint = new Vec3(),
    ringDir = new Vec3(),
    sideAxis = new Vec3(),
    webNormal = new Vec3(thumbDir.x, thumbDir.y, thumbDir.z - 1).normalize(),
    sectionTs = [-0.12, 0, 0.2, 0.4, 0.6, 0.78, 0.9];
  for (let sectionIndex = 0; sectionIndex < sectionTs.length; sectionIndex++) {
    let sectionT = sectionTs[sectionIndex],
      isCapSection = sectionIndex === 0 || sectionIndex === sectionTs.length - 1;
    (sectionCenter.set(-0.028, -0.007, -0.014).addScaledVector(thumbDir, 0.044 * sectionT),
      innerPoint.set(-0.03, -0.003, -0.022 - 0.06 * sectionT),
      ringDir.subVectors(sectionCenter, innerPoint));
    let ringRadius = ringDir.length() * 0.5 + 0.005;
    (ringDir.normalize(), sideAxis.crossVectors(ringDir, webNormal).normalize());
    let ringThickness = isCapSection ? 1e-5 : 0.0085 * (1 - 0.55 * sectionT),
      halfWidth = isCapSection ? 1e-5 : ringRadius * (1 - 0.3 * sectionT * sectionT);
    for (let ringSegIndex = 0; ringSegIndex < 12; ringSegIndex++) {
      let segAngle = ((ringSegIndex + 0.5) / 12) * Math.PI * 2,
        cosA = Math.cos(segAngle),
        sinA = Math.sin(segAngle);
      ringPoint
        .copy(sectionCenter)
        .add(innerPoint)
        .multiplyScalar(0.5)
        .addScaledVector(ringDir, cosA * halfWidth)
        .addScaledVector(sideAxis, sinA * ringThickness);
      let isSideFace = sideAxis.y * sinA < 0;
      ringBuilder.v(
        ringPoint,
        isSideFace ? GLOVE_TONE_SIDE : GLOVE_TONE_TOP,
        isSideFace ? 0.85 : 0.92,
      );
    }
    isCapSection && ringBuilder.collapse();
  }
  let webGeo = ringBuilder.geo(),
    positionAttr = webGeo.attributes.position,
    indexArray = webGeo.index.array,
    signedVolume = 0;
  for (let sectionIndex = 0; sectionIndex < indexArray.length; sectionIndex += 3)
    (sectionCenter.fromBufferAttribute(positionAttr, indexArray[sectionIndex]),
      innerPoint.fromBufferAttribute(positionAttr, indexArray[sectionIndex + 1]),
      ringPoint.fromBufferAttribute(positionAttr, indexArray[sectionIndex + 2]),
      (signedVolume += sectionCenter.dot(innerPoint.cross(ringPoint))));
  if (signedVolume < 0) {
    for (let sectionIndex = 0; sectionIndex < indexArray.length; sectionIndex += 3) {
      let sectionT = indexArray[sectionIndex + 1];
      ((indexArray[sectionIndex + 1] = indexArray[sectionIndex + 2]),
        (indexArray[sectionIndex + 2] = sectionT));
    }
    webGeo.computeVertexNormals();
  }
  return webGeo;
}

/**
 * 武器材质共享的淋雨强度 uniform，由武器 setWetness 写入，多个材质 patch 共用同一引用
 */
export var PAC9_RAIN_UNIFORM = {
  value: 1,
};

/**
 * THREE.Vector3 的短别名，武器视图模型装配与展示台里大量使用
 */
var WeaponVec3 = THREE.Vector3;

/**
 * THREE.Quaternion 的短别名，手持姿态与换弹关键帧插值用
 */
export var WeaponQuat = THREE.Quaternion;

/**
 * 初始备弹数（150 发）
 */
var PAC9_RESERVE_AMMO = 150;

/**
 * 射速（720 发/分），换算成每发冷却 60/720 秒，决定连发节奏
 */
var PAC9_RPM = 720;

/**
 * 射线最大射程（300 米），也是没命中时的曳光终点距离
 */
var PAC9_RANGE = 300;

/**
 * 腰射基准姿态（位置+欧拉角），ADS 姿态与它按 adsE 插值得到最终视图模型偏移
 */
var HIP_POSE = {
  p: [0.118, -0.122, -0.275],
  r: [0.034, 0.085, -0.03],
};

/**
 * 瞄准姿态：把枪抬到镜片高度并对正屏幕中心，位置与 HIP_POSE 按 adsE 插值
 */
var ADS_POSE = {
  p: [0, -PAC9_DIMENSIONS.sightY, -0.135],
  r: [0, 0, 0],
};

/**
 * 冲刺时枪口下压斜持的姿态增量，按 sprintT 权重叠加
 */
var SPRINT_POSE = {
  p: [-0.035, 0.004, 0.03],
  r: [-0.04, 0.62, 0.26],
};

/**
 * 换弹时把枪压向屏幕下方并侧倾的姿态增量，按 reloadW 权重叠加
 */
var RELOAD_POSE = {
  p: [-0.03, 0.1, -0.02],
  r: [0.46, 0.22, -0.8],
};

/**
 * 弹匣里还有子弹时的换弹时长（2.1 秒），不包含拉栓
 */
var RELOAD_TIME_TACTICAL = 2.1;

/**
 * 空仓换弹时长（2.72 秒），多出挂机拉栓一段关键帧
 */
var RELOAD_TIME_EMPTY = 2.72;

/**
 * 构建 pac9 步枪的第一人称视图模型：程序化几何 + 双手手套手指绑定 + 金属铭牌贴花 + 枪口焰，并返回带开火/换弹/ADS/惯性摆动状态的 weapon 对象；整个模型挂在相机下，只走 viewmodel layer 以免被世界裁切
 */
export async function createWeapon(ctx) {
  let root = new THREE.Group();
  root.name = 'viewmodel-pac9';
  let parts = buildPac9Geometry(),
    materialScales = {
      anodized_black: 2,
      gunmetal: 2,
      brass: 4,
      glove_fabric: 3,
      rubber: 4,
    },
    getMat = (Me) =>
      ctx.mats.get(Me, {
        triplanar: !0,
        vertexColors: !0,
        scale: materialScales[Me] || 1,
      }),
    makeMesh = (Me, we) => {
      let be = new THREE.Mesh(Me, we);
      return ((be.castShadow = !1), (be.receiveShadow = !0), (be.frustumCulled = !1), be);
    },
    anodisedMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.0085, 0.009, 0.0105),
      roughness: 0.4,
      metalness: 0.45,
      vertexColors: !0,
    });
  ((anodisedMat.name = 'pac9_anodised'), patchPac9DetailMaterial(anodisedMat, 0));
  let matteMat = new THREE.MeshStandardMaterial({
    color: 16777215,
    roughness: 0.92,
    metalness: 0,
    vertexColors: !0,
  });
  matteMat.name = 'pac9_matte';
  let phosphateMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.016, 0.016, 0.0165),
    roughness: 0.5,
    metalness: 0.7,
    vertexColors: !0,
  });
  ((phosphateMat.name = 'pac9_phosphate'), patchPac9DetailMaterial(phosphateMat, 1));
  let polymerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.0125, 0.0128, 0.0135),
    roughness: 0.62,
    metalness: 0,
    vertexColors: !0,
  });
  ((polymerMat.name = 'pac9_polymer'), patchPac9DetailMaterial(polymerMat, 2));
  let tanPolymerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.105, 0.08, 0.05),
    roughness: 0.62,
    metalness: 0,
    vertexColors: !0,
  });
  ((tanPolymerMat.name = 'pac9_polymer_tan'),
    patchPac9DetailMaterial(tanPolymerMat, 2),
    root.add(
      makeMesh(parts.ano, anodisedMat),
      makeMesh(parts.gun, phosphateMat),
      makeMesh(parts.poly, polymerMat),
      makeMesh(parts.plain, matteMat),
    ));
  let boltMesh = makeMesh(parts.bolt, phosphateMat);
  root.add(boltMesh);
  let magGroup = new THREE.Group(),
    magRestPos = new WeaponVec3().fromArray(PAC9_DIMENSIONS.magPos);
  magGroup.position.copy(magRestPos);
  let roundMesh = makeMesh(parts.round, getMat('brass'));
  (magGroup.add(makeMesh(parts.mag, tanPolymerMat), roundMesh), root.add(magGroup));
  let markingsMesh = null,
    opticGlass = null,
    flashMesh = null;
  try {
    ((markingsMesh = createMarkingsMesh([
      ['model', -0.0168, -0.0315, 0.064, 0.0095, 'L'],
      ['maker', -0.0168, -0.042, 0.064, 0.003, 'L'],
      ['cal', -0.0168, -0.0465, 0.064, 0.0028, 'L'],
      ['prop', -0.0168, -0.071, 0.066, 0.0026, 'L'],
      ['auto', -0.0168, -0.027, -0.0335, 0.0036, 'L'],
      ['semi', -0.0168, -0.0262, -0.049, 0.0036, 'L'],
      ['safe', -0.0168, -0.0362, -0.062, 0.0036, 'L'],
      ['rack', -0.0168, -0.004, -0.205, 0.02, 'L'],
      ['warn', -0.0181, -0.01, 0.03, 0.0062, 'L'],
      ['optic', -0.0195, 0.0735, 0.021, 0.0024, 'L'],
      ['model', 0.0168, -0.0315, 0.068, 0.0095, 'R'],
      ['warn', 0.0168, -0.066, 0.066, 0.0075, 'R'],
      ['rack', 0.0168, -0.004, -0.205, 0.02, 'R'],
      ['auto', 0.0168, -0.027, -0.0335, 0.0036, 'R'],
      ['safe', 0.0168, -0.0362, -0.062, 0.0036, 'R'],
      ['optic', 0.0195, 0.0735, 0.021, 0.0024, 'R'],
      ['cal', 0.0181, 0.0245, -0.055, 0.0026, 'R'],
      ['r2', 0, 0.04365, -0.0816, 0.003, 'T'],
      ['r4', 0, 0.04365, -0.0616, 0.003, 'T'],
      ['r6', 0, 0.04365, 0.0584, 0.003, 'T'],
      ['r8', 0, 0.04365, 0.0784, 0.003, 'T'],
      ['r10', 0, 0.04365, 0.0984, 0.003, 'T'],
      ['r12', 0, 0.04365, 0.1184, 0.003, 'T'],
    ])),
      (markingsMesh.castShadow = !1),
      (markingsMesh.receiveShadow = !0),
      (markingsMesh.frustumCulled = !1),
      root.add(markingsMesh));
  } catch (Me) {
    console.warn('[weapon] markings skipped: ' + Me);
  }
  ((opticGlass = createOpticLens(
    PAC9_DIMENSIONS.window.map((Me) => [
      Me[0] * 1.01,
      (Me[1] - PAC9_DIMENSIONS.sightY) * 1.01 + PAC9_DIMENSIONS.sightY,
    ]),
    PAC9_DIMENSIONS.lensF + 0.0025,
  )),
    (opticGlass.frustumCulled = !1),
    root.add(opticGlass),
    (flashMesh = createMuzzleFlash()),
    flashMesh.position.fromArray(PAC9_DIMENSIONS.muzzle),
    (flashMesh.visible = !1),
    root.add(flashMesh));
  let toHandSpace = (Me, we, be) => {
      let Oe = new WeaponVec3(we[0], we[1], we[2]).normalize().applyQuaternion(Me.clone().invert());
      return (be && (Oe.x *= -1), [Oe.x, Oe.y, Oe.z]);
    },
    rightHandQuat = eulerQuat(-0.24, 0, 0).multiply(eulerQuat(0, 0, -Math.PI / 2)),
    rightGlove = buildGloveHand({
      mirror: !1,
      fingers: [null, [0.62, 1.72, 0.8, 0], [0.68, 1.7, 0.8, -0.03], [0.74, 1.66, 0.8, -0.09]],
      indexPoses: [
        [0.1, 0.16, 0.1, 0.05],
        [0.46, 1.15, 0.5, 0],
      ],
      thumb: [
        toHandSpace(rightHandQuat, [-0.85, 0.05, -0.5]),
        toHandSpace(rightHandQuat, [-0.6, -0.05, -0.8]),
        toHandSpace(rightHandQuat, [-0.05, -0.2, -0.97]),
      ],
      forearm: toHandSpace(rightHandQuat, [0.27, -0.44, 0.86]),
      sleeve: 0.34,
    }),
    rightHandGroup = new THREE.Group();
  (rightHandGroup.quaternion.copy(rightHandQuat),
    rightHandGroup.position
      .fromArray(PAC9_DIMENSIONS.grip)
      .sub(new WeaponVec3(0.006, -0.031, -0.085).applyQuaternion(rightHandQuat)));
  let gloveMat = getMat('glove_fabric');
  rightHandGroup.add(makeMesh(rightGlove.fabric, gloveMat));
  let indexFingerMesh = makeMesh(rightGlove.index[0].clone(), gloveMat);
  (rightHandGroup.add(indexFingerMesh), root.add(rightHandGroup));
  let fingerRestAttrs = rightGlove.index[0].attributes,
    fingerCurlAttrs = rightGlove.index[1].attributes,
    fingerBlend = -1;
  function setFingerCurl(Me) {
    if (Math.abs(Me - fingerBlend) < 0.004) return;
    fingerBlend = Me;
    let we = indexFingerMesh.geometry.attributes.position,
      be = indexFingerMesh.geometry.attributes.normal,
      Oe = fingerRestAttrs.position.array,
      pt = fingerCurlAttrs.position.array,
      ut = fingerRestAttrs.normal.array,
      nn = fingerCurlAttrs.normal.array;
    for (let bt = 0; bt < Oe.length; bt++)
      ((we.array[bt] = Oe[bt] + (pt[bt] - Oe[bt]) * Me),
        (be.array[bt] = ut[bt] + (nn[bt] - ut[bt]) * Me));
    ((we.needsUpdate = !0), (be.needsUpdate = !0));
  }
  let leftHandQuat = eulerQuat(0, 0, Math.PI / 2).multiply(eulerQuat(0.06, 0, 0)),
    leftGlove = buildGloveHand({
      mirror: !0,
      fingers: [
        [1.27, 1.42, 0.75, 0.02],
        [1.3, 1.45, 0.75, 0],
        [1.3, 1.45, 0.75, -0.02],
        [1.33, 1.45, 0.75, -0.05],
      ],
      thumb: [
        toHandSpace(leftHandQuat, [0, 0.25, -0.97], !0),
        toHandSpace(leftHandQuat, [0.05, 0.1, -0.99], !0),
        toHandSpace(leftHandQuat, [0, 0, -1], !0),
      ],
      forearm: toHandSpace(leftHandQuat, [-0.5, -0.35, 0.79], !0),
      sleeve: 0.34,
    }),
    leftHandGroup = new THREE.Group();
  (leftHandGroup.add(makeMesh(leftGlove.fabric, gloveMat)), root.add(leftHandGroup));
  let handPivot = new WeaponVec3(0, -0.015, -0.055),
    makePose = (Me, we, be = handPivot) => ({
      q: Me.clone(),
      p: new WeaponVec3(we[0], we[1], we[2]).sub(be.clone().applyQuaternion(Me)),
    }),
    offsetPose = (Me, we, be, Oe, pt = null) => ({
      q: pt ? pt.clone() : Me.q.clone(),
      p: Me.p.clone().add(new WeaponVec3(we, be, Oe)),
    }),
    boltHandQuat = eulerQuat(0, 0, Math.PI / 2).multiply(eulerQuat(0.12, 0, 0)),
    leftGripPose = makePose(leftHandQuat, [-0.015, -0.062, -0.236]),
    leftWorkPose = makePose(boltHandQuat, [-0.0135, -0.15, -0.0745]),
    leftReachPose = offsetPose(leftWorkPose, -0.035, -0.02, 0.01),
    leftPullPose = offsetPose(
      leftWorkPose,
      -0.06,
      -0.3,
      0.13,
      boltHandQuat.clone().multiply(eulerQuat(-0.5, 0, 0.25)),
    ),
    leftPushPose = offsetPose(leftWorkPose, 0, -0.035, 0.004),
    leftTapPose = offsetPose(leftWorkPose, -0.004, -0.06, 0),
    leftSettlePose = offsetPose(leftWorkPose, 0, -0.012, 0),
    boltHandBaseQuat = eulerQuat(-0.6, 0, 0).multiply(
      new WeaponQuat().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          new WeaponVec3(0, 0, 1),
          new WeaponVec3(-1, 0, 0),
          new WeaponVec3(0, -1, 0),
        ),
      ),
    ),
    boltHandPose = makePose(
      boltHandBaseQuat,
      [
        PAC9_DIMENSIONS.handlePos[0] - 0.004,
        PAC9_DIMENSIONS.handlePos[1],
        PAC9_DIMENSIONS.handlePos[2],
      ],
      new WeaponVec3(0, -0.024, -0.118),
    ),
    boltHandPullPose = offsetPose(boltHandPose, 0, 0, PAC9_DIMENSIONS.boltTravel),
    reloadTrack = [
      [0, leftGripPose],
      [0.1, leftGripPose],
      [0.36, leftReachPose],
      [0.44, leftWorkPose],
      [0.5, leftWorkPose],
      [0.8, leftPullPose],
      [0.98, leftPullPose],
      [1.28, leftPushPose],
      [1.35, leftWorkPose],
      [1.45, leftTapPose],
      [1.52, leftSettlePose],
      [1.62, leftWorkPose],
      [1.7, leftReachPose],
      [2.02, leftGripPose],
      [9, leftGripPose],
    ],
    reloadEmptyTrack = [
      ...reloadTrack.slice(0, 12),
      [1.7, leftReachPose],
      [1.96, boltHandPose],
      [2.02, boltHandPose],
      [2.14, boltHandPullPose],
      [2.19, boltHandPullPose],
      [2.26, boltHandPose],
      [2.36, boltHandPose],
      [2.66, leftGripPose],
      [9, leftGripPose],
    ],
    MAG_OUT_T = 0.47,
    MAG_IN_T = 1.345,
    BOLT_PULL_T = 2.02,
    BOLT_FULL_T = 2.14,
    BOLT_RELEASE_T = 2.19,
    trackPos = new WeaponVec3(),
    trackQuat = new WeaponQuat(),
    magAttachQuat = new WeaponQuat(),
    spareVecA = new WeaponVec3(),
    spareVecB = new WeaponVec3(),
    spareVecC = new WeaponVec3();
  function sampleTrack(Me, we) {
    let be = 0;
    for (; be < Me.length - 2 && we > Me[be + 1][0];) be++;
    let Oe = Me[be],
      pt = Me[be + 1],
      ut = smootherStep((we - Oe[0]) / Math.max(1e-4, pt[0] - Oe[0]));
    (trackPos.copy(Oe[1].p).lerp(pt[1].p, ut), trackQuat.copy(Oe[1].q).slerp(pt[1].q, ut));
  }
  (leftHandGroup.position.copy(leftGripPose.p), leftHandGroup.quaternion.copy(leftGripPose.q));
  let boltHandInvQuat = boltHandQuat.clone().invert();
  (root.traverse((Me) => {
    Me.layers.set(LAYER_VIEWMODEL);
  }),
    ctx.camera.add(root));
  let triCount =
      Object.values(parts).reduce((Me, we) => Me + triangleCount(we), 0) +
      triangleCount(rightGlove.fabric) +
      triangleCount(rightGlove.index[0]) +
      triangleCount(leftGlove.fabric) +
      (markingsMesh ? triangleCount(markingsMesh.geometry) : 0) +
      2,
    meshCount = 0;
  (root.traverse((Me) => {
    Me.isMesh && meshCount++;
  }),
    console.log(
      `[weapon] ${PAC9_DIMENSIONS.name}: ${Math.round(triCount)} tris, ${meshCount} meshes (flash only while firing)`,
    ));
  let rand = ctx.rng && ctx.rng.fork ? ctx.rng.fork() : Math.random,
    anim = {
      t: 0,
      cooldown: 0,
      prevFire: !1,
      dryDone: !1,
      autoReload: -1,
      reload: null,
      burst: 0,
      lastShot: -9,
      bloom: 0,
      heat: 0,
      smoke: 0,
      smokeTick: 0,
      adsLin: 0,
      adsE: 0,
      sprintT: 0,
      reloadW: 0,
      rackW: 0,
      bobPhase: 0,
      bobAmt: 0,
      finger: 0,
      boltT: 9,
      boltLocked: !1,
      flashT: 0,
      flashDur: 0.05,
      recPhase: 0,
      wasGround: !0,
      lastVy: 0,
      spreadS: 0.0125,
      idleT: 0,
      inspect: -1,
      kZ: makeSpring(520, 30),
      kP: makeSpring(380, 26),
      kY: makeSpring(300, 22),
      kR: makeSpring(300, 20),
      swY: makeSpring(110, 15),
      swP: makeSpring(110, 15),
      jY: makeSpring(140, 13),
      jP: makeSpring(140, 13),
      bump: makeSpring(600, 30),
    },
    debug = {
      freeze: !1,
      reloadT: null,
      empty: !1,
      flash: !1,
      noFire: !1,
    },
    weapon = {
      name: PAC9_DIMENSIONS.name,
      ammo: PAC9_MAG_SIZE,
      magSize: PAC9_MAG_SIZE,
      reserve: PAC9_RESERVE_AMMO,
      state: 'idle',
      ads: 0,
      spread: 0.0125,
      damage: PAC9_DAMAGE,
      rpm: PAC9_RPM,
      root: root,
      debug: debug,
      info: {
        tris: Math.round(triCount),
        meshes: meshCount,
      },
      update: update,
      reset: resetWeapon,
      setVisible(Me) {
        root.visible = !!Me;
      },
      muzzleWorld: muzzleWorld,
      reloadNow: startReload,
      addAmmo(Me) {
        weapon.reserve += Me;
      },
      setWetness(Me) {
        PAC9_RAIN_UNIFORM.value = Math.max(0, Math.min(1, +Me || 0));
      },
      snap() {
        anim.adsLin = ctx.input.ads ? 1 : 0;
        for (let Me of ['kZ', 'kP', 'kY', 'kR', 'swY', 'swP', 'jY', 'jP', 'bump'])
          ((anim[Me].x = 0), (anim[Me].v = 0));
        anim.sprintT = ctx.player.sprinting ? 1 : 0;
      },
    };
  function resetWeapon() {
    ((weapon.ammo = PAC9_MAG_SIZE),
      (weapon.reserve = PAC9_RESERVE_AMMO),
      (weapon.state = 'idle'),
      (weapon.ads = 0),
      Object.assign(anim, {
        cooldown: 0,
        prevFire: !1,
        dryDone: !1,
        autoReload: -1,
        reload: null,
        burst: 0,
        lastShot: -9,
        bloom: 0,
        heat: 0,
        smoke: 0,
        adsLin: 0,
        adsE: 0,
        sprintT: 0,
        reloadW: 0,
        boltT: 9,
        boltLocked: !1,
        flashT: 0,
        idleT: 0,
        inspect: -1,
      }));
    for (let Me of ['kZ', 'kP', 'kY', 'kR', 'swY', 'swP', 'jY', 'jP', 'bump'])
      ((anim[Me].x = 0), (anim[Me].v = 0));
    ((roundMesh.visible = !0),
      (magGroup.visible = !0),
      magGroup.position.copy(magRestPos),
      magGroup.quaternion.identity(),
      leftHandGroup.position.copy(leftGripPose.p),
      leftHandGroup.quaternion.copy(leftGripPose.q));
  }
  let spareMatrix = new THREE.Matrix4();
  function toWorld(Me, we) {
    (root.updateMatrix(), we.fromArray(Me).applyMatrix4(root.matrix));
    let be = ctx.camera,
      Oe = Math.tan((be.fov * Math.PI) / 360) / Math.tan((ctx.viewCamera.fov * Math.PI) / 360);
    return ((we.x *= Oe), (we.y *= Oe), we.applyQuaternion(be.quaternion).add(be.position));
  }
  function muzzleWorld(Me = new WeaponVec3()) {
    return toWorld(PAC9_DIMENSIONS.muzzle, Me);
  }
  function startReload() {
    if (anim.reload || weapon.ammo >= weapon.magSize || weapon.reserve <= 0) return !1;
    let Me = weapon.ammo <= 0;
    return (
      (anim.reload = {
        t: 0,
        T: Me ? RELOAD_TIME_EMPTY : RELOAD_TIME_TACTICAL,
        empty: Me,
        f: {},
      }),
      (anim.autoReload = -1),
      ctx.events.emit('weapon:reload', {
        phase: 'start',
        empty: Me,
      }),
      !0
    );
  }
  let shotDir = new WeaponVec3(),
    muzzlePos = new WeaponVec3(),
    hitPoint = new WeaponVec3(),
    ejectPos = new WeaponVec3(),
    ejectVel = new WeaponVec3(),
    shotOrigin = new WeaponVec3();
  function fireShot() {
    let Me = ctx.player,
      we = ctx.camera;
    (weapon.ammo--,
      anim.burst++,
      (anim.lastShot = anim.t),
      (anim.heat = Math.min(1.3, anim.heat + 0.05)));
    let be = weapon.spread,
      Oe = rand() * Math.PI * 2,
      pt = Math.tan(be) * Math.sqrt(rand());
    (shotDir
      .set(Math.cos(Oe) * pt, Math.sin(Oe) * pt, -1)
      .normalize()
      .applyQuaternion(we.quaternion),
      shotOrigin.copy(Me.eye || we.position));
    let ut = null;
    try {
      ut = ctx.combat.playerShot(shotOrigin, shotDir, {
        damage: PAC9_DAMAGE,
        range: PAC9_RANGE,
      });
    } catch {}
    (ut && ut.point
      ? hitPoint.copy(ut.point)
      : hitPoint.copy(shotOrigin).addScaledVector(shotDir, PAC9_RANGE),
      muzzleWorld(muzzlePos));
    let nn = ctx.fx;
    (nn &&
      (nn.tracer && nn.tracer(muzzlePos, hitPoint),
      nn.shell &&
        (toWorld(PAC9_DIMENSIONS.eject, ejectPos),
        ejectVel
          .set(2 + rand() * 1.2, 1.2 + rand() * 0.8, 0.5 - rand() * 0.6)
          .applyQuaternion(we.quaternion),
        Me.vel && ejectVel.add(Me.vel),
        nn.shell(ejectPos, ejectVel))),
      ctx.render &&
        ctx.render.lightPool &&
        ctx.render.lightPool.flash(muzzlePos, 16756832, 45, 9, 0.05),
      ctx.events.emit('weapon:fire', {
        origin: shotOrigin,
        dir: shotDir,
        muzzle: muzzlePos,
        ads: anim.adsE,
      }));
    let bt = lerp(1, 0.55, anim.adsE) * (Me.crouching ? 0.85 : 1),
      Os = anim.burst,
      pn = Os <= 9 ? 1 : 0.38,
      Ti =
        (Os < 4
          ? (rand() - 0.5) * 0.0022
          : Math.sin(Os * 0.57 + anim.recPhase) * 0.0042 + (rand() - 0.5) * 0.002) * bt;
    (Me.addRecoil && Me.addRecoil(0.0068 * pn * bt * (0.85 + rand() * 0.3), Ti),
      Me.addShake && Me.addShake(0.12 * bt),
      (anim.kZ.v += 1.5 * lerp(1, 0.6, anim.adsE)),
      (anim.kP.v += 1.5 * bt),
      (anim.kY.v += (rand() - 0.5) * 1 * bt),
      (anim.kR.v += (rand() - 0.5) * 1.8 * bt),
      (anim.bloom = Math.min(1, anim.bloom + 0.17)),
      (anim.flashT = anim.flashDur = 0.036 + rand() * 0.02));
    let ho = flashMesh.material.uniforms;
    ((ho.uSeed.value = rand() * 100),
      (ho.uJet.value = 0.6 + rand() * 0.6),
      (flashMesh.rotation.z = (rand() - 0.5) * 0.4));
    let Rs = (0.8 + rand() * 0.5) * lerp(1, 0.62, anim.adsE);
    (flashMesh.scale.set(Rs, Rs, Rs * (0.8 + rand() * 0.5)),
      (anim.boltT = 0),
      weapon.ammo <= 0 && ((anim.boltLocked = !0), (roundMesh.visible = !1)));
  }
  function update(Me) {
    let we = ctx.player,
      be = ctx.input;
    if (!we || !be || !we.alive) {
      ((anim.prevFire = !1), flashMesh && (flashMesh.visible = !1));
      return;
    }
    anim.t += Me;
    let Oe = !!be.fire && root.visible && !debug.noFire,
      pt = Oe && !anim.prevFire;
    ((anim.prevFire = Oe), Oe || (anim.dryDone = !1));
    let ut = !!we.sprinting && !Oe && !be.ads && !anim.reload;
    ((anim.sprintT = damp(anim.sprintT, ut ? 1 : 0, 9, Me)),
      be.pressed && be.pressed('reload') && startReload(),
      anim.autoReload >= 0 && ((anim.autoReload -= Me), anim.autoReload < 0 && startReload()));
    let nn = 0;
    if (
      (debug.reloadT != null &&
        !anim.reload &&
        (anim.reload = {
          t: 0,
          T: debug.empty ? RELOAD_TIME_EMPTY : RELOAD_TIME_TACTICAL,
          empty: debug.empty,
          f: {},
        }),
      anim.reload)
    ) {
      let Je = anim.reload;
      debug.reloadT != null ? (Je.t = debug.reloadT) : (Je.t += Me);
      let Pt = Je.t,
        Vt = (Tt, Ai) =>
          Pt >= Ai && !Je.f[Tt]
            ? ((Je.f[Tt] = 1),
              ctx.events.emit('weapon:reload', {
                phase: Tt,
                empty: Je.empty,
              }),
              !0)
            : !1;
      if (
        (Vt('magout', MAG_OUT_T) && (anim.bump.v -= 0.25),
        Pt > 0.86 && !Je.f.fresh && ((Je.f.fresh = 1), (roundMesh.visible = !0)),
        Vt('magin', MAG_IN_T))
      ) {
        anim.bump.v += 0.55;
        let Tt = Math.min(weapon.magSize - weapon.ammo, weapon.reserve);
        ((weapon.ammo += Tt), (weapon.reserve -= Tt), Je.empty || (anim.boltLocked = !1));
      }
      (Pt >= 1.5 && !Je.f.tap && ((Je.f.tap = 1), (anim.bump.v += 0.4)),
        Je.empty &&
          (Pt >= BOLT_PULL_T &&
            (nn =
              Pt < BOLT_FULL_T
                ? smootherStep((Pt - BOLT_PULL_T) / (BOLT_FULL_T - BOLT_PULL_T))
                : Pt < BOLT_RELEASE_T
                  ? 1
                  : Math.max(0, 1 - (Pt - BOLT_RELEASE_T) / 0.035)),
          Vt('bolt', BOLT_RELEASE_T) &&
            ((anim.boltLocked = !1), (anim.bump.v += 0.3), (anim.kZ.v -= 0.5))),
        sampleTrack(Je.empty ? reloadEmptyTrack : reloadTrack, Pt),
        leftHandGroup.position.copy(trackPos),
        leftHandGroup.quaternion.copy(trackQuat),
        Pt >= MAG_OUT_T && Pt < MAG_IN_T
          ? (magAttachQuat.copy(trackQuat).multiply(boltHandInvQuat),
            magGroup.quaternion.copy(magAttachQuat),
            magGroup.position
              .copy(magRestPos)
              .sub(leftWorkPose.p)
              .applyQuaternion(magAttachQuat)
              .add(trackPos))
          : (magGroup.quaternion.identity(), magGroup.position.copy(magRestPos)));
      let ss = smootherStep(Pt / 0.3),
        Hs = 1 - smootherStep((Pt - (Je.T - 0.46)) / 0.4);
      ((anim.reloadW = Math.min(ss, Hs)),
        (anim.rackW = Je.empty ? smootherStep((Pt - 1.62) / 0.3) * Hs : 0),
        Pt >= Je.T &&
          debug.reloadT == null &&
          ((anim.reload = null),
          (anim.reloadW = 0),
          (anim.rackW = 0),
          ctx.events.emit('weapon:reload', {
            phase: 'done',
          }),
          leftHandGroup.position.copy(leftGripPose.p),
          leftHandGroup.quaternion.copy(leftGripPose.q)));
    }
    anim.cooldown -= Me;
    let bt = !anim.reload && anim.sprintT < 0.45;
    if (Oe && bt)
      if (weapon.ammo > 0) {
        let Je = 0;
        for (; anim.cooldown <= 0 && weapon.ammo > 0 && Je < 3;)
          (fireShot(), (anim.cooldown += 60 / PAC9_RPM), Je++);
      } else
        anim.dryDone ||
          ((anim.dryDone = !0),
          ctx.events.emit('weapon:dry', {}),
          (anim.bump.v -= 0.08),
          weapon.reserve > 0 && (anim.autoReload = 0.32));
    (anim.cooldown < 0 && (anim.cooldown = Math.max(anim.cooldown, -0.001)),
      anim.t - anim.lastShot > 0.24 &&
        (anim.burst > 0 && (anim.recPhase = rand() * 6.28), (anim.burst = 0)),
      (anim.bloom = Math.max(0, anim.bloom - Me * 1.5)),
      anim.t - anim.lastShot > 0.11 &&
        anim.t - anim.lastShot < 0.11 + Me * 1.5 &&
        anim.heat > 0.4 &&
        (anim.smoke = Math.min(1.6, anim.heat * 1.3)),
      anim.smoke > 0 &&
        ((anim.smoke -= Me),
        (anim.smokeTick -= Me),
        anim.smokeTick <= 0 &&
          ctx.fx &&
          ctx.fx.smoke &&
          ((anim.smokeTick = 0.085),
          muzzleWorld(muzzlePos),
          ctx.fx.smoke(muzzlePos, {
            size: 0.1 + anim.smoke * 0.06,
            life: 1.3,
            rise: 0.5,
            count: 1,
            alpha: 0.22,
          }))),
      (anim.heat = Math.max(0, anim.heat - Me * 0.2)));
    let Os = !!be.ads && !anim.reload && anim.sprintT < 0.35;
    ((anim.adsLin = clamp(anim.adsLin + (Os ? Me : -Me) / 0.18, 0, 1)),
      (anim.adsE = smootherStep(anim.adsLin)),
      (weapon.ads = anim.adsE));
    let pn = we.speed || 0,
      Ti = saturate(pn / 6),
      ho =
        lerp(0.0125, 0.0012, anim.adsE) +
        Ti * lerp(0.013, 0.004, anim.adsE) +
        anim.bloom * lerp(0.0065, 0.0022, anim.adsE) +
        (we.onGround === !1 ? 0.022 : 0) -
        (we.crouching ? 0.002 * (1 - anim.adsE) : 0);
    ((anim.spreadS = damp(anim.spreadS, ho, 18, Me)),
      (weapon.spread = anim.spreadS),
      Oe ||
      !!be.ads ||
      !!anim.reload ||
      pn > 0.2 ||
      (be.look && Math.abs(be.look.dx) + Math.abs(be.look.dy) > 0.002) ||
      anim.sprintT > 0.1
        ? ((anim.idleT = 0), anim.inspect >= 0 && (anim.inspect = Math.max(anim.inspect, 2.9)))
        : (anim.idleT += Me),
      anim.inspect < 0 && anim.idleT > 24 && (anim.inspect = 0));
    let Un = 0,
      zo = 0,
      $i = 0;
    if (anim.inspect >= 0) {
      let Je = (anim.inspect += Me);
      ((Un = smootherStep(Je / 0.5) * (1 - smootherStep((Je - 1.4) / 0.5))),
        (zo = smootherStep((Je - 1.5) / 0.5) * (1 - smootherStep((Je - 2.8) / 0.5))),
        ($i = smootherStep(Je / 0.5) * (1 - smootherStep((Je - 2.9) / 0.5))),
        Je > 3.5 && ((anim.inspect = -1), (anim.idleT = 0)));
    }
    ((weapon.state = anim.reload
      ? 'reloading'
      : anim.inspect >= 0
        ? 'inspect'
        : anim.sprintT > 0.5
          ? 'sprinting'
          : anim.t - anim.lastShot < 0.14
            ? 'firing'
            : 'idle'),
      (anim.boltT += Me));
    let ya = 0.072,
      ba = anim.boltT < ya ? Math.sin((Math.PI * anim.boltT) / ya) : 0;
    (anim.boltLocked && anim.boltT > ya * 0.5 && (ba = Math.max(ba, 0.86)),
      (boltMesh.position.z = PAC9_DIMENSIONS.boltTravel * Math.max(ba * 0.95, nn)),
      (anim.finger = damp(anim.finger, (Oe && bt) || debug.flash ? 1 : 0, 30, Me)),
      setFingerCurl(anim.finger));
    let Hn = flashMesh.material.uniforms;
    if (
      (debug.flash && ((anim.flashT = anim.flashDur = 0.05), (Hn.uSeed.value = 3.7)),
      (anim.flashT -= Me),
      (Hn.uInt.value =
        anim.flashT > 0 ? 9.5 * Math.sqrt(Math.max(0, anim.flashT / anim.flashDur)) : 0),
      (Hn.uHeat.value = saturate((anim.heat - 0.45) / 0.8) * 2.2),
      (flashMesh.visible = Hn.uInt.value > 0 || Hn.uHeat.value > 0.02),
      debug.freeze)
    )
      return;
    let fo = we.onGround !== !1,
      ln = we.vel ? we.vel.y : 0;
    ((anim.bobAmt = damp(anim.bobAmt, fo ? saturate(pn / 3.6) : 0, 8, Me)),
      (anim.bobPhase += Me * (pn > 0.3 && fo ? 5.2 + pn * 1.55 : 0)));
    let Zo = anim.bobPhase,
      yr = anim.bobAmt * lerp(1, 0.12, anim.adsE) * (1 + anim.sprintT * 1.4),
      lu = Math.sin(Zo) * 0.006 * yr,
      de =
        (Math.sin(2 * Zo) * 0.0042 - Math.pow(0.5 + 0.5 * Math.cos(2 * Zo + 0.6), 4) * 0.0048) * yr,
      te = lerp(1, 0.3, anim.adsE),
      he = anim.t,
      pe = lerp(1, 0.4, anim.adsE);
    if (
      ((anim.swY.v += clamp(be.look ? be.look.dx : 0, -0.2, 0.2) * 3.2 * pe),
      (anim.swP.v += clamp(be.look ? be.look.dy : 0, -0.2, 0.2) * 2.6 * pe),
      stepSpring(anim.swY, 0, Me),
      stepSpring(anim.swP, 0, Me),
      (anim.swY.x = clamp(anim.swY.x, -0.09, 0.09)),
      (anim.swP.x = clamp(anim.swP.x, -0.07, 0.07)),
      anim.wasGround && !fo && ln > 1 && ((anim.jY.v -= 0.22), (anim.jP.v += 0.7)),
      !anim.wasGround && fo)
    ) {
      let Je = clamp(-anim.lastVy * 0.06, 0, 0.6);
      ((anim.jY.v -= Je), (anim.jP.v -= Je * 3.2), (anim.kR.v += (rand() - 0.5) * Je * 2));
    }
    ((anim.wasGround = fo),
      fo || (anim.lastVy = ln),
      stepSpring(anim.jY, fo ? 0 : clamp(-ln * 0.0045, -0.02, 0.024), Me),
      stepSpring(anim.jP, fo ? 0 : clamp(ln * 0.012, -0.06, 0.06), Me),
      stepSpring(anim.kZ, 0, Me),
      stepSpring(anim.kP, 0, Me),
      stepSpring(anim.kY, 0, Me),
      stepSpring(anim.kR, 0, Me),
      stepSpring(anim.bump, 0, Me));
    let ge = be.move ? be.move.x : 0,
      ye = be.move ? be.move.y : 0,
      Le = 1 - anim.adsE,
      ke = anim.adsE,
      Ue = anim.sprintT,
      ct = anim.reloadW,
      De = anim.rackW,
      it =
        lerp(HIP_POSE.p[0], ADS_POSE.p[0], ke) +
        SPRINT_POSE.p[0] * Ue +
        RELOAD_POSE.p[0] * ct +
        lu +
        Math.sin(he * 0.85 + 1) * 0.0012 * te -
        anim.swY.x * 0.06 -
        ge * 0.004 * Le -
        0.035 * $i,
      gt =
        lerp(HIP_POSE.p[1], ADS_POSE.p[1], ke) +
        SPRINT_POSE.p[1] * Ue +
        RELOAD_POSE.p[1] * ct +
        de +
        Math.sin(he * 1.7) * 0.0016 * te +
        anim.swP.x * 0.05 +
        anim.jY.x +
        anim.bump.x * 0.6 +
        0.045 * $i,
      Ot =
        lerp(HIP_POSE.p[2], ADS_POSE.p[2], ke) +
        SPRINT_POSE.p[2] * Ue +
        RELOAD_POSE.p[2] * ct +
        anim.kZ.x * 0.55 +
        ye * 0.004 * Le * (1 - Ue),
      xn =
        HIP_POSE.r[0] * Le +
        SPRINT_POSE.r[0] * Ue +
        RELOAD_POSE.r[0] * ct -
        0.16 * De +
        Math.sin(he * 1.7 + 0.8) * 0.0035 * te +
        Math.sin(2 * Zo + 0.5) * 0.008 * yr +
        anim.swP.x +
        anim.jP.x +
        anim.kP.x +
        anim.bump.x * 1.5 +
        0.3 * $i,
      $t =
        HIP_POSE.r[1] * Le +
        SPRINT_POSE.r[1] * Ue +
        RELOAD_POSE.r[1] * ct +
        Math.sin(he * 0.6) * 0.002 * te +
        Math.sin(Zo) * 0.01 * yr +
        anim.swY.x +
        anim.kY.x +
        0.18 * $i +
        0.25 * zo,
      Ht =
        HIP_POSE.r[2] * Le +
        SPRINT_POSE.r[2] * Ue +
        RELOAD_POSE.r[2] * ct +
        0.62 * De +
        Math.sin(Zo) * 0.014 * yr +
        anim.swY.x * 0.7 -
        ge * 0.035 * Le +
        anim.kR.x -
        0.75 * Un +
        0.55 * zo +
        Math.sin(he * 0.5) * 0.004 * te;
    (root.position.set(it, gt, Ot), root.rotation.set(xn, $t, Ht, 'YXZ'));
  }
  return (resetWeapon(), weapon);
}

/**
 * 武器模型展示台：把枪摆成 hip/ads/sprint/fire/reload/empty 等固定姿势并锁帧，供截图与调参用；挂 window.__setShot 以便外部脚本切姿势
 */
export async function showcaseWeapon(ctx) {
  let weapon = await createWeapon(ctx);
  ctx.weapon = weapon;
  let root = weapon.root,
    hipCamPos = new WeaponVec3(0, 1.68, 4),
    lookDirs = {
      south: [0.28, -0.01, 1],
      east: [1, 0, 0.25],
      north: [-0.2, -0.01, -1],
      west: [-1, 0, 0.1],
      nw: [-0.75, -0.01, -0.65],
    },
    shotPoses = {
      side: [Math.PI, [1.12, 1.3, 0.11], [0, 1.235, 0.11], 30],
      right: [0, [1.12, 1.3, -0.11], [0, 1.235, -0.11], 30],
      top: [Math.PI * 0.86, [0.62, 1.8, -0.42], [0, 1.24, 0.12], 32],
      hands: [Math.PI, [0.4, 1.4, 0.02], [0.02, 1.215, 0.25], 30],
      rhand: [0, [0.36, 1.22, 0.27], [0.03, 1.16, 0.09], 30],
      muzzle: [Math.PI, [0.26, 1.37, 0.98], [0, 1.262, 0.44], 30],
      optic: [Math.PI, [0.2, 1.4, -0.26], [0, 1.31, 0.02], 30],
      lower: [Math.PI, [0.34, 1.26, 0.04], [0, 1.2, 0.03], 30],
    },
    prevSetShot = window.__setShot,
    currentShot = null;
  function setShot(u, h = {}) {
    currentShot = u;
    let f = shotPoses[u],
      p = ctx.input,
      d = ctx.player;
    ((p.ads = !1),
      (p.fire = !1),
      (d.sprinting = !1),
      (d.speed = 0),
      (weapon.debug.reloadT = null),
      (weapon.debug.flash = !1),
      (weapon.debug.empty = !1),
      (weapon.debug.freeze = !!f),
      weapon.reset());
    let v, g, x;
    if (f)
      (ctx.scene.add(root),
        root.position.set(0, 1.25, 0),
        root.rotation.set(0, f[0], 0, 'YXZ'),
        root.traverse((y) => y.layers.set(LAYER_WORLD)),
        (v = f[1]),
        (g = f[2]),
        (x = f[3]),
        h.wt != null && ((weapon.debug.reloadT = +h.wt), (weapon.debug.empty = !!h.wempty)));
    else {
      (ctx.camera.add(root), root.traverse((b) => b.layers.set(LAYER_VIEWMODEL)));
      let y = lookDirs[h.wlook] || lookDirs.south;
      ((v = [hipCamPos.x, hipCamPos.y, hipCamPos.z]),
        (g = [hipCamPos.x + y[0] * 50, hipCamPos.y + y[1] * 50, hipCamPos.z + y[2] * 50]),
        (x = 74),
        u === 'ads' && ((p.ads = !0), (x = 52)),
        u === 'sprint' && ((d.sprinting = !0), (d.speed = 6)),
        u === 'fire' && ((weapon.debug.flash = !0), h.wads && ((p.ads = !0), (x = 52))),
        (u === 'reload' || u === 'empty') &&
          ((weapon.debug.reloadT = h.wt != null ? +h.wt : 0.62),
          (weapon.debug.empty = u === 'empty')),
        u === 'empty' && (weapon.ammo = 0));
    }
    return (
      weapon.snap(),
      weapon.update(0.016),
      weapon.snap(),
      prevSetShot &&
        prevSetShot({
          cam: h.cam || [...v, ...g].join(','),
          fov: h.fov || x,
          exposure: h.exposure,
        }),
      {
        cam: v,
        target: g,
      }
    );
  }
  window.__setShot = (u) => {
    u && u.wpose ? setShot(u.wpose, u) : prevSetShot && prevSetShot(u);
  };
  let firstShot = setShot(ctx.params.wpose || 'hip', ctx.params);
  return {
    cam: firstShot.cam,
    target: firstShot.target,
    update(u) {
      (weapon.update(u), currentShot === 'fire' && (weapon.debug.flash = !0));
    },
  };
}
