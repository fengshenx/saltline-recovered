// content/backdrop/harbor-skyline.js — 从 content/backdrop/sky.js 拆出（原文件名为 sky 但内容是海港天际线与海鸥，与 render/sky.js 的天空同名易混）。

import { MeshBatcher, beamBetween, boxFromBounds, colorGeometry, cylinderFromAxis, strutBetween } from '../../assets/procedural/geometry.js';
import { getTintedMaterial } from '../../render/materials/materials.js';
import { createSeededRng } from '../../core/random.js';
import { valueNoise3 } from '../../core/math.js';
import { _b } from '../../misc.js';
import { DISTANT_CONTAINER_COLORS, HARBOR_CONTAINER_COLORS, addRailing, distanceFade, makeBeaconGeo, normalizeTint } from './backdrop.js';
import * as THREE from 'three';
import { buildDistantCrane, buildQuayCrane } from './cranes.js';

/**
 * 屋面天窗开洞表（南北坡、坡带序号、列序号共 8 处）；铺瓦楞板时跳过这些格子，并在洞下补漏痕贴花与滴水痕迹
 */
export var SHED_SKYLIGHT_HOLES = [
  ['S', 1, 4],
  ['S', 2, 5],
  ['S', 1, 11],
  ['S', 2, 15],
  ['S', 3, 8],
  ['N', 2, 7],
  ['N', 1, 13],
  ['N', 3, 17],
];

/**
 * 搭建对岸港口天际线：成片集装箱堆场（含门标、绑扎与箱门细节）、多台岸桥、仓库、灯柱、三角桅、灯塔与远景建筑，全部合并成一个 skyline 网格
 */
