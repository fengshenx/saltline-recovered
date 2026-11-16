// content/backdrop/ships.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  MeshBatcher,
  beamBetween,
  boxFromBounds,
  catenaryPoints,
  cylinderFromAxis,
  planeAt,
  strutBetween,
  strutsAlongPath,
} from '../../assets/procedural/geometry.js';

import {
  addRailing,
  bulwarkHeightAt,
  bulwarkTopAt,
  deckHeightAt,
  makeBeaconGeo,
} from './backdrop.js';

import { hullPatchGeo } from '../models/enemies.js';

import { newVec3 } from '../../core/math.js';

import { hash2 } from '../../core/random.js';

import { SurfaceBuilder } from '../../gameplay/weapons/geometry.js';

import { getTintedMaterial, tintByHash } from '../../render/materials/materials.js';

/**
 * KITTIWAKE 号货船的中纵剖面 x，船体所有剖面点都以它为中线
 */
var SHIP_CENTER_X = 41;

/**
 * 船体中段最大半宽（型宽一半），舷侧曲线在此处达到最宽
 */
var SHIP_HALF_BEAM = 8;

/**
 * 船尾所在的 z；船体沿 -z 方向从船尾延伸到船首
 */
var SHIP_STERN_Z = -9;

/**
 * 船体总长（沿 z 的站号终值），船体放样、栏杆、舱盖与编号全靠它定位
 */
export var SHIP_LENGTH = 63;

/**
 * 船舯处龙骨（船底）的 y，作为横剖面曲线的底部起点
 */
var SHIP_KEEL_Y = -4.4;

/**
 * 主甲板高度 y；甲板上的集装箱、舱盖、桅杆都以它为基准
 */
export var SHIP_DECK_Y = 13;

/**
 * 设计水线高度 y，吃水与护舷、系缆设备都相对它布置
 */
var SHIP_WATERLINE_Y = -1.6;

/**
 * 船尾舷墙顶高度，作为船体放样时首尾收束的基准值
 */
var SHIP_STERN_TOP_Y = bulwarkTopAt(0);

/**
 * 船体放样函数：给（站号、高度、左右舷）返回船壳表面点；宽度沿船长按 sin 幂次收束，是整条船几何的唯一真源
 */
export function hullPoint(station, height, side) {
  let rakeOffset = (SHIP_STERN_TOP_Y - height) * 0.22,
    rakeFalloff = Math.max(0, 1 - station / 22),
    hullZ = SHIP_STERN_Z - station - rakeOffset * rakeFalloff,
    heightFrac = Math.min(
      1,
      Math.max(0, (height - SHIP_WATERLINE_Y) / (SHIP_DECK_Y - SHIP_WATERLINE_Y)),
    ),
    taperLen = 17 - 8.5 * Math.pow(heightFrac, 1.3),
    stationT = station / taperLen,
    widthFactor = stationT >= 1 ? 1 : Math.pow(Math.sin((stationT * Math.PI) / 2), 0.72),
    halfBeam = 0.2 + (SHIP_HALF_BEAM - 0.2) * widthFactor,
    bowT = (station - (SHIP_LENGTH - 10)) / 10;
  return (
    bowT > 0 && (halfBeam *= 1 - 0.24 * bowT * bowT * (1 - 0.6 * heightFrac)),
    new THREE.Vector3(SHIP_CENTER_X + side * halfBeam, height, hullZ)
  );
}

/**
 * 用有限差分数值求船壳表面法线并翻向船外，供外板、贴花、栏杆偏移使用
 */
export function hullNormal(station, height, side) {
  let tangentS = hullPoint(station + 0.05, height, side).sub(
      hullPoint(Math.max(0, station - 0.05), height, side),
    ),
    tangentH = hullPoint(station, height + 0.05, side).sub(hullPoint(station, height - 0.05, side)),
    normalVec = tangentS.cross(tangentH).normalize();
  return (normalVec.x * side + normalVec.z * 0.25 < 0 && normalVec.negate(), normalVec);
}

/**
 * 搭建 KITTIWAKE 号集装箱船：船体放样（水下/水线/舷侧分段配色）、甲板、舱盖、绑扎、上层建筑、桅杆、烟囱、救生艇与船名标识，返回根节点、雷达、碰撞盒
 */
