// assets/procedural/geometry.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { applyTransform } from '../../audio/audio.js';

import { roundedBoxGeometry } from '../../content/props/detail-geometry.js';

import { chamferedBoxGeometry } from '../../content/props/geometry.js';

import { ONE_SCALE, PI_TWO, TMP_MATRIX, TMP_QUAT, toVec3 } from '../../core/math.js';

import { applyVertexShading, buildLatheBody } from '../../gameplay/weapons/geometry.js';

import { SCRATCH_VEC3 } from '../../gameplay/weapons/weapon.js';

import { LC, va, y_ } from '../../misc.js';

import { UP_AXIS } from '../../render/effects/effects.js';

import { TINTED_MATERIALS, WHITE_TINT, tintByHash } from '../../render/materials/materials.js';

/**
 * three BufferGeometryUtils.mergeGeometries 的内联副本：按属性语义合并多个几何（保留 index/morph/group），属性集合或类型不一致时报错并返回 null 而不是产出坏网格
 */
export function mergeGeometries(geometries, useGroups = !1) {
  let usesIndex = geometries[0].index !== null,
    attributeNames = new Set(Object.keys(geometries[0].attributes)),
    morphNames = new Set(Object.keys(geometries[0].morphAttributes)),
    attributesBySemantic = {},
    morphAttributesBySemantic = {},
    morphTargetsRelative = geometries[0].morphTargetsRelative,
    merged = new THREE.BufferGeometry(),
    groupStart = 0;
  for (let geoIndex = 0; geoIndex < geometries.length; ++geoIndex) {
    let sourceGeo = geometries[geoIndex],
      attrCount = 0;
    if (usesIndex !== (sourceGeo.index !== null))
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
            geoIndex +
            '. All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.',
        ),
        null
      );
    for (let attrName in sourceGeo.attributes) {
      if (!attributeNames.has(attrName))
        return (
          console.error(
            'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
              geoIndex +
              '. All geometries must have compatible attributes; make sure "' +
              attrName +
              '" attribute exists among all geometries, or in none of them.',
          ),
          null
        );
      (attributesBySemantic[attrName] === void 0 && (attributesBySemantic[attrName] = []),
        attributesBySemantic[attrName].push(sourceGeo.attributes[attrName]),
        attrCount++);
    }
    if (attrCount !== attributeNames.size)
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
            geoIndex +
            '. Make sure all geometries have the same number of attributes.',
        ),
        null
      );
    if (morphTargetsRelative !== sourceGeo.morphTargetsRelative)
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
            geoIndex +
            '. .morphTargetsRelative must be consistent throughout all geometries.',
        ),
        null
      );
    for (let attrName in sourceGeo.morphAttributes) {
      if (!morphNames.has(attrName))
        return (
          console.error(
            'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
              geoIndex +
              '.  .morphAttributes must be consistent throughout all geometries.',
          ),
          null
        );
      (morphAttributesBySemantic[attrName] === void 0 && (morphAttributesBySemantic[attrName] = []),
        morphAttributesBySemantic[attrName].push(sourceGeo.morphAttributes[attrName]));
    }
    if (useGroups) {
      let attrName;
      if (usesIndex) attrName = sourceGeo.index.count;
      else if (sourceGeo.attributes.position !== void 0)
        attrName = sourceGeo.attributes.position.count;
      else
        return (
          console.error(
            'THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index ' +
              geoIndex +
              '. The geometry must have either an index or a position attribute',
          ),
          null
        );
      (merged.addGroup(groupStart, attrName, geoIndex), (groupStart += attrName));
    }
  }
  if (usesIndex) {
    let geoIndex = 0,
      sourceGeo = [];
    for (let attrCount = 0; attrCount < geometries.length; ++attrCount) {
      let attrName = geometries[attrCount].index;
      for (let vertexIndex = 0; vertexIndex < attrName.count; ++vertexIndex)
        sourceGeo.push(attrName.getX(vertexIndex) + geoIndex);
      geoIndex += geometries[attrCount].attributes.position.count;
    }
    merged.setIndex(sourceGeo);
  }
  for (let geoIndex in attributesBySemantic) {
    let sourceGeo = mergeAttributes(attributesBySemantic[geoIndex]);
    if (!sourceGeo)
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the ' +
            geoIndex +
            ' attribute.',
        ),
        null
      );
    merged.setAttribute(geoIndex, sourceGeo);
  }
  for (let geoIndex in morphAttributesBySemantic) {
    let sourceGeo = morphAttributesBySemantic[geoIndex][0].length;
    if (sourceGeo === 0) break;
    ((merged.morphAttributes = merged.morphAttributes || {}),
      (merged.morphAttributes[geoIndex] = []));
    for (let attrCount = 0; attrCount < sourceGeo; ++attrCount) {
      let attrName = [];
      for (
        let morphSourceIndex = 0;
        morphSourceIndex < morphAttributesBySemantic[geoIndex].length;
        ++morphSourceIndex
      )
        attrName.push(morphAttributesBySemantic[geoIndex][morphSourceIndex][attrCount]);
      let vertexIndex = mergeAttributes(attrName);
      if (!vertexIndex)
        return (
          console.error(
            'THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the ' +
              geoIndex +
              ' morphAttribute.',
          ),
          null
        );
      merged.morphAttributes[geoIndex].push(vertexIndex);
    }
  }
  return merged;
}

/**
 * 合并同名 BufferAttribute：先校验 array 构造类型/itemSize/normalized/gpuType 全部一致，再一次性分配拷贝；交错属性逐分量展开，是几何合并的底层搬运工
 */
function mergeAttributes(attributes) {
  let ArrayType,
    itemSize,
    normalized,
    gpuType = -1,
    totalComponents = 0;
  for (let attrIndex = 0; attrIndex < attributes.length; ++attrIndex) {
    let attribute = attributes[attrIndex];
    if (
      (ArrayType === void 0 && (ArrayType = attribute.array.constructor),
      ArrayType !== attribute.array.constructor)
    )
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes.',
        ),
        null
      );
    if ((itemSize === void 0 && (itemSize = attribute.itemSize), itemSize !== attribute.itemSize))
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes.',
        ),
        null
      );
    if (
      (normalized === void 0 && (normalized = attribute.normalized),
      normalized !== attribute.normalized)
    )
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes.',
        ),
        null
      );
    if ((gpuType === -1 && (gpuType = attribute.gpuType), gpuType !== attribute.gpuType))
      return (
        console.error(
          'THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes.',
        ),
        null
      );
    totalComponents += attribute.count * itemSize;
  }
  let mergedArray = new ArrayType(totalComponents),
    mergedAttr = new THREE.BufferAttribute(mergedArray, itemSize, normalized),
    writeOffset = 0;
  for (let attrIndex = 0; attrIndex < attributes.length; ++attrIndex) {
    let attribute = attributes[attrIndex];
    if (attribute.isInterleavedBufferAttribute) {
      let vertexBase = writeOffset / itemSize;
      for (let vertexIdx = 0, vertexCount = attribute.count; vertexIdx < vertexCount; vertexIdx++)
        for (let compIdx = 0; compIdx < itemSize; compIdx++) {
          let compValue = attribute.getComponent(vertexIdx, compIdx);
          mergedAttr.setComponent(vertexIdx + vertexBase, compIdx, compValue);
        }
    } else mergedArray.set(attribute.array, writeOffset);
    writeOffset += attribute.count * itemSize;
  }
  return (gpuType !== void 0 && (mergedAttr.gpuType = gpuType), mergedAttr);
}

/**
 * 倒角盒逐顶点计算外扩方向时复用的临时向量，避免每顶点新建 Vector3 造成的分配压力
 */
var SCRATCH_BEVEL_DIR = new THREE.Vector3();

/**
 * 盒体几何，UV 改为按世界坐标做三向平面投影，使不同尺寸的箱子/机柜贴图密度一致；anchor='bottom' 时原点落在盒底，便于按地面高度摆放
 */
export function boxGeometry(width, height, depth, anchor = 'center') {
  let boxGeo = new THREE.BoxGeometry(width, height, depth),
    uvAttr = boxGeo.attributes.uv,
    posAttr = boxGeo.attributes.position,
    normalAttr = boxGeo.attributes.normal;
  for (let vIdx = 0; vIdx < uvAttr.count; vIdx++) {
    let c = Math.abs(normalAttr.getX(vIdx)),
      ny = Math.abs(normalAttr.getY(vIdx)),
      vx = posAttr.getX(vIdx),
      vy = posAttr.getY(vIdx),
      vz = posAttr.getZ(vIdx);
    c > 0.5
      ? uvAttr.setXY(vIdx, vz, vy)
      : ny > 0.5
        ? uvAttr.setXY(vIdx, vx, vz)
        : uvAttr.setXY(vIdx, vx, vy);
  }
  return (anchor === 'bottom' && boxGeo.translate(0, height / 2, 0), boxGeo);
}

/**
 * 倒角盒：3×3 分段的盒体把棱/角顶点沿外法线内缩成小斜面并同步重算法线，让集装箱与机柜的边沿有真实高光；bevel 被限制在最短边一半以内，UV 仍走平面投影
 */
