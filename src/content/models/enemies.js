// content/models/enemies.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  createCylinderX,
  createCylinderY,
  createCylinderZ,
  createRoundedBox,
  createScaledSphere,
  createStrut,
  cylinderGeometry,
  makeBoltHexX,
  makeBoltHexY,
  makeBoltHexZ,
  mergeGeometries,
  transformGeom,
  tubeGeometry,
} from '../../assets/procedural/geometry.js';

import {
  MARK_ATLAS_HEIGHT,
  MARK_ATLAS_WIDTH,
  PAC9_MARK_REGIONS,
} from '../../assets/procedural/textures.js';

import { hullNormal, hullPoint } from '../backdrop/ships.js';

import { GULL_RIG, createRotorBellGeometry } from '../../gameplay/enemies/drone.js';

import { HOUND_RIG } from '../../gameplay/enemies/walker.js';

import {
  RIG_METAL_BASE,
  RIG_METAL_BORE,
  RIG_METAL_BRIGHT,
  RIG_METAL_CHROME,
  RIG_METAL_WHITE,
  RIG_SHELL_COOL,
  RIG_SHELL_DARK,
  RIG_SHELL_HAZARD,
  RIG_SHELL_RUST,
  RIG_SHELL_SHADOW,
  RIG_SHELL_WHITE,
  buildMarkingsAtlas,
} from '../../gameplay/weapons/rig.js';

import { va } from '../../misc.js';

/**
 * 线缆盘木侧板的扇形拼板几何：把圆盘切成 9 瓣并给每瓣随机 UV 偏移，做出木板拼接而不是整圆
 */
export function createCableReelDiscGeometries(radius, segments, rand, unusedOffset = 0) {
  let geometryList = [],
    sliceWidth = (2 * radius) / segments;
  for (let sliceIdx = 0; sliceIdx < segments; sliceIdx++) {
    let sliceMinX = -radius + sliceIdx * sliceWidth + 0.003,
      sliceMaxX = -radius + (sliceIdx + 1) * sliceWidth - 0.003,
      xSamples = [sliceMinX, (sliceMinX + sliceMaxX) / 2, sliceMaxX],
      posArray = [],
      normArray = [],
      uvArray = [],
      indexArray = [],
      halfChord = (y) => Math.sqrt(Math.max(0, radius * radius - y * y)),
      uvOffsetX = rand() * 2,
      uvOffsetY = rand() * 2;
    for (let edgeX of xSamples)
      (posArray.push(edgeX, -halfChord(edgeX), 0, edgeX, halfChord(edgeX), 0),
        normArray.push(0, 0, 1, 0, 0, 1),
        uvArray.push(
          -halfChord(edgeX) + uvOffsetX,
          edgeX + uvOffsetY,
          halfChord(edgeX) + uvOffsetX,
          edgeX + uvOffsetY,
        ));
    indexArray.push(0, 2, 3, 0, 3, 1, 2, 4, 5, 2, 5, 3);
    let sliceGeo = new THREE.BufferGeometry();
    (sliceGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArray), 3)),
      sliceGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normArray), 3)),
      sliceGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvArray), 2)),
      sliceGeo.setIndex(indexArray),
      geometryList.push(sliceGeo));
  }
  return geometryList;
}

/**
 * 在船壳参数网格上贴出贴合曲面的补片（船名、锈痕、水线漆），自动沿法线外推避免 z-fighting
 */
export function hullPatchGeo(
  station0,
  station1,
  bottomY,
  topY,
  side,
  normalOffset = 0.012,
  stationSegs = 6,
  verticalSegs = 1,
) {
  let posArr = [],
    uvArr = [],
    nrmArr = [],
    idxArr = [];
  for (let rowIdx = 0; rowIdx <= verticalSegs; rowIdx++)
    for (let colIdx = 0; colIdx <= stationSegs; colIdx++) {
      let stationVal = station0 + ((station1 - station0) * colIdx) / stationSegs,
        yVal = bottomY + ((topY - bottomY) * rowIdx) / verticalSegs,
        surfNormal = hullNormal(stationVal, yVal, side),
        surfPoint = hullPoint(stationVal, yVal, side).addScaledVector(surfNormal, normalOffset);
      (posArr.push(surfPoint.x, surfPoint.y, surfPoint.z),
        nrmArr.push(surfNormal.x, surfNormal.y, surfNormal.z),
        uvArr.push(
          side < 0 ? 1 - colIdx / stationSegs : colIdx / stationSegs,
          rowIdx / verticalSegs,
        ));
    }
  let rowStride = stationSegs + 1;
  for (let rowIdx = 0; rowIdx < verticalSegs; rowIdx++)
    for (let colIdx = 0; colIdx < stationSegs; colIdx++) {
      let stationVal = rowIdx * rowStride + colIdx,
        yVal = stationVal + 1,
        surfNormal = stationVal + rowStride + 1,
        surfPoint = stationVal + rowStride;
      side > 0
        ? idxArr.push(stationVal, yVal, surfNormal, stationVal, surfNormal, surfPoint)
        : idxArr.push(stationVal, surfNormal, yVal, stationVal, surfPoint, surfNormal);
    }
  let patchGeo = new THREE.BufferGeometry();
  return (
    patchGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3)),
    patchGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrmArr, 3)),
    patchGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2)),
    patchGeo.setIndex(idxArr),
    patchGeo
  );
}

/**
 * 把铭文图集按若干矩形片贴到枪身两侧/顶部，生成透明双面 decal 网格并做 polygonOffset 防 z-fighting
 */
