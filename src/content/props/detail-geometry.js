// content/props/detail-geometry.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  HALF_PI,
  bakeVertexColorTint,
  createCurvedDecalQuad,
  createDecalPlane,
  createGeometryFromArrays,
  cylinderGeometry,
  mapVertices,
  mergeGeometryParts,
  revolveProfileGeometry,
} from '../../assets/procedural/geometry.js';

import { applyTransform, clampValue, composePropTransform } from '../../audio/audio.js';

import { resolvePaintColorAlias } from '../level/buildings.js';

import { barrelProfile } from './basic-builders.js';

import { PROP_SIZES } from './registry.js';

import { PI_TWO, valueNoise3D } from '../../core/math.js';

import { createRng } from '../../core/random.js';

/**
 * 圆角方块（8 角各 3 顶点，廉价倒角）；后半段道具默认的箱体基元，比纯 BoxGeometry 更有工业感
 */
export function roundedBoxGeometry(
  width,
  height,
  depth,
  bevelRadius = 0.008,
  anchorMode = 'center',
) {
  let halfSize = [width / 2, height / 2, depth / 2];
  bevelRadius = Math.min(bevelRadius, halfSize[0] * 0.9, halfSize[1] * 0.9, halfSize[2] * 0.9);
  let posArr = [],
    nrmArr = [],
    uvArr = [],
    idxArr = [];
  for (let triangleVertexFirst = 0; triangleVertexFirst < 8; triangleVertexFirst++)
    for (let triangleVertexSecond = 0; triangleVertexSecond < 3; triangleVertexSecond++) {
      let triangleVertexThird = [
          triangleVertexFirst & 1 ? 1 : -1,
          triangleVertexFirst & 2 ? 1 : -1,
          triangleVertexFirst & 4 ? 1 : -1,
        ],
        normalCompX = [0, 1, 2].map(
          (normalCompY) =>
            triangleVertexThird[normalCompY] *
            (halfSize[normalCompY] - (normalCompY !== triangleVertexSecond ? bevelRadius : 0)),
        );
      (posArr.push(normalCompX[0], normalCompX[1], normalCompX[2]),
        nrmArr.push(
          triangleVertexSecond === 0 ? triangleVertexThird[0] : 0,
          triangleVertexSecond === 1 ? triangleVertexThird[1] : 0,
          triangleVertexSecond === 2 ? triangleVertexThird[2] : 0,
        ),
        triangleVertexSecond === 0
          ? uvArr.push(normalCompX[2], normalCompX[1])
          : triangleVertexSecond === 1
            ? uvArr.push(normalCompX[0], normalCompX[2])
            : uvArr.push(normalCompX[0], normalCompX[1]));
    }
  let vertIdx = (p, d) => p * 3 + d,
    pushTri = (p, d, v, g, x, y) => {
      let b = posArr[d * 3] - posArr[p * 3],
        m = posArr[d * 3 + 1] - posArr[p * 3 + 1],
        A = posArr[d * 3 + 2] - posArr[p * 3 + 2],
        _ = posArr[v * 3] - posArr[p * 3],
        M = posArr[v * 3 + 1] - posArr[p * 3 + 1],
        E = posArr[v * 3 + 2] - posArr[p * 3 + 2];
      (m * E - A * M) * g + (A * _ - b * E) * x + (b * M - m * _) * y >= 0
        ? idxArr.push(p, d, v)
        : idxArr.push(p, v, d);
    };
  for (let triangleVertexFirst = 0; triangleVertexFirst < 3; triangleVertexFirst++) {
    let triangleVertexSecond = (triangleVertexFirst + 1) % 3,
      triangleVertexThird = (triangleVertexFirst + 2) % 3;
    for (let normalCompX of [0, 1]) {
      let normalCompY = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ].map(
          ([edgeOneDx, edgeOneDy]) =>
            (normalCompX << triangleVertexFirst) |
            (edgeOneDx << triangleVertexSecond) |
            (edgeOneDy << triangleVertexThird),
        ),
        normalCompZ = [0, 0, 0];
      ((normalCompZ[triangleVertexFirst] = normalCompX ? 1 : -1),
        pushTri(
          vertIdx(normalCompY[0], triangleVertexFirst),
          vertIdx(normalCompY[1], triangleVertexFirst),
          vertIdx(normalCompY[2], triangleVertexFirst),
          ...normalCompZ,
        ),
        pushTri(
          vertIdx(normalCompY[0], triangleVertexFirst),
          vertIdx(normalCompY[2], triangleVertexFirst),
          vertIdx(normalCompY[3], triangleVertexFirst),
          ...normalCompZ,
        ));
    }
    for (let normalCompX of [0, 1])
      for (let normalCompY of [0, 1]) {
        let normalCompZ =
            (normalCompX << triangleVertexSecond) | (normalCompY << triangleVertexThird),
          edgeOneDx = normalCompZ | (1 << triangleVertexFirst),
          edgeOneDy = [0, 0, 0];
        ((edgeOneDy[triangleVertexSecond] = normalCompX ? 1 : -1),
          (edgeOneDy[triangleVertexThird] = normalCompY ? 1 : -1),
          pushTri(
            vertIdx(normalCompZ, triangleVertexSecond),
            vertIdx(edgeOneDx, triangleVertexSecond),
            vertIdx(edgeOneDx, triangleVertexThird),
            ...edgeOneDy,
          ),
          pushTri(
            vertIdx(normalCompZ, triangleVertexSecond),
            vertIdx(edgeOneDx, triangleVertexThird),
            vertIdx(normalCompZ, triangleVertexThird),
            ...edgeOneDy,
          ));
      }
  }
  for (let triangleVertexFirst = 0; triangleVertexFirst < 8; triangleVertexFirst++)
    pushTri(
      vertIdx(triangleVertexFirst, 0),
      vertIdx(triangleVertexFirst, 1),
      vertIdx(triangleVertexFirst, 2),
      triangleVertexFirst & 1 ? 1 : -1,
      triangleVertexFirst & 2 ? 1 : -1,
      triangleVertexFirst & 4 ? 1 : -1,
    );
  let boxGeo = createGeometryFromArrays(posArr, nrmArr, uvArr, idxArr);
  return (anchorMode === 'bottom' && boxGeo.translate(0, height / 2, 0), boxGeo);
}