export function beveledBoxGeometry(width, height, depth, bevelSize = 0.02, anchor = 'center') {
  bevelSize = Math.min(bevelSize, width / 2 - 1e-4, height / 2 - 1e-4, depth / 2 - 1e-4);
  let boxGeo = new THREE.BoxGeometry(width, height, depth, 3, 3, 3),
    posAttr = boxGeo.attributes.position,
    normAttr = boxGeo.attributes.normal,
    uvAttr = boxGeo.attributes.uv,
    halfW = width / 2,
    halfH = height / 2,
    halfD = depth / 2,
    snapToEdge = (p, d) => {
      let v = Math.abs(p),
        g = Math.sign(p);
      return v > d - 1e-5 ? g * d : g * (d - bevelSize);
    };
  for (let vertIdx = 0; vertIdx < posAttr.count; vertIdx++) {
    let px = snapToEdge(posAttr.getX(vertIdx), halfW),
      py = snapToEdge(posAttr.getY(vertIdx), halfH),
      g = snapToEdge(posAttr.getZ(vertIdx), halfD),
      cx = Math.max(-(halfW - bevelSize), Math.min(halfW - bevelSize, px)),
      cy = Math.max(-(halfH - bevelSize), Math.min(halfH - bevelSize, py)),
      cz = Math.max(-(halfD - bevelSize), Math.min(halfD - bevelSize, g));
    if ((SCRATCH_BEVEL_DIR.set(px - cx, py - cy, g - cz), SCRATCH_BEVEL_DIR.lengthSq() > 1e-10)) {
      SCRATCH_BEVEL_DIR.normalize();
      let M = normAttr.getX(vertIdx),
        ny = normAttr.getY(vertIdx),
        nz = normAttr.getZ(vertIdx);
      (Math.abs(px) > halfW - 1e-5 ? 1 : 0) +
        (Math.abs(py) > halfH - 1e-5 ? 1 : 0) +
        (Math.abs(g) > halfD - 1e-5 ? 1 : 0) >=
      2
        ? ((px = cx + SCRATCH_BEVEL_DIR.x * bevelSize),
          (py = cy + SCRATCH_BEVEL_DIR.y * bevelSize),
          (g = cz + SCRATCH_BEVEL_DIR.z * bevelSize),
          normAttr.setXYZ(vertIdx, SCRATCH_BEVEL_DIR.x, SCRATCH_BEVEL_DIR.y, SCRATCH_BEVEL_DIR.z))
        : normAttr.setXYZ(vertIdx, M, ny, nz);
    }
    posAttr.setXYZ(vertIdx, px, py, g);
    let absNx = Math.abs(normAttr.getX(vertIdx)),
      absNy = Math.abs(normAttr.getY(vertIdx)),
      absNz = Math.abs(normAttr.getZ(vertIdx));
    absNx >= absNy && absNx >= absNz
      ? uvAttr.setXY(vertIdx, g, py)
      : absNy >= absNx && absNy >= absNz
        ? uvAttr.setXY(vertIdx, px, g)
        : uvAttr.setXY(vertIdx, px, py);
  }
  return (anchor === 'bottom' && boxGeo.translate(0, height / 2, 0), boxGeo);
}

/**
 * 圆柱几何，侧面 UV 按周长×高度换算成米制，使管材/栏杆的纹理不随半径粗细被拉伸；顶底盖走平面投影
 */
export function cylinderGeometry(
  radiusTop,
  radiusBottom,
  height,
  radialSegments = 16,
  openEnded = !1,
  pivotMode = 'center',
) {
  let geometry = new THREE.CylinderGeometry(
      radiusTop,
      radiusBottom,
      height,
      radialSegments,
      1,
      openEnded,
    ),
    uvAttr = geometry.attributes.uv,
    posAttr = geometry.attributes.position,
    normalAttr = geometry.attributes.normal,
    circumference = Math.PI * (radiusTop + radiusBottom);
  for (let vertexIndex = 0; vertexIndex < uvAttr.count; vertexIndex++)
    Math.abs(normalAttr.getY(vertexIndex)) > 0.9
      ? uvAttr.setXY(vertexIndex, posAttr.getX(vertexIndex), posAttr.getZ(vertexIndex))
      : uvAttr.setXY(
          vertexIndex,
          uvAttr.getX(vertexIndex) * circumference,
          posAttr.getY(vertexIndex),
        );
  return (pivotMode === 'bottom' && geometry.translate(0, height / 2, 0), geometry);
}

/**
 * 沿点列生成 CatmullRom 管体（电缆、软管、缆绳）：段数与 UV 按实际弧长换算，并硬性限制 400 段以免长索把面数拉爆
 */
export function tubeGeometry(points, radius = 0.03, radialSegments = 8, closed = !1, tension = 0) {
  let ctrlPoints = points.map((vertIdx) =>
      vertIdx.isVector3 ? vertIdx : new THREE.Vector3(vertIdx[0], vertIdx[1], vertIdx[2]),
    ),
    curve = new THREE.CatmullRomCurve3(ctrlPoints, closed, 'catmullrom', tension),
    curveLength = curve.getLength(),
    segCount = Math.max(2, Math.ceil(curveLength / Math.max(0.08, radius * 3))),
    tubeGeo = new THREE.TubeGeometry(
      curve,
      Math.min(segCount, 400),
      radius,
      radialSegments,
      closed,
    ),
    uvAttr = tubeGeo.attributes.uv;
  for (let vertIdx = 0; vertIdx < uvAttr.count; vertIdx++)
    uvAttr.setXY(
      vertIdx,
      uvAttr.getX(vertIdx) * curveLength,
      uvAttr.getY(vertIdx) * Math.PI * 2 * radius,
    );
  return tubeGeo;
}

/**
 * applyTransform 复用的临时矩阵，避免每个零件变换都新建 Matrix4
 */
export var SCRATCH_TRS_MATRIX = new THREE.Matrix4();

/**
 * applyTransform 复用的临时四元数
 */
export var SCRATCH_ROTATION = new THREE.Quaternion();

/**
 * buildRoundedBox 旋转复用欧拉角实例，避免每块板都新建
 */
export var SCRATCH_EULER = new THREE.Euler();

/**
 * applyTransform 复用的临时位置向量
 */
export var SCRATCH_POSITION = new THREE.Vector3();

/**
 * applyTransform 复用的临时缩放向量，同时兼容标量与三元组两种缩放写法
 */
export var SCRATCH_SCALE = new THREE.Vector3();

/**
 * 给几何写入逐顶点 color 属性（可传固定 RGB 或按坐标计算的函数），用于锈迹、水渍等顶点级染色，省掉一张贴图
 */
export function colorGeometry(geometry, color) {
  let posAttr = geometry.attributes.position,
    vertCount = posAttr.count,
    colorArray = new Float32Array(vertCount * 3);
  for (let vIdx = 0; vIdx < vertCount; vIdx++) {
    let rgb =
      typeof color == 'function'
        ? color(posAttr.getX(vIdx), posAttr.getY(vIdx), posAttr.getZ(vIdx))
        : color;
    ((colorArray[vIdx * 3] = rgb[0]),
      (colorArray[vIdx * 3 + 1] = rgb[1]),
      (colorArray[vIdx * 3 + 2] = rgb[2]));
  }
  return (geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3)), geometry);
}

/**
 * 合并前的规范化管线：补齐 uv/normal/color、剔除本例不需要的属性、统一 index 有无，再交给 mergeBufferGeometries，失败时退回空几何而不是崩掉
 */
export function mergeGeometryParts(geometries) {
  let preparedGeos = geometries
    .filter(Boolean)
    .map(
      (geo) => (
        geo.attributes.uv ||
          geo.setAttribute(
            'uv',
            new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2),
          ),
        geo.attributes.normal || geo.computeVertexNormals(),
        geo
      ),
    );
  if (!preparedGeos.length) return new THREE.BufferGeometry();
  let hasVertexColor = preparedGeos.some((geo) => geo.attributes.color),
    normalizedGeos = preparedGeos.map((geo) => {
      let currentGeo = (geo.index, geo);
      if (hasVertexColor && !currentGeo.attributes.color) {
        let colorArr = new Float32Array(currentGeo.attributes.position.count * 3).fill(1);
        currentGeo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
      }
      for (let colorArr of Object.keys(currentGeo.attributes))
        ['position', 'normal', 'uv', 'color'].includes(colorArr) ||
          currentGeo.deleteAttribute(colorArr);
      return currentGeo;
    }),
    allIndexed = normalizedGeos.every((geo) => geo.index),
    noneIndexed = normalizedGeos.every((geo) => !geo.index),
    mergeReady =
      allIndexed || noneIndexed
        ? normalizedGeos
        : normalizedGeos.map((geo) => (geo.index ? geo.toNonIndexed() : geo));
  return mergeGeometries(mergeReady, !1) || new THREE.BufferGeometry();
}

/**
 * 把一棵静态子树按「材质 uuid + 投影/接收阴影标志 + layer」分组烘成若干大网格以压 draw call；skinned/instanced/多材质以及带 userData.noMerge 标记的子树原样保留
 */
export function mergeStaticMeshes(
  root,
  { castShadow: castEnabled = !0, receiveShadow: recvEnabled = !0 } = {},
) {
  root.updateMatrixWorld(!0);
  let groupMap = new Map(),
    unmergedMeshes = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    let ancestor = node,
      skipMerge = !1;
    for (; ancestor;) {
      if (ancestor.userData && ancestor.userData.noMerge) {
        skipMerge = !0;
        break;
      }
      ancestor = ancestor.parent;
    }
    if (skipMerge || node.isSkinnedMesh || node.isInstancedMesh || Array.isArray(node.material)) {
      unmergedMeshes.push(node);
      return;
    }
    let groupKey =
      node.material.uuid +
      (node.castShadow ? 'c' : 'n') +
      (node.receiveShadow ? 'r' : 'n') +
      ':' +
      node.layers.mask;
    groupMap.has(groupKey) ||
      groupMap.set(groupKey, {
        mat: node.material,
        geos: [],
        cast: node.castShadow,
        recv: node.receiveShadow,
        layers: node.layers.mask,
      });
    let geoClone = node.geometry.clone();
    (geoClone.applyMatrix4(node.matrixWorld), groupMap.get(groupKey).geos.push(geoClone));
  });
  let outGroup = new THREE.Group();
  for (let node of groupMap.values()) {
    let ancestor = new THREE.Mesh(mergeGeometryParts(node.geos), node.mat);
    ((ancestor.castShadow = node.cast && castEnabled),
      (ancestor.receiveShadow = node.recv && recvEnabled),
      (ancestor.layers.mask = node.layers),
      outGroup.add(ancestor));
  }
  for (let node of unmergedMeshes) {
    node.updateMatrixWorld(!0);
    let ancestor = node.matrixWorld.clone();
    (outGroup.add(node),
      node.matrix.copy(ancestor),
      node.matrix.decompose(node.position, node.quaternion, node.scale));
  }
  return outGroup;
}

/**
 * 建 Mesh 并默认打开 castShadow/receiveShadow，统一道具与建筑对阴影的约定，可用 opts 逐处关掉
 */
export function createShadowMesh(
  geometry,
  material,
  { cast: wantCast = !0, recv: wantRecv = !0 } = {},
) {
  let shadowMesh = new THREE.Mesh(geometry, material);
  return ((shadowMesh.castShadow = wantCast), (shadowMesh.receiveShadow = wantRecv), shadowMesh);
}

/**
 * 按世界尺度重写球体 uv（乘 2πr 与 πr），使材质 tile 的物理尺寸与米一致，而不是每颗球都各自铺满一次
 */
export function createTiledSphere(radius) {
  let sphereGeo = new THREE.SphereGeometry(radius, 48, 32),
    uvAttr = sphereGeo.attributes.uv;
  for (let uvIdx = 0; uvIdx < uvAttr.count; uvIdx++)
    uvAttr.setXY(
      uvIdx,
      uvAttr.getX(uvIdx) * 2 * Math.PI * radius,
      uvAttr.getY(uvIdx) * Math.PI * radius,
    );
  return sphereGeo;
}