export function buildContainerShip(ctx, lamps) {
  let batcher = new MeshBatcher(),
    hullPaintMat = getTintedMaterial(ctx, 'hull_paint'),
    hullRedMat = getTintedMaterial(ctx, 'hull_red'),
    whiteMat = getTintedMaterial(ctx, 'paint_white'),
    darkSteelMat = ctx.mats.get('steel_dark'),
    galvMat = ctx.mats.get('steel_galv'),
    ropeMat = ctx.mats.get('rope'),
    rubberMat = ctx.mats.get('rubber'),
    hullTint = [2.6, 1.75, 0.95],
    addLampGeo = ($) => lamps.add($, hullTint, 0),
    addGeom = ($, ue, me) => batcher.add($, ue, me),
    stations = [0, 0.35, 0.9, 1.8, 3, 4.5, 6, 8, 10, 12, 14.5, 17, 20];
  for (let $ = 23; $ < SHIP_LENGTH - 0.5; $ += 3) stations.push($);
  stations.push(SHIP_LENGTH);
  let profileFractions = [0, 0.17, 0.34, 0.5, 0.66, 0.83, 1],
    profileAt = ($) => {
      let ue = deckHeightAt($),
        me = [SHIP_KEEL_Y, -2.3, -0.4, 1];
      for (let ee = 1; ee < profileFractions.length; ee++)
        me.push(1 + (ue - 1) * profileFractions[ee]);
      return (me.push(bulwarkTopAt($)), me);
    },
    heightSegs = 10,
    bootRows = 3,
    bottomBuilder = new SurfaceBuilder(),
    hullBuilder = new SurfaceBuilder(),
    tintFor = ($, ue, me, ee) => {
      let B = tintByHash($.x * 0.6, $.y, $.z * 0.6, void 0, 0.8),
        P = [B[0] * ee, B[1] * ee, B[2] * ee];
      return (
        ue < bootRows
          ? $.y < -0.2
            ? ((P[0] *= 0.55), (P[1] *= 0.72), (P[2] *= 0.55))
            : me && ((P[0] *= 1.12), (P[1] *= 1), (P[2] *= 0.92))
          : $.y < 1.1 && ((P[0] *= 1.7), (P[1] *= 1.62), (P[2] *= 1.45)),
        P
      );
    };
  for (let $ of [-1, 1])
    for (let ue = 0; ue < stations.length - 1; ue++) {
      let me = stations[ue],
        ee = stations[ue + 1],
        B = profileAt(me),
        P = profileAt(ee);
      for (let V = 0; V < heightSegs; V++) {
        if (V === heightSegs - 1 && bulwarkHeightAt(me) < 0.02 && bulwarkHeightAt(ee) < 0.02)
          continue;
        let Y = (V < bootRows ? 0.8 : 0.58) + 0.36 * hash2(ue * 7 + ($ > 0 ? 100 : 0), V),
          L = [
            hullPoint(me, B[V], $),
            hullPoint(ee, P[V], $),
            hullPoint(ee, P[V + 1], $),
            hullPoint(me, B[V + 1], $),
          ],
          Z = [
            hullNormal(me, B[V], $),
            hullNormal(ee, P[V], $),
            hullNormal(ee, P[V + 1], $),
            hullNormal(me, B[V + 1], $),
          ],
          J = [
            [me, B[V]],
            [ee, P[V]],
            [ee, P[V + 1]],
            [me, B[V + 1]],
          ],
          oe = [
            tintFor(L[0], V, !1, Y),
            tintFor(L[1], V, !1, Y),
            tintFor(L[2], V, !0, Y),
            tintFor(L[3], V, !0, Y),
          ];
        if (me > 1.5 && V >= 2 && V < heightSegs - 1) {
          let fe = L[0].clone().add(L[1]).add(L[2]).add(L[3]).multiplyScalar(0.25);
          for (let le = 0; le < 4; le++)
            Z[le].addScaledVector(fe.clone().sub(L[le]).normalize(), 0.075).normalize();
        }
        (V < bootRows ? bottomBuilder : hullBuilder).quad(L, Z, J, oe);
      }
    }
  {
    let $ = profileAt(0),
      ue = profileAt(SHIP_LENGTH),
      me = newVec3(0, 0.2, 1).normalize(),
      ee = newVec3(0, 0, -1),
      B = newVec3(0, 1, 0);
    for (let P = 0; P < heightSegs; P++) {
      let V = P < bootRows ? [0.8, 0.8, 0.8] : [0.9, 0.9, 0.9];
      ((P < bootRows ? bottomBuilder : hullBuilder).quad(
        [
          hullPoint(0, $[P], -1),
          hullPoint(0, $[P], 1),
          hullPoint(0, $[P + 1], 1),
          hullPoint(0, $[P + 1], -1),
        ],
        [me, me, me, me],
        [
          [0, $[P]],
          [0.4, $[P]],
          [0.4, $[P + 1]],
          [0, $[P + 1]],
        ],
        [V, V, V, V],
      ),
        (P < bootRows ? bottomBuilder : hullBuilder).quad(
          [
            hullPoint(SHIP_LENGTH, ue[P], -1),
            hullPoint(SHIP_LENGTH, ue[P], 1),
            hullPoint(SHIP_LENGTH, ue[P + 1], 1),
            hullPoint(SHIP_LENGTH, ue[P + 1], -1),
          ],
          [ee, ee, ee, ee],
          [
            [0, ue[P]],
            [14, ue[P]],
            [14, ue[P + 1]],
            [0, ue[P + 1]],
          ],
          [V, V, V, V],
        ));
    }
    for (let P = 0; P < stations.length - 1; P++) {
      let V = hullPoint(stations[P], deckHeightAt(stations[P]), -1),
        Y = hullPoint(stations[P], deckHeightAt(stations[P]), 1),
        L = hullPoint(stations[P + 1], deckHeightAt(stations[P + 1]), 1),
        Z = hullPoint(stations[P + 1], deckHeightAt(stations[P + 1]), -1),
        J = [0.75, 0.72, 0.7];
      bottomBuilder.quad(
        [V, Y, L, Z],
        [B, B, B, B],
        [
          [V.x, V.z],
          [Y.x, Y.z],
          [L.x, L.z],
          [Z.x, Z.z],
        ],
        [J, J, J, J],
      );
    }
  }
  (addGeom(hullRedMat, bottomBuilder.geo()), addGeom(hullPaintMat, hullBuilder.geo()));
  {
    let $ = (me, ee) => hullPoint(me, ee, -1).addScaledVector(hullNormal(me, ee, -1), 0.012),
      ue = [1.05, 0.92, 0.8];
    for (let me = 2; me < stations.length - 1; me++) {
      let ee = profileAt(stations[me]),
        B = profileAt(stations[me + 1]);
      for (let P = 4; P <= 9; P++)
        addGeom(
          hullPaintMat,
          beamBetween($(stations[me], ee[P]), $(stations[me + 1], B[P]), 0.03, 0.045),
          ue,
        );
      for (let P = 3; P < 9; P++)
        (me + P) % 2 === 0 &&
          addGeom(
            hullPaintMat,
            beamBetween($(stations[me], ee[P]), $(stations[me], ee[P + 1]), 0.035, 0.03),
            ue,
          );
    }
  }
  for (let $ of [-1, 1]) {
    for (let Y = 3; Y < stations.length - 1; Y++) {
      let L = (Z, J) => hullPoint(Z, J, $).addScaledVector(hullNormal(Z, J, $), 0.07);
      (addGeom(
        hullPaintMat,
        beamBetween(L(stations[Y], 9.6), L(stations[Y + 1], 9.6), 0.16, 0.3),
        [0.55, 0.55, 0.55],
      ),
        bulwarkHeightAt(stations[Y]) > 0.6 &&
          bulwarkHeightAt(stations[Y + 1]) > 0.6 &&
          addGeom(
            darkSteelMat,
            strutBetween(
              hullPoint(stations[Y], bulwarkTopAt(stations[Y]), $),
              hullPoint(stations[Y + 1], bulwarkTopAt(stations[Y + 1]), $),
              0.07,
              6,
            ),
          ));
    }
    for (let Y = 0; Y < 3; Y++)
      addGeom(
        darkSteelMat,
        strutBetween(
          hullPoint(stations[Y], bulwarkTopAt(stations[Y]), $),
          hullPoint(stations[Y + 1], bulwarkTopAt(stations[Y + 1]), $),
          0.07,
          6,
        ),
      );
    let ue = [];
    for (let Y = 18; Y <= SHIP_LENGTH - 10.4; Y += 3)
      ue.push(hullPoint(Y, deckHeightAt(Y), $).add(newVec3(-$ * 0.12, 0, 0)));
    addRailing(batcher, darkSteelMat, ue, {
      h: 1.05,
      post: 1.5,
      r: 0.028,
    });
    let me = 4.6,
      ee = deckHeightAt(me) - 2.3,
      B = hullPoint(me, ee, $),
      P = hullNormal(me, ee, $);
    addGeom(
      darkSteelMat,
      strutBetween(
        B.clone().addScaledVector(P, -0.3),
        B.clone().addScaledVector(P, 0.22),
        0.5,
        12,
        !0,
      ),
    );
    let V = (Y, L, Z) => hullPoint(Y, L, $).addScaledVector(hullNormal(Y, L, $), Z);
    (addGeom(
      darkSteelMat,
      beamBetween(V(me, ee - 0.1, 0.34), V(me, ee - 2.3, 0.3), 0.22, 0.22, 0.03),
    ),
      addGeom(
        darkSteelMat,
        beamBetween(V(me - 0.95, ee - 2.45, 0.34), V(me + 0.95, ee - 2.45, 0.34), 0.42, 0.42, 0.05),
      ));
    for (let Y of [-0.8, 0.8])
      addGeom(
        darkSteelMat,
        beamBetween(V(me + Y, ee - 2.4, 0.3), V(me + Y * 1.1, ee - 1.1, 0.34), 0.5, 0.12, 0.02),
      );
  }
  let nameLabel = ctx.mats.label('KITTIWAKE', {
    color: 'white',
    font: 'sans',
    distress: 0.3,
  });
  {
    let ue = Math.min(12, 1.7 * Math.max(2, nameLabel.aspect || 6));
    (addGeom(nameLabel.material, hullPatchGeo(7.6, 7.6 + ue, 10.25, 10.25 + 1.7, -1, 0.014, 10, 1)),
      addGeom(
        nameLabel.material,
        hullPatchGeo(7.6, 7.6 + ue, 10.25, 10.25 + 1.7, 1, 0.014, 10, 1),
      ));
  }
  let rustDecal = ctx.mats.decal('rust_run');
  addGeom(
    rustDecal.material,
    hullPatchGeo(
      4.6 - 0.8,
      4.6 + 0.8,
      deckHeightAt(4.6) - 9.5,
      deckHeightAt(4.6) - 2.6,
      -1,
      0.012,
      2,
      3,
    ),
  );
  for (let $ = 21.5; $ < SHIP_LENGTH - 11; $ += 5.5) {
    let ue = hullPoint($, SHIP_DECK_Y - 0.45, -1);
    addGeom(
      darkSteelMat,
      boxFromBounds(ue.x - 0.04, ue.y - 0.09, ue.z - 0.3, ue.x + 0.01, ue.y + 0.09, ue.z + 0.3),
    );
    let me = 2.6 + 3.2 * hash2(Math.round($ * 10), 5);
    addGeom(
      rustDecal.material,
      hullPatchGeo($ - 0.45, $ + 0.45, SHIP_DECK_Y - 0.5 - me, SHIP_DECK_Y - 0.5, -1, 0.012, 1, 1),
    );
  }
  for (let $ of [6.4, SHIP_LENGTH - 7])
    for (let ue = 0; ue < 9; ue++) {
      let me = 1.6 + ue * 0.62;
      addGeom(
        whiteMat,
        hullPatchGeo($, $ + (ue % 2 ? 0.28 : 0.5), me, me + 0.13, -1, 0.01, 1, 1),
        [1.1, 1.1, 1.05],
      );
    }
  (addGeom(whiteMat, hullPatchGeo(33, 33.9, 3.2, 3.3, -1, 0.01, 1, 1), [1.1, 1.1, 1.05]),
    addGeom(whiteMat, hullPatchGeo(33.4, 33.5, 2.4, 4.1, -1, 0.01, 1, 1), [1.1, 1.1, 1.05]));
  let bowDeckY = deckHeightAt(7);
  for (let $ of [-1, 1]) {
    (addGeom(
      darkSteelMat,
      cylinderFromAxis(
        0.55,
        0.55,
        0.9,
        'x',
        SHIP_CENTER_X + $ * 1.5,
        bowDeckY + 0.75,
        SHIP_STERN_Z - 6.2,
        12,
      ),
    ),
      addGeom(
        darkSteelMat,
        boxFromBounds(
          SHIP_CENTER_X + $ * 0.5,
          bowDeckY,
          SHIP_STERN_Z - 6.9,
          SHIP_CENTER_X + $ * 2.6,
          bowDeckY + 0.5,
          SHIP_STERN_Z - 5.5,
          0.04,
        ),
      ));
    for (let ue of [0, 0.7])
      addGeom(
        darkSteelMat,
        cylinderFromAxis(
          0.16,
          0.16,
          0.7,
          'y',
          SHIP_CENTER_X + $ * 4.2,
          bowDeckY + 0.35,
          SHIP_STERN_Z - 8.5 - ue,
          8,
        ),
      );
  }
  let foremastZ = SHIP_STERN_Z - 10.5,
    foremastTopY = bowDeckY + 15;
  (addGeom(
    whiteMat,
    cylinderFromAxis(0.26, 0.42, 15, 'y', SHIP_CENTER_X, bowDeckY + 7.5, foremastZ, 10),
    [0.85, 0.8, 0.7],
  ),
    addGeom(
      whiteMat,
      boxFromBounds(
        SHIP_CENTER_X - 2.6,
        bowDeckY + 10,
        foremastZ - 0.12,
        SHIP_CENTER_X + 2.6,
        bowDeckY + 10.24,
        foremastZ + 0.12,
      ),
      [0.85, 0.8, 0.7],
    ),
    addGeom(
      darkSteelMat,
      strutBetween(
        [SHIP_CENTER_X, foremastTopY, foremastZ],
        [SHIP_CENTER_X, foremastTopY + 2.4, foremastZ],
        0.03,
        5,
      ),
    ));
  for (let $ of [-1, 1])
    (addGeom(
      darkSteelMat,
      strutBetween(
        [SHIP_CENTER_X + $ * 2.5, bowDeckY + 10.2, foremastZ],
        [SHIP_CENTER_X + $ * 5.6, bowDeckY + 0.6, foremastZ - 1.2],
        0.022,
        4,
      ),
    ),
      addGeom(
        darkSteelMat,
        strutBetween(
          [SHIP_CENTER_X + $ * 2.5, bowDeckY + 10.2, foremastZ],
          [SHIP_CENTER_X, foremastTopY, foremastZ],
          0.02,
          4,
        ),
      ));
  (addGeom(
    darkSteelMat,
    strutBetween(
      [SHIP_CENTER_X, foremastTopY, foremastZ],
      [SHIP_CENTER_X, bulwarkTopAt(0) + 0.3, SHIP_STERN_Z - 0.4],
      0.022,
      4,
    ),
  ),
    addGeom(
      darkSteelMat,
      strutBetween(
        [SHIP_CENTER_X, bulwarkTopAt(0), SHIP_STERN_Z - 0.3],
        [SHIP_CENTER_X, bulwarkTopAt(0) + 2.6, SHIP_STERN_Z - 0.15],
        0.03,
        5,
      ),
    ));
  let mastBase = newVec3(SHIP_CENTER_X, bowDeckY + 2.2, foremastZ - 0.5),
    mastTop = newVec3(SHIP_CENTER_X + 1.2, bowDeckY + 9.5, foremastZ - 11.5);
  (addGeom(whiteMat, strutBetween(mastBase, mastTop, 0.2, 8, !0), [0.85, 0.8, 0.7]),
    addGeom(
      darkSteelMat,
      strutBetween(mastTop, [SHIP_CENTER_X, foremastTopY - 0.4, foremastZ], 0.022, 4),
    ),
    addGeom(darkSteelMat, strutBetween(mastTop, [mastTop.x, SHIP_DECK_Y + 4, mastTop.z], 0.018, 4)),
    addGeom(
      darkSteelMat,
      boxFromBounds(
        mastTop.x - 0.18,
        SHIP_DECK_Y + 3.4,
        mastTop.z - 0.18,
        mastTop.x + 0.18,
        SHIP_DECK_Y + 4,
        mastTop.z + 0.18,
        0.04,
      ),
    ),
    lamps.add(
      makeBeaconGeo(SHIP_CENTER_X, foremastTopY - 0.6, foremastZ + 0.5, 0.14),
      [5, 4.6, 3.8],
      0,
    ));
  let containerTints = [
    [0.62, 0.17, 0.13],
    [0.17, 0.29, 0.5],
    [0.2, 0.42, 0.3],
    [0.78, 0.36, 0.12],
    [0.8, 0.62, 0.16],
    [0.82, 0.83, 0.8],
    [0.4, 0.43, 0.47],
    [0.16, 0.42, 0.45],
  ];
  [
    [-45.6, 12.19],
    [-32.7, 12.19],
    [-22.8, 6.06],
  ].forEach(([$, ue], me) => {
    addGeom(
      hullRedMat,
      boxFromBounds(
        SHIP_CENTER_X - 7.7,
        SHIP_DECK_Y,
        $ - ue / 2 - 0.2,
        SHIP_CENTER_X + 7.7,
        SHIP_DECK_Y + 0.42,
        $ + ue / 2 + 0.2,
        0.04,
      ),
      [0.6, 0.6, 0.62],
    );
    for (let ee = 0; ee < 6; ee++) {
      let B = SHIP_CENTER_X + (ee - 2.5) * 2.52,
        P = me === 2 ? 2 : 2 + (hash2(ee * 3 + me, 9) > 0.4 ? 1 : 0);
      for (let V = 0; V < P; V++) {
        let Y = SHIP_DECK_Y + 0.44 + V * 2.61,
          L =
            containerTints[Math.floor(hash2(ee * 5 + V * 13 + me * 29, 2) * containerTints.length)];
        if (
          (addGeom(
            whiteMat,
            boxFromBounds(B - 1.22, Y, $ - ue / 2, B + 1.22, Y + 2.59, $ + ue / 2, 0.035),
            L,
          ),
          ee === 0)
        )
          for (let Z = $ - ue / 2 + 0.5; Z < $ + ue / 2 - 0.3; Z += 0.58)
            addGeom(
              whiteMat,
              boxFromBounds(B - 1.24, Y + 0.15, Z - 0.1, B - 1.21, Y + 2.45, Z + 0.1),
              L,
            );
      }
    }
    for (let ee of [$ - ue / 2 - 0.45, $ + ue / 2 + 0.45]) {
      for (let B = 0; B <= 6; B++)
        addGeom(
          darkSteelMat,
          boxFromBounds(
            SHIP_CENTER_X + (B - 3) * 2.52 - 0.05,
            SHIP_DECK_Y,
            ee - 0.05,
            SHIP_CENTER_X + (B - 3) * 2.52 + 0.05,
            SHIP_DECK_Y + 5.6,
            ee + 0.05,
          ),
        );
      for (let B of [SHIP_DECK_Y + 2.9, SHIP_DECK_Y + 5.6])
        addGeom(
          darkSteelMat,
          boxFromBounds(
            SHIP_CENTER_X - 7.6,
            B - 0.05,
            ee - 0.12,
            SHIP_CENTER_X + 7.6,
            B + 0.05,
            ee + 0.12,
          ),
        );
    }
  });
  let whiteTint = [0.92, 0.93, 0.92],
    hatchZ0 = -53,
    hatchZ1 = -66.5;
  [
    [7.2, 13, 15.9, 0],
    [6.7, 15.9, 18.7, 0.5],
    [6.3, 18.7, 21.5, 1],
    [6.5, 21.5, 24.4, 1.5],
  ].forEach(([$, ue, me, ee], B) => {
    (addGeom(
      whiteMat,
      boxFromBounds(
        SHIP_CENTER_X - $,
        ue,
        hatchZ1 + ee * 0.4,
        SHIP_CENTER_X + $,
        me,
        hatchZ0 - ee,
        0.08,
      ),
      whiteTint,
    ),
      addGeom(
        whiteMat,
        boxFromBounds(
          SHIP_CENTER_X - $ - 0.7,
          me - 0.06,
          hatchZ1 + ee * 0.4 - 0.3,
          SHIP_CENTER_X + $ + 0.7,
          me + 0.06,
          hatchZ0 - ee + 1,
        ),
        [0.7, 0.72, 0.72],
      ));
    let P = me + 0.06,
      V = SHIP_CENTER_X - $ - 0.67,
      Y = SHIP_CENTER_X + $ + 0.67,
      L = hatchZ0 - ee + 0.97,
      Z = hatchZ1 + ee * 0.4 - 0.27;
    if (
      (addRailing(
        batcher,
        galvMat,
        [
          [V, P, Z],
          [V, P, L],
          [Y, P, L],
          [Y, P, Z],
        ],
        {
          h: 1.05,
          post: 1.6,
          r: 0.026,
        },
      ),
      B < 3)
    )
      for (let J = hatchZ0 - ee - 1.2, oe = 0; J > hatchZ1 + 1.5; J -= 1.45, oe++) {
        let fe = hash2(oe * 3 + B * 11, 4) > 0.8;
        for (let le of [-1, 1]) {
          let R = boxFromBounds(
            SHIP_CENTER_X + le * ($ + 0.012) - 0.012,
            ue + 1.25,
            J - 0.33,
            SHIP_CENTER_X + le * ($ + 0.012) + 0.012,
            ue + 1.85,
            J + 0.33,
          );
          fe && le < 0 ? addLampGeo(R) : addGeom(darkSteelMat, R);
        }
      }
    if (B < 3)
      for (let J = SHIP_CENTER_X - $ + 1, oe = 0; J < SHIP_CENTER_X + $ - 0.6; J += 1.5, oe++) {
        let fe = boxFromBounds(
          J - 0.33,
          ue + 1.25,
          hatchZ0 - ee - 0.01,
          J + 0.33,
          ue + 1.85,
          hatchZ0 - ee + 0.014,
        );
        hash2(oe + B * 7, 8) > 0.84 ? addLampGeo(fe) : addGeom(darkSteelMat, fe);
      }
  });
  let winchY = 21.5,
    winchZ = hatchZ0 - 1.5,
    winchHalfW = 6.5;
  addGeom(
    darkSteelMat,
    boxFromBounds(
      SHIP_CENTER_X - winchHalfW + 0.2,
      winchY + 1.3,
      winchZ - 0.01,
      SHIP_CENTER_X + winchHalfW - 0.2,
      winchY + 2.25,
      winchZ + 0.02,
    ),
  );
  for (
    let $ = SHIP_CENTER_X - winchHalfW + 0.75, ue = 0;
    $ < SHIP_CENTER_X + winchHalfW - 0.4;
    $ += 1.05, ue++
  )
    (hash2(ue, 21) > 0.62 &&
      addLampGeo(
        boxFromBounds(
          $ - 0.44,
          winchY + 1.36,
          winchZ + 0.02,
          $ + 0.44,
          winchY + 2.19,
          winchZ + 0.03,
        ),
      ),
      addGeom(
        whiteMat,
        boxFromBounds($ + 0.48, winchY + 1.3, winchZ, $ + 0.57, winchY + 2.25, winchZ + 0.04),
        whiteTint,
      ));
  for (let $ of [-1, 1])
    (addGeom(
      darkSteelMat,
      boxFromBounds(
        SHIP_CENTER_X + $ * winchHalfW - 0.02,
        winchY + 1.3,
        winchZ - 5,
        SHIP_CENTER_X + $ * winchHalfW + 0.02,
        winchY + 2.25,
        winchZ - 0.2,
      ),
    ),
      addGeom(
        whiteMat,
        boxFromBounds(
          SHIP_CENTER_X + $ * 6.4,
          winchY - 0.12,
          winchZ - 3.4,
          SHIP_CENTER_X + $ * 8.3,
          winchY + 0.02,
          winchZ + 0.9,
          0.03,
        ),
        whiteTint,
      ),
      addGeom(
        whiteMat,
        boxFromBounds(
          SHIP_CENTER_X + $ * 8.22,
          winchY,
          winchZ - 3.4,
          SHIP_CENTER_X + $ * 8.3,
          winchY + 1.1,
          winchZ + 0.9,
        ),
        whiteTint,
      ),
      addGeom(
        whiteMat,
        boxFromBounds(
          SHIP_CENTER_X + $ * 6.5,
          winchY,
          winchZ + 0.82,
          SHIP_CENTER_X + $ * 8.3,
          winchY + 1.1,
          winchZ + 0.9,
        ),
        whiteTint,
      ),
      addGeom(
        darkSteelMat,
        beamBetween(
          [SHIP_CENTER_X + $ * 6.6, winchY - 2.6, winchZ - 1.2],
          [SHIP_CENTER_X + $ * 8.1, winchY - 0.1, winchZ - 1.2],
          0.12,
          0.12,
        ),
      ),
      lamps.add(
        makeBeaconGeo(SHIP_CENTER_X + $ * 8.25, winchY + 1.35, winchZ - 0.4, 0.13),
        $ < 0 ? [0.3, 5, 1.6] : [6, 0.4, 0.3],
        0,
      ));
  (addLampGeo(
    boxFromBounds(
      SHIP_CENTER_X - 2.2,
      24.42,
      winchZ + 0.6,
      SHIP_CENTER_X - 1.6,
      24.52,
      winchZ + 0.9,
    ),
  ),
    addLampGeo(
      boxFromBounds(
        SHIP_CENTER_X + 1.6,
        24.42,
        winchZ + 0.6,
        SHIP_CENTER_X + 2.2,
        24.52,
        winchZ + 0.9,
      ),
    ));
  let mastPos = newVec3(SHIP_CENTER_X, 24.46, -57.5);
  (addGeom(
    whiteMat,
    cylinderFromAxis(0.16, 0.28, 8.5, 'y', mastPos.x, mastPos.y + 4.25, mastPos.z, 8),
    whiteTint,
  ),
    addGeom(
      whiteMat,
      boxFromBounds(
        mastPos.x - 2.4,
        mastPos.y + 5.2,
        mastPos.z - 0.08,
        mastPos.x + 2.4,
        mastPos.y + 5.36,
        mastPos.z + 0.08,
      ),
      whiteTint,
    ),
    addGeom(
      whiteMat,
      boxFromBounds(
        mastPos.x - 1.3,
        mastPos.y + 7.3,
        mastPos.z - 0.06,
        mastPos.x + 1.3,
        mastPos.y + 7.42,
        mastPos.z + 0.06,
      ),
      whiteTint,
    ),
    addGeom(
      whiteMat,
      boxFromBounds(
        mastPos.x - 0.5,
        mastPos.y + 3.2,
        mastPos.z,
        mastPos.x + 0.5,
        mastPos.y + 3.3,
        mastPos.z + 1.2,
      ),
      whiteTint,
    ));
  for (let $ of [-2.3, -1.2, 1.2, 2.3])
    addGeom(
      darkSteelMat,
      strutBetween(
        [mastPos.x + $, mastPos.y + 5.36, mastPos.z],
        [mastPos.x + $, mastPos.y + 5.36 + (Math.abs($) > 2 ? 3.2 : 1.2), mastPos.z],
        0.012,
        4,
      ),
    );
  addGeom(
    darkSteelMat,
    strutBetween(
      [mastPos.x, mastPos.y + 8.5, mastPos.z],
      [mastPos.x, mastPos.y + 10.8, mastPos.z],
      0.015,
      4,
    ),
  );
  for (let $ of [-1, 1])
    addGeom(
      darkSteelMat,
      strutBetween(
        [mastPos.x + $ * 2.3, mastPos.y + 5.3, mastPos.z],
        [SHIP_CENTER_X + $ * 6, 24.5, hatchZ1 + 2],
        0.014,
        4,
      ),
    );
  (lamps.add(makeBeaconGeo(mastPos.x, mastPos.y + 8.7, mastPos.z + 0.3, 0.14), [5, 4.6, 3.8], 0),
    lamps.add(
      makeBeaconGeo(mastPos.x, mastPos.y + 7.6, mastPos.z, 0.12),
      [8, 0.4, 0.25],
      3.4,
      0.6,
      0.4,
    ));
  let funnelZ = -62.6;
  (addGeom(
    whiteMat,
    boxFromBounds(
      SHIP_CENTER_X - 1.7,
      24.4,
      funnelZ - 2.3,
      SHIP_CENTER_X + 1.7,
      29.3,
      funnelZ + 2.1,
      0.25,
    ),
    [0.2, 0.34, 0.5],
  ),
    addGeom(
      whiteMat,
      boxFromBounds(
        SHIP_CENTER_X - 1.72,
        27.2,
        funnelZ - 2.32,
        SHIP_CENTER_X + 1.72,
        28.1,
        funnelZ + 2.12,
        0.1,
      ),
      [0.9, 0.88, 0.8],
    ),
    addGeom(
      whiteMat,
      boxFromBounds(
        SHIP_CENTER_X - 1.75,
        29.3,
        funnelZ - 2.35,
        SHIP_CENTER_X + 1.75,
        30.3,
        funnelZ + 2.15,
        0.2,
      ),
      [0.07, 0.07, 0.08],
    ));
  for (let $ of [-0.9, 0.5])
    addGeom(
      darkSteelMat,
      cylinderFromAxis(0.28, 0.28, 1.1, 'y', SHIP_CENTER_X, 30.7, funnelZ + $, 10),
    );
  let logoBDecal = ctx.mats.decal('logo_b');
  addGeom(
    logoBDecal.material,
    planeAt(
      2.6,
      2.6 / Math.max(1, logoBDecal.aspect || 1),
      SHIP_CENTER_X - 1.705,
      26.1,
      funnelZ - 0.1,
      -Math.PI / 2,
    ),
  );
  {
    let $ = SHIP_CENTER_X - 7.9,
      ue = 17.5,
      me = -61,
      ee = [1.25, 0.42, 0.1],
      B = new THREE.CapsuleGeometry(1.15, 3.6, 4, 12);
    (B.rotateX(Math.PI / 2),
      B.scale(0.95, 0.82, 1),
      B.translate($, ue, me),
      addGeom(whiteMat, B, ee),
      addGeom(
        whiteMat,
        boxFromBounds($ - 0.6, ue + 0.7, me - 1.2, $ + 0.6, ue + 1.25, me + 0.9, 0.12),
        ee,
      ));
    for (let P of [-2.1, 2.1])
      (addGeom(
        darkSteelMat,
        beamBetween([SHIP_CENTER_X - 6.9, 15.9, me + P], [$ - 0.2, ue + 2.3, me + P], 0.16, 0.22),
      ),
        addGeom(
          darkSteelMat,
          strutBetween([$ - 0.2, ue + 2.2, me + P], [$, ue + 0.9, me + P * 0.8], 0.02, 4),
        ));
  }
  (addGeom(
    darkSteelMat,
    strutBetween(
      [SHIP_CENTER_X, bulwarkTopAt(SHIP_LENGTH), SHIP_STERN_Z - SHIP_LENGTH + 0.4],
      [SHIP_CENTER_X, bulwarkTopAt(SHIP_LENGTH) + 3.4, SHIP_STERN_Z - SHIP_LENGTH - 0.3],
      0.03,
      5,
    ),
  ),
    lamps.add(
      makeBeaconGeo(
        SHIP_CENTER_X,
        bulwarkTopAt(SHIP_LENGTH) + 0.6,
        SHIP_STERN_Z - SHIP_LENGTH - 0.1,
        0.1,
      ),
      [4, 3.7, 3],
      0,
    ));
  {
    let $ = newVec3(32.55, 13, -51.5),
      ue = newVec3(31.4, 1.25, -38.5);
    for (let me of [-0.4, 0.4])
      (addGeom(
        galvMat,
        beamBetween([$.x + me, $.y - 0.1, $.z], [ue.x + me, ue.y - 0.1, ue.z], 0.05, 0.3),
      ),
        addGeom(
          galvMat,
          strutBetween([$.x + me, $.y + 1, $.z], [ue.x + me, ue.y + 1, ue.z], 0.025, 5),
        ),
        addGeom(
          galvMat,
          strutBetween([$.x + me, $.y + 0.5, $.z], [ue.x + me, ue.y + 0.5, ue.z], 0.02, 4),
        ));
    for (let me = 0; me <= 8; me++) {
      let ee = $.clone().lerp(ue, me / 8);
      for (let B of [-0.4, 0.4])
        addGeom(
          galvMat,
          strutBetween([ee.x + B, ee.y - 0.1, ee.z], [ee.x + B, ee.y + 1, ee.z], 0.02, 4),
        );
    }
    for (let me = 1; me < 44; me++) {
      let ee = $.clone().lerp(ue, me / 44);
      addGeom(
        galvMat,
        boxFromBounds(ee.x - 0.38, ee.y - 0.02, ee.z - 0.12, ee.x + 0.38, ee.y, ee.z + 0.12),
      );
    }
    (addGeom(galvMat, boxFromBounds(31, 1.15, -38.5, 32, 1.2, -37.3)),
      addGeom(galvMat, beamBetween([31.2, 1.2, -37.9], [29.2, 0.12, -37.9], 0.8, 0.06)),
      addRailing(
        batcher,
        galvMat,
        [
          [31, 1.2, -37.32],
          [32, 1.2, -37.32],
          [32, 1.2, -38.5],
        ],
        {
          post: 1.1,
        },
      ),
      addGeom(
        darkSteelMat,
        strutBetween([$.x, $.y + 3.2, $.z + 4], [ue.x, ue.y + 1.2, ue.z + 0.3], 0.014, 4),
      ),
      addGeom(darkSteelMat, beamBetween([33.2, 13.2, $.z + 4], [32.2, 16.4, $.z + 4], 0.14, 0.14)));
  }
  let addMooringLine = ($, ue, me, ee) => {
    let B = hullPoint($, ue, -1);
    ((B.x -= 0.1), addGeom(ropeMat, strutsAlongPath(catenaryPoints(B, me, ee, 12), 0.042, 5)));
    let P = catenaryPoints(B, me, ee, 12)[3],
      V = catenaryPoints(B, me, ee, 12)[4].clone().sub(P).normalize(),
      Y = cylinderFromAxis(0.42, 0.42, 0.012, 'y', 0, 0, 0, 12);
    (Y.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(newVec3(0, 1, 0), V)),
      Y.translate(P.x, P.y, P.z),
      addGeom(galvMat, Y),
      addGeom(
        darkSteelMat,
        boxFromBounds(B.x - 0.12, B.y - 0.28, B.z - 0.35, B.x + 0.12, B.y + 0.28, B.z + 0.35, 0.05),
      ));
  };
  (addMooringLine(4.4, deckHeightAt(4.4) + 0.55, newVec3(29.2, 0.5, -12), 1.3),
    addMooringLine(4.9, deckHeightAt(4.9) + 0.55, newVec3(29.2, 0.36, -12.1), 1.7),
    addMooringLine(1.6, deckHeightAt(1.6) + 0.6, newVec3(29.2, 0.5, -2), 1.6),
    addMooringLine(2.2, deckHeightAt(2.2) + 0.6, newVec3(29.2, 0.36, -2.1), 2.2),
    addMooringLine(
      SHIP_LENGTH - 5,
      deckHeightAt(SHIP_LENGTH - 5) + 0.6,
      newVec3(29.2, 0.5, -82),
      1.6,
    ),
    addMooringLine(
      SHIP_LENGTH - 9,
      deckHeightAt(SHIP_LENGTH - 9) + 0.6,
      newVec3(29.2, 0.45, -58),
      1.2,
    ));
  for (let $ of [-82, -58])
    (addGeom(darkSteelMat, cylinderFromAxis(0.2, 0.26, 0.55, 'y', 29.2, 0.27, $, 10)),
      addGeom(darkSteelMat, cylinderFromAxis(0.34, 0.3, 0.14, 'y', 29.2, 0.6, $, 10)));
  for (let $ of [-17.6, -37, -54])
    (addGeom(
      rubberMat,
      cylinderFromAxis(1.25, 1.25, 2.2, 'z', 31.55, SHIP_WATERLINE_Y + 0.35, $, 14),
    ),
      addGeom(
        rubberMat,
        cylinderFromAxis(0.45, 1.25, 0.5, 'z', 31.55, SHIP_WATERLINE_Y + 0.35, $ + 1.35, 14),
      ),
      addGeom(
        rubberMat,
        cylinderFromAxis(1.25, 0.45, 0.5, 'z', 31.55, SHIP_WATERLINE_Y + 0.35, $ - 1.35, 14),
      ),
      addGeom(
        ropeMat,
        strutBetween([31.55, SHIP_WATERLINE_Y + 1.6, $], [29.9, 0.1, $ + 0.6], 0.03, 4),
      ));
  let hullMesh = batcher.build({
    cast: !0,
    recv: !0,
  });
  hullMesh.name = 'ship';
  let radarBatch = new MeshBatcher();
  (radarBatch.add(whiteMat, boxFromBounds(-1.25, -0.07, -0.1, 1.25, 0.07, 0.1, 0.02), whiteTint),
    radarBatch.add(whiteMat, cylinderFromAxis(0.1, 0.12, 0.25, 'y', 0, -0.18, 0, 8), whiteTint));
  let radarMesh = radarBatch.build({
    cast: !1,
  });
  (radarMesh.position.set(mastPos.x, mastPos.y + 3.62, mastPos.z + 0.8),
    (radarMesh.userData.noMerge = !0),
    hullMesh.add(radarMesh));
  let colliders = [
    {
      min: [33, -5, SHIP_STERN_Z - SHIP_LENGTH],
      max: [49, 15, -17.5],
    },
    {
      min: [34.9, -5, -17.5],
      max: [47.1, 15.5, -13],
    },
    {
      min: [37.7, -5, -13],
      max: [44.3, 16, -9.3],
    },
    {
      min: [SHIP_CENTER_X - 7.2, 13, hatchZ1],
      max: [SHIP_CENTER_X + 7.2, 24.4, hatchZ0],
    },
  ];
  return {
    root: hullMesh,
    radar: radarMesh,
    colliders: colliders,
    tris: batcher.tris,
    name: 'KITTIWAKE',
  };
}