/**
 * 带细分的圆角方块：用 BoxGeometry 顶点位移做出可被噪声扰动的圆角箱体（纸箱、篷布下的木箱、叉车机罩）
 */
export function roundedBoxGeometryGrid(
  width,
  height,
  depth,
  radius = 0.03,
  segX = 3,
  segY = 3,
  segZ = 3,
  anchor = 'center',
) {
  let boxGeo = new THREE.BoxGeometry(width, height, depth, segX, segY, segZ),
    posAttr = boxGeo.attributes.position,
    normAttr = boxGeo.attributes.normal,
    uvAttr = boxGeo.attributes.uv,
    halfW = width / 2,
    halfH = height / 2,
    halfD = depth / 2;
  radius = Math.min(radius, halfW * 0.95, halfH * 0.95, halfD * 0.95);
  let insetCoord = (x, boundsMin, boundsMax) => {
      if (Math.abs(x) > boundsMin - 1e-6 || boundsMax < 3) return x;
      let eachCorner = (2 * boundsMin) / boundsMax;
      return (x * (boundsMin - radius)) / (boundsMin - eachCorner);
    },
    offsetVec = new THREE.Vector3();
  for (let vertIdx = 0; vertIdx < posAttr.count; vertIdx++) {
    let coordX = insetCoord(posAttr.getX(vertIdx), halfW, segX),
      coordY = insetCoord(posAttr.getY(vertIdx), halfH, segY),
      coordZ = insetCoord(posAttr.getZ(vertIdx), halfD, segZ),
      clampedX = clampValue(coordX, -(halfW - radius), halfW - radius),
      clampedY = clampValue(coordY, -(halfH - radius), halfH - radius),
      clampedZ = clampValue(coordZ, -(halfD - radius), halfD - radius);
    (offsetVec.set(coordX - clampedX, coordY - clampedY, coordZ - clampedZ),
      (Math.abs(coordX) > halfW - 1e-5 ? 1 : 0) +
        (Math.abs(coordY) > halfH - 1e-5 ? 1 : 0) +
        (Math.abs(coordZ) > halfD - 1e-5 ? 1 : 0) >=
        2 &&
        offsetVec.lengthSq() > 1e-12 &&
        (offsetVec.normalize(),
        (coordX = clampedX + offsetVec.x * radius),
        (coordY = clampedY + offsetVec.y * radius),
        (coordZ = clampedZ + offsetVec.z * radius),
        normAttr.setXYZ(vertIdx, offsetVec.x, offsetVec.y, offsetVec.z)),
      posAttr.setXYZ(vertIdx, coordX, coordY, coordZ));
    let normX = Math.abs(normAttr.getX(vertIdx)),
      normY = Math.abs(normAttr.getY(vertIdx)),
      normZ = Math.abs(normAttr.getZ(vertIdx));
    normX >= normY && normX >= normZ
      ? uvAttr.setXY(vertIdx, coordZ, coordY)
      : normY >= normX && normY >= normZ
        ? uvAttr.setXY(vertIdx, coordX, coordZ)
        : uvAttr.setXY(vertIdx, coordX, coordY);
  }
  return (anchor === 'bottom' && boxGeo.translate(0, height / 2, 0), boxGeo);
}