/**
 * 按世界尺度重写平面 uv（乘宽高），使材质 tile 的物理尺寸与米一致，避免小面片贴图过密、大面片过大
 */
export function createTiledPlane(width, height) {
  let planeGeo = new THREE.PlaneGeometry(width, height),
    uvAttr = planeGeo.attributes.uv;
  for (let uvIdx = 0; uvIdx < uvAttr.count; uvIdx++)
    uvAttr.setXY(uvIdx, uvAttr.getX(uvIdx) * width, uvAttr.getY(uvIdx) * height);
  return planeGeo;
}

/**
 * 三角绕序修正：用三角形质心相对参考点的有向体积判断整体朝向，需要时整片翻转索引与 UV，避免放样面朝内而黑掉
 */
function orientTrianglesOutward(positions, uvs, start, end, center, inward) {
  let signedVolume = 0;
  for (let triOffset = start; triOffset < end; triOffset += 9) {
    let e1x = positions[triOffset + 3] - positions[triOffset],
      e1y = positions[triOffset + 4] - positions[triOffset + 1],
      e1z = positions[triOffset + 5] - positions[triOffset + 2],
      e2x = positions[triOffset + 6] - positions[triOffset],
      e2y = positions[triOffset + 7] - positions[triOffset + 1],
      e2z = positions[triOffset + 8] - positions[triOffset + 2],
      d = e1y * e2z - e1z * e2y,
      ny = e1z * e2x - e1x * e2z,
      nz = e1x * e2y - e1y * e2x;
    signedVolume +=
      d *
        ((positions[triOffset] + positions[triOffset + 3] + positions[triOffset + 6]) / 3 -
          center[0]) +
      ny *
        ((positions[triOffset + 1] + positions[triOffset + 4] + positions[triOffset + 7]) / 3 -
          center[1]) +
      nz *
        ((positions[triOffset + 2] + positions[triOffset + 5] + positions[triOffset + 8]) / 3 -
          center[2]);
  }
  if (signedVolume < 0 != !!inward)
    for (let triOffset = start; triOffset < end; triOffset += 9) {
      for (let e1y = 0; e1y < 3; e1y++) {
        let e1z = positions[triOffset + 3 + e1y];
        ((positions[triOffset + 3 + e1y] = positions[triOffset + 6 + e1y]),
          (positions[triOffset + 6 + e1y] = e1z));
      }
      let e1x = (triOffset / 3) * 2;
      for (let e1y = 0; e1y < 2; e1y++) {
        let e1z = uvs[e1x + 2 + e1y];
        ((uvs[e1x + 2 + e1y] = uvs[e1x + 4 + e1y]), (uvs[e1x + 4 + e1y] = e1z));
      }
    }
}

/**
 * 截面放样：把二维截面对照着站点序列逐段投影成带状曲面（集装箱波纹板、天沟、包边都靠它），可选首尾封盖并统一朝外绕序
 */
export function loftProfileSurface(
  profile,
  stations,
  project,
  {
    closed: closedLoop = !1,
    center: centerOverride = null,
    inward: inwardFacing = !1,
    caps: addCaps = !1,
  } = {},
) {
  let positions = [],
    uvs = [],
    pointCount = profile.length,
    segCount = closedLoop ? pointCount : pointCount - 1,
    arcLengths = [0];
  for (let rowIndex = 0; rowIndex < segCount; rowIndex++) {
    let stationU = profile[rowIndex],
      stationV = profile[(rowIndex + 1) % pointCount];
    arcLengths.push(
      arcLengths[rowIndex] + Math.hypot(stationV[0] - stationU[0], stationV[1] - stationU[1]),
    );
  }
  for (let rowIndex = 0; rowIndex < stations.length - 1; rowIndex++) {
    let stationU = stations[rowIndex],
      stationV = stations[rowIndex + 1];
    for (let colIndex = 0; colIndex < segCount; colIndex++) {
      let segStartPoint = profile[colIndex],
        segEndPoint = profile[(colIndex + 1) % pointCount],
        triV0 = project(segStartPoint[0], segStartPoint[1], stationU, rowIndex),
        triV1 = project(segEndPoint[0], segEndPoint[1], stationU, rowIndex),
        triV2 = project(segEndPoint[0], segEndPoint[1], stationV, rowIndex + 1),
        triV3 = project(segStartPoint[0], segStartPoint[1], stationV, rowIndex + 1);
      (positions.push(...triV0, ...triV1, ...triV2, ...triV0, ...triV2, ...triV3),
        uvs.push(
          arcLengths[colIndex],
          stationU,
          arcLengths[colIndex + 1],
          stationU,
          arcLengths[colIndex + 1],
          stationV,
          arcLengths[colIndex],
          stationU,
          arcLengths[colIndex + 1],
          stationV,
          arcLengths[colIndex],
          stationV,
        ));
    }
  }
  let vertexFloatCount = positions.length,
    centroidCache = null,
    getCentroid = () => {
      if (centerOverride) return centerOverride;
      if (!centroidCache) {
        centroidCache = [0, 0, 0];
        for (let x = 0; x < vertexFloatCount; x += 3)
          ((centroidCache[0] += positions[x]),
            (centroidCache[1] += positions[x + 1]),
            (centroidCache[2] += positions[x + 2]));
        let g = 3 / vertexFloatCount;
        ((centroidCache[0] *= g), (centroidCache[1] *= g), (centroidCache[2] *= g));
      }
      return centroidCache;
    };
  if (
    (orientTrianglesOutward(positions, uvs, 0, vertexFloatCount, getCentroid(), inwardFacing),
    addCaps && closedLoop)
  ) {
    let rowIndex = 0,
      stationU = 0;
    for (let stationV of profile) ((rowIndex += stationV[0]), (stationU += stationV[1]));
    ((rowIndex /= pointCount), (stationU /= pointCount));
    for (let stationV of [0, stations.length - 1]) {
      let colIndex = positions.length,
        segStartPoint = stations[stationV],
        segEndPoint = project(rowIndex, stationU, segStartPoint, stationV);
      for (let triV0 = 0; triV0 < pointCount; triV0++) {
        let triV1 = profile[triV0],
          triV2 = profile[(triV0 + 1) % pointCount];
        (positions.push(
          ...segEndPoint,
          ...project(triV1[0], triV1[1], segStartPoint, stationV),
          ...project(triV2[0], triV2[1], segStartPoint, stationV),
        ),
          uvs.push(rowIndex, stationU, triV1[0], triV1[1], triV2[0], triV2[1]));
      }
      orientTrianglesOutward(
        positions,
        uvs,
        colIndex,
        positions.length,
        getCentroid(),
        inwardFacing,
      );
    }
  }
  let loftGeo = new THREE.BufferGeometry();
  return (
    loftGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3)),
    loftGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2)),
    loftGeo.computeVertexNormals(),
    loftGeo
  );
}

/**
 * 周期梯形波纹的高度函数：把沿板长的位置映射成「平台—斜坡—平台」的凹陷量，是集装箱侧板压型剖面的数学来源
 */
function corrugationWaveOffset(alongX, period, amplitude, flat, slope) {
  let phase = alongX % period;
  phase < 0 && (phase += period);
  let rampLen = period - flat - 2 * slope;
  return phase <= flat
    ? 0
    : phase < flat + slope
      ? (-amplitude * (phase - flat)) / slope
      : phase <= flat + slope + rampLen
        ? -amplitude
        : -amplitude * (1 - (phase - flat - slope - rampLen) / slope);
}

/**
 * 按给定跨距与波纹参数生成站点数组（位置 + 该处波纹偏移），只保留落在有效区间内的站点，供放样使用
 */
export function buildCorrugationStations(min, max, pitch, depth, flat, slope, origin = min) {
  let rampLen = pitch - flat - 2 * slope,
    profileOffsets = [0, flat, flat + slope, flat + slope + rampLen],
    stations = [min],
    firstTile = Math.floor((min - origin) / pitch) - 1,
    lastTile = Math.ceil((max - origin) / pitch) + 1;
  for (let tileIdx = firstTile; tileIdx <= lastTile; tileIdx++)
    for (let profOffset of profileOffsets) {
      let stationPos = origin + tileIdx * pitch + profOffset;
      stationPos > min + 1e-4 && stationPos < max - 1e-4 && stations.push(stationPos);
    }
  return (
    stations.push(max),
    stations.map((tileIdx) => [
      tileIdx,
      corrugationWaveOffset(tileIdx - origin, pitch, depth, flat, slope),
    ])
  );
}

/**
 * 平面几何简写；道具里大量贴花、铭牌、玻璃片都用它，命名统一便于后续替换成带细分的版本
 */
export function createPlaneGeometry(width, height) {
  return new THREE.PlaneGeometry(width, height);
}

/**
 * UV 按世界尺寸缩放的平面：让警示条纹、锈迹贴图在任意大小的面上保持同一物理密度，而不是被拉伸
 */
export function createPlaneGeometryWorldUV(width, height) {
  let planeGeo = new THREE.PlaneGeometry(width, height),
    uvAttr = planeGeo.attributes.uv;
  for (let uvIdx = 0; uvIdx < uvAttr.count; uvIdx++)
    uvAttr.setXY(uvIdx, uvAttr.getX(uvIdx) * width, uvAttr.getY(uvIdx) * height);
  return planeGeo;
}

/**
 * 去索引并重算法线，得到硬边平面着色；用于需要棱角分明的机械件（法兰、垫块）
 */
function flatShadeGeometry(geometry) {
  let e = geometry.index ? geometry.toNonIndexed() : geometry;
  return (e.computeVertexNormals(), e);
}

/**
 * 带默认分段的球体简写，道具里用于球形护罩、焊点、橡胶垫脚
 */
export function createSphereGeometry(radius, e = 10, t = 6, n = Math.PI * 2, s = 0, o = Math.PI) {
  return new THREE.SphereGeometry(radius, e, t, 0, n, s, o);
}

/**
 * 把 [[半径, 高度], …] 剖面旋成回转体：系船柱、雷达罩、气瓶肩部这类有明确剖面线的零件都用它
 */
export function createLatheGeometryFromProfile(profile, e = 16) {
  return new THREE.LatheGeometry(
    profile.map((t) => new THREE.Vector2(t[0], t[1])),
    e,
  );
}

/**
 * 复用的欧拉角对象，避免每次变换都新建（道具生成一次会调用上万次 applyTransform）
 */
var TEMP_EULER_A = new THREE.Euler();

/**
 * 复用的四元数，与 TEMP_EULER_A 配套
 */
var TEMP_QUAT_A = new THREE.Quaternion();

/**
 * 复用的 4x4 矩阵，applyTransform 的临时载体
 */