/**
 * 搭建岸桥旁系泊的橙色小工作艇：CatmullRom 曲线放样的船壳管体、护舷环、折角船底多边形、舷外机、探照灯与驾驶台；整船 noMerge 以便单独摇摆
 */
export function buildMooringBoat(ctx, lamps) {
  let batcher = new MeshBatcher(),
    plasticMat = getTintedMaterial(ctx, 'plastic_grey'),
    orangePaintMat = getTintedMaterial(ctx, 'paint_orange'),
    blackPolymerMat = ctx.mats.get('polymer_black'),
    galvMat = ctx.mats.get('steel_galv'),
    glassMat = ctx.mats.get('glass'),
    addGeom = (U, T, D) => batcher.add(U, T, D),
    hullTint = [2, 2.02, 2.08],
    seamTint = [0.5, 0.5, 0.52],
    darkTint = [1.9, 1.7, 1.2],
    hullProfile = [
      [-3.35, 0.5, 1.03],
      [-1.6, 0.5, 1.06],
      [0.5, 0.52, 1.05],
      [1.8, 0.58, 0.93],
      [2.75, 0.68, 0.6],
      [3.3, 0.78, 0.22],
    ],
    hullPath = [
      ...hullProfile.map((U) => newVec3(U[0], U[1], U[2])),
      newVec3(3.43, 0.8, 0),
      ...hullProfile
        .slice()
        .reverse()
        .map((U) => newVec3(U[0], U[1], -U[2])),
    ],
    hullCurve = new THREE.CatmullRomCurve3(hullPath, !1, 'centripetal'),
    hullTube = new THREE.TubeGeometry(hullCurve, 60, 0.27, 12, !1);
  {
    let U = hullTube.attributes.uv,
      T = hullCurve.getLength();
    for (let D = 0; D < U.count; D++) U.setXY(D, U.getX(D) * T, U.getY(D) * 1.7);
  }
  addGeom(plasticMat, hullTube, hullTint);
  for (let U of [-1, 1])
    addGeom(
      plasticMat,
      cylinderFromAxis(0.07, 0.27, 0.42, 'x', -3.56, 0.5, U * 1.03, 12),
      hullTint,
    );
  let ringCount = 11,
    rubRails = [];
  for (let U = 0; U < ringCount; U++) {
    let T = 0.04 + (0.92 * U) / (ringCount - 1),
      D = hullCurve.getPointAt(T),
      C = hullCurve.getTangentAt(T),
      G = new THREE.TorusGeometry(0.276, 0.016, 5, 14);
    (G.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(newVec3(0, 0, 1), C)),
      G.translate(D.x, D.y, D.z),
      addGeom(plasticMat, G, seamTint));
    let j = newVec3(D.x, 0, D.z)
      .sub(newVec3(Math.min(D.x, 2.2), 0, 0))
      .normalize();
    rubRails.push(
      D.clone()
        .addScaledVector(j, 0.2)
        .add(newVec3(0, 0.2, 0)),
    );
  }
  for (let U = 0; U < ringCount - 1; U++)
    addGeom(
      plasticMat,
      strutsAlongPath(catenaryPoints(rubRails[U], rubRails[U + 1], 0.1, 4), 0.012, 4),
      darkTint,
    );
  let gunwaleStations = [-3.4, -2, -0.5, 1, 2, 2.8, 3.3],
    gunwaleHalfWidths = [0.9, 0.93, 0.93, 0.85, 0.62, 0.34, 0.08],
    gunwaleHeights = [0.22, 0.22, 0.24, 0.3, 0.42, 0.56, 0.7],
    gunwaleBases = [-0.3, -0.32, -0.33, -0.3, -0.15, 0.15, 0.62],
    deckTris = [],
    pushTri = (U, T, D) => {
      let C = T.clone().sub(U).cross(D.clone().sub(U)),
        G = U.clone()
          .add(T)
          .add(D)
          .multiplyScalar(1 / 3),
        j = newVec3(0, G.y - 0.45, G.z);
      (Math.abs(G.x) > 3.39 && j.set(G.x, 0, 0),
        C.dot(j) < 0
          ? deckTris.push(U.x, U.y, U.z, D.x, D.y, D.z, T.x, T.y, T.z)
          : deckTris.push(U.x, U.y, U.z, T.x, T.y, T.z, D.x, D.y, D.z));
    };
  for (let U of [-1, 1]) {
    for (let T = 0; T < gunwaleStations.length - 1; T++) {
      let D = newVec3(gunwaleStations[T], gunwaleBases[T], 0),
        C = newVec3(gunwaleStations[T + 1], gunwaleBases[T + 1], 0),
        G = newVec3(gunwaleStations[T], gunwaleHeights[T], U * gunwaleHalfWidths[T]),
        j = newVec3(gunwaleStations[T + 1], gunwaleHeights[T + 1], U * gunwaleHalfWidths[T + 1]),
        gunwaleFlareCur = newVec3(
          gunwaleStations[T],
          0.5 + Math.max(0, gunwaleHeights[T] - 0.22) * 0.6,
          U * (gunwaleHalfWidths[T] + 0.1),
        ),
        gunwaleFlareNext = newVec3(
          gunwaleStations[T + 1],
          0.5 + Math.max(0, gunwaleHeights[T + 1] - 0.22) * 0.6,
          U * (gunwaleHalfWidths[T + 1] + 0.1),
        );
      (pushTri(D, C, j),
        pushTri(D, j, G),
        pushTri(G, j, gunwaleFlareNext),
        pushTri(G, gunwaleFlareNext, gunwaleFlareCur));
    }
    (pushTri(
      newVec3(-3.4, gunwaleBases[0], 0),
      newVec3(-3.4, gunwaleHeights[0], U * gunwaleHalfWidths[0]),
      newVec3(-3.4, 0.78, U * (gunwaleHalfWidths[0] + 0.1)),
    ),
      pushTri(
        newVec3(-3.4, gunwaleBases[0], 0),
        newVec3(-3.4, 0.78, U * (gunwaleHalfWidths[0] + 0.1)),
        newVec3(-3.4, 0.78, 0),
      ));
  }
  let deckGeo = new THREE.BufferGeometry();
  (deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckTris, 3)),
    deckGeo.computeVertexNormals(),
    addGeom(blackPolymerMat, deckGeo),
    addGeom(plasticMat, boxFromBounds(-3.38, 0.2, -0.86, 2.1, 0.26, 0.86), seamTint),
    addGeom(plasticMat, boxFromBounds(2, 0.26, -0.62, 2.85, 0.56, 0.62, 0.05), seamTint),
    addGeom(blackPolymerMat, boxFromBounds(-3.46, 0.1, -0.92, -3.34, 0.8, 0.92, 0.02)),
    addGeom(galvMat, strutBetween([3.2, 0.95, -0.12], [3.2, 0.95, 0.12], 0.02, 5)),
    addGeom(galvMat, strutBetween([3.2, 0.8, 0], [3.2, 0.95, 0], 0.018, 5)),
    addGeom(orangePaintMat, boxFromBounds(0.3, 0.26, -0.4, 1, 1.12, 0.4, 0.05), [1, 0.9, 0.85]),
    addGeom(blackPolymerMat, beamBetween([0.28, 1.14, 0], [0.86, 1.3, 0], 0.76, 0.05)));
  let windshieldGeo = boxFromBounds(-0.012, 0, -0.42, 0.012, 0.5, 0.42);
  (windshieldGeo.rotateZ(0.42),
    windshieldGeo.translate(0.95, 1.2, 0),
    addGeom(glassMat, windshieldGeo));
  for (let U of [-0.43, 0.43])
    addGeom(
      galvMat,
      strutBetween(
        [0.95, 1.2, U],
        [0.95 - Math.sin(0.42) * 0.52, 1.2 + Math.cos(0.42) * 0.52, U],
        0.016,
        5,
      ),
    );
  addGeom(
    galvMat,
    strutBetween(
      [0.95 - Math.sin(0.42) * 0.52, 1.2 + Math.cos(0.42) * 0.52, -0.43],
      [0.95 - Math.sin(0.42) * 0.52, 1.2 + Math.cos(0.42) * 0.52, 0.43],
      0.016,
      5,
    ),
  );
  let searchLightTorus = new THREE.TorusGeometry(0.18, 0.017, 6, 18);
  (searchLightTorus.rotateY(Math.PI / 2),
    searchLightTorus.rotateZ(-0.5),
    searchLightTorus.translate(0.2, 1.12, -0.12),
    addGeom(blackPolymerMat, searchLightTorus),
    addGeom(galvMat, strutBetween([0.2, 1.12, -0.12], [0.36, 1.03, -0.12], 0.02, 5)));
  for (let U of [0, 2.1, 4.2])
    addGeom(
      galvMat,
      strutBetween(
        [0.2, 1.12, -0.12],
        [
          0.2 + Math.sin(-0.5) * Math.cos(U) * -0.17,
          1.12 + Math.cos(-0.5) * Math.cos(U) * 0.17,
          -0.12 + Math.sin(U) * 0.17,
        ],
        0.01,
        4,
      ),
    );
  (addGeom(blackPolymerMat, boxFromBounds(0.34, 1.16, 0.16, 0.5, 1.34, 0.3, 0.02)),
    addGeom(galvMat, strutBetween([0.42, 1.34, 0.23], [0.36, 1.48, 0.23], 0.012, 4)),
    addGeom(galvMat, strutBetween([0.35, 0.3, -0.46], [0.35, 1, -0.46], 0.02, 5)),
    addGeom(galvMat, strutBetween([0.35, 1, -0.46], [0.95, 1, -0.46], 0.02, 5)),
    addGeom(galvMat, strutBetween([0.35, 0.3, 0.46], [0.35, 1, 0.46], 0.02, 5)),
    addGeom(galvMat, strutBetween([0.35, 1, 0.46], [0.95, 1, 0.46], 0.02, 5)));
  for (let U of [-0.75, -1.75])
    (addGeom(
      orangePaintMat,
      boxFromBounds(U - 0.28, 0.26, -0.2, U + 0.28, 0.82, 0.2, 0.05),
      [1, 0.9, 0.85],
    ),
      addGeom(blackPolymerMat, boxFromBounds(U - 0.3, 0.82, -0.22, U + 0.3, 0.93, 0.22, 0.04)),
      addGeom(blackPolymerMat, boxFromBounds(U - 0.34, 0.93, -0.2, U - 0.26, 1.2, 0.2, 0.03)),
      addGeom(galvMat, strutBetween([U + 0.3, 0.6, -0.22], [U + 0.3, 1.02, 0], 0.014, 4)),
      addGeom(galvMat, strutBetween([U + 0.3, 0.6, 0.22], [U + 0.3, 1.02, 0], 0.014, 4)));
  addGeom(orangePaintMat, boxFromBounds(-2.9, 0.26, -0.3, -2.45, 0.58, 0.3, 0.04), [1.1, 0.5, 0.4]);
  for (let U of [-1, 1])
    (addGeom(galvMat, strutBetween([-2.95, 0.55, U * 0.9], [-2.75, 2, U * 0.55], 0.03, 6)),
      addGeom(galvMat, strutBetween([-2.3, 0.55, U * 0.9], [-2.75, 1.3, U * 0.7], 0.022, 5)));
  (addGeom(galvMat, strutBetween([-2.75, 2, -0.55], [-2.75, 2, 0.55], 0.03, 6)),
    addGeom(galvMat, boxFromBounds(-2.88, 2, -0.2, -2.62, 2.04, 0.2)),
    addGeom(blackPolymerMat, cylinderFromAxis(0.05, 0.06, 0.1, 'y', -2.75, 2.09, 0, 8)),
    addGeom(blackPolymerMat, strutBetween([-2.75, 2, 0.42], [-2.9, 3.7, 0.46], 0.011, 5)),
    addGeom(blackPolymerMat, cylinderFromAxis(0.16, 0.16, 0.07, 'y', -2.75, 2.1, -0.36, 10)));
  for (let U of [-0.36, 0.36])
    (addGeom(galvMat, boxFromBounds(-3.6, 0.42, U - 0.16, -3.44, 0.78, U + 0.16, 0.02)),
      addGeom(blackPolymerMat, boxFromBounds(-4.1, 0.78, U - 0.23, -3.48, 1.4, U + 0.23, 0.09)),
      addGeom(
        plasticMat,
        boxFromBounds(-4.11, 1, U - 0.235, -3.47, 1.05, U + 0.235),
        [1.4, 1.4, 1.4],
      ),
      addGeom(blackPolymerMat, boxFromBounds(-3.92, -0.05, U - 0.085, -3.62, 0.8, U + 0.085, 0.03)),
      addGeom(blackPolymerMat, boxFromBounds(-4.02, -0.52, U - 0.04, -3.6, -0.05, U + 0.04, 0.015)),
      addGeom(blackPolymerMat, cylinderFromAxis(0.07, 0.03, 0.42, 'x', -3.9, -0.3, U, 8)));
  for (let U of [-1.8, 0.4, 1.7])
    (addGeom(
      orangePaintMat,
      cylinderFromAxis(0.11, 0.11, 0.42, 'y', U, 0.42, 1.36, 10),
      [1.2, 0.8, 0.7],
    ),
      addGeom(plasticMat, strutBetween([U, 0.63, 1.36], [U, 0.78, 1.12], 0.01, 4), darkTint));
  let wheelTorus = new THREE.TorusGeometry(0.26, 0.07, 6, 16);
  (wheelTorus.rotateY(Math.PI / 2),
    wheelTorus.translate(1.02, 0.72, 0),
    addGeom(orangePaintMat, wheelTorus, [1.3, 0.6, 0.45]));
  let hullMesh = batcher.build({
    cast: !0,
    recv: !0,
  });
  (lamps.add(makeBeaconGeo(-2.75, 2.2, 0, 0.075), [1.2, 11, 3.2], 1.5, 0, 0.1),
    lamps.add(makeBeaconGeo(-2.75, 2.2, 0, 0.074), [1.2, 11, 3.2], 1.5, 0.2, 0.08));
  let lampMesh = lamps.build();
  lampMesh && ((lampMesh.frustumCulled = !1), hullMesh.add(lampMesh));
  let boatGroup = new THREE.Group();
  return (
    (boatGroup.name = 'boat'),
    boatGroup.add(hullMesh),
    (boatGroup.userData.noMerge = !0),
    {
      root: boatGroup,
      hullGrp: hullMesh,
      tris: batcher.tris,
    }
  );
}