/**
 * 按位置哈希合并重复顶点后求平均法线：顶点变形之后必须重算，否则倒角处会出现断裂的高光
 */
export function recomputeSmoothNormals(geometry) {
  let posAttr = geometry.attributes.position,
    indexAttr = geometry.index,
    vertCount = posAttr.count,
    normalSums = new Map(),
    posKey = (f) =>
      Math.round(posAttr.getX(f) * 2e3) +
      ',' +
      Math.round(posAttr.getY(f) * 2e3) +
      ',' +
      Math.round(posAttr.getZ(f) * 2e3),
    keyList = new Array(vertCount);
  for (let vIdx = 0; vIdx < vertCount; vIdx++) keyList[vIdx] = posKey(vIdx);
  let cornerA = new THREE.Vector3(),
    cornerB = new THREE.Vector3(),
    cornerC = new THREE.Vector3(),
    triCount = indexAttr ? indexAttr.count : vertCount;
  for (let vIdx = 0; vIdx < triCount; vIdx += 3) {
    let p = indexAttr ? indexAttr.getX(vIdx) : vIdx,
      d = indexAttr ? indexAttr.getX(vIdx + 1) : vIdx + 1,
      i2 = indexAttr ? indexAttr.getX(vIdx + 2) : vIdx + 2;
    (cornerA.fromBufferAttribute(posAttr, p),
      cornerB.fromBufferAttribute(posAttr, d),
      cornerC.fromBufferAttribute(posAttr, i2),
      cornerB.sub(cornerA),
      cornerC.sub(cornerA),
      cornerB.cross(cornerC));
    for (let cornerIdx of [p, d, i2]) {
      let sumVec = normalSums.get(keyList[cornerIdx]);
      (sumVec || ((sumVec = [0, 0, 0]), normalSums.set(keyList[cornerIdx], sumVec)),
        (sumVec[0] += cornerB.x),
        (sumVec[1] += cornerB.y),
        (sumVec[2] += cornerB.z));
    }
  }
  let normalsOut = new Float32Array(vertCount * 3);
  for (let vIdx = 0; vIdx < vertCount; vIdx++) {
    let p = normalSums.get(keyList[vIdx]) || [0, 1, 0],
      d = Math.hypot(p[0], p[1], p[2]) || 1;
    ((normalsOut[vIdx * 3] = p[0] / d),
      (normalsOut[vIdx * 3 + 1] = p[1] / d),
      (normalsOut[vIdx * 3 + 2] = p[2] / d));
  }
  return (geometry.setAttribute('normal', new THREE.BufferAttribute(normalsOut, 3)), geometry);
}

/**
 * 第二代道具装配器：矩阵栈 push/pop、按材质+是否投影分桶、add/decal/label/cdecal 语法糖；finish() 时合并几何并按噪声+朝上程度统一施加脏污顶点色，最后写尺寸与碰撞盒
 */