var TEMP_MATRIX_A = new THREE.Matrix4();

/**
 * 复用的平移向量
 */
var TEMP_POS_A = new THREE.Vector3();

/**
 * 单位缩放常量，给矩阵 compose 补位，避免每次 new 一个 Vector3(1,1,1)
 */
var UNIT_SCALE = new THREE.Vector3(1, 1, 1);

export function je(geometry, offsetX = 0, offsetY = 0, offsetZ = 0, eulerAngles = null) {
  return (
    eulerAngles
      ? (TEMP_EULER_A.set(eulerAngles[0], eulerAngles[1], eulerAngles[2]),
        TEMP_QUAT_A.setFromEuler(TEMP_EULER_A))
      : TEMP_QUAT_A.identity(),
    TEMP_POS_A.set(offsetX, offsetY, offsetZ),
    TEMP_MATRIX_A.compose(TEMP_POS_A, TEMP_QUAT_A, UNIT_SCALE),
    geometry.applyMatrix4(TEMP_MATRIX_A),
    geometry
  );
}

/**
 * 由位移与欧拉角合成一个 4x4 变换矩阵，供装配器 push() 压栈时使用
 */
export function composeTransformMatrix(posX = 0, posY = 0, posZ = 0, eulerAngles = null) {
  return (
    eulerAngles
      ? (TEMP_EULER_A.set(eulerAngles[0], eulerAngles[1], eulerAngles[2]),
        TEMP_QUAT_A.setFromEuler(TEMP_EULER_A))
      : TEMP_QUAT_A.identity(),
    TEMP_POS_A.set(posX, posY, posZ),
    new THREE.Matrix4().compose(TEMP_POS_A, TEMP_QUAT_A, UNIT_SCALE)
  );
}

/**
 * 第一代道具零件装配器：按材质分桶收集几何、维护变换矩阵栈、提供 box/cyl/tube/bar/beam/decal 语法糖，最后 parts()/group() 合并成少量 Mesh
 */
export var PartBuilder = class {
  constructor(e) {
    ((this.G = e),
      (this.buckets = new Map()),
      (this.stack = []),
      (this.m = null),
      (this.defCol = new Map()));
  }
  M(e, t) {
    return this.G.mats.get(e, t);
  }
  push(e) {
    return (
      this.stack.push(this.m),
      (this.m = this.m ? this.m.clone().multiply(e) : e.clone()),
      this
    );
  }
  pop() {
    return ((this.m = this.stack.pop()), this);
  }
  add(e, t, n, s) {
    this.m && t.applyMatrix4(this.m);
    let o = n || this.defCol.get(e);
    o && colorGeometry(t, o);
    let r = this.buckets.get(e);
    return (
      r ||
        ((r = {
          mat: e,
          geos: [],
          cast: !s,
        }),
        this.buckets.set(e, r)),
      r.geos.push(t),
      t
    );
  }
  box(e, t, n, s, o, r, a, l = {}) {
    return this.add(
      e,
      je(
        l.r === 0
          ? boxGeometry(t, n, s)
          : chamferedBoxGeometry(t, n, s, l.r || Math.min(0.012, Math.min(t, n, s) * 0.25)),
        o,
        r,
        a,
        l.rot,
      ),
      l.col,
    );
  }
  cyl(e, t, n, s, o, r, a, l = {}) {
    let c = cylinderGeometry(t, n, s, l.seg || 12, !!l.open);
    return (l.flat && (c = flatShadeGeometry(c)), this.add(e, je(c, o, r, a, l.rot), l.col));
  }
  tube(e, t, n, s = {}) {
    return this.add(
      e,
      tubeGeometry(t, n, s.seg || 6, !1, s.tension === void 0 ? 0.5 : s.tension),
      s.col,
    );
  }
  bar(e, t, n, s, o = {}) {
    let r = new THREE.Vector3(n[0] - t[0], n[1] - t[1], n[2] - t[2]),
      a = r.length(),
      l = cylinderGeometry(o.r2 === void 0 ? s : o.r2, s, a, o.seg || 6, !o.caps),
      c = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), r.normalize());
    return (
      l.applyMatrix4(
        new THREE.Matrix4().compose(
          new THREE.Vector3((t[0] + n[0]) / 2, (t[1] + n[1]) / 2, (t[2] + n[2]) / 2),
          c,
          UNIT_SCALE,
        ),
      ),
      this.add(e, l, o.col)
    );
  }
  beam(e, t, n, s, o, r = {}) {
    let a = new THREE.Vector3(n[0] - t[0], n[1] - t[1], n[2] - t[2]),
      l = a.length(),
      c =
        r.r === 0
          ? boxGeometry(s, l, o)
          : chamferedBoxGeometry(s, l, o, r.r || Math.min(s, o) * 0.2),
      u = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.normalize());
    return (
      r.twist &&
        u.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.twist)),
      c.applyMatrix4(
        new THREE.Matrix4().compose(
          new THREE.Vector3((t[0] + n[0]) / 2, (t[1] + n[1]) / 2, (t[2] + n[2]) / 2),
          u,
          UNIT_SCALE,
        ),
      ),
      this.add(e, c, r.col)
    );
  }
  decal(e, t, n, s, o, r, a) {
    return this.add(
      e.material,
      je(createPlaneGeometry(a || t * e.aspect, t), n, s, o, r),
      null,
      !0,
    );
  }
  parts() {
    let e = [];
    for (let t of this.buckets.values())
      e.push({
        mat: t.mat,
        geo: mergeGeometryParts(t.geos),
        cast: t.cast,
      });
    return e;
  }
  group(e) {
    return buildPartsGroup(this.parts(), e);
  }
};

/**
 * 把分桶好的零件换成 Mesh 并组装成 Group；materialMap 允许按桶替换材质（集装箱按色号换漆就靠它）
 */
export function buildPartsGroup(parts, materialMap) {
  let partsGroup = new THREE.Group();
  for (let part of parts) {
    let partMesh = new THREE.Mesh(part.geo, (materialMap && materialMap.get(part.mat)) || part.mat);
    ((partMesh.castShadow = part.cast), (partMesh.receiveShadow = !0), partsGroup.add(partMesh));
  }
  return partsGroup;
}

/**
 * 给生成好的道具打上 name / userData.size / userData.colliders，物理与关卡布置只认这三样
 */
export function tagPropUserData(object, name, size, colliders) {
  return (
    (object.userData.size = size),
    (object.userData.colliders = colliders),
    (object.name = name),
    object
  );
}

/**
 * 四分之一圆弧常量，供圆柱绕轴翻转成 X/Z 朝向的几何助手复用，避免到处写 Math.PI/2
 */
export var HALF_PI = Math.PI / 2;

/**
 * 用裸数组直接组装 BufferGeometry；法线缺失时自动计算，是后半段所有手写几何的收口函数
 */
export function createGeometryFromArrays(positions, normals, uvs, indices) {
  let geo = new THREE.BufferGeometry();
  return (
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3)),
    normals && geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3)),
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2)),
    indices && geo.setIndex(indices),
    normals || geo.computeVertexNormals(),
    geo
  );
}

/**
 * 把 [半径, 高度] 剖面绕 Y 轴旋成回转体（油桶、气瓶、线缆盘、轮胎断面都靠它），自带沿剖面的弧长 UV
 */
export function revolveProfileGeometry(profile, segments = 16) {
  let profLen = profile.length,
    positions = [],
    normals = [],
    uvs = [],
    indices = [],
    normY = [],
    normR = [],
    arcLen = [],
    maxR = 0,
    arcLenAcc = 0;
  for (let profIdx = 0; profIdx < profLen; profIdx++) {
    let tanR = 0,
      tanY = 0;
    if (profIdx > 0) {
      let deltaR = profile[profIdx][0] - profile[profIdx - 1][0],
        deltaH = profile[profIdx][1] - profile[profIdx - 1][1],
        segLen = Math.hypot(deltaR, deltaH);
      segLen > 1e-6 &&
        ((tanR += deltaR / segLen), (tanY += deltaH / segLen), (arcLenAcc += segLen));
    }
    if (profIdx < profLen - 1) {
      let deltaR = profile[profIdx + 1][0] - profile[profIdx][0],
        deltaH = profile[profIdx + 1][1] - profile[profIdx][1],
        segLen = Math.hypot(deltaR, deltaH);
      segLen > 1e-6 && ((tanR += deltaR / segLen), (tanY += deltaH / segLen));
    }
    let cosA = Math.hypot(tanR, tanY) || 1;
    (normY.push(tanY / cosA),
      normR.push(-tanR / cosA),
      arcLen.push(arcLenAcc),
      (maxR = Math.max(maxR, profile[profIdx][0])));
  }
  for (let profIdx = 0; profIdx < profLen; profIdx++)
    for (let tanR = 0; tanR <= segments; tanR++) {
      let tanY = (tanR / segments) * PI_TWO * 2,
        cosA = Math.cos(tanY),
        deltaR = Math.sin(tanY);
      (positions.push(
        profile[profIdx][0] * cosA,
        profile[profIdx][1],
        profile[profIdx][0] * deltaR,
      ),
        normals.push(normY[profIdx] * cosA, normR[profIdx], normY[profIdx] * deltaR),
        uvs.push((tanR / segments) * PI_TWO * 2 * maxR, arcLen[profIdx]));
    }
  for (let profIdx = 0; profIdx < profLen - 1; profIdx++)
    if (
      !(
        Math.hypot(
          profile[profIdx + 1][0] - profile[profIdx][0],
          profile[profIdx + 1][1] - profile[profIdx][1],
        ) < 1e-6
      )
    )
      for (let tanR = 0; tanR < segments; tanR++) {
        let tanY = profIdx * (segments + 1) + tanR,
          cosA = tanY + segments + 1,
          deltaR = cosA + 1,
          deltaH = tanY + 1;
        (profile[profIdx][0] > 1e-6 && indices.push(tanY, cosA, deltaH),
          profile[profIdx + 1][0] > 1e-6 && indices.push(cosA, deltaR, deltaH));
      }
  return createGeometryFromArrays(positions, normals, uvs, indices);
}

/**
 * 遍历顶点施加变形回调并回写，是所有「程序化揉形状」的入口
 */
export function mapVertices(geometry, deformFn) {
  let posAttr = geometry.attributes.position,
    scratchVec = new THREE.Vector3();
  for (let vertIdx = 0; vertIdx < posAttr.count; vertIdx++)
    (scratchVec.fromBufferAttribute(posAttr, vertIdx),
      deformFn(scratchVec, vertIdx),
      posAttr.setXYZ(vertIdx, scratchVec.x, scratchVec.y, scratchVec.z));
  return geometry;
}