export function createMarkingsMesh(decals) {
  let posArr = [],
    uvArr = [],
    normArr = [],
    idxArr = [];
  for (let [regionKey, centerX, centerY, centerZ, plateHeight, side, tiltAngle = 0] of decals) {
    let [regionU, regionV, regionW, regionH] = PAC9_MARK_REGIONS[regionKey],
      plateWidth = (plateHeight * regionW) / regionH,
      u0 = regionU / MARK_ATLAS_WIDTH,
      A = (regionU + regionW) / MARK_ATLAS_WIDTH,
      v0 = 1 - regionV / MARK_ATLAS_HEIGHT,
      M = 1 - (regionV + regionH) / MARK_ATLAS_HEIGHT,
      vertBase = posArr.length / 3,
      quadPts;
    if (
      (side === 'L'
        ? (quadPts = [
            [centerX, centerY - plateHeight / 2, -(centerZ + plateWidth / 2)],
            [centerX, centerY - plateHeight / 2, -(centerZ - plateWidth / 2)],
            [centerX, centerY + plateHeight / 2, -(centerZ - plateWidth / 2)],
            [centerX, centerY + plateHeight / 2, -(centerZ + plateWidth / 2)],
          ])
        : side === 'R'
          ? (quadPts = [
              [centerX, centerY - plateHeight / 2, -(centerZ - plateWidth / 2)],
              [centerX, centerY - plateHeight / 2, -(centerZ + plateWidth / 2)],
              [centerX, centerY + plateHeight / 2, -(centerZ + plateWidth / 2)],
              [centerX, centerY + plateHeight / 2, -(centerZ - plateWidth / 2)],
            ])
          : (quadPts = [
              [centerX - plateWidth / 2, centerY, -(centerZ - plateHeight / 2)],
              [centerX + plateWidth / 2, centerY, -(centerZ - plateHeight / 2)],
              [centerX + plateWidth / 2, centerY, -(centerZ + plateHeight / 2)],
              [centerX - plateWidth / 2, centerY, -(centerZ + plateHeight / 2)],
            ]),
      tiltAngle)
    ) {
      let cosTilt = Math.cos(tiltAngle),
        sinTilt = Math.sin(tiltAngle),
        pivotY = centerY,
        pivotZ = -centerZ;
      for (let cornerPt of quadPts) {
        let dy = cornerPt[1] - pivotY,
          dz = cornerPt[2] - pivotZ;
        ((cornerPt[1] = pivotY + dy * cosTilt - dz * sinTilt),
          (cornerPt[2] = pivotZ + dy * sinTilt + dz * cosTilt));
      }
    }
    for (let cosTilt of quadPts) posArr.push(cosTilt[0], cosTilt[1], cosTilt[2]);
    uvArr.push(u0, M, A, M, A, v0, u0, v0);
    let faceNormal = side === 'L' ? [-1, 0, 0] : side === 'R' ? [1, 0, 0] : [0, 1, 0];
    for (let cosTilt = 0; cosTilt < 4; cosTilt++)
      normArr.push(faceNormal[0], faceNormal[1], faceNormal[2]);
    idxArr.push(vertBase, vertBase + 1, vertBase + 2, vertBase, vertBase + 2, vertBase + 3);
  }
  let markGeo = new THREE.BufferGeometry();
  (markGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3)),
    markGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2)),
    markGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3)),
    markGeo.setIndex(idxArr));
  let markMat = new THREE.MeshStandardMaterial({
      map: buildMarkingsAtlas(),
      transparent: !0,
      roughness: 0.62,
      metalness: 0,
      depthWrite: !1,
      polygonOffset: !0,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide,
    }),
    markMesh = new THREE.Mesh(markGeo, markMat);
  return ((markMesh.renderOrder = 2), markMesh);
}

/**
 * 骨骼装配器：按名字登记骨骼（记录局部/世界偏移与父索引）、把几何按槽位(shell/metal/glow/lens)贴到骨骼上并写入 skinIndex/skinWeight 与 AO 顶点色，最后合并成单个 SkinnedMesh 的几何
 */
var Rig = class {
  constructor() {
    ((this.bones = []), (this.index = {}), (this.slots = {}), (this.order = []));
  }
  bone(e, t, n = 0, s = 0, o = 0) {
    let r = t ? this.bones[this.index[t]] : null;
    if (t && !r) throw new Error('rig: unknown parent bone ' + t);
    let a = {
      name: e,
      parent: r ? r.i : -1,
      local: [n, s, o],
      world: [n + (r ? r.world[0] : 0), s + (r ? r.world[1] : 0), o + (r ? r.world[2] : 0)],
      i: this.bones.length,
    };
    return ((this.index[e] = a.i), this.bones.push(a), a);
  }
  add(e, t, n, s = [1, 1, 1], o = !0) {
    let r = this.bones[this.index[t]];
    if (!r) throw new Error('rig: unknown bone ' + t);
    let a = n;
    a.attributes.normal || a.computeVertexNormals();
    for (let p of Object.keys(a.attributes))
      p !== 'position' && p !== 'normal' && p !== 'uv' && a.deleteAttribute(p);
    let l = a.attributes.position.count;
    (a.attributes.uv || a.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(l * 2), 2)),
      a.translate(r.world[0], r.world[1], r.world[2]));
    let c = new Float32Array(l * 3),
      u = new Uint16Array(l * 4),
      h = new Float32Array(l * 4),
      f = a.attributes.normal;
    for (let p = 0; p < l; p++) {
      let d = o ? 0.74 + 0.26 * (f.getY(p) * 0.5 + 0.5) : 1;
      ((c[p * 3] = s[0] * d),
        (c[p * 3 + 1] = s[1] * d),
        (c[p * 3 + 2] = s[2] * d),
        (u[p * 4] = r.i),
        (h[p * 4] = 1));
    }
    return (
      a.setAttribute('color', new THREE.BufferAttribute(c, 3)),
      a.setAttribute('skinIndex', new THREE.BufferAttribute(u, 4)),
      a.setAttribute('skinWeight', new THREE.BufferAttribute(h, 4)),
      this.slots[e] || ((this.slots[e] = []), this.order.push(e)),
      this.slots[e].push(a),
      this
    );
  }
  build(e) {
    let t = (e || this.order).filter((o) => this.slots[o] && this.slots[o].length),
      n = t.map((o) => {
        let r = this.slots[o],
          l = r.some((u) => !u.index) ? r.map((u) => (u.index ? u.toNonIndexed() : u)) : r,
          c = mergeGeometries(l, !1);
        return c.index ? c.toNonIndexed() : c;
      }),
      s = mergeGeometries(n, !0);
    return (
      s.computeBoundingSphere(),
      s.computeBoundingBox(),
      {
        geometry: s,
        slots: t,
        bones: this.bones,
        tris: s.attributes.position.count / 3,
      }
    );
  }
};

/**
 * 程序化搭建 hound 的整台机体：head/body/neck/turret/gun/antenna/beacon 加四条腿的 abd-thigh-shin 链，全部装甲板、螺栓、软管、发光线都按槽位塞进 Rig 后合并成一个蒙皮几何
 */
