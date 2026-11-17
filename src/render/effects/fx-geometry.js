// render/effects/fx-geometry.js — 从 render/effects/effects.js 按职责拆出。

import * as THREE from 'three';

/**
 * 把 1×1×1 盒体的顶点做哈希抖动（角上略缩、各顶点不等量偏移并去索引化），得到看不出是盒子的碎块几何，一次生成全池共用
 */
export function createDebrisGeometry() {
  let debrisGeo = new THREE.BoxGeometry(1, 1, 1, 2, 1, 2),
    posAttr = debrisGeo.attributes.position,
    hashState = 1234.5,
    hashRand = () => (
      (hashState = Math.sin(hashState * 12.9898 + 78.233) * 43758.5453),
      (hashState -= Math.floor(hashState)),
      hashState
    ),
    offsetCache = new Map();
  for (let vertIdx = 0; vertIdx < posAttr.count; vertIdx++) {
    let vertKey =
        posAttr.getX(vertIdx).toFixed(3) +
        ',' +
        posAttr.getY(vertIdx).toFixed(3) +
        ',' +
        posAttr.getZ(vertIdx).toFixed(3),
      offsetXYZ = offsetCache.get(vertKey);
    if (!offsetXYZ) {
      let vx = posAttr.getX(vertIdx),
        vy = posAttr.getY(vertIdx),
        vz = posAttr.getZ(vertIdx),
        cornerScale = Math.abs(vx) > 0.49 && Math.abs(vz) > 0.49 ? 0.72 + hashRand() * 0.2 : 1;
      ((vx = vx * cornerScale + (hashRand() - 0.5) * 0.14),
        (vz = vz * cornerScale + (hashRand() - 0.5) * 0.14),
        (vy = vy * (0.8 + hashRand() * 0.3) + (hashRand() - 0.5) * 0.1),
        (offsetXYZ = [vx, vy, vz]),
        offsetCache.set(vertKey, offsetXYZ));
    }
    posAttr.setXYZ(vertIdx, offsetXYZ[0], offsetXYZ[1], offsetXYZ[2]);
  }
  return ((debrisGeo = debrisGeo.toNonIndexed()), debrisGeo.computeVertexNormals(), debrisGeo);
}

/**
 * 用车削（LatheGeometry）拼出 5.56 弹壳外形：细颈、锥形壳体与底缘，10 段旋转保低面数
 */
export function createShellGeometry() {
  let profile = [
      [0, 0],
      [0.006076, 0],
      [0.0062, 0.0012],
      [0.005083999999999999, 0.0022],
      [0.005083999999999999, 0.0034],
      [0.006013999999999999, 0.0046],
      [0.005889999999999999, 0.036399999999999995],
      [0.004092, 0.0416],
      [0.003968, 0.052],
      [0.003224, 0.052],
      [0.0031, 0.044719999999999996],
    ],
    shellGeo = new THREE.LatheGeometry(
      profile.map((pt) => new THREE.Vector2(pt[0], pt[1] - 0.052 / 2)),
      10,
    );
  return (shellGeo.computeVertexNormals(), shellGeo);
}