/**
 * 翻转三角绕序与法线，用来把一个几何反向成内侧/背面（篷布内壁、管道内壁）
 */
export function flipGeometryWinding(geometry) {
  if (geometry.index) {
    let indexArray = geometry.index.array;
    for (let cursor = 0; cursor < indexArray.length; cursor += 3) {
      let swapTmp = indexArray[cursor + 1];
      ((indexArray[cursor + 1] = indexArray[cursor + 2]), (indexArray[cursor + 2] = swapTmp));
    }
  } else
    for (let indexArray of Object.keys(geometry.attributes)) {
      let cursor = geometry.attributes[indexArray],
        swapTmp = cursor.itemSize,
        attrArray = cursor.array;
      for (let vertexCursor = 0; vertexCursor < cursor.count; vertexCursor += 3)
        for (let componentIdx = 0; componentIdx < swapTmp; componentIdx++) {
          let swapValue = attrArray[(vertexCursor + 1) * swapTmp + componentIdx];
          ((attrArray[(vertexCursor + 1) * swapTmp + componentIdx] =
            attrArray[(vertexCursor + 2) * swapTmp + componentIdx]),
            (attrArray[(vertexCursor + 2) * swapTmp + componentIdx] = swapValue));
        }
    }
  let normalArray = geometry.attributes.normal.array;
  for (let indexArray = 0; indexArray < normalArray.length; indexArray++)
    normalArray[indexArray] = -normalArray[indexArray];
  return geometry;
}

/**
 * 按 group 索引删掉一段三角面（并修正后续 group 的 start 偏移），用于把箱体的某一面挖掉做开口
 */
export function removeGeometryGroup(geometry, groupIndex) {
  let targetGroup = geometry.groups[groupIndex];
  if (!targetGroup) return geometry;
  let indexArr = Array.from(geometry.index.array);
  (indexArr.splice(targetGroup.start, targetGroup.count), geometry.setIndex(indexArr));
  for (let group of geometry.groups)
    group.start > targetGroup.start && (group.start -= targetGroup.count);
  return ((targetGroup.count = 0), geometry);
}

/**
 * 复用的四元数，createCylinderBetween 的朝向计算载体
 */
var TEMP_QUAT_B = new THREE.Quaternion();

/**
 * 常量 (0,1,0)：所有「两点之间拉一根柱子」都用它做起始朝向
 */
var UP_AXIS_VECTOR = new THREE.Vector3(0, 1, 0);

/**
 * 复用的方向向量
 */
var TEMP_DIR_B = new THREE.Vector3();

/**
 * 复用的 4x4 矩阵
 */
var TEMP_MATRIX_B = new THREE.Matrix4();

/**
 * 在两点之间生成一根圆柱（可两端不同半径、可封口），栏杆、管件、螺栓全靠它，避免手动算角度
 */
export function createCylinderBetween(
  from,
  endPoint,
  baseRadius = 0.02,
  radialSegments = 6,
  capped = !1,
  topRadius = baseRadius,
) {
  TEMP_DIR_B.set(endPoint[0] - from[0], endPoint[1] - from[1], endPoint[2] - from[2]);
  let segmentLen = TEMP_DIR_B.length();
  TEMP_DIR_B.normalize();
  let cylinderGeo = cylinderGeometry(topRadius, baseRadius, segmentLen, radialSegments, !capped);
  return (
    TEMP_QUAT_B.setFromUnitVectors(UP_AXIS_VECTOR, TEMP_DIR_B),
    TEMP_MATRIX_B.compose(
      new THREE.Vector3(
        (from[0] + endPoint[0]) / 2,
        (from[1] + endPoint[1]) / 2,
        (from[2] + endPoint[2]) / 2,
      ),
      TEMP_QUAT_B,
      new THREE.Vector3(1, 1, 1),
    ),
    cylinderGeo.applyMatrix4(TEMP_MATRIX_B),
    cylinderGeo
  );
}

/**
 * 把闭合二维多边形沿 Z 挤出成空心环带（可选倒角、封盖），用来做托盘垫块、箱盖、货箱翼板这类薄壁件
 */
export function createHollowPolygonExtrusion(
  polygon,
  depth,
  { soft: softCos = 0.6, caps: withCaps = !0 } = {},
) {
  let vertCount = polygon.length,
    positions = [],
    normals = [],
    uvs = [],
    indices = [],
    halfDepth = depth / 2,
    edgeNormals = [],
    perimLen = 0,
    cumLen = [0];
  for (let edgeIndex = 0; edgeIndex < vertCount; edgeIndex++) {
    let neighborOffset = polygon[edgeIndex],
      edgeNormal = polygon[(edgeIndex + 1) % vertCount],
      edgeDx = edgeNormal[0] - neighborOffset[0],
      edgeDy = edgeNormal[1] - neighborOffset[1],
      edgeLen = Math.hypot(edgeDx, edgeDy) || 1;
    (edgeNormals.push([edgeDy / edgeLen, -edgeDx / edgeLen]),
      (perimLen += edgeLen),
      cumLen.push(perimLen));
  }
  let miterNorm = (d, v) => {
    let g = edgeNormals[d],
      idxA = edgeNormals[(v + vertCount) % vertCount];
    if (g[0] * idxA[0] + g[1] * idxA[1] > Math.cos(softCos)) {
      let idxB = g[0] + idxA[0],
        idxC = g[1] + idxA[1],
        ax = Math.hypot(idxB, idxC) || 1;
      return [idxB / ax, idxC / ax];
    }
    return g;
  };
  for (let edgeIndex = 0; edgeIndex < vertCount; edgeIndex++) {
    let neighborOffset = polygon[edgeIndex],
      edgeNormal = polygon[(edgeIndex + 1) % vertCount],
      edgeDx = miterNorm(edgeIndex, edgeIndex - 1),
      edgeDy = miterNorm(edgeIndex, edgeIndex + 1),
      edgeLen = positions.length / 3;
    (positions.push(
      neighborOffset[0],
      neighborOffset[1],
      halfDepth,
      neighborOffset[0],
      neighborOffset[1],
      -halfDepth,
      edgeNormal[0],
      edgeNormal[1],
      -halfDepth,
      edgeNormal[0],
      edgeNormal[1],
      halfDepth,
    ),
      normals.push(
        edgeDx[0],
        edgeDx[1],
        0,
        edgeDx[0],
        edgeDx[1],
        0,
        edgeDy[0],
        edgeDy[1],
        0,
        edgeDy[0],
        edgeDy[1],
        0,
      ),
      uvs.push(
        cumLen[edgeIndex],
        halfDepth,
        cumLen[edgeIndex],
        -halfDepth,
        cumLen[edgeIndex + 1],
        -halfDepth,
        cumLen[edgeIndex + 1],
        halfDepth,
      ),
      indices.push(edgeLen, edgeLen + 1, edgeLen + 2, edgeLen, edgeLen + 2, edgeLen + 3));
  }
  if (withCaps) {
    let edgeIndex = THREE.ShapeUtils.triangulateShape(
      polygon.map((neighborOffset) => new THREE.Vector2(neighborOffset[0], neighborOffset[1])),
      [],
    );
    for (let neighborOffset of [1, -1]) {
      let edgeNormal = positions.length / 3;
      for (let edgeDx of polygon)
        (positions.push(edgeDx[0], edgeDx[1], neighborOffset * halfDepth),
          normals.push(0, 0, neighborOffset),
          uvs.push(edgeDx[0], edgeDx[1]));
      for (let edgeDx of edgeIndex)
        neighborOffset > 0
          ? indices.push(edgeNormal + edgeDx[0], edgeNormal + edgeDx[1], edgeNormal + edgeDx[2])
          : indices.push(edgeNormal + edgeDx[0], edgeNormal + edgeDx[2], edgeNormal + edgeDx[1]);
    }
  }
  return createGeometryFromArrays(positions, normals, uvs, indices);
}

/**
 * 沿三维折线生成有宽度的双面扁带：篷布绑带、开箱胶带、钢丝绳、垫片都用它
 */
export function createRibbonFromPolyline(points, halfExtent, doubleSided = !0) {
  let ptCount = points.length,
    positions = [],
    uvs = [],
    indices = [],
    arcLen = 0,
    vMax = Math.hypot(halfExtent[0], halfExtent[1], halfExtent[2]) * 2;
  for (let ptIdx = 0; ptIdx < ptCount; ptIdx++)
    (ptIdx &&
      (arcLen += Math.hypot(
        points[ptIdx][0] - points[ptIdx - 1][0],
        points[ptIdx][1] - points[ptIdx - 1][1],
        points[ptIdx][2] - points[ptIdx - 1][2],
      )),
      positions.push(
        points[ptIdx][0] - halfExtent[0],
        points[ptIdx][1] - halfExtent[1],
        points[ptIdx][2] - halfExtent[2],
        points[ptIdx][0] + halfExtent[0],
        points[ptIdx][1] + halfExtent[1],
        points[ptIdx][2] + halfExtent[2],
      ),
      uvs.push(arcLen, 0, arcLen, vMax));
  for (let ptIdx = 0; ptIdx < ptCount - 1; ptIdx++) {
    let baseIdx = ptIdx * 2;
    indices.push(baseIdx, baseIdx + 1, baseIdx + 3, baseIdx, baseIdx + 3, baseIdx + 2);
  }
  let ribbonGeo = createGeometryFromArrays(positions, null, uvs, indices);
  if (!doubleSided) return ribbonGeo;
  let backGeo = ribbonGeo.clone(),
    indexArr = backGeo.index.array;
  for (let ptIdx = 0; ptIdx < indexArr.length; ptIdx += 3) {
    let baseIdx = indexArr[ptIdx + 1];
    ((indexArr[ptIdx + 1] = indexArr[ptIdx + 2]), (indexArr[ptIdx + 2] = baseIdx));
  }
  let normalAttr = backGeo.attributes.normal.array;
  for (let ptIdx = 0; ptIdx < normalAttr.length; ptIdx++) normalAttr[ptIdx] = -normalAttr[ptIdx];
  return mergeGeometryParts([ribbonGeo, backGeo]);
}

/**
 * 贴花/铭牌专用的平面四边形（不投阴影），后半段装配器的 decal/label 全部基于它
 */
export function createDecalPlane(width, height) {
  return new THREE.PlaneGeometry(width, height);
}

/**
 * 沿圆柱面弯曲的贴花四边形：贴在油桶、气瓶这种圆弧面上才不会被拉伸或切到表面
 */