export function buildHarborSkyline(ctx, lamps) {
  let batcher = new MeshBatcher(),
    containerMat = getTintedMaterial(ctx, 'paint_white'),
    rng = createSeededRng(90417),
    containerTint = [5.5, 4.3, 2.9],
    lampTint = [8, 0.45, 0.25],
    scratchTint = [0, 0, 0];
  function tintAt(D, C, G, j, N = 1) {
    let Q = valueNoise3(C * 0.23 + 1.3, G * 0.31, j * 0.23 + 7.7),
      K = valueNoise3(C * 1.9 + 4.1, 2.2, j * 1.9 + 9.3),
      ie = N * (0.56 + 0.52 * Q) * (0.62 + 0.38 * _b(0, 5, G)),
      F = D[0] * ie,
      X = D[1] * ie,
      ne = D[2] * ie;
    if (K > 0.62) {
      let re = Math.min(1, (K - 0.62) / 0.3) * 0.55;
      ((F = F * (1 - re) + 0.3 * re * ie),
        (X = X * (1 - re) + 0.15 * re * ie),
        (ne = ne * (1 - re) + 0.08 * re * ie));
    }
    return ((scratchTint[0] = F), (scratchTint[1] = X), (scratchTint[2] = ne), scratchTint);
  }
  let addPiece = (D, C) => {
      if (!D) return;
      if (Array.isArray(D)) {
        for (let Q of D) addPiece(Q, C);
        return;
      }
      D.computeBoundingBox();
      let G = D.boundingBox,
        j = (G.min.x + G.max.x) / 2,
        N = (G.min.z + G.max.z) / 2;
      if (j < 31) {
        let Q = distanceFade(j, N);
        (colorGeometry(D, (K, ie, F) => tintAt(C, K, ie, F, Q)), batcher.add(containerMat, D));
      } else batcher.add(containerMat, D, C);
    },
    positions = [],
    normals = [],
    uvs = [],
    colors = [];
  function pushQuad(D, C, G) {
    let j = D[1][0] - D[0][0],
      N = D[1][1] - D[0][1],
      Q = D[1][2] - D[0][2],
      K = D[3][0] - D[0][0],
      ie = D[3][1] - D[0][1],
      F = D[3][2] - D[0][2],
      X = (N * F - Q * ie) * C[0] + (Q * K - j * F) * C[1] + (j * ie - N * K) * C[2] < 0;
    for (let ne of X ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) {
      let re = D[ne];
      (positions.push(re[0], re[1], re[2]),
        normals.push(C[0], C[1], C[2]),
        colors.push(G[ne][0], G[ne][1], G[ne][2]),
        Math.abs(C[0]) > 0.5
          ? uvs.push(re[2], re[1])
          : Math.abs(C[1]) > 0.5
            ? uvs.push(re[0], re[2])
            : uvs.push(re[0], re[1]));
    }
  }
  let shadeNormal = [0.866, -0.5, 0],
    tintQuad = (D, C, G) => C.map((j) => tintAt(D, j[0], j[1], j[2], G).slice());
  function addBoxFaces(D, C, G, j, N, Q, K, ie, F) {
    for (let X of ie) {
      let ne, re;
      X === 'E'
        ? ((ne = [
            [j, C, Q],
            [j, C, G],
            [j, N, G],
            [j, N, Q],
          ]),
          (re = shadeNormal))
        : X === 'W'
          ? ((ne = [
              [D, C, G],
              [D, C, Q],
              [D, N, Q],
              [D, N, G],
            ]),
            (re = [-1, 0, 0]))
          : X === 'S'
            ? ((ne = [
                [D, C, Q],
                [j, C, Q],
                [j, N, Q],
                [D, N, Q],
              ]),
              (re = [0, 0, 1]))
            : X === 'N'
              ? ((ne = [
                  [j, C, G],
                  [D, C, G],
                  [D, N, G],
                  [j, N, G],
                ]),
                (re = [0, 0, -1]))
              : ((ne = [
                  [D, N, Q],
                  [j, N, Q],
                  [j, N, G],
                  [D, N, G],
                ]),
                (re = [0, 1, 0]));
      let $ = tintQuad(K, ne, X === 'T' ? F * 0.8 : X === 'E' ? F * 0.92 : F);
      if (C < 0.1 && X !== 'T')
        for (let ue of [0, 1]) (($[ue][0] *= 0.62), ($[ue][1] *= 0.62), ($[ue][2] *= 0.62));
      pushQuad(ne, re, $);
    }
  }
  function addContainerWall(
    D,
    C,
    G,
    { faceZ: j = 0, ribs: N = !1, doorRows: Q = 0, west: K = !1 } = {},
  ) {
    let ie = Math.sign(G - C),
      F = [];
    for (let re = C, $ = 1; ie > 0 ? re < G : re > G; re += ie * 2.62, $++)
      $ % 8 >= 1 &&
        $ % 8 <= 5 &&
        F.push({
          z: re,
          blk: Math.floor($ / 8),
          first: $ === 1,
        });
    let X = F.map((re, $) =>
        D.map((ue, me) => {
          let ee = valueNoise3(ue * 0.04 + 3, 0.5, re.z * 0.05 + 7),
            B = Math.round(0.2 + ee * 5.4 + (rng() - 0.5) * 2.4);
          return (!re.first && rng() < 0.07 && (B = 0), Math.max(re.first ? 2 : 0, Math.min(5, B)));
        }),
      ),
      ne = (re, $) => (re >= 0 && re < F.length && $ >= 0 && $ < D.length ? X[re][$] : 0);
    F.forEach((re, $) =>
      D.forEach((ue, me) => {
        let ee = X[$][me],
          B = re.z,
          P = distanceFade(ue, B),
          V = Math.max(Math.abs(ue + 5) - 40, Math.abs(B) - 30) < 55,
          Y = (L, Z) =>
            L >= 0 && Z >= 0 && L < D.length && Z < D.length && Math.abs(D[L] - D[Z]) < 12.8;
        for (let L = 0; L < ee; L++) {
          let Z = HARBOR_CONTAINER_COLORS[Math.floor(rng() * HARBOR_CONTAINER_COLORS.length)],
            J = 0.6 + rng() * 0.4,
            oe = [Z[0] * J, Z[1] * J, Z[2] * J],
            fe = (rng() - 0.5) * 0.22,
            le = L * 2.6,
            R = ue - 6.095 + fe,
            I = ue + 6.095 + fe,
            se = B - 1.22,
            ae = B + 1.22,
            k = L === ee - 1 ? 'T' : '';
          for (let Pe of j ? [j] : [-1, 1]) {
            let Re = $ + Pe * ie;
            (!(Re >= 0 && Re < F.length && F[Re].blk === re.blk && Math.abs(F[Re].z - B) < 2.7) ||
              ne(Re, me) <= L) &&
              (k += Pe > 0 ? 'S' : 'N');
          }
          let ce = !(Y(me - 1, me) && ne($, me - 1) > L),
            ve = !K && !(Y(me + 1, me) && ne($, me + 1) > L);
          (ce && (k += 'E'), ve && (k += 'W'), addBoxFaces(R, le, se, I, le + 2.59, ae, oe, k, P));
          let _e = [oe[0] * 0.45, oe[1] * 0.45, oe[2] * 0.45],
            Te = re.first
              ? j
                ? [j]
                : [-ie]
              : me === 0 && K && Math.abs(B) < 42
                ? [-1, 1].filter((Pe) => k.includes(Pe > 0 ? 'S' : 'N'))
                : [];
          if (N && V && Te.length) {
            let Pe = Te;
            for (let Re of Pe) {
              let Fe = Re > 0 ? ae : se,
                ze = Fe + Re * 0.04,
                We = le + 0.15,
                Ne = le + 2.45,
                dt = [oe[0] * 0.7, oe[1] * 0.7, oe[2] * 0.7];
              for (let xe = R + 0.24; xe < I - 0.3; xe += 0.575) {
                let Ie = [
                  [xe, We, Fe],
                  [xe + 0.07, We, ze],
                  [xe + 0.07, Ne, ze],
                  [xe, Ne, Fe],
                ];
                (pushQuad(Ie, [-0.5, 0, Re * 0.87], tintQuad(dt, Ie, P)),
                  (Ie = [
                    [xe + 0.07, We, ze],
                    [xe + 0.2, We, ze],
                    [xe + 0.2, Ne, ze],
                    [xe + 0.07, Ne, ze],
                  ]),
                  pushQuad(Ie, [0, 0, Re], tintQuad(oe, Ie, P)),
                  (Ie = [
                    [xe + 0.2, We, ze],
                    [xe + 0.27, We, Fe],
                    [xe + 0.27, Ne, Fe],
                    [xe + 0.2, Ne, ze],
                  ]),
                  pushQuad(Ie, [0.42, -0.52, Re * 0.74], tintQuad(dt, Ie, P)));
              }
              for (let [xe, Ie] of [
                [le, We],
                [Ne, le + 2.59],
              ]) {
                let Be = Fe + Re * 0.05,
                  Xe = [
                    [R, xe, Be],
                    [I, xe, Be],
                    [I, Ie, Be],
                    [R, Ie, Be],
                  ];
                (pushQuad(Xe, [0, 0, Re], tintQuad(_e, Xe, P)),
                  (Xe = [
                    [R, Ie, Fe],
                    [I, Ie, Fe],
                    [I, Ie, Be],
                    [R, Ie, Be],
                  ]),
                  pushQuad(Xe, [0, xe === le ? 1 : -1, 0], tintQuad(_e, Xe, P)));
              }
            }
          }
          if (ce && me === 0 && $ < Q) {
            let Pe = I + 0.03,
              Re = I + 0.055,
              Fe = le + 0.02,
              ze = le + 2.57,
              We = [oe[0] * 0.55, oe[1] * 0.55, oe[2] * 0.55],
              Ne = [0.34, 0.35, 0.36],
              dt = [0.05, 0.05, 0.055],
              xe = (Ie, Be, Xe, Me, we, be) => {
                let Oe = [
                    [Ie, Me, Xe],
                    [Ie, Me, Be],
                    [Ie, we, Be],
                    [Ie, we, Xe],
                  ],
                  pt = tintQuad(be, Oe, P);
                if (le < 0.1 && Me < 0.3)
                  for (let ut of [0, 1])
                    ((pt[ut][0] *= 0.62), (pt[ut][1] *= 0.62), (pt[ut][2] *= 0.62));
                pushQuad(Oe, shadeNormal, pt);
              };
            (xe(Pe, se, se + 0.13, Fe, ze, We),
              xe(Pe, ae - 0.13, ae, Fe, ze, We),
              xe(Pe, se + 0.13, ae - 0.13, le, le + 0.15, We),
              xe(Pe, se + 0.13, ae - 0.13, le + 2.44, le + 2.59, We),
              xe(Pe, B - 0.018, B + 0.018, le + 0.15, le + 2.44, dt));
            for (let Ie of [-0.8, -0.32, 0.32, 0.8])
              if ((xe(Re, B + Ie - 0.024, B + Ie + 0.024, le + 0.1, le + 2.5, Ne), $ < 8))
                for (let Be of [0.32, 2.2])
                  xe(Re + 0.01, B + Ie - 0.07, B + Ie + 0.07, le + Be, le + Be + 0.09, Ne);
            if ($ < 8)
              for (let Ie of [-0.56, 0.56])
                xe(Re + 0.01, B + Ie - 0.1, B + Ie + 0.1, le + 1.02, le + 1.1, Ne);
          }
        }
      }),
    );
  }
  let wallXs = [-48.6, -61.2, -73.8, -90.5, -103.1, -115.7, -132, -144.6],
    wallZs = [6.3, -6.3, -18.9, -31.5];
  (addContainerWall(wallXs, -4.9, -112, {
    ribs: !0,
    doorRows: 15,
    west: !0,
  }),
    addContainerWall(wallXs, 14.9, 112, {
      ribs: !0,
      doorRows: 15,
      west: !0,
    }),
    addContainerWall(wallZs, -36.4, -110, {
      faceZ: 1,
      ribs: !0,
      doorRows: 12,
    }),
    addContainerWall(wallZs, 33.9, 110, {
      faceZ: -1,
      ribs: !0,
      doorRows: 12,
    }));
  {
    let cranePosX = new THREE.BufferGeometry();
    (cranePosX.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)),
      cranePosX.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)),
      cranePosX.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)),
      cranePosX.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)),
      batcher.add(containerMat, cranePosX));
  }
  let craneTintA = normalizeTint(5922920, 0.85),
    darkTint = [0.1, 0.1, 0.11],
    frameTint = [0.36, 0.38, 0.4],
    craneTintB = normalizeTint(12159516, 0.5),
    houseTint = [0.5, 0.5, 0.48];
  function addGantryCrane(D, C, G, j, N) {
    let K = G,
      ie = [K[0] * 0.7, K[1] * 0.7, K[2] * 0.7];
    for (let ne of [-1, 1]) {
      let re = C + ne * 9.5;
      for (let $ of [-1, 1]) {
        let ue = D + $ * 7.5;
        (addPiece(boxFromBounds(ue - 1.5, 0.05, re - 0.28, ue + 1.5, 0.8, re + 0.28), darkTint),
          addPiece(boxFromBounds(ue - 0.36, 0.8, re - 0.36, ue + 0.36, 19.1, re + 0.36), K),
          addPiece(boxFromBounds(ue - 0.4, 6.9, re - 0.4, ue + 0.4, 7, re + 0.4), ie),
          addPiece(boxFromBounds(ue - 0.4, 13, re - 0.4, ue + 0.4, 13.1, re + 0.4), ie),
          addPiece(beamBetween([ue, 14.6, re], [ue - $ * 3.2, 19.1, re], 0.3, 0.3), K));
      }
      (addPiece(boxFromBounds(D - 9.3, 0.8, re - 0.4, D + 9.3, 1.7, re + 0.4), K),
        addPiece(boxFromBounds(D - 8, 19.1, re - 0.45, D + 8, 20.2, re + 0.45), K),
        addPiece(boxFromBounds(D - 2.4, 1.7, re - 0.5, D + 0.8, 3.9, re + 0.5), houseTint));
    }
    for (let ne of [-1, 1]) {
      let re = D + ne * 3.3,
        $ = C - 9.5 - 5.6,
        ue = C + 9.5 + 5.6;
      addPiece(boxFromBounds(re - 0.45, 20.2, $, re + 0.45, 21.9, ue), K);
      for (let me = $ + 4.4; me < ue; me += 4.4)
        addPiece(boxFromBounds(re - 0.48, 20.15, me - 0.03, re + 0.48, 21.95, me + 0.03), ie);
      (addPiece(boxFromBounds(re + ne * 0.45, 21, $, re + ne * 1.3, 21.05, ue), frameTint),
        addRailing(
          lampSink,
          null,
          [
            [re + ne * 1.27, 21.05, $],
            [re + ne * 1.27, 21.05, ue],
          ],
          {
            post: 3.3,
            r: 0.035,
            mid: !1,
            tint: craneTintB,
          },
        ),
        addPiece(
          strutBetween([re, 20.2, C - 9.5 + 0.5], [re, 20.2, C + 9.5 - 0.5], 0.05, 4),
          darkTint,
        ));
    }
    for (let ne of [C - 9.5 - 5.4, C + 9.5 + 5.4])
      addPiece(boxFromBounds(D - 3.3, 20.4, ne - 0.25, D + 3.3, 21.7, ne + 0.25), K);
    let F = C + j;
    (addPiece(boxFromBounds(D - 4, 21.9, F - 2.3, D + 4, 22.5, F + 2.3), craneTintB),
      addPiece(boxFromBounds(D - 2.6, 22.5, F - 1.7, D + 1.4, 24.5, F + 1.7), houseTint),
      addPiece(boxFromBounds(D + 1.8, 22.5, F - 0.9, D + 3.4, 23.3, F + 0.9), darkTint),
      addPiece(boxFromBounds(D + 4.3, 17.2, F - 1, D + 6.1, 19.5, F + 1), houseTint),
      addPiece(
        boxFromBounds(D + 4.4, 18.2, F - 1.02, D + 6.12, 19.2, F + 1.02),
        [0.08, 0.1, 0.12],
      ));
    for (let ne of [-0.9, 0.9])
      addPiece(
        boxFromBounds(D + 4.9, 19.5, F + ne - 0.06, D + 5.05, 21.9, F + ne + 0.06),
        craneTintB,
      );
    let X = 21.9 - N;
    for (let ne of [-2.2, 2.2])
      for (let re of [-0.8, 0.8])
        addPiece(strutBetween([D + ne, 21.9, F + re], [D + ne, X, F + re], 0.03, 4), darkTint);
    (addPiece(boxFromBounds(D - 6.1, X - 0.4, F - 1.22, D + 6.1, X, F + 1.22), craneTintB),
      addPiece(boxFromBounds(D - 2.4, X, F - 0.9, D + 2.4, X + 0.5, F + 0.9), craneTintB));
    {
      let ne = D - 7.5 - 0.5,
        re = C - 9.5,
        $ = 1.7;
      for (let ue = 0; ue < 6; ue++) {
        let me = re + (ue % 2 ? 1.9 : -1.9),
          ee = re + (ue % 2 ? -1.9 : 1.9),
          B = Math.min(20.2, $ + 3.1);
        (addPiece(beamBetween([ne, $, me], [ne, B, ee], 0.6, 0.07), frameTint),
          addPiece(strutBetween([ne - 0.3, $ + 1, me], [ne - 0.3, B + 1, ee], 0.03, 4), craneTintB),
          addPiece(boxFromBounds(ne - 0.35, B - 0.04, ee - 0.5, ne + 0.35, B, ee + 0.5), frameTint),
          ($ = B));
      }
      for (let ue of [-2.4, 2.4])
        addPiece(boxFromBounds(ne - 0.3, 1.7, re + ue - 0.05, ne - 0.2, 20.2, re + ue + 0.05), ie);
      (addPiece(
        cylinderFromAxis(1.25, 1.25, 0.5, 'z', D + 7.5 + 1, 3.3, C + 9.5 + 0.9, 12),
        craneTintB,
      ),
        addPiece(
          cylinderFromAxis(0.5, 0.5, 0.6, 'z', D + 7.5 + 1, 3.3, C + 9.5 + 0.9, 8),
          darkTint,
        ));
      for (let ue of [-0.2, 0.2])
        addPiece(
          strutBetween(
            [D + 7.5 + 0.45, 1.7, C - 9.5 + ue],
            [D + 7.5 + 0.45, 20.2, C - 9.5 + ue],
            0.022,
            4,
          ),
          frameTint,
        );
    }
    (lamps.add(makeBeaconGeo(D, 24.9, F, 0.3), lampTint, 3.1, rng(), 0.4),
      lamps.add(makeBeaconGeo(D - 3.3, 20, C - 4, 0.24), containerTint, 0),
      lamps.add(makeBeaconGeo(D + 3.3, 20, C + 4, 0.24), containerTint, 0));
  }
  let lampSink = {
      add: (D, C, G) => addPiece(C, G),
    },
    craneTintC = normalizeTint(6172444, 0.7);
  (addGantryCrane(-61, -52.06, craneTintA, -3, 4.5),
    addGantryCrane(-61, 41.1, craneTintC, 5, 9),
    addGantryCrane(-103, -10.14, craneTintC, 2, 3),
    addGantryCrane(-6, -62.6, craneTintA, -6, 7),
    addGantryCrane(-12, 60.1, craneTintA, 4, 5));
  for (let [cranePosX, cranePosZ, craneTintColor] of [
    [-67.5, -22, 32],
    [-67.5, 31, 32],
    [-122, 4, 34],
    [-12.6, -53, 30],
    [-12.6, 51, 30],
    [-140, -84, 34],
    [-96, 96, 34],
    [0.2, -100, 30],
    [-52, -70, 28],
    [-55, 72, 28],
    [-84, -45, 34],
    [-84, 24, 34],
    [-25, -84, 30],
    [-28, 90, 30],
    [-120, 60, 34],
    [10.5, 49, 26],
  ]) {
    (addPiece(
      cylinderFromAxis(0.14, 0.3, craneTintColor, 'y', cranePosX, craneTintColor / 2, cranePosZ, 6),
      frameTint,
    ),
      addPiece(
        cylinderFromAxis(1.5, 1.5, 0.18, 'y', cranePosX, craneTintColor - 0.5, cranePosZ, 8),
        darkTint,
      ));
    for (let [faceZOption, ribsEnabled] of [
      [-1.4, 0],
      [1.4, 0],
      [0, -1.4],
      [0, 1.4],
    ])
      (addPiece(
        boxFromBounds(
          cranePosX + faceZOption - 0.25,
          craneTintColor - 0.95,
          cranePosZ + ribsEnabled - 0.25,
          cranePosX + faceZOption + 0.25,
          craneTintColor - 0.6,
          cranePosZ + ribsEnabled + 0.25,
        ),
        darkTint,
      ),
        lamps.add(
          makeBeaconGeo(
            cranePosX + faceZOption,
            craneTintColor - 1.05,
            cranePosZ + ribsEnabled,
            0.2,
          ),
          containerTint,
          0,
        ));
  }
  for (let [cranePosX, cranePosZ, craneTintColor] of [
    [-158, -30, 62],
    [-76, -128, 48],
    [-150, 104, 54],
  ]) {
    let ribsEnabled = [
      [-1.1, -0.638],
      [1.1, -0.638],
      [0, 1.265],
    ];
    for (let [doorRowLimit, mainTintColor] of ribsEnabled)
      addPiece(
        strutBetween(
          [cranePosX + doorRowLimit, 0, cranePosZ + mainTintColor],
          [cranePosX + doorRowLimit * 0.3, craneTintColor, cranePosZ + mainTintColor * 0.3],
          0.07,
          4,
        ),
        [0.42, 0.14, 0.1],
      );
    for (
      let doorRowLimit = 3, mainTintColor = 0;
      doorRowLimit < craneTintColor;
      doorRowLimit += 6, mainTintColor++
    )
      for (let columnStepSign = 0; columnStepSign < 3; columnStepSign++) {
        let columnEntries = ribsEnabled[columnStepSign],
          stackHeights = ribsEnabled[(columnStepSign + 1) % 3],
          stackHeightAt = 1 - (0.7 * doorRowLimit) / craneTintColor,
          columnEntry = 1 - (0.7 * Math.min(craneTintColor, doorRowLimit + 6)) / craneTintColor;
        addPiece(
          strutBetween(
            [
              cranePosX + columnEntries[0] * stackHeightAt,
              doorRowLimit,
              cranePosZ + columnEntries[1] * stackHeightAt,
            ],
            [
              cranePosX + stackHeights[0] * columnEntry,
              Math.min(craneTintColor, doorRowLimit + 6),
              cranePosZ + stackHeights[1] * columnEntry,
            ],
            0.04,
            3,
          ),
          mainTintColor % 2 ? houseTint : [0.42, 0.14, 0.1],
        );
      }
    for (let doorRowLimit of [0.5, 2.6, 4.7])
      addPiece(
        strutBetween(
          [cranePosX, craneTintColor * 0.72, cranePosZ],
          [
            cranePosX + Math.cos(doorRowLimit) * craneTintColor * 0.5,
            0,
            cranePosZ + Math.sin(doorRowLimit) * craneTintColor * 0.5,
          ],
          0.025,
          3,
        ),
        darkTint,
      );
    (addPiece(
      strutBetween(
        [cranePosX, craneTintColor, cranePosZ],
        [cranePosX, craneTintColor + 5, cranePosZ],
        0.04,
        3,
      ),
      darkTint,
    ),
      addPiece(
        boxFromBounds(
          cranePosX - 0.9,
          craneTintColor * 0.8,
          cranePosZ - 0.25,
          cranePosX + 0.9,
          craneTintColor * 0.8 + 1.6,
          cranePosZ + 0.25,
        ),
        houseTint,
      ),
      lamps.add(
        makeBeaconGeo(cranePosX, craneTintColor + 0.4, cranePosZ, 0.35),
        lampTint,
        2.4,
        rng(),
        0.45,
      ),
      lamps.add(makeBeaconGeo(cranePosX, craneTintColor * 0.55, cranePosZ, 0.28), lampTint, 0));
  }
  for (let [cranePosX, cranePosZ, craneTintColor] of [
    [-178, -70, 90],
    [-182, 40, 110],
    [-60, -150, 70],
    [-70, 150, 80],
  ]) {
    let faceZOption = Math.abs(cranePosZ) > 120,
      ribsEnabled = (Q, K, ie, F, X, ne, re) =>
        addPiece(
          faceZOption
            ? boxFromBounds(cranePosX + Q, K, cranePosZ + ie, cranePosX + F, X, cranePosZ + ne)
            : boxFromBounds(cranePosX + ie, K, cranePosZ + Q, cranePosX + ne, X, cranePosZ + F),
          re,
        );
    (ribsEnabled(-craneTintColor / 2, 0, -16, craneTintColor / 2, 9.5, 16, [0.2, 0.22, 0.24]),
      ribsEnabled(
        -craneTintColor / 2,
        9.5,
        -16.4,
        craneTintColor / 2,
        9.9,
        16.4,
        [0.12, 0.12, 0.13],
      ),
      ribsEnabled(-craneTintColor / 2, 9.9, -10, craneTintColor / 2, 12.2, 10, [0.17, 0.18, 0.2]),
      ribsEnabled(
        -craneTintColor / 2 + 4,
        12.2,
        -1.2,
        craneTintColor / 2 - 4,
        13.3,
        1.2,
        [0.13, 0.13, 0.14],
      ));
    for (
      let doorRowLimit = -craneTintColor / 2 + 6;
      doorRowLimit < craneTintColor / 2 - 5;
      doorRowLimit += 12
    )
      (ribsEnabled(
        doorRowLimit - 0.25,
        0,
        -16.2,
        doorRowLimit + 0.25,
        9.5,
        16.2,
        [0.13, 0.14, 0.15],
      ),
        (doorRowLimit | 0) % 3 === 0 &&
          ribsEnabled(doorRowLimit + 2, 0, -16.1, doorRowLimit + 8, 6.2, 16.1, [0.06, 0.06, 0.07]));
  }
  (buildQuayCrane(ctx, lamps, {
    into: batcher,
    mat: containerMat,
    dz: 66,
  }),
    [
      [-132, 1.15, !0, [0.14, 0.17, 0.21]],
      [-186, 1.25, !1, [0.14, 0.17, 0.21]],
      [-252, 1.35, !0, [0.26, 0.12, 0.06]],
      [-336, 1.4, !1, [0.26, 0.12, 0.06]],
      [128, 1.2, !1, [0.14, 0.17, 0.21]],
      [182, 1.3, !0, [0.24, 0.25, 0.27]],
      [250, 1.4, !1, [0.24, 0.25, 0.27]],
      [330, 1.45, !0, [0.26, 0.12, 0.06]],
    ].forEach(([cranePosX, cranePosZ, craneTintColor, faceZOption], ribsEnabled) => {
      let doorRowLimit = buildDistantCrane(batcher, containerMat, 23.5, cranePosX, {
        s: cranePosZ,
        up: craneTintColor,
        tint: faceZOption,
      });
      lamps.add(
        makeBeaconGeo(doorRowLimit[0], doorRowLimit[1], doorRowLimit[2], 0.45 * cranePosZ),
        lampTint,
        2.6 + (ribsEnabled % 3) * 0.35,
        ribsEnabled * 0.37,
        0.45,
      );
    }),
    addPiece(boxFromBounds(-230, -1.6, -384, 30, -0.12, 425), [0.24, 0.24, 0.25]));
  function addWarehouse(D, C, G, j, N, Q, K) {
    (addPiece(boxFromBounds(D, -1.6, G, C, N, j), Q),
      addPiece(boxFromBounds(D, -1.6, G, C, 0.8, j + 0.2), [0.42, 0.14, 0.1]));
    let ie = j - G,
      F = G + ie * K;
    (addPiece(boxFromBounds(D + 2, N, F - 7, C - 2, N + 17, F + 7), [0.72, 0.73, 0.7]),
      addPiece(
        boxFromBounds((D + C) / 2 - 3, N + 17, F - 5, (D + C) / 2 + 3, N + 24, F + 1),
        [0.2, 0.3, 0.45],
      ));
    for (let X = G + 12; X < j - 12; X += 13.2) {
      if (Math.abs(X + 6 - F) < 14) continue;
      let ne = 2.6 * (2 + Math.floor(rng() * 4)),
        re = DISTANT_CONTAINER_COLORS[Math.floor(rng() * DISTANT_CONTAINER_COLORS.length)];
      addPiece(boxFromBounds(D + 1, N, X, (D + C) / 2 - 0.2, N + ne, X + 12.2), re);
      let $ = DISTANT_CONTAINER_COLORS[Math.floor(rng() * DISTANT_CONTAINER_COLORS.length)];
      addPiece(
        boxFromBounds(
          (D + C) / 2 + 0.2,
          N,
          X,
          C - 1,
          N + ne - 2.6 * Math.floor(rng() * 2),
          X + 12.2,
        ),
        $,
      );
    }
    lamps.add(makeBeaconGeo((D + C) / 2, N + 26, F, 0.4), [5, 4.6, 3.8], 0);
  }
  (addWarehouse(34, 62, 140, 345, 11, [0.1, 0.13, 0.2], 0.78),
    addWarehouse(34, 58, -360, -205, 10, [0.2, 0.08, 0.07], 0.2),
    addWarehouse(470, 500, -190, -40, 9, [0.12, 0.14, 0.17], 0.8),
    addWarehouse(600, 626, 160, 300, 9, [0.16, 0.12, 0.1], 0.2));
  for (let cranePosX = 340; cranePosX > -66; cranePosX -= 12.5) {
    let cranePosZ = 398 + Math.sin(cranePosX * 0.013) * 14 + (rng() - 0.5) * 3,
      craneTintColor = boxFromBounds(-6 - rng() * 2, -1.6, -7, 6 + rng() * 2, 2.2 + rng() * 1.2, 7);
    (craneTintColor.rotateY((rng() - 0.5) * 0.5),
      craneTintColor.translate(cranePosZ, 0, cranePosX),
      addPiece(craneTintColor, [0.2, 0.21, 0.22]));
  }
  {
    (addPiece(cylinderFromAxis(5, 6, 3.6, 'y', 399, 0.2, -72, 10), [0.3, 0.3, 0.3]),
      addPiece(cylinderFromAxis(1.7, 2.3, 6, 'y', 399, 5, -72, 10), [0.85, 0.85, 0.82]),
      addPiece(cylinderFromAxis(1.5, 1.7, 4, 'y', 399, 10, -72, 10), [0.62, 0.14, 0.1]),
      addPiece(cylinderFromAxis(1.3, 1.5, 4, 'y', 399, 14, -72, 10), [0.85, 0.85, 0.82]),
      addPiece(cylinderFromAxis(2, 2, 0.3, 'y', 399, 16.1, -72, 10), [0.3, 0.3, 0.32]),
      addPiece(cylinderFromAxis(0.2, 1.3, 1.2, 'y', 399, 18.9, -72, 8), [0.25, 0.25, 0.27]));
    for (let craneTintColor = 0; craneTintColor < 6; craneTintColor++) {
      let faceZOption = (craneTintColor / 6) * 6.283;
      addPiece(
        boxFromBounds(
          399 + Math.cos(faceZOption) * 1.1 - 0.06,
          16.2,
          -72 + Math.sin(faceZOption) * 1.1 - 0.06,
          399 + Math.cos(faceZOption) * 1.1 + 0.06,
          18.3,
          -72 + Math.sin(faceZOption) * 1.1 + 0.06,
        ),
        [0.25, 0.25, 0.27],
      );
    }
    lamps.add(makeBeaconGeo(399, 17.25, -72, 0.85), [16, 15, 11], 6, 0, 0.09);
  }
  let breakBulkX = 300;
  addPiece(
    boxFromBounds(breakBulkX - 330, -1.6, -520, breakBulkX + 330, 2.2, -430),
    [0.16, 0.17, 0.18],
  );
  for (let [cranePosX, cranePosZ, craneTintColor, faceZOption] of [
    [-150, -452, 17, 15],
    [-112, -458, 17, 15],
    [-76, -450, 13, 18],
    [20, -455, 20, 14],
    [64, -462, 20, 14],
    [104, -452, 14, 19],
    [136, -462, 14, 19],
    [210, -456, 22, 12],
  ])
    (addPiece(
      cylinderFromAxis(
        craneTintColor,
        craneTintColor,
        faceZOption,
        'y',
        breakBulkX + cranePosX,
        2.2 + faceZOption / 2,
        cranePosZ,
        14,
      ),
      [0.62, 0.63, 0.62],
    ),
      addPiece(
        cylinderFromAxis(
          craneTintColor * 0.2,
          craneTintColor,
          faceZOption * 0.12,
          'y',
          breakBulkX + cranePosX,
          2.2 + faceZOption * 1.06,
          cranePosZ,
          14,
        ),
        [0.52, 0.53, 0.53],
      ));
  for (let [cranePosX, cranePosZ, craneTintColor, faceZOption] of [
    [-32, -470, 96, 3.2],
    [168, -475, 70, 2.6],
  ]) {
    addPiece(
      cylinderFromAxis(
        faceZOption * 0.62,
        faceZOption,
        craneTintColor,
        'y',
        breakBulkX + cranePosX,
        2.2 + craneTintColor / 2,
        cranePosZ,
        10,
      ),
      [0.5, 0.5, 0.5],
    );
    for (let ribsEnabled of [0.82, 0.94])
      addPiece(
        cylinderFromAxis(
          faceZOption * 0.66,
          faceZOption * 0.7,
          craneTintColor * 0.05,
          'y',
          breakBulkX + cranePosX,
          2.2 + craneTintColor * ribsEnabled,
          cranePosZ,
          10,
        ),
        [0.6, 0.15, 0.1],
      );
    (lamps.add(
      makeBeaconGeo(breakBulkX + cranePosX, 3.2 + craneTintColor, cranePosZ, 0.9),
      lampTint,
      2.2,
      rng(),
      0.5,
    ),
      lamps.add(
        makeBeaconGeo(
          breakBulkX + cranePosX + faceZOption,
          2.2 + craneTintColor * 0.55,
          cranePosZ,
          0.7,
        ),
        lampTint,
        2.2,
        rng(),
        0.5,
      ));
  }
  for (let [cranePosX, cranePosZ, craneTintColor, faceZOption, ribsEnabled] of [
    [-230, -455, 70, 16, 30],
    [-10, -445, 30, 22, 18],
    [0, -452, 8, 44, 8],
    [-18, -450, 5, 36, 5],
    [270, -450, 60, 12, 30],
    [150, -448, 26, 28, 14],
  ])
    addPiece(
      boxFromBounds(
        breakBulkX + cranePosX - craneTintColor / 2,
        2.2,
        cranePosZ - ribsEnabled / 2,
        breakBulkX + cranePosX + craneTintColor / 2,
        2.2 + faceZOption,
        cranePosZ + ribsEnabled / 2,
      ),
      [0.34, 0.36, 0.38],
    );
  for (let cranePosX = 0; cranePosX < 26; cranePosX++)
    lamps.add(
      makeBeaconGeo(breakBulkX - 300 + rng() * 600, 6 + rng() * 26, -436 + rng() * 6, 0.55),
      rng() > 0.3 ? containerTint : [3, 3.4, 3.8],
      0,
    );
  let skylineMesh = batcher.build({
    cast: !1,
    recv: !1,
  });
  return (
    (skylineMesh.name = 'skyline'),
    {
      root: skylineMesh,
      tris: batcher.tris,
    }
  );
}
