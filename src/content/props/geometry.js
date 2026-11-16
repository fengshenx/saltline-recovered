// content/props/geometry.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { clampValue } from '../../audio/audio.js';

/**
 * 倒角方块几何：8 个角各拆成 3 个顶点形成 12 条倒角棱，低面数却不会出现硬边法线接缝；anchor='bottom' 时把原点移到底面，方便道具按地面摆放
 */
export function chamferedBoxGeometry(width, height, depth, bevelSize = 0.01, anchor = 'center') {
  bevelSize = Math.max(
    5e-4,
    Math.min(bevelSize, width / 2 - 1e-4, height / 2 - 1e-4, depth / 2 - 1e-4),
  );
  let halfW = width / 2,
    halfH = height / 2,
    halfD = depth / 2,
    posArr = new Float32Array(72),
    normArr = new Float32Array(72),
    uvArr = new Float32Array(48),
    vtxIndex = (x, y, b, m) => ((x > 0 ? 1 : 0) + (y > 0 ? 2 : 0) + (b > 0 ? 4 : 0)) * 3 + m;
  for (let cornerX of [-1, 1])
    for (let cornerY of [-1, 1])
      for (let cornerZ of [-1, 1]) {
        let cornerCoords = [
            [cornerX * halfW, cornerY * (halfH - bevelSize), cornerZ * (halfD - bevelSize)],
            [cornerX * (halfW - bevelSize), cornerY * halfH, cornerZ * (halfD - bevelSize)],
            [cornerX * (halfW - bevelSize), cornerY * (halfH - bevelSize), cornerZ * halfD],
          ],
          cornerNormals = [
            [cornerX, 0, 0],
            [0, cornerY, 0],
            [0, 0, cornerZ],
          ];
        for (let subIdx = 0; subIdx < 3; subIdx++) {
          let e1x = vtxIndex(cornerX, cornerY, cornerZ, subIdx);
          (posArr.set(cornerCoords[subIdx], e1x * 3),
            normArr.set(cornerNormals[subIdx], e1x * 3),
            subIdx === 0
              ? ((uvArr[e1x * 2] = cornerCoords[subIdx][2]),
                (uvArr[e1x * 2 + 1] = cornerCoords[subIdx][1]))
              : subIdx === 1
                ? ((uvArr[e1x * 2] = cornerCoords[subIdx][0]),
                  (uvArr[e1x * 2 + 1] = cornerCoords[subIdx][2]))
                : ((uvArr[e1x * 2] = cornerCoords[subIdx][0]),
                  (uvArr[e1x * 2 + 1] = cornerCoords[subIdx][1])));
        }
      }
  let indexArr = [],
    pushTri = (idxA, idxB, idxC) => {
      let ax = posArr[idxA * 3],
        ay = posArr[idxA * 3 + 1],
        az = posArr[idxA * 3 + 2],
        e1x = posArr[idxB * 3] - ax,
        e1y = posArr[idxB * 3 + 1] - ay,
        e1z = posArr[idxB * 3 + 2] - az,
        e2x = posArr[idxC * 3] - ax,
        e2y = posArr[idxC * 3 + 1] - ay,
        e2z = posArr[idxC * 3 + 2] - az,
        crossX = e1y * e2z - e1z * e2y,
        crossY = e1z * e2x - e1x * e2z,
        crossZ = e1x * e2y - e1y * e2x,
        centroidX = ax + (e1x + e2x) / 3,
        centroidY = ay + (e1y + e2y) / 3,
        centroidZ = az + (e1z + e2z) / 3;
      crossX * centroidX + crossY * centroidY + crossZ * centroidZ >= 0
        ? indexArr.push(idxA, idxB, idxC)
        : indexArr.push(idxA, idxC, idxB);
    },
    pushQuadTri = (x, y, b, m) => {
      (pushTri(x, y, b), pushTri(x, b, m));
    },
    quadCorners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
  for (let cornerX of [-1, 1])
    (pushQuadTri(...quadCorners.map(([y, b]) => vtxIndex(cornerX, y, b, 0))),
      pushQuadTri(...quadCorners.map(([y, b]) => vtxIndex(y, cornerX, b, 1))),
      pushQuadTri(...quadCorners.map(([y, b]) => vtxIndex(y, b, cornerX, 2))));
  for (let cornerX of [-1, 1])
    for (let cornerY of [-1, 1])
      (pushQuadTri(
        vtxIndex(-1, cornerX, cornerY, 1),
        vtxIndex(1, cornerX, cornerY, 1),
        vtxIndex(1, cornerX, cornerY, 2),
        vtxIndex(-1, cornerX, cornerY, 2),
      ),
        pushQuadTri(
          vtxIndex(cornerX, -1, cornerY, 0),
          vtxIndex(cornerX, 1, cornerY, 0),
          vtxIndex(cornerX, 1, cornerY, 2),
          vtxIndex(cornerX, -1, cornerY, 2),
        ),
        pushQuadTri(
          vtxIndex(cornerX, cornerY, -1, 0),
          vtxIndex(cornerX, cornerY, 1, 0),
          vtxIndex(cornerX, cornerY, 1, 1),
          vtxIndex(cornerX, cornerY, -1, 1),
        ));
  for (let cornerX of [-1, 1])
    for (let cornerY of [-1, 1])
      for (let cornerZ of [-1, 1])
        pushTri(
          vtxIndex(cornerX, cornerY, cornerZ, 0),
          vtxIndex(cornerX, cornerY, cornerZ, 1),
          vtxIndex(cornerX, cornerY, cornerZ, 2),
        );
  let chamferGeo = new THREE.BufferGeometry();
  return (
    chamferGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3)),
    chamferGeo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3)),
    chamferGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2)),
    chamferGeo.setIndex(indexArr),
    anchor === 'bottom' && chamferGeo.translate(0, height / 2, 0),
    chamferGeo
  );
}

/**
 * 三种箱型的铭牌数据表（箱型代码、总重/皮重/净重、容积、默认漆色），共 3 条，用来生成门板上的 MAX GROSS / TARE / NET / CU.CAP. 铭牌
 */
export var CONTAINER_SPECS = {
  container20: {
    type: '22G1',
    gross: '30,480',
    tare: '2,230',
    net: '28,250',
    cu: '33.2',
    def: 'red',
  },
  container40: {
    type: '42G1',
    gross: '32,500',
    tare: '3,750',
    net: '28,750',
    cu: '67.7',
    def: 'blue',
  },
  container40hc: {
    type: '45G1',
    gross: '32,500',
    tare: '3,940',
    net: '28,560',
    cu: '76.3',
    def: 'green',
  },
};

/**
 * 6 个虚构箱主代号（SLTU/HBMU/…），按 seed 轮换印在箱门与侧板上，让堆场里的箱子看起来不重复
 */
export var CONTAINER_OWNER_CODES = [
  'SLTU 482915 7',
  'HBMU 307144 2',
  'NRDU 665201 9',
  'OKTU 119873 4',
  'VSLU 850362 1',
  'TQLU 274590 6',
];

/**
 * smoothstepRange 的重复实现（按模块边界复制），塑料桶液面渐变的过渡曲线
 */
export var smoothstepRangeAlt = (edge0, edge1, x) => {
  let n = clampValue((x - edge0) / (edge1 - edge0), 0, 1);
  return n * n * (3 - 2 * n);
};