export function createCurvedDecalQuad(radius, arcLength, height, segCount = 4) {
  let positions = [],
    normals = [],
    uvs = [],
    indices = [];
  for (let segIndex = 0; segIndex <= segCount; segIndex++) {
    let arcAngle = ((segIndex / segCount - 0.5) * arcLength) / radius,
      sinA = Math.sin(arcAngle),
      cosA = Math.cos(arcAngle);
    (positions.push(
      radius * sinA,
      -height / 2,
      radius * cosA,
      radius * sinA,
      height / 2,
      radius * cosA,
    ),
      normals.push(sinA, 0, cosA, sinA, 0, cosA),
      uvs.push(segIndex / segCount, 0, segIndex / segCount, 1));
  }
  for (let segIndex = 0; segIndex < segCount; segIndex++) {
    let arcAngle = segIndex * 2;
    indices.push(arcAngle, arcAngle + 2, arcAngle + 3, arcAngle, arcAngle + 3, arcAngle + 1);
  }
  return createGeometryFromArrays(positions, normals, uvs, indices);
}

/**
 * UV 按世界尺寸展开的圆环（卡箍、吊环、轮胎侧壁的钢丝圈）
 */
export function createTorusGeometryWorldUV(
  radius,
  tube,
  radialSegments = 6,
  tubularSegments = 12,
  arcAngle = PI_TWO * 2,
) {
  let torusGeo = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments, arcAngle),
    uvAttr = torusGeo.attributes.uv;
  for (let vertexIndex = 0; vertexIndex < uvAttr.count; vertexIndex++)
    uvAttr.setXY(
      vertexIndex,
      uvAttr.getX(vertexIndex) * arcAngle * radius,
      uvAttr.getY(vertexIndex) * 2 * PI_TWO * tube,
    );
  return torusGeo;
}

/**
 * UV 按世界尺寸展开的球（线缆末端、球头手柄）
 */
export function createSphereGeometryWorldUV(radius, widthSegments = 8, heightSegments = 6) {
  let sphereGeo = new THREE.SphereGeometry(radius, widthSegments, heightSegments),
    uvAttr = sphereGeo.attributes.uv;
  for (let vertexIndex = 0; vertexIndex < uvAttr.count; vertexIndex++)
    uvAttr.setXY(
      vertexIndex,
      uvAttr.getX(vertexIndex) * 2 * PI_TWO * radius,
      uvAttr.getY(vertexIndex) * PI_TWO * radius,
    );
  return sphereGeo;
}

/**
 * 把色调（常数或回调）烘进顶点色属性：单个材质就能表现脏/旧/湿的差异，是控制道具 draw call 的关键手段
 */
export function bakeVertexColorTint(geometry, tint) {
  let vertexCount = geometry.attributes.position.count,
    colorAttr = geometry.attributes.color;
  if (
    (colorAttr ||
      ((colorAttr = new THREE.BufferAttribute(new Float32Array(vertexCount * 3).fill(1), 3)),
      geometry.setAttribute('color', colorAttr)),
    tint === 1 || tint == null)
  )
    return geometry;
  let colorArray = colorAttr.array;
  if (typeof tint == 'function') {
    let positionAttr = geometry.attributes.position;
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
      let tintValue = tint(
        positionAttr.getX(vertexIndex),
        positionAttr.getY(vertexIndex),
        positionAttr.getZ(vertexIndex),
      );
      typeof tintValue == 'number'
        ? ((colorArray[vertexIndex * 3] *= tintValue),
          (colorArray[vertexIndex * 3 + 1] *= tintValue),
          (colorArray[vertexIndex * 3 + 2] *= tintValue))
        : ((colorArray[vertexIndex * 3] *= tintValue[0]),
          (colorArray[vertexIndex * 3 + 1] *= tintValue[1]),
          (colorArray[vertexIndex * 3 + 2] *= tintValue[2]));
    }
    return geometry;
  }
  let tintR = typeof tint == 'number' ? tint : tint[0],
    tintG = typeof tint == 'number' ? tint : tint[1],
    tintB = typeof tint == 'number' ? tint : tint[2];
  for (let positionAttr = 0; positionAttr < vertexCount; positionAttr++)
    ((colorArray[positionAttr * 3] *= tintR),
      (colorArray[positionAttr * 3 + 1] *= tintG),
      (colorArray[positionAttr * 3 + 2] *= tintB));
  return geometry;
}

/**
 * 复用的 4x4 矩阵（装配器变换缓存）
 */
var TEMP_MATRIX_C = new THREE.Matrix4();

/**
 * 复用的四元数
 */
export var TEMP_QUAT_C = new THREE.Quaternion();

/**
 * 复用的欧拉角
 */
export var TEMP_EULER_C = new THREE.Euler();

/**
 * 复用的位置向量
 */
export var TEMP_POS_C = new THREE.Vector3();

/**
 * 复用的缩放向量
 */
export var TEMP_SCALE_C = new THREE.Vector3();

/**
 * UV 整体平移的平面：让木箱各面的木纹贴图错开，避免同一块面重复得一眼看出来
 */
export function createPlaneGeometryOffsetUV(width, height, offsetU = 0, offsetV = 0) {
  let planeGeo = new THREE.PlaneGeometry(width, height),
    uvAttr = planeGeo.attributes.uv,
    posAttr = planeGeo.attributes.position;
  for (let vertexIndex = 0; vertexIndex < uvAttr.count; vertexIndex++)
    uvAttr.setXY(
      vertexIndex,
      posAttr.getX(vertexIndex) + offsetU,
      posAttr.getY(vertexIndex) + offsetV,
    );
  return planeGeo;
}

/**
 * 四个水平朝向（+Z/-Z/+X/-X）的欧拉角表，箱体贴面/贴花按面取角度
 */
export var FACE_ROTATIONS = {
  pz: [0, 0, 0],
  nz: [0, PI_TWO, 0],
  px: [0, HALF_PI, 0],
  nx: [0, -HALF_PI, 0],
};

/**
 * 与 createPlaneGeometryOffsetUV 等价的重复实现，纸箱各面贴图错位用
 */
export function createPlaneGeometryOffsetUVAlt(width, height, uvOffsetX = 0, uvOffsetY = 0) {
  let planeGeo = new THREE.PlaneGeometry(width, height),
    uvAttr = planeGeo.attributes.uv,
    posAttr = planeGeo.attributes.position;
  for (let vertIdx = 0; vertIdx < uvAttr.count; vertIdx++)
    uvAttr.setXY(vertIdx, posAttr.getX(vertIdx) + uvOffsetX, posAttr.getY(vertIdx) + uvOffsetY);
  return planeGeo;
}

/**
 * 复用的四元数，createRoundedBeamBetween 的朝向计算载体
 */
var TEMP_QUAT_D = new THREE.Quaternion();

/**
 * 常量 (0,1,0) 的第二份副本
 */
var UP_AXIS_VECTOR_B = new THREE.Vector3(0, 1, 0);

/**
 * 复用的方向向量
 */
var TEMP_DIR_C = new THREE.Vector3();

/**
 * 复用的 4x4 矩阵
 */
var TEMP_MATRIX_D = new THREE.Matrix4();

/**
 * 在两点之间生成一根带圆角的方梁（可退化成硬边方料）：叉车护顶架、垃圾桶加强筋这类方截面杆件都靠它
 */
export function createRoundedBeamBetween(
  from,
  toPoint,
  width,
  depth,
  bevel = 0.006,
  hardEdges = !1,
) {
  TEMP_DIR_C.set(toPoint[0] - from[0], toPoint[1] - from[1], toPoint[2] - from[2]);
  let beamLen = TEMP_DIR_C.length();
  TEMP_DIR_C.normalize();
  let beamGeo = hardEdges
    ? boxGeometry(width, beamLen, depth)
    : roundedBoxGeometry(width, beamLen, depth, bevel);
  return (
    TEMP_QUAT_D.setFromUnitVectors(UP_AXIS_VECTOR_B, TEMP_DIR_C),
    TEMP_MATRIX_D.compose(
      new THREE.Vector3(
        (from[0] + toPoint[0]) / 2,
        (from[1] + toPoint[1]) / 2,
        (from[2] + toPoint[2]) / 2,
      ),
      TEMP_QUAT_D,
      new THREE.Vector3(1, 1, 1),
    ),
    beamGeo.applyMatrix4(TEMP_MATRIX_D),
    beamGeo
  );
}

/**
 * 按有向面积判断并统一多边形绕序为逆时针，挤出函数要求输入方向一致
 */
export var ensurePolygonCCW = (polygon) => {
  let e = 0;
  for (let t = 0; t < polygon.length; t++) {
    let n = polygon[t],
      s = polygon[(t + 1) % polygon.length];
    e += n[0] * s[1] - s[0] * n[1];
  }
  return e < 0 ? polygon.slice().reverse() : polygon;
};

/**
 * 按材质归并几何体的批处理器：先攒后一次性合并，把上千个小件压成几十个 draw call；支持材质重映射、整体平移和最小尺寸剔除（远景只保留大块）
 */
export var MeshBatcher = class {
  constructor() {
    ((this.b = new Map()), (this.tris = 0), (this.remap = null), (this.dz = 0), (this.minSize = 0));
  }
  add(e, t, n) {
    if (!t) return;
    if (Array.isArray(t)) {
      for (let o of t) this.add(e, o, n);
      return;
    }
    if (this.remap) {
      let o = this.remap(e, n);
      if (!o) return;
      if (this.minSize) {
        t.computeBoundingBox();
        let r = t.boundingBox;
        if (Math.max(r.max.x - r.min.x, r.max.y - r.min.y, r.max.z - r.min.z) < this.minSize)
          return;
      }
      ((e = o[0]), (n = o[1]), this.dz && t.translate(0, 0, this.dz));
    }
    TINTED_MATERIALS.has(e) &&
      !t.attributes.color &&
      colorGeometry(t, (o, r, a) => tintByHash(o, r, a, n || WHITE_TINT));
    let s = this.b.get(e.uuid);
    (s ||
      ((s = {
        mat: e,
        geos: [],
      }),
      this.b.set(e.uuid, s)),
      s.geos.push(t),
      (this.tris += (t.index ? t.index.count : t.attributes.position.count) / 3));
  }
  build({ cast: e = !0, recv: t = !0 } = {}) {
    let n = new THREE.Group();
    for (let s of this.b.values()) {
      let o = mergeGeometryParts(s.geos),
        r = new THREE.Mesh(o, s.mat),
        a = s.mat.isMeshBasicMaterial || s.mat.transparent;
      ((r.castShadow = e && !a), (r.receiveShadow = t && !a), n.add(r));
    }
    return (this.b.clear(), n);
  }
};