export function createWalkerModel() {
  let metrics = HOUND_RIG,
    rig = new Rig();
  (rig.bone('root', null, 0, 0, 0),
    rig.bone('body', 'root', 0, metrics.stand, 0),
    rig.bone('neck', 'body', 0, 0.06, 0.49),
    rig.bone('head', 'neck', 0, 0.13, 0.12),
    rig.bone('turret', 'body', 0, 0.152, -0.03),
    rig.bone('gun', 'turret', 0, 0.095, 0.02),
    rig.bone('antenna', 'body', -0.105, 0.15, -0.46),
    rig.bone('beacon', 'body', 0.105, 0.2, -0.455));
  for (let partSlot = 0; partSlot < 4; partSlot++) {
    let slotName = metrics.legs[partSlot],
      boneName = metrics.side[partSlot];
    (rig.bone(
      'abd' + slotName,
      'body',
      boneName * metrics.hipX,
      metrics.hipY,
      metrics.fore[partSlot] * metrics.hipZ,
    ),
      rig.bone('thigh' + slotName, 'abd' + slotName, boneName * metrics.l0, 0, 0),
      rig.bone('shin' + slotName, 'thigh' + slotName, 0, -metrics.L1, 0));
  }
  let addPart = (mixedHash, s, o, r, a) => rig.add(mixedHash, s, o, r, a);
  (addPart(
    'metal',
    'body',
    transformGeom(createRoundedBox(0.27, 0.2, 0.98, 0.02), 0, -0.01, 0),
    RIG_METAL_BASE,
  ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.35, 0.05, 0.3, 0.014), 0, 0.125, 0.33),
      RIG_SHELL_WHITE,
    ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.35, 0.05, 0.36, 0.014), 0, 0.125, -0.012),
      RIG_SHELL_WHITE,
    ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.1, 0.052, 0.36, 0.01), 0, 0.126, -0.012 + 0),
      RIG_SHELL_COOL,
    ));
  for (let partSlot of [-0.15, 0.15])
    for (let slotName of [0.21, 0.45, -0.17, 0.145])
      addPart('metal', 'body', makeBoltHexY(partSlot, 0.152, slotName), RIG_METAL_BRIGHT);
  addPart(
    'metal',
    'body',
    transformGeom(createRoundedBox(0.31, 0.03, 0.25, 0.006), 0, 0.112, -0.335),
    RIG_METAL_WHITE,
  );
  for (let partSlot = 0; partSlot < 10; partSlot++)
    addPart(
      'metal',
      'body',
      transformGeom(
        createRoundedBox(0.007, 0.062, 0.225, 0.002),
        -0.126 + partSlot * 0.028,
        0.155,
        -0.335,
      ),
      RIG_METAL_BRIGHT,
    );
  (addPart(
    'metal',
    'body',
    transformGeom(createRoundedBox(0.3, 0.012, 0.02, 0.003), 0, 0.186, -0.24),
    RIG_METAL_BASE,
  ),
    addPart(
      'metal',
      'body',
      transformGeom(createRoundedBox(0.3, 0.012, 0.02, 0.003), 0, 0.186, -0.43),
      RIG_METAL_BASE,
    ));
  for (let partSlot of [1, -1]) {
    (addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.032, 0.15, 0.31, 0.012), partSlot * 0.15, 0.022, -0.075),
      RIG_SHELL_WHITE,
    ),
      addPart(
        'shell',
        'body',
        transformGeom(createRoundedBox(0.032, 0.15, 0.135, 0.012), partSlot * 0.15, 0.022, 0.1625),
        RIG_SHELL_COOL,
      ),
      addPart(
        'metal',
        'body',
        tubeGeometry(
          [
            [partSlot * 0.168, 0.06, 0.125],
            [partSlot * 0.182, 0.06, 0.135],
            [partSlot * 0.182, 0.06, 0.19],
            [partSlot * 0.168, 0.06, 0.2],
          ],
          0.005,
          5,
        ),
        RIG_METAL_BRIGHT,
      ),
      addPart(
        'shell',
        'body',
        transformGeom(
          createRoundedBox(0.034, 0.016, 0.135, 0.004),
          partSlot * 0.151,
          -0.035,
          0.1625,
        ),
        RIG_SHELL_HAZARD,
      ),
      addPart(
        'shell',
        'body',
        transformGeom(createRoundedBox(0.034, 0.042, 0.46, 0.008), partSlot * 0.151, -0.078, 0),
        RIG_SHELL_RUST,
      ),
      addPart(
        'shell',
        'body',
        transformGeom(createRoundedBox(0.028, 0.1, 0.11, 0.008), partSlot * 0.146, 0.01, 0.305),
        RIG_SHELL_DARK,
      ));
    for (let slotName = 0; slotName < 4; slotName++)
      addPart(
        'metal',
        'body',
        transformGeom(
          createRoundedBox(0.004, 0.012, 0.085, 0.001),
          partSlot * 0.161,
          -0.02 + slotName * 0.022,
          0.305,
        ),
        RIG_METAL_BASE,
      );
    for (let slotName of [-0.035, 0.08])
      for (let boneName of [-0.21, 0.06, 0.115, 0.21])
        addPart(
          'metal',
          'body',
          makeBoltHexX(partSlot * 0.167, slotName, boneName),
          RIG_METAL_BRIGHT,
        );
    addPart(
      'metal',
      'body',
      tubeGeometry(
        [
          [partSlot * 0.135, 0.148, -0.19],
          [partSlot * 0.135, 0.205, -0.16],
          [partSlot * 0.135, 0.212, 0],
          [partSlot * 0.135, 0.205, 0.43],
          [partSlot * 0.135, 0.148, 0.465],
        ],
        0.0105,
        6,
      ),
      RIG_METAL_BRIGHT,
    );
    for (let slotName of [0, 0.26])
      addPart(
        'metal',
        'body',
        transformGeom(createCylinderY(0.008, 0.008, 0.06, 6), partSlot * 0.135, 0.178, slotName),
        RIG_METAL_BRIGHT,
      );
    (addPart(
      'shell',
      'body',
      tubeGeometry(
        [
          [partSlot * 0.118, -0.105, -0.36],
          [partSlot * 0.132, -0.118, -0.2],
          [partSlot * 0.13, -0.112, 0.1],
          [partSlot * 0.118, -0.1, 0.36],
        ],
        0.009,
        5,
      ),
      RIG_SHELL_SHADOW,
    ),
      addPart(
        'metal',
        'body',
        transformGeom(
          new THREE.TorusGeometry(0.02, 0.005, 5, 10),
          partSlot * 0.17,
          0.085,
          -0.335,
          0,
          va,
          0,
        ),
        RIG_METAL_BRIGHT,
      ));
  }
  (addPart(
    'shell',
    'body',
    transformGeom(createRoundedBox(0.3, 0.15, 0.075, 0.018), 0, -0.005, 0.505),
    RIG_SHELL_RUST,
  ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.2, 0.07, 0.02, 0.006), 0, 0.012, 0.545),
      RIG_SHELL_DARK,
    ));
  for (let partSlot = 0; partSlot < 6; partSlot++)
    addPart(
      'shell',
      'body',
      transformGeom(
        createRoundedBox(0.05, 0.034, 0.014, 0.003),
        -0.125 + partSlot * 0.05,
        -0.098,
        0.538,
        0,
        0,
        0,
      ),
      partSlot % 2 ? RIG_SHELL_DARK : RIG_SHELL_HAZARD,
    );
  for (let partSlot of [-0.115, 0.115])
    (addPart(
      'metal',
      'body',
      transformGeom(createCylinderZ(0.021, 0.021, 0.014, 10), partSlot, 0.012, 0.547),
      RIG_METAL_BASE,
    ),
      addPart(
        'glow',
        'body',
        transformGeom(createCylinderZ(0.015, 0.015, 0.004, 10), partSlot, 0.012, 0.556),
        [6.5, 4.6, 2.2],
        !1,
      ));
  (addPart(
    'metal',
    'body',
    transformGeom(createRoundedBox(0.24, 0.095, 0.56, 0.02), 0, -0.145, 0),
    RIG_METAL_WHITE,
  ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.246, 0.03, 0.09, 0.006), 0, -0.14, 0.12),
      RIG_SHELL_RUST,
    ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.246, 0.03, 0.09, 0.006), 0, -0.14, -0.12),
      RIG_SHELL_RUST,
    ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.29, 0.15, 0.05, 0.014), 0, 0, -0.495),
      RIG_SHELL_WHITE,
    ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.17, 0.05, 0.012, 0.004), 0, 0.03, -0.523),
      RIG_SHELL_DARK,
    ),
    addPart(
      'glow',
      'body',
      transformGeom(createRoundedBox(0.13, 0.012, 0.004, 0.001), 0, 0.03, -0.531),
      [5, 0.3, 0.1],
      !1,
    ),
    addPart(
      'metal',
      'body',
      transformGeom(createCylinderZ(0.022, 0.022, 0.02, 10), 0.085, -0.035, -0.525),
      RIG_METAL_BRIGHT,
    ),
    addPart(
      'metal',
      'body',
      transformGeom(new THREE.TorusGeometry(0.024, 0.006, 5, 10), -0.07, -0.05, -0.528, va, 0, 0),
      RIG_METAL_BRIGHT,
    ));
  for (let partSlot of [-0.125, 0.125])
    for (let slotName of [-0.055, 0.055])
      addPart('metal', 'body', makeBoltHexZ(partSlot, slotName, -0.523), RIG_METAL_BRIGHT);
  (addPart(
    'shell',
    'body',
    tubeGeometry(
      [
        [0.09, 0.15, -0.2],
        [0.13, 0.2, -0.16],
        [0.12, 0.2, -0.08],
        [0.09, 0.165, -0.05],
      ],
      0.009,
      5,
    ),
    RIG_SHELL_SHADOW,
  ),
    addPart(
      'metal',
      'neck',
      createStrut([0, -0.02, -0.02], [0, 0.11, 0.1], 0.045, 0.036, 10),
      RIG_METAL_BASE,
    ));
  for (let partSlot = 0; partSlot < 3; partSlot++) {
    let slotName = 0.2 + partSlot * 0.28;
    addPart(
      'shell',
      'neck',
      createStrut(
        [0, -0.02 + 0.13 * slotName - 0.008, -0.02 + 0.12 * slotName - 0.0075],
        [0, -0.02 + 0.13 * slotName + 0.008, -0.02 + 0.12 * slotName + 0.0075],
        0.052,
        0.052,
        10,
      ),
      RIG_SHELL_SHADOW,
    );
  }
  (addPart(
    'shell',
    'neck',
    transformGeom(createRoundedBox(0.13, 0.05, 0.1, 0.012), 0, -0.01, -0.03),
    RIG_SHELL_WHITE,
  ),
    addPart(
      'shell',
      'neck',
      tubeGeometry(
        [
          [0.05, -0.02, -0.04],
          [0.07, 0.05, 0.02],
          [0.06, 0.11, 0.07],
          [0.045, 0.12, 0.1],
        ],
        0.007,
        5,
      ),
      RIG_SHELL_SHADOW,
    ),
    addPart(
      'shell',
      'head',
      transformGeom(createRoundedBox(0.19, 0.118, 0.25, 0.03), 0, 0, 0),
      RIG_SHELL_WHITE,
    ),
    addPart(
      'shell',
      'head',
      transformGeom(createRoundedBox(0.168, 0.074, 0.03, 0.012), 0, -0.004, 0.118),
      RIG_SHELL_DARK,
    ),
    addPart(
      'lens',
      'head',
      transformGeom(createRoundedBox(0.128, 0.024, 0.006, 0.002), 0, 0.006, 0.1345),
      [1, 1, 1],
      !1,
    ));
  for (let partSlot of [-0.056, 0.056])
    (addPart(
      'metal',
      'head',
      transformGeom(createCylinderZ(0.015, 0.015, 0.012, 10), partSlot, -0.022, 0.132),
      RIG_METAL_BASE,
    ),
      addPart(
        'metal',
        'head',
        transformGeom(createCylinderZ(0.009, 0.009, 0.004, 8), partSlot, -0.022, 0.139),
        [0.1, 0.12, 0.2],
      ));
  (addPart(
    'shell',
    'head',
    transformGeom(createRoundedBox(0.062, 0.008, 0.2, 0.003), 0, 0.06, -0.005),
    RIG_SHELL_RUST,
  ),
    addPart(
      'metal',
      'head',
      transformGeom(createCylinderX(0.032, 0.032, 0.214, 12), 0, 0, -0.055),
      RIG_METAL_BASE,
    ));
  for (let partSlot of [1, -1])
    addPart(
      'shell',
      'head',
      transformGeom(createCylinderX(0.022, 0.022, 0.006, 10), partSlot * 0.108, 0, -0.055),
      RIG_SHELL_RUST,
    );
  (addPart(
    'metal',
    'head',
    transformGeom(createCylinderY(0.036, 0.036, 0.026, 14), 0, 0.072, -0.05),
    RIG_METAL_BASE,
  ),
    addPart(
      'metal',
      'head',
      transformGeom(createCylinderY(0.037, 0.037, 0.006, 14), 0, 0.074, -0.05),
      [0.2, 0.3, 0.5],
    ),
    addPart(
      'metal',
      'head',
      transformGeom(createRoundedBox(0.12, 0.03, 0.13, 0.008), 0, -0.068, 0.02),
      RIG_METAL_WHITE,
    ));
  for (let partSlot of [-0.08, 0.08])
    for (let slotName of [-0.09, 0.07])
      addPart('metal', 'head', makeBoltHexY(partSlot, 0.061, slotName), RIG_METAL_BRIGHT);
  (addPart(
    'metal',
    'turret',
    transformGeom(createCylinderY(0.105, 0.118, 0.034, 18), 0, 0, 0),
    RIG_METAL_BASE,
  ),
    addPart(
      'metal',
      'turret',
      transformGeom(createRoundedBox(0.18, 0.02, 0.16, 0.005), 0, 0.026, 0),
      RIG_METAL_WHITE,
    ));
  for (let partSlot of [1, -1])
    (addPart(
      'shell',
      'turret',
      transformGeom(createRoundedBox(0.028, 0.115, 0.15, 0.012), partSlot * 0.078, 0.085, 0.005),
      RIG_SHELL_WHITE,
    ),
      addPart(
        'metal',
        'turret',
        transformGeom(createCylinderX(0.022, 0.022, 0.008, 10), partSlot * 0.094, 0.095, 0.02),
        RIG_METAL_BRIGHT,
      ));
  (addPart(
    'shell',
    'gun',
    transformGeom(createRoundedBox(0.108, 0.086, 0.21, 0.016), 0, 0, -0.012),
    RIG_SHELL_WHITE,
  ),
    addPart(
      'shell',
      'gun',
      transformGeom(createRoundedBox(0.11, 0.02, 0.212, 0.006), 0, -0.022, -0.012),
      RIG_SHELL_RUST,
    ),
    addPart(
      'metal',
      'gun',
      transformGeom(createCylinderZ(0.035, 0.035, 0.11, 12), 0, 0, 0.145),
      RIG_METAL_BASE,
    ));
  for (let partSlot = 0; partSlot < 4; partSlot++)
    addPart(
      'metal',
      'gun',
      transformGeom(createCylinderZ(0.039, 0.039, 0.008, 12), 0, 0, 0.105 + partSlot * 0.026),
      RIG_METAL_WHITE,
    );
  (addPart(
    'metal',
    'gun',
    transformGeom(createCylinderZ(0.022, 0.024, 0.3, 12), 0, 0, 0.25),
    RIG_METAL_WHITE,
  ),
    addPart(
      'metal',
      'gun',
      transformGeom(createCylinderZ(0.036, 0.036, 0.06, 10), 0, 0, 0.395),
      RIG_METAL_BASE,
    ),
    addPart(
      'metal',
      'gun',
      transformGeom(createRoundedBox(0.08, 0.012, 0.025, 0.003), 0, 0, 0.395),
      [0.15, 0.15, 0.15],
    ),
    addPart(
      'metal',
      'gun',
      transformGeom(createCylinderX(0.056, 0.056, 0.06, 14), 0.084, -0.004, -0.045),
      RIG_METAL_BASE,
    ),
    addPart(
      'metal',
      'gun',
      transformGeom(createCylinderX(0.02, 0.02, 0.066, 8), 0.084, -0.004, -0.045),
      RIG_METAL_BORE,
    ),
    addPart(
      'metal',
      'gun',
      transformGeom(createRoundedBox(0.036, 0.036, 0.095, 0.008), -0.03, 0.06, 0),
      RIG_METAL_BASE,
    ),
    addPart(
      'glow',
      'gun',
      transformGeom(createCylinderZ(0.011, 0.011, 0.003, 8), -0.03, 0.06, 0.049),
      [1.6, 0.12, 0.05],
      !1,
    ),
    addPart(
      'shell',
      'gun',
      tubeGeometry(
        [
          [0.05, -0.03, -0.11],
          [0.06, -0.07, -0.13],
          [0.04, -0.09, -0.1],
        ],
        0.008,
        5,
      ),
      RIG_SHELL_SHADOW,
    ),
    addPart(
      'metal',
      'body',
      transformGeom(createCylinderY(0.022, 0.026, 0.05, 10), 0.105, 0.175, -0.455),
      RIG_METAL_BASE,
    ),
    addPart(
      'glow',
      'beacon',
      transformGeom(createScaledSphere(0.02, 10, 6, 1, 1.25, 1), 0, 0.012, 0),
      [14, 5.5, 0.5],
      !1,
    ),
    addPart(
      'metal',
      'antenna',
      transformGeom(createCylinderY(0.011, 0.014, 0.05, 8), 0, 0.025, 0),
      RIG_METAL_BASE,
    ),
    addPart(
      'metal',
      'antenna',
      transformGeom(createCylinderY(0.0028, 0.005, 0.62, 5), 0, 0.36, 0),
      RIG_METAL_BASE,
    ),
    addPart(
      'shell',
      'antenna',
      transformGeom(createScaledSphere(0.009, 6, 4), 0, 0.67, 0),
      RIG_SHELL_RUST,
    ));
  for (let partSlot = 0; partSlot < 4; partSlot++) {
    let slotName = metrics.legs[partSlot],
      boneName = metrics.side[partSlot],
      geometryPart = 'abd' + slotName,
      castShadowFlag = 'thigh' + slotName,
      shinKey = 'shin' + slotName;
    (addPart(
      'metal',
      geometryPart,
      transformGeom(createCylinderZ(0.06, 0.06, 0.17, 14), -boneName * 0.02, 0, 0),
      RIG_METAL_BASE,
    ),
      addPart(
        'shell',
        geometryPart,
        transformGeom(createRoundedBox(0.11, 0.05, 0.155, 0.014), boneName * 0, 0.058, 0),
        RIG_SHELL_WHITE,
      ),
      addPart(
        'metal',
        geometryPart,
        transformGeom(createCylinderZ(0.03, 0.03, 0.18, 8), -boneName * 0.02, 0, 0),
        RIG_METAL_BRIGHT,
      ),
      addPart(
        'shell',
        castShadowFlag,
        transformGeom(createCylinderX(0.078, 0.078, 0.07, 18), 0, 0, 0),
        RIG_SHELL_WHITE,
      ),
      addPart(
        'shell',
        castShadowFlag,
        transformGeom(createCylinderX(0.081, 0.081, 0.016, 18), boneName * 0.012, 0, 0),
        RIG_SHELL_RUST,
      ),
      addPart(
        'metal',
        castShadowFlag,
        transformGeom(createCylinderX(0.048, 0.048, 0.082, 12), 0, 0, 0),
        RIG_METAL_BASE,
      ));
    for (let boltIndex = 0; boltIndex < 5; boltIndex++) {
      let boltPhase = boltIndex * 1.2566;
      addPart(
        'metal',
        castShadowFlag,
        makeBoltHexX(boneName * 0.039, Math.cos(boltPhase) * 0.062, Math.sin(boltPhase) * 0.062),
        RIG_METAL_BRIGHT,
      );
    }
    (addPart(
      'shell',
      castShadowFlag,
      transformGeom(
        createRoundedBox(0.062, metrics.L1 - 0.07, 0.1, 0.022),
        0,
        -metrics.L1 * 0.5 - 0.005,
        0.004,
      ),
      RIG_SHELL_WHITE,
    ),
      addPart(
        'metal',
        castShadowFlag,
        transformGeom(
          createRoundedBox(0.044, metrics.L1 - 0.04, 0.06, 0.012),
          0,
          -metrics.L1 * 0.5,
          -0.035,
        ),
        RIG_METAL_BASE,
      ),
      addPart(
        'shell',
        castShadowFlag,
        transformGeom(createRoundedBox(0.065, 0.045, 0.103, 0.01), 0, -0.145, 0.004),
        RIG_SHELL_RUST,
      ),
      addPart(
        'shell',
        castShadowFlag,
        transformGeom(createRoundedBox(0.064, 0.012, 0.102, 0.004), 0, -0.26, 0.004),
        RIG_SHELL_DARK,
      ),
      addPart(
        'metal',
        castShadowFlag,
        createStrut([0, -0.06, -0.082], [0, -metrics.L1 * 0.62, -0.078], 0.021, 0.021, 10),
        RIG_METAL_BRIGHT,
      ),
      addPart(
        'metal',
        castShadowFlag,
        createStrut(
          [0, -metrics.L1 * 0.62, -0.078],
          [0, -metrics.L1 + 0.025, -0.058],
          0.009,
          0.009,
          6,
        ),
        RIG_METAL_CHROME,
      ),
      addPart(
        'metal',
        castShadowFlag,
        transformGeom(createRoundedBox(0.05, 0.03, 0.035, 0.006), 0, -0.055, -0.07),
        RIG_METAL_WHITE,
      ),
      addPart(
        'shell',
        castShadowFlag,
        tubeGeometry(
          [
            [boneName * 0.036, -0.02, 0.05],
            [boneName * 0.044, -0.13, 0.062],
            [boneName * 0.042, -0.28, 0.058],
            [boneName * 0.034, -metrics.L1 + 0.03, 0.035],
          ],
          0.0065,
          5,
        ),
        RIG_SHELL_SHADOW,
      ),
      addPart(
        'metal',
        castShadowFlag,
        transformGeom(createCylinderX(0.05, 0.05, 0.086, 14), 0, -metrics.L1, 0),
        RIG_METAL_BASE,
      ),
      addPart(
        'shell',
        castShadowFlag,
        transformGeom(createCylinderX(0.036, 0.036, 0.092, 12), 0, -metrics.L1, 0),
        RIG_SHELL_COOL,
      ),
      addPart(
        'metal',
        shinKey,
        transformGeom(
          createCylinderY(0.03, 0.021, metrics.L2 - 0.08, 10),
          0,
          -(metrics.L2 - 0.08) / 2 - 0.01,
          0,
        ),
        RIG_METAL_BASE,
      ),
      addPart(
        'shell',
        shinKey,
        transformGeom(createRoundedBox(0.052, 0.21, 0.04, 0.014), 0, -0.14, 0.02),
        RIG_SHELL_WHITE,
      ),
      addPart(
        'shell',
        shinKey,
        transformGeom(createRoundedBox(0.054, 0.02, 0.042, 0.006), 0, -0.215, 0.02),
        RIG_SHELL_RUST,
      ),
      addPart(
        'metal',
        shinKey,
        transformGeom(createRoundedBox(0.03, 0.06, 0.05, 0.008), 0, -0.02, -0.03),
        RIG_METAL_WHITE,
      ),
      addPart(
        'metal',
        shinKey,
        transformGeom(createCylinderY(0.024, 0.03, 0.03, 10), 0, -metrics.L2 + 0.085, 0),
        RIG_METAL_BRIGHT,
      ),
      addPart(
        'shell',
        shinKey,
        transformGeom(
          createScaledSphere(metrics.footR + 0.002, 12, 8, 1, 0.86, 1.08),
          0,
          -metrics.L2 + metrics.footR * 0.86,
          0.004,
        ),
        RIG_SHELL_SHADOW,
      ));
  }
  return rig.build(['shell', 'metal', 'glow', 'lens']);
}