export var PropAssembler = class {
  constructor(e, t, n = 1) {
    ((this.G = e),
      (this.name = t),
      (this.seed = Math.abs(n | 0)),
      (this.rng = createRng((this.seed + 1) * 7919 + t.length * 131)),
      (this.b = new Map()),
      (this.stack = [new THREE.Matrix4()]));
  }
  push(e) {
    return (
      this.stack.push(this.stack[this.stack.length - 1].clone().multiply(composePropTransform(e))),
      this
    );
  }
  pop() {
    return (this.stack.pop(), this);
  }
  mat(e, t) {
    return this.G.mats.get(e, {
      vertexColors: !0,
      ...(t || {}),
    });
  }
  add(e, t, n, s = 1, { raw: o = !1, cast: r = !0 } = {}) {
    let a = typeof e == 'string' ? this.mat(e) : e;
    (n && applyTransform(t, n),
      t.applyMatrix4(this.stack[this.stack.length - 1]),
      o || bakeVertexColorTint(t, s));
    let l = a.uuid + (r ? 'c' : 'n'),
      c = this.b.get(l);
    return (
      c ||
        ((c = {
          mat: a,
          geos: [],
          raw: o,
          cast: r,
        }),
        this.b.set(l, c)),
      c.geos.push(t),
      this
    );
  }
  decal(e, t, n, s) {
    return this.add(e.material, createDecalPlane(t, s || t / (e.aspect || 1)), n, 1, {
      raw: !0,
      cast: !1,
    });
  }
  label(e, t, n, s, o) {
    let r = this.G.mats.label(e, t),
      a = Math.min(n, s * (r.aspect || 1));
    return this.add(r.material, createDecalPlane(a, a / (r.aspect || 1)), o, 1, {
      raw: !0,
      cast: !1,
    });
  }
  cdecal(e, t, n, s, o) {
    return this.add(e.material, createCurvedDecalQuad(t, n, o || n / (e.aspect || 1)), s, 1, {
      raw: !0,
      cast: !1,
    });
  }
  finish({ size: e, colliders: t, grime: n = 1, surface: s } = {}) {
    let o = new THREE.Group(),
      r = this.seed * 3.71;
    for (let c of this.b.values()) {
      let u = mergeGeometryParts(c.geos);
      if (!c.raw && n > 0 && u.attributes.color) {
        let f = u.attributes.position,
          p = u.attributes.normal,
          d = u.attributes.color.array;
        for (let v = 0; v < f.count; v++) {
          let g = f.getX(v),
            x = f.getY(v),
            y = f.getZ(v),
            b = p.getY(v),
            m = valueNoise3D(g * 1.9 + r, x * 1.9, y * 1.9 + 5.3),
            A = valueNoise3D(g * 9 + 2.1, x * 9 + r, y * 9),
            _ =
              (0.82 + 0.18 * m) *
              (0.92 + 0.08 * A) *
              (0.76 + 0.24 * clampValue(b * 0.6 + 0.62, 0, 1)),
            M = clampValue(1 - x / 0.2, 0, 1);
          ((_ *= 1 - 0.42 * M * M * (0.55 + 0.45 * A)),
            (_ = 1 + (_ - 1) * n),
            (d[v * 3] *= _),
            (d[v * 3 + 1] *= _ * (1 - 0.05 * M * n)),
            (d[v * 3 + 2] *= _ * (1 - 0.12 * M * n)));
        }
      }
      let h = new THREE.Mesh(u, c.mat);
      ((h.castShadow = c.cast), (h.receiveShadow = !0), o.add(h));
    }
    let a = PROP_SIZES[this.name] || [1, 1, 1, '', 'metal'],
      l = e || [a[0], a[1], a[2]];
    return (
      (o.userData.size = l),
      (o.userData.colliders = t || [
        {
          min: [-l[0] / 2, 0, -l[2] / 2],
          max: [l[0] / 2, l[1], l[2] / 2],
          surface: s || a[4],
        },
      ]),
      o
    );
  }
};

/**
 * 钢桶：旋成桶身 + 随机凹坑 + 桶盖/呼吸阀 + 危险品与 UN 编号贴花；lying 参数把桶放倒（碰撞盒同步改尺寸），rust 色额外跳过贴花
 */