/**
 * 用两个对角点描述一个方盒几何，是整套结构装配最常用的写法（可直接给出局部坐标区间）
 */
export function boxFromBounds(minX, minY, minZ, maxX, maxY, maxZ, bevelRadius = 0) {
  let sizeX = Math.abs(maxX - minX),
    sizeY = Math.abs(maxY - minY),
    sizeZ = Math.abs(maxZ - minZ),
    boxGeo =
      bevelRadius > 0
        ? beveledBoxGeometry(sizeX, sizeY, sizeZ, bevelRadius)
        : boxGeometry(sizeX, sizeY, sizeZ);
  return (boxGeo.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2), boxGeo);
}

/**
 * 沿 x/y/z 轴摆放的圆柱/圆盘几何，省去每次手写旋转
 */
export function cylinderFromAxis(
  radiusTop,
  radiusBottom,
  height,
  axis,
  posX,
  posY,
  posZ,
  segments = 12,
  openEnded = !1,
) {
  let cylGeo = cylinderGeometry(radiusTop, radiusBottom, height, segments, openEnded);
  return (
    axis === 'x' ? cylGeo.rotateZ(Math.PI / 2) : axis === 'z' && cylGeo.rotateX(Math.PI / 2),
    cylGeo.translate(posX, posY, posZ),
    cylGeo
  );
}

/**
 * 两点之间生成一根圆柱杆件（栏杆、桁架、拉索），自动求朝向与长度
 */
export function strutBetween(startPt, endPt, radius = 0.03, radialSegments = 5, openEnded = !1) {
  ((startPt = toVec3(startPt)), (endPt = toVec3(endPt)));
  let axisVec = new THREE.Vector3().subVectors(endPt, startPt),
    length = axisVec.length();
  if (length < 1e-5) return null;
  let strutGeo = cylinderGeometry(radius, radius, length, radialSegments, !openEnded);
  return (
    TMP_QUAT.setFromUnitVectors(UP_AXIS, axisVec.multiplyScalar(1 / length)),
    TMP_MATRIX.compose(
      new THREE.Vector3().addVectors(startPt, endPt).multiplyScalar(0.5),
      TMP_QUAT,
      ONE_SCALE,
    ),
    strutGeo.applyMatrix4(TMP_MATRIX),
    strutGeo
  );
}

/**
 * 两点之间生成一根可带锥度的方截面梁（斜撑、箱型杆），用于桁架与结构斜撑
 */
export function beamBetween(startPt, endPt, beamWidth = 0.3, beamDepth = 0.3, bevel = 0) {
  ((startPt = toVec3(startPt)), (endPt = toVec3(endPt)));
  let axisVec = new THREE.Vector3().subVectors(endPt, startPt),
    length = axisVec.length();
  axisVec.multiplyScalar(1 / length);
  let sideVec = new THREE.Vector3().crossVectors(axisVec, UP_AXIS);
  sideVec.lengthSq() < 1e-6 ? sideVec.set(1, 0, 0) : sideVec.normalize();
  let upVec = new THREE.Vector3().crossVectors(sideVec, axisVec),
    beamGeo =
      bevel > 0
        ? beveledBoxGeometry(beamWidth, length, beamDepth, bevel)
        : boxGeometry(beamWidth, length, beamDepth);
  return (
    TMP_MATRIX.makeBasis(sideVec, axisVec, upVec).setPosition(
      (startPt.x + endPt.x) / 2,
      (startPt.y + endPt.y) / 2,
      (startPt.z + endPt.z) / 2,
    ),
    beamGeo.applyMatrix4(TMP_MATRIX),
    beamGeo
  );
}

/**
 * 把一串点连成连续杆件数组，一次性交给批处理器，用于管线与弯曲钢筋
 */
export function strutsAlongPath(points, e = 0.03, t = 5) {
  let n = [];
  for (let s = 0; s < points.length - 1; s++) {
    let o = strutBetween(points[s], points[s + 1], e, t);
    o && n.push(o);
  }
  return n;
}

/**
 * 在两点间生成带垂坠的控制点（抛物线近似），给电缆、缆绳做出自然下垂
 */
export function catenaryPoints(startPt, endPt, sagAmount = 1, segCount = 10) {
  ((startPt = toVec3(startPt)), (endPt = toVec3(endPt)));
  let points = [];
  for (let segIdx = 0; segIdx <= segCount; segIdx++) {
    let t01 = segIdx / segCount,
      pt = new THREE.Vector3().lerpVectors(startPt, endPt, t01);
    ((pt.y -= sagAmount * 4 * t01 * (1 - t01)), points.push(pt));
  }
  return points;
}

/**
 * 建一个已定位定向的平面片，专用于贴标牌、贴花与窗面
 */
export function planeAt(w, h, x, y, z, o = 0, r = 0) {
  let a = new THREE.PlaneGeometry(w, h);
  return (r && a.rotateX(r), o && a.rotateY(o), a.translate(x, y, z), a);
}

/**
 * 判断法线是否三个分量都偏离坐标轴，只给倒角/圆角面加磨损亮度，平面保持干净
 */
var isBevelNormal = (nx, ny, nz) => Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)) < 0.95;

/**
 * 挤出板的磨损掩码：只让侧壁法线（z 分量居中）吃到磨损，前后端面不脏
 */
var isLateralNormal = (nx, ny, nz) => {
  let n = Math.abs(nz);
  return n > 0.15 && n < 0.95;
};

/**
 * buildRoundedBox 里把欧拉角转矩阵的复用 Matrix4
 */
var SCRATCH_ROTATION_MATRIX = new THREE.Matrix4();

/**
 * 圆角盒体生成器：把 3×3×3 分段盒体的棱角顶点沿法线内收成圆角（半径会被夹到最短边的一半），再烘顶点色磨损、可选预旋转并平移到位，武器上几十块平板/导轨全靠它
 */
export function buildRoundedBox(
  width,
  height,
  depth,
  bevel,
  posX,
  posY,
  posZ,
  tint,
  wearAmount = 0,
  rotEuler = null,
) {
  let boxGeo = beveledBoxGeometry(width, height, depth, bevel);
  return (
    applyVertexShading(boxGeo, tint, wearAmount, isBevelNormal),
    rotEuler &&
      (y_.set(rotEuler[0], rotEuler[1], rotEuler[2]),
      boxGeo.applyMatrix4(SCRATCH_ROTATION_MATRIX.makeRotationFromEuler(y_))),
    boxGeo.translate(posX, posY, -posZ),
    boxGeo
  );
}

/**
 * 把二维点列转成闭合 THREE.Shape，并挂上挖孔路径，供挤出使用
 */
function createShapeFromPoints(points, holes) {
  let shape = new THREE.Shape();
  if (
    (points.forEach((point, pointIdx) =>
      pointIdx ? shape.lineTo(point[0], point[1]) : shape.moveTo(point[0], point[1]),
    ),
    shape.closePath(),
    holes)
  )
    for (let point of holes)
      shape.holes.push(
        new THREE.Path(point.map((pointIdx) => new THREE.Vector2(pointIdx[0], pointIdx[1]))),
      );
  return shape;
}

/**
 * 按深度与倒角量把 Shape 挤成实体，倒角段数压到 1 以省面数
 */
function extrudeShape(points, depth, bevel, holes) {
  return new THREE.ExtrudeGeometry(createShapeFromPoints(points, holes), {
    depth: Math.max(1e-4, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 6,
  });
}

/**
 * 修挤出体的端面法线：靠近两端的位置强制轴对齐、其余侧壁去掉轴向分量，避免倒角让平板看起来是圆饼
 */
function flattenCapNormals(geometry) {
  geometry.computeBoundingBox();
  let zMin = geometry.boundingBox.min.z,
    zMax = geometry.boundingBox.max.z,
    posAttr = geometry.attributes.position,
    normAttr = geometry.attributes.normal;
  for (let vertIdx = 0; vertIdx < posAttr.count; vertIdx++) {
    let normalZ = normAttr.getZ(vertIdx),
      absNormalZ = Math.abs(normalZ);
    if (absNormalZ < 0.15 || absNormalZ > 0.95) continue;
    let vertZ = posAttr.getZ(vertIdx);
    if (Math.abs(vertZ - zMin) < 1e-6 || Math.abs(vertZ - zMax) < 1e-6)
      normAttr.setXYZ(vertIdx, 0, 0, Math.sign(normalZ));
    else {
      let xyLen = Math.hypot(normAttr.getX(vertIdx), normAttr.getY(vertIdx)) || 1;
      normAttr.setXYZ(vertIdx, normAttr.getX(vertIdx) / xyLen, normAttr.getY(vertIdx) / xyLen, 0);
    }
  }
  return geometry;
}

/**
 * 沿 X 轴方向挤出的侧板（外形轮廓在 YZ 面），挤出后转 90 度对齐机匣侧面
 */
export function buildPlateX(points, zStart, zEnd, bevel, tint, shadeBias = 0, extrudeOpts = null) {
  let plateGeo = extrudeShape(points, zEnd - zStart, bevel, extrudeOpts);
  return (
    applyVertexShading(plateGeo, tint, shadeBias, isLateralNormal),
    flattenCapNormals(plateGeo),
    plateGeo.translate(0, 0, zStart + bevel),
    plateGeo.rotateY(Math.PI / 2),
    plateGeo
  );
}

/**
 * 沿 Z 轴（枪管方向）挤出的顶板/导轨齿，是 buildPlateX 的未旋转版本
 */
export function buildPlateZ(points, zStart, zEnd, bevel, tint, shadeBias = 0, extrudeOpts = null) {
  let plateGeo = extrudeShape(points, zEnd - zStart, bevel, extrudeOpts);
  return (
    applyVertexShading(plateGeo, tint, shadeBias, isLateralNormal),
    flattenCapNormals(plateGeo),
    plateGeo.translate(0, 0, -zEnd + bevel),
    plateGeo
  );
}

/**
 * 圆头长条管件（销轴、螺丝座、枪管箍），沿圆角矩形轨迹绕一圈成管，再转到枪身坐标
 */
export function buildRoundedTab(
  width,
  length,
  posX,
  posY,
  posZ,
  tint,
  sweepSegments = 12,
  twistAngle = 0,
) {
  let cornerRadius = Math.min(width * 0.25, length * 0.25),
    halfLength = length / 2,
    tabGeo = buildLatheBody(
      [
        [0, -halfLength],
        [width - cornerRadius, -halfLength],
        [width, -halfLength + cornerRadius],
        [width, halfLength - cornerRadius],
        [width - cornerRadius, halfLength],
        [0, halfLength],
      ],
      sweepSegments,
      tint,
      twistAngle,
    );
  return (tabGeo.rotateY(Math.PI / 2), tabGeo.translate(posX, posY, -posZ), tabGeo);
}

/**
 * 生成胶囊形开孔轮廓（两段半圆+直边），用作板件上的减重槽与握把指槽
 */
export function roundedSlotOutline(centerX, centerY, length, width, arcSteps = 4) {
  let outline = [],
    halfW = width / 2,
    straightHalf = length / 2 - halfW;
  for (let stepIdx = 0; stepIdx <= arcSteps; stepIdx++) {
    let angle = -Math.PI / 2 + (stepIdx / arcSteps) * Math.PI;
    outline.push([
      centerX + straightHalf + Math.cos(angle) * halfW,
      centerY + Math.sin(angle) * halfW,
    ]);
  }
  for (let stepIdx = 0; stepIdx <= arcSteps; stepIdx++) {
    let angle = Math.PI / 2 + (stepIdx / arcSteps) * Math.PI;
    outline.push([
      centerX - straightHalf + Math.cos(angle) * halfW,
      centerY + Math.sin(angle) * halfW,
    ]);
  }
  return outline;
}

/**
 * 生成切角矩形八点轮廓，用于机匣盖等带倒角的板件外形
 */
export var roundedRectOutline = (x0, y0, x1, y1, corner) => [
  [x0 + corner, y0],
  [x1 - corner, y0],
  [x1, y0 + corner],
  [x1, y1 - corner],
  [x1 - corner, y1],
  [x0 + corner, y1],
  [x0, y1 - corner],
  [x0, y0 + corner],
];

/**
 * 数几何体三角形数，用于启动日志和武器 debug 信息里的面数统计
 */
export var triangleCount = (geometry) =>
  (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;

/**
 * 环形网格累加器：按固定环顶点数逐环推点与顶点色，收尾时统一生成 position/color/uv 与索引、算法线，并可把退化环的接缝法线焊接平滑——手套与袖管的曲面全靠它拼
 */
export var RingMeshBuilder = class {
  constructor(e) {
    ((this.N = e), (this.P = []), (this.C = []), (this.weld = []));
  }
  v(e, t, n = 1) {
    (this.P.push(e.x, e.y, e.z), this.C.push(t[0] * n, t[1] * n, t[2] * n));
  }
  rings() {
    return this.P.length / 3 / this.N;
  }
  collapse() {
    this.weld.push(this.rings() - 1);
  }
  geo(e = !1) {
    let t = this.N,
      n = this.rings(),
      s = [];
    for (let a = 0; a < n - 1; a++)
      for (let l = 0; l < t; l++) {
        let c = a * t + l,
          u = a * t + ((l + 1) % t),
          h = c + t,
          f = u + t;
        e ? s.push(c, u, h, u, f, h) : s.push(c, h, u, u, h, f);
      }
    let o = new THREE.BufferGeometry();
    (o.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)),
      o.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3)),
      o.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(new Float32Array((this.P.length / 3) * 2), 2),
      ),
      o.setIndex(s),
      o.computeVertexNormals());
    let r = o.attributes.normal;
    for (let a of this.weld) {
      let l = 0,
        c = 0,
        u = 0;
      for (let f = 0; f < t; f++)
        ((l += r.getX(a * t + f)), (c += r.getY(a * t + f)), (u += r.getZ(a * t + f)));
      let h = Math.hypot(l, c, u) || 1;
      for (let f = 0; f < t; f++) r.setXYZ(a * t + f, l / h, c / h, u / h);
    }
    return o;
  }
};