/**
 * 程序化搭建 gull 无人机：机身、四旋翼、云台球机、探照灯、三色航行灯，并额外构建第二个 Rig 放不参与蒙皮的旋翼盘与探照锥（disc/cone 槽位）
 */
export function createDroneModel() {
  let metrics = GULL_RIG,
    rig = new Rig(),
    fxRig = new Rig(),
    addBone = (mixBuf, dropBuf, workBuf, dropPos, dropLen) => {
      (rig.bone(mixBuf, dropBuf, workBuf, dropPos, dropLen),
        fxRig.bone(mixBuf, dropBuf, workBuf, dropPos, dropLen));
    };
  (addBone('root', null, 0, 0, 0), addBone('body', 'root', 0, 0, 0));
  for (let slotBucket = 0; slotBucket < 4; slotBucket++)
    addBone(
      'rotor' + slotBucket,
      'body',
      metrics.rotors[slotBucket][0],
      metrics.rotors[slotBucket][1],
      metrics.rotors[slotBucket][2],
    );
  (addBone('gimbalYaw', 'body', metrics.gimbal[0], metrics.gimbal[1], metrics.gimbal[2]),
    addBone('ball', 'gimbalYaw', metrics.ball[0], metrics.ball[1], metrics.ball[2]),
    addBone('lamp', 'ball', metrics.lamp[0], metrics.lamp[1], metrics.lamp[2]),
    addBone('gun', 'body', metrics.gun[0], metrics.gun[1], metrics.gun[2]),
    addBone('strobeG', 'body', 0, 0, 0),
    addBone('strobeR', 'body', 0, 0, 0),
    addBone('strobeW', 'body', 0, 0, 0));
  let addPart = (l, c, u, h, f) => rig.add(l, c, u, h, f);
  (addPart(
    'shell',
    'body',
    transformGeom(createScaledSphere(1, 20, 12, 0.118, 0.074, 0.27), 0, 0.02, 0),
    RIG_SHELL_WHITE,
  ),
    addPart(
      'shell',
      'body',
      transformGeom(cylinderGeometry(1, 0.9, 1, 20), 0, 0.02, 0.165, va, 0, 0, [0.094, 0.05, 0.06]),
      RIG_SHELL_RUST,
    ),
    addPart(
      'shell',
      'body',
      transformGeom(
        cylinderGeometry(1, 1, 1, 20),
        0,
        0.02,
        -0.02,
        va,
        0,
        0,
        [0.121, 0.012, 0.0765],
      ),
      RIG_SHELL_DARK,
    ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.118, 0.014, 0.2, 0.005), 0, 0.089, -0.03),
      RIG_SHELL_COOL,
    ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.03, 0.006, 0.2, 0.002), 0, 0.0975, -0.03),
      RIG_SHELL_RUST,
    ));
  for (let slotBucket of [-0.05, 0.05])
    for (let boneTarget of [-0.12, 0.06])
      addPart('metal', 'body', makeBoltHexY(slotBucket, 0.097, boneTarget), RIG_METAL_BRIGHT);
  (addPart(
    'metal',
    'body',
    transformGeom(createRoundedBox(0.175, 0.06, 0.37, 0.016), 0, -0.035, -0.005),
    RIG_METAL_BASE,
  ),
    addPart(
      'metal',
      'body',
      transformGeom(createRoundedBox(0.12, 0.075, 0.11, 0.014), 0, 0.005, -0.265),
      RIG_METAL_WHITE,
    ),
    addPart(
      'shell',
      'body',
      transformGeom(createRoundedBox(0.124, 0.02, 0.03, 0.005), 0, 0.03, -0.3),
      RIG_SHELL_RUST,
    ),
    addPart(
      'glow',
      'body',
      transformGeom(createRoundedBox(0.05, 0.006, 0.003, 0.001), 0, 0, -0.321),
      [0.3, 1.6, 0.4],
      !1,
    ));
  for (let slotBucket of [1, -1]) {
    for (let boneTarget = 0; boneTarget < 4; boneTarget++)
      addPart(
        'metal',
        'body',
        transformGeom(
          createRoundedBox(0.004, 0.01, 0.06, 0.001),
          slotBucket * 0.0885,
          -0.045 + boneTarget * 0.016,
          -0.06,
        ),
        [0.2, 0.2, 0.2],
      );
    addPart(
      'metal',
      'body',
      tubeGeometry(
        [
          [slotBucket * 0.075, -0.055, 0.13],
          [slotBucket * 0.135, -0.175, 0.16],
          [slotBucket * 0.135, -0.192, 0.11],
          [slotBucket * 0.135, -0.192, -0.14],
          [slotBucket * 0.135, -0.175, -0.19],
          [slotBucket * 0.075, -0.055, -0.15],
        ],
        0.0085,
        6,
        !1,
        0.5,
      ),
      RIG_METAL_BRIGHT,
    );
    for (let boneTarget of [0.07, -0.1])
      addPart(
        'shell',
        'body',
        transformGeom(
          createCylinderZ(0.0135, 0.0135, 0.07, 8),
          slotBucket * 0.135,
          -0.192,
          boneTarget,
        ),
        RIG_SHELL_SHADOW,
      );
    (addPart(
      'metal',
      'body',
      createStrut(
        [slotBucket * 0.04, 0.07, -0.17],
        [slotBucket * 0.085, 0.37, -0.27],
        0.004,
        0.002,
        5,
      ),
      RIG_METAL_BASE,
    ),
      addPart(
        'metal',
        'body',
        transformGeom(createCylinderY(0.008, 0.01, 0.025, 6), slotBucket * 0.04, 0.078, -0.17),
        RIG_METAL_BRIGHT,
      ));
  }
  (addPart(
    'metal',
    'body',
    transformGeom(createCylinderY(0.007, 0.007, 0.04, 6), 0, 0.105, 0.1),
    RIG_METAL_BRIGHT,
  ),
    addPart(
      'shell',
      'body',
      transformGeom(createCylinderY(0.034, 0.036, 0.018, 14), 0, 0.132, 0.1),
      RIG_SHELL_WHITE,
    ),
    addPart(
      'metal',
      'body',
      transformGeom(createRoundedBox(0.07, 0.03, 0.09, 0.008), 0, -0.075, 0.235),
      RIG_METAL_WHITE,
    ));
  let rotorBell = createRotorBellGeometry();
  for (let slotBucket = 0; slotBucket < 4; slotBucket++) {
    let [boneTarget, partGeometry, partTint] = metrics.rotors[slotBucket],
      castShadowPart = Math.sign(boneTarget),
      signZ = Math.sign(partTint);
    (addPart(
      'metal',
      'body',
      createStrut(
        [castShadowPart * 0.07, 0, signZ * 0.09],
        [boneTarget, partGeometry - 0.05, partTint],
        0.017,
        0.015,
        8,
      ),
      RIG_METAL_BASE,
    ),
      addPart(
        'shell',
        'body',
        transformGeom(
          createRoundedBox(0.07, 0.045, 0.07, 0.014),
          castShadowPart * 0.085,
          0,
          signZ * 0.1,
          0,
          castShadowPart * signZ * 0.74,
          0,
        ),
        RIG_SHELL_WHITE,
      ),
      addPart(
        'shell',
        'body',
        tubeGeometry(
          [
            [castShadowPart * 0.09, 0.02, signZ * 0.12],
            [castShadowPart * 0.18, 0.012, signZ * 0.19],
            [boneTarget - castShadowPart * 0.05, partGeometry - 0.03, partTint - signZ * 0.04],
          ],
          0.005,
          5,
        ),
        RIG_SHELL_SHADOW,
      ),
      addPart(
        'metal',
        'body',
        transformGeom(
          createCylinderY(0.04, 0.03, 0.075, 12),
          boneTarget,
          partGeometry - 0.05,
          partTint,
        ),
        RIG_METAL_BASE,
      ),
      addPart(
        'metal',
        'body',
        transformGeom(
          createCylinderY(0.042, 0.042, 0.012, 12),
          boneTarget,
          partGeometry - 0.02,
          partTint,
        ),
        RIG_METAL_BRIGHT,
      ),
      addPart(
        'shell',
        'body',
        transformGeom(rotorBell.clone(), boneTarget, partGeometry, partTint),
        RIG_SHELL_WHITE,
      ),
      addPart(
        'shell',
        'body',
        transformGeom(
          new THREE.TorusGeometry(0.196, 0.0085, 6, 28),
          boneTarget,
          partGeometry + 0.036,
          partTint,
          va,
          0,
          0,
        ),
        RIG_SHELL_RUST,
      ));
    for (let bladeIndex = 0; bladeIndex < 3; bladeIndex++) {
      let bladeAngle = bladeIndex * 2.094 + 0.5 + slotBucket;
      addPart(
        'metal',
        'body',
        transformGeom(
          createRoundedBox(0.145, 0.007, 0.016, 0.002),
          boneTarget + Math.cos(bladeAngle) * 0.105,
          partGeometry - 0.022,
          partTint - Math.sin(bladeAngle) * 0.105,
          0,
          bladeAngle,
          0,
        ),
        RIG_METAL_BASE,
      );
    }
    for (let bladeIndex = -1; bladeIndex <= 1; bladeIndex++) {
      let bladeAngle = Math.atan2(signZ, castShadowPart) + bladeIndex * 0.2;
      addPart(
        'shell',
        'body',
        transformGeom(
          createRoundedBox(0.012, 0.05, 0.036, 0.003),
          boneTarget + Math.cos(bladeAngle) * 0.205,
          partGeometry,
          partTint + Math.sin(bladeAngle) * 0.205,
          0,
          -bladeAngle,
          0,
        ),
        bladeIndex === 0 ? RIG_SHELL_DARK : RIG_SHELL_HAZARD,
      );
    }
    (addPart(
      'metal',
      'rotor' + slotBucket,
      transformGeom(createCylinderY(0.017, 0.02, 0.03, 8), 0, -0.002, 0),
      RIG_METAL_BRIGHT,
    ),
      addPart(
        'metal',
        'rotor' + slotBucket,
        transformGeom(createRoundedBox(0.158, 0.0035, 0.03, 0.001), 0.088, 0.008, 0, 0.22, 0, 0),
        RIG_METAL_BASE,
      ),
      addPart(
        'metal',
        'rotor' + slotBucket,
        transformGeom(createRoundedBox(0.158, 0.0035, 0.03, 0.001), -0.088, 0.008, 0, -0.22, 0, 0),
        RIG_METAL_BASE,
      ),
      addPart(
        'shell',
        'rotor' + slotBucket,
        transformGeom(createRoundedBox(0.02, 0.004, 0.031, 0.001), 0.158, 0.008, 0, 0.22, 0, 0),
        RIG_SHELL_HAZARD,
      ),
      addPart(
        'shell',
        'rotor' + slotBucket,
        transformGeom(createRoundedBox(0.02, 0.004, 0.031, 0.001), -0.158, 0.008, 0, -0.22, 0, 0),
        RIG_SHELL_HAZARD,
      ));
    let discGeom = new THREE.RingGeometry(0.03, 0.168, 24, 1);
    (discGeom.rotateX(-va),
      fxRig.add(
        'disc',
        'body',
        transformGeom(discGeom, boneTarget, partGeometry + 0.008, partTint),
        [1, 1, 1],
        !1,
      ));
  }
  (addPart(
    'glow',
    'strobeR',
    transformGeom(createScaledSphere(0.012, 8, 6), 0.33 + 0.215, 0.035, 0.3),
    [10, 0.4, 0.2],
    !1,
  ),
    addPart(
      'glow',
      'strobeR',
      transformGeom(createScaledSphere(0.012, 8, 6), 0.33 + 0.215, 0.035, -0.3),
      [10, 0.4, 0.2],
      !1,
    ),
    addPart(
      'glow',
      'strobeG',
      transformGeom(createScaledSphere(0.012, 8, 6), -0.33 - 0.215, 0.035, 0.3),
      [0.3, 9, 1],
      !1,
    ),
    addPart(
      'glow',
      'strobeG',
      transformGeom(createScaledSphere(0.012, 8, 6), -0.33 - 0.215, 0.035, -0.3),
      [0.3, 9, 1],
      !1,
    ),
    addPart(
      'glow',
      'strobeW',
      transformGeom(createScaledSphere(0.011, 8, 6), 0, 0.05, -0.325),
      [9, 9, 9],
      !1,
    ),
    addPart(
      'metal',
      'gimbalYaw',
      transformGeom(createCylinderY(0.036, 0.036, 0.014, 12), 0, -0.004, 0),
      RIG_METAL_BASE,
    ),
    addPart(
      'metal',
      'gimbalYaw',
      transformGeom(createRoundedBox(0.156, 0.01, 0.03, 0.003), 0, -0.014, 0),
      RIG_METAL_WHITE,
    ));
  for (let slotBucket of [1, -1])
    addPart(
      'metal',
      'gimbalYaw',
      transformGeom(createRoundedBox(0.009, 0.075, 0.03, 0.003), slotBucket * 0.0735, -0.05, 0),
      RIG_METAL_WHITE,
    );
  (addPart(
    'metal',
    'ball',
    transformGeom(createScaledSphere(0.06, 18, 12), 0, 0, 0),
    RIG_METAL_BASE,
  ),
    addPart(
      'metal',
      'ball',
      transformGeom(createCylinderX(0.013, 0.013, 0.142, 8), 0, 0, 0),
      RIG_METAL_BRIGHT,
    ),
    addPart(
      'metal',
      'ball',
      transformGeom(createCylinderZ(0.031, 0.036, 0.03, 14), 0, 0.004, 0.048),
      RIG_METAL_WHITE,
    ),
    addPart(
      'lens',
      'ball',
      transformGeom(createCylinderZ(0.025, 0.025, 0.004, 14), 0, 0.004, 0.0645),
      [1, 1, 1],
      !1,
    ),
    addPart(
      'metal',
      'ball',
      transformGeom(createCylinderZ(0.012, 0.012, 0.01, 8), 0.03, 0.036, 0.04),
      [0.1, 0.12, 0.2],
    ),
    addPart(
      'metal',
      'ball',
      transformGeom(
        createCylinderZ(0.019, 0.023, 0.045, 10),
        metrics.lamp[0],
        metrics.lamp[1],
        metrics.lamp[2] - 0.022,
      ),
      RIG_METAL_BASE,
    ),
    addPart(
      'glow',
      'lamp',
      transformGeom(createCylinderZ(0.016, 0.016, 0.003, 10), 0, 0, 0.001),
      [11, 9.8, 7.6],
      !1,
    ));
  {
    let partGeometry = new THREE.ConeGeometry(1.25, 9, 20, 6, !0);
    (partGeometry.translate(0, -9 / 2, 0),
      partGeometry.rotateX(-va),
      fxRig.add('cone', 'lamp', partGeometry, [1, 1, 1], !1));
  }
  (addPart(
    'metal',
    'gun',
    transformGeom(createRoundedBox(0.05, 0.03, 0.05, 0.006), 0, 0.012, 0),
    RIG_METAL_WHITE,
  ),
    addPart(
      'metal',
      'gun',
      transformGeom(createCylinderX(0.012, 0.012, 0.07, 8), 0, -0.005, 0),
      RIG_METAL_BRIGHT,
    ),
    addPart(
      'metal',
      'gun',
      transformGeom(createRoundedBox(0.052, 0.046, 0.13, 0.008), 0, -0.032, 0),
      RIG_METAL_WHITE,
    ),
    addPart(
      'shell',
      'gun',
      transformGeom(createRoundedBox(0.054, 0.012, 0.05, 0.003), 0, -0.02, -0.03),
      RIG_SHELL_RUST,
    ));
  for (let slotBucket of [-0.014, 0.014])
    (addPart(
      'metal',
      'gun',
      transformGeom(createCylinderZ(0.0085, 0.0085, 0.2, 8), slotBucket, -0.032, 0.16),
      RIG_METAL_BASE,
    ),
      addPart(
        'metal',
        'gun',
        transformGeom(createCylinderZ(0.012, 0.012, 0.03, 8), slotBucket, -0.032, 0.255),
        RIG_METAL_WHITE,
      ));
  (addPart(
    'metal',
    'gun',
    transformGeom(createRoundedBox(0.045, 0.012, 0.012, 0.002), 0, -0.032, 0.2),
    RIG_METAL_BRIGHT,
  ),
    addPart(
      'metal',
      'gun',
      transformGeom(createRoundedBox(0.03, 0.05, 0.05, 0.006), 0.04, -0.035, -0.02),
      RIG_METAL_BASE,
    ));
  let builtRig = rig.build(['shell', 'metal', 'glow', 'lens']),
    builtFxRig = fxRig.build(['disc', 'cone']);
  return ((builtRig.extra = builtFxRig), builtRig);
}