export function buildBarrel(ctx, opts, variant) {
  let rand = new PropAssembler(ctx, 'barrel', variant),
    rng = rand.rng,
    radialSegments = 22,
    [bodyMat, bodyTint] = resolvePaintColorAlias(opts.color, 'blue');
  opts.lying &&
    rand.push({
      p: [-0.45, 0.297, 0],
      r: [0, 0, -HALF_PI],
    });
  let shellGeo = revolveProfileGeometry(barrelProfile(!!opts.open), radialSegments),
    dents = [];
  for (let vertexCoord = 0; vertexCoord < 2 + (variant % 2); vertexCoord++)
    dents.push([
      rng() * PI_TWO * 2,
      rng.range(0.12, 0.78),
      rng.range(0.07, 0.13),
      rng.range(0.006, 0.014),
    ]);
  (mapVertices(shellGeo, (vertexCoord) => {
    let radiusOrHeight = Math.hypot(vertexCoord.x, vertexCoord.z);
    if (radiusOrHeight < 0.27) return;
    let azimuthOrDepth = Math.atan2(vertexCoord.z, vertexCoord.x);
    for (let dentSpec of dents) {
      let angleDelta = Math.abs(azimuthOrDepth - dentSpec[0]) % (PI_TWO * 2);
      angleDelta > PI_TWO && (angleDelta = PI_TWO * 2 - angleDelta);
      let dentDistanceNoise = Math.hypot(angleDelta * 0.285, vertexCoord.y - dentSpec[1]);
      if (dentDistanceNoise < dentSpec[2]) {
        let dentScaleFactor =
          1 -
          (dentSpec[3] * (0.5 + 0.5 * Math.cos((PI_TWO * dentDistanceNoise) / dentSpec[2]))) /
            radiusOrHeight;
        ((vertexCoord.x *= dentScaleFactor), (vertexCoord.z *= dentScaleFactor));
      }
    }
  }),
    shellGeo.computeVertexNormals());
  let normals = shellGeo.attributes.normal,
    ringCount = shellGeo.attributes.position.count / (radialSegments + 1);
  for (let vertexCoord = 0; vertexCoord < ringCount; vertexCoord++) {
    let radiusOrHeight = vertexCoord * (radialSegments + 1),
      azimuthOrDepth = radiusOrHeight + radialSegments,
      dentSpec = normals.getX(radiusOrHeight) + normals.getX(azimuthOrDepth),
      angleDelta = normals.getY(radiusOrHeight) + normals.getY(azimuthOrDepth),
      dentDistanceNoise = normals.getZ(radiusOrHeight) + normals.getZ(azimuthOrDepth),
      dentScaleFactor = Math.hypot(dentSpec, angleDelta, dentDistanceNoise) || 1;
    (normals.setXYZ(
      radiusOrHeight,
      dentSpec / dentScaleFactor,
      angleDelta / dentScaleFactor,
      dentDistanceNoise / dentScaleFactor,
    ),
      normals.setXYZ(
        azimuthOrDepth,
        dentSpec / dentScaleFactor,
        angleDelta / dentScaleFactor,
        dentDistanceNoise / dentScaleFactor,
      ));
  }
  let noiseOffset = variant * 2.37,
    isRust = opts.color === 'rust';
  return (
    rand.add(bodyMat, shellGeo, null, (vertexCoord, radiusOrHeight, azimuthOrDepth) => {
      let dentSpec = Math.hypot(vertexCoord, azimuthOrDepth),
        angleDelta = Math.atan2(azimuthOrDepth, vertexCoord);
      if (dentSpec < 0.27) {
        let capShadeValue =
          radiusOrHeight > 0.5
            ? 0.62 + 0.3 * valueNoise3D(vertexCoord * 9 + noiseOffset, azimuthOrDepth * 9)
            : 0.6;
        return [capShadeValue, capShadeValue, capShadeValue];
      }
      let dentDistanceNoise = Math.pow(valueNoise3D(angleDelta * 2.6 + noiseOffset, 3.1), 2.2),
        dentScaleFactor =
          radiusOrHeight > 0.6
            ? (0.88 - radiusOrHeight) / 0.28
            : radiusOrHeight > 0.31
              ? (0.6 - radiusOrHeight) / 0.29
              : (0.31 - radiusOrHeight) / 0.31,
        baseShadeValue =
          1 - 0.55 * dentDistanceNoise * (1 - 0.6 * clampValue(dentScaleFactor, 0, 1)),
        rimWearAmount =
          (dentSpec > 0.289 ? 1 : 0) *
          (0.35 + 0.65 * valueNoise3D(angleDelta * 7 + noiseOffset, radiusOrHeight * 20)),
        barrelColorRgb = [
          baseShadeValue * (1 - 0.25 * rimWearAmount),
          baseShadeValue * (1 - 0.42 * rimWearAmount),
          baseShadeValue * (1 - 0.55 * rimWearAmount),
        ];
      return (
        typeof bodyTint != 'number' &&
          ((barrelColorRgb[0] *= bodyTint[0]),
          (barrelColorRgb[1] *= bodyTint[1]),
          (barrelColorRgb[2] *= bodyTint[2])),
        barrelColorRgb
      );
    }),
    opts.open ||
      (rand.add(
        'steel_galv',
        cylinderGeometry(0.036, 0.038, 0.016, 8),
        {
          p: [0.17, 0.891, 0.02],
        },
        0.8,
      ),
      rand.add(
        'steel_galv',
        cylinderGeometry(0.017, 0.018, 0.014, 8),
        {
          p: [-0.16, 0.89, -0.08],
        },
        0.8,
      )),
    !isRust &&
      variant % 3 !== 2 &&
      rand.cdecal(ctx.mats.decal('hazard_flammable'), 0.2855, 0.15, {
        p: [0, 0.455, 0],
        r: [0, 0.9 + variant, 0],
      }),
    variant % 2 === 0 &&
      rand.cdecal(
        ctx.mats.label('UN 1202', {
          color: isRust || opts.color === 'white' || opts.color === 'yellow' ? 'black' : 'white',
          font: 'stencil',
          distress: 0.5,
        }),
        0.2855,
        0.2,
        {
          p: [0, 0.74, 0],
          r: [0, 2.6 + variant, 0],
        },
      ),
    rand.finish(
      opts.lying
        ? {
            size: [0.9, 0.6, 0.6],
          }
        : {},
    )
  );
}