/**
 * 通用参数化网格：对 u/v 两组采样值求位置并回调出顶点色，用于护板、舌片等曲面片
 */
export function buildGridSurface(uSamples, vSamples, project) {
  let positions = [],
    colors = [],
    indices = [],
    uCount = uSamples.length,
    vCount = vSamples.length;
  for (let vIdx = 0; vIdx < vCount; vIdx++)
    for (let uIdx = 0; uIdx < uCount; uIdx++) {
      let rgb = project(uSamples[uIdx], vSamples[vIdx], SCRATCH_VEC3);
      (positions.push(SCRATCH_VEC3.x, SCRATCH_VEC3.y, SCRATCH_VEC3.z),
        colors.push(rgb[0], rgb[1], rgb[2]));
    }
  for (let vIdx = 0; vIdx < vCount - 1; vIdx++)
    for (let uIdx = 0; uIdx < uCount - 1; uIdx++) {
      let rgb = vIdx * uCount + uIdx,
        idx1 = rgb + 1,
        idxNext = rgb + uCount,
        idxNextDiag = idxNext + 1;
      indices.push(rgb, idx1, idxNext, idx1, idxNextDiag, idxNext);
    }
  let outGeometry = new THREE.BufferGeometry();
  return (
    outGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)),
    outGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)),
    outGeometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2),
    ),
    outGeometry.setIndex(indices),
    outGeometry.computeVertexNormals(),
    outGeometry
  );
}

/**
 * 曲面片的默认 7 段采样分布（两端加密），让圆角边缘更圆
 */
export var SHEET_SAMPLES = [-1, -0.9, -0.5, 0, 0.5, 0.9, 1];

/**
 * 曲面片边缘权重：最外圈返回 -1（改走暗色/贴合），次外圈 0.82，内部 1，用来压出包边
 */
export var sheetEdgeWeight = (v) => (Math.abs(v) > 0.95 ? -1 : Math.abs(v) > 0.8 ? 0.82 : 1);

/**
 * 沿 X 轴镜像几何并翻转索引绕序（缺索引时补一个），用来从左手直接得到右手手套
 */
export function mirrorGeometryX(geometry) {
  if ((geometry.scale(-1, 1, 1), !geometry.index)) {
    let idxCursor = geometry.attributes.position.count,
      identityIdx = new Uint32Array(idxCursor);
    for (let vIdx = 0; vIdx < idxCursor; vIdx++) identityIdx[vIdx] = vIdx;
    geometry.setIndex(new THREE.BufferAttribute(identityIdx, 1));
  }
  let indexArr = geometry.index.array;
  for (let idxCursor = 0; idxCursor < indexArr.length; idxCursor += 3) {
    let identityIdx = indexArr[idxCursor + 1];
    ((indexArr[idxCursor + 1] = indexArr[idxCursor + 2]), (indexArr[idxCursor + 2] = identityIdx));
  }
  return geometry;
}

/**
 * 带倒角的长方体生成器：机械件的边角必须有一致的小圆角才不显得是塑料玩具，默认 8mm 半径对应真实倒角尺度
 */
export var createRoundedBox = (width, height, depth, n = 0.008) =>
  beveledBoxGeometry(width, height, depth, n);

/**
 * 把已经烘焙进 Rig 骨骼的几何模块平移旋转缩放到位，是骨骼部件摆放的唯一入口（位置+欧拉角+统一缩放）
 */
export var transformGeom = (geom, x, y, z, s = 0, o = 0, r = 0, a = 1) =>
  applyTransform(geom, {
    p: [x, y, z],
    r: [s, o, r],
    s: a,
  });

/**
 * 沿 Y 轴的圆柱几何（默认朝向），机械件里最常见的轴对称体
 */
export var createCylinderY = (radiusTop, radiusBottom, height, n = 12) =>
  cylinderGeometry(radiusTop, radiusBottom, height, n);

/**
 * 沿 X 轴的圆柱几何，绕 Z 转 -90° 得到，用于横向轴件与枪管
 */
export var createCylinderX = (radiusTop, radiusBottom, height, n = 12) =>
  applyTransform(cylinderGeometry(radiusTop, radiusBottom, height, n), {
    r: [0, 0, -va],
  });

/**
 * 沿 Z 轴的圆柱几何，绕 X 转 +90° 得到，用于前后向的轴件与镜头筒
 */
export var createCylinderZ = (radiusTop, radiusBottom, height, n = 12) =>
  applyTransform(cylinderGeometry(radiusTop, radiusBottom, height, n), {
    r: [va, 0, 0],
  });

/**
 * createStrut 的起点暂存向量，复用以避免每帧新分配
 */
var strutFrom = new THREE.Vector3();

/**
 * createStrut 的终点暂存向量
 */
var strutTo = new THREE.Vector3();

/**
 * createStrut 的朝向四元数暂存（把圆柱从 Y 轴旋到两点连线方向）
 */
var strutQuat = new THREE.Quaternion();

/**
 * 单位 Y 轴常量，作为圆柱默认朝向上的参考方向
 */
var AXIS_Y = new THREE.Vector3(0, 1, 0);

/**
 * createStrut 的复合变换矩阵暂存（中点位移 + 朝向 + 单位缩放）
 */
var strutMatrix = new THREE.Matrix4();

/**
 * 两点之间的圆柱拉杆生成器：按两点距离决定长度并自动对齐朝向，用于液压杆、天线、钢索这类跨关节的连接件
 */
export function createStrut(from, toPoint, radiusA, radiusB = radiusA, radialSegs = 8) {
  (strutFrom.set(from[0], from[1], from[2]), strutTo.set(toPoint[0], toPoint[1], toPoint[2]));
  let strutLen = strutFrom.distanceTo(strutTo),
    strutGeo = cylinderGeometry(radiusB, radiusA, strutLen, radialSegs);
  return (
    strutQuat.setFromUnitVectors(AXIS_Y, strutTo.clone().sub(strutFrom).normalize()),
    strutMatrix.compose(strutFrom.clone().add(strutTo).multiplyScalar(0.5), strutQuat, LC),
    strutGeo.applyMatrix4(strutMatrix),
    strutGeo
  );
}

/**
 * 可非均匀缩放的球体生成器，用一个球做出椭球壳体（浮筒、机头罩），比专门建几何省面
 */
export var createScaledSphere = (radius, e = 14, t = 10, n = 1, s = 1, o = 1) => {
  let r = new THREE.SphereGeometry(radius, e, t);
  return (r.scale(n, s, o), r);
};

/**
 * 沿 X 轴的微型六角螺栓头（6 段圆柱），散落在装甲板上提供机械密度
 */
export var makeBoltHexX = (x, y, z) =>
  transformGeom(createCylinderX(0.0075, 0.0075, 0.006, 6), x, y, z);

/**
 * 沿 Y 轴的微型六角螺栓头，用于朝上的安装面
 */
export var makeBoltHexY = (x, y, z) =>
  transformGeom(createCylinderY(0.0075, 0.0075, 0.006, 6), x, y, z);

/**
 * 沿 Z 轴的微型六角螺栓头，用于朝前的安装面
 */
export var makeBoltHexZ = (x, y, z) =>
  transformGeom(createCylinderZ(0.0075, 0.0075, 0.006, 6), x, y, z);
