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
  for (let sideSign = 23; sideSign < SHIP_LENGTH - 0.5; sideSign += 3) stations.push(sideSign);
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
  for (let sideSign of [-1, 1])
    for (let stationIndex = 0; stationIndex < stations.length - 1; stationIndex++) {
      let stationPos = stations[stationIndex],
        nextStationPos = stations[stationIndex + 1],
        profileAtStation = profileAt(stationPos),
        profileAtNextStation = profileAt(nextStationPos);
      for (let rowIndex = 0; rowIndex < heightSegs; rowIndex++) {
        if (
          rowIndex === heightSegs - 1 &&
          bulwarkHeightAt(stationPos) < 0.02 &&
          bulwarkHeightAt(nextStationPos) < 0.02
        )
          continue;
        let panelBrightness =
            (rowIndex < bootRows ? 0.8 : 0.58) +
            0.36 * hash2(stationIndex * 7 + (sideSign > 0 ? 100 : 0), rowIndex),
          quadCorners = [
            hullPoint(stationPos, profileAtStation[rowIndex], sideSign),
            hullPoint(nextStationPos, profileAtNextStation[rowIndex], sideSign),
            hullPoint(nextStationPos, profileAtNextStation[rowIndex + 1], sideSign),
            hullPoint(stationPos, profileAtStation[rowIndex + 1], sideSign),
          ],
          quadNormals = [
            hullNormal(stationPos, profileAtStation[rowIndex], sideSign),
            hullNormal(nextStationPos, profileAtNextStation[rowIndex], sideSign),
            hullNormal(nextStationPos, profileAtNextStation[rowIndex + 1], sideSign),
            hullNormal(stationPos, profileAtStation[rowIndex + 1], sideSign),
          ],
          quadUvs = [
            [stationPos, profileAtStation[rowIndex]],
            [nextStationPos, profileAtNextStation[rowIndex]],
            [nextStationPos, profileAtNextStation[rowIndex + 1]],
            [stationPos, profileAtStation[rowIndex + 1]],
          ],
          quadTint = [
            tintFor(quadCorners[0], rowIndex, !1, panelBrightness),
            tintFor(quadCorners[1], rowIndex, !1, panelBrightness),
            tintFor(quadCorners[2], rowIndex, !0, panelBrightness),
            tintFor(quadCorners[3], rowIndex, !0, panelBrightness),
          ];
        if (stationPos > 1.5 && rowIndex >= 2 && rowIndex < heightSegs - 1) {
          let quadCenter = quadCorners[0]
            .clone()
            .add(quadCorners[1])
            .add(quadCorners[2])
            .add(quadCorners[3])
            .multiplyScalar(0.25);
          for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++)
            quadNormals[cornerIndex]
              .addScaledVector(quadCenter.clone().sub(quadCorners[cornerIndex]).normalize(), 0.075)
              .normalize();
        }
        (rowIndex < bootRows ? bottomBuilder : hullBuilder).quad(
          quadCorners,
          quadNormals,
          quadUvs,
          quadTint,
        );
      }
    }
  {
    let sideSign = profileAt(0),
      stationIndex = profileAt(SHIP_LENGTH),
      stationPos = newVec3(0, 0.2, 1).normalize(),
      nextStationPos = newVec3(0, 0, -1),
      profileAtStation = newVec3(0, 1, 0);
    for (let profileAtNextStation = 0; profileAtNextStation < heightSegs; profileAtNextStation++) {
      let rowIndex = profileAtNextStation < bootRows ? [0.8, 0.8, 0.8] : [0.9, 0.9, 0.9];
      ((profileAtNextStation < bootRows ? bottomBuilder : hullBuilder).quad(
        [
          hullPoint(0, sideSign[profileAtNextStation], -1),
          hullPoint(0, sideSign[profileAtNextStation], 1),
          hullPoint(0, sideSign[profileAtNextStation + 1], 1),
          hullPoint(0, sideSign[profileAtNextStation + 1], -1),
        ],
        [stationPos, stationPos, stationPos, stationPos],
        [
          [0, sideSign[profileAtNextStation]],
          [0.4, sideSign[profileAtNextStation]],
          [0.4, sideSign[profileAtNextStation + 1]],
          [0, sideSign[profileAtNextStation + 1]],
        ],
        [rowIndex, rowIndex, rowIndex, rowIndex],
      ),
        (profileAtNextStation < bootRows ? bottomBuilder : hullBuilder).quad(
          [
            hullPoint(SHIP_LENGTH, stationIndex[profileAtNextStation], -1),
            hullPoint(SHIP_LENGTH, stationIndex[profileAtNextStation], 1),
            hullPoint(SHIP_LENGTH, stationIndex[profileAtNextStation + 1], 1),
            hullPoint(SHIP_LENGTH, stationIndex[profileAtNextStation + 1], -1),
          ],
          [nextStationPos, nextStationPos, nextStationPos, nextStationPos],
          [
            [0, stationIndex[profileAtNextStation]],
            [14, stationIndex[profileAtNextStation]],
            [14, stationIndex[profileAtNextStation + 1]],
            [0, stationIndex[profileAtNextStation + 1]],
          ],
          [rowIndex, rowIndex, rowIndex, rowIndex],
        ));
    }
    for (
      let profileAtNextStation = 0;
      profileAtNextStation < stations.length - 1;
      profileAtNextStation++
    ) {
      let rowIndex = hullPoint(
          stations[profileAtNextStation],
          deckHeightAt(stations[profileAtNextStation]),
          -1,
        ),
        panelBrightness = hullPoint(
          stations[profileAtNextStation],
          deckHeightAt(stations[profileAtNextStation]),
          1,
        ),
        quadCorners = hullPoint(
          stations[profileAtNextStation + 1],
          deckHeightAt(stations[profileAtNextStation + 1]),
          1,
        ),
        quadNormals = hullPoint(
          stations[profileAtNextStation + 1],
          deckHeightAt(stations[profileAtNextStation + 1]),
          -1,
        ),
        quadUvs = [0.75, 0.72, 0.7];
      bottomBuilder.quad(
        [rowIndex, panelBrightness, quadCorners, quadNormals],
        [profileAtStation, profileAtStation, profileAtStation, profileAtStation],
        [
          [rowIndex.x, rowIndex.z],
          [panelBrightness.x, panelBrightness.z],
          [quadCorners.x, quadCorners.z],
          [quadNormals.x, quadNormals.z],
        ],
        [quadUvs, quadUvs, quadUvs, quadUvs],
      );
    }
  }
  (addGeom(hullRedMat, bottomBuilder.geo()), addGeom(hullPaintMat, hullBuilder.geo()));
  {
    let sideSign = (me, ee) => hullPoint(me, ee, -1).addScaledVector(hullNormal(me, ee, -1), 0.012),
      stationIndex = [1.05, 0.92, 0.8];
    for (let stationPos = 2; stationPos < stations.length - 1; stationPos++) {
      let nextStationPos = profileAt(stations[stationPos]),
        profileAtStation = profileAt(stations[stationPos + 1]);
      for (let profileAtNextStation = 4; profileAtNextStation <= 9; profileAtNextStation++)
        addGeom(
          hullPaintMat,
          beamBetween(
            sideSign(stations[stationPos], nextStationPos[profileAtNextStation]),
            sideSign(stations[stationPos + 1], profileAtStation[profileAtNextStation]),
            0.03,
            0.045,
          ),
          stationIndex,
        );
      for (let profileAtNextStation = 3; profileAtNextStation < 9; profileAtNextStation++)
        (stationPos + profileAtNextStation) % 2 === 0 &&
          addGeom(
            hullPaintMat,
            beamBetween(
              sideSign(stations[stationPos], nextStationPos[profileAtNextStation]),
              sideSign(stations[stationPos], nextStationPos[profileAtNextStation + 1]),
              0.035,
              0.03,
            ),
            stationIndex,
          );
    }
  }
  for (let sideSign of [-1, 1]) {
    for (let panelBrightness = 3; panelBrightness < stations.length - 1; panelBrightness++) {
      let quadCorners = (Z, J) =>
        hullPoint(Z, J, sideSign).addScaledVector(hullNormal(Z, J, sideSign), 0.07);
      (addGeom(
        hullPaintMat,
        beamBetween(
          quadCorners(stations[panelBrightness], 9.6),
          quadCorners(stations[panelBrightness + 1], 9.6),
          0.16,
          0.3,
        ),
        [0.55, 0.55, 0.55],
      ),
        bulwarkHeightAt(stations[panelBrightness]) > 0.6 &&
          bulwarkHeightAt(stations[panelBrightness + 1]) > 0.6 &&
          addGeom(
            darkSteelMat,
            strutBetween(
              hullPoint(
                stations[panelBrightness],
                bulwarkTopAt(stations[panelBrightness]),
                sideSign,
              ),
              hullPoint(
                stations[panelBrightness + 1],
                bulwarkTopAt(stations[panelBrightness + 1]),
                sideSign,
              ),
              0.07,
              6,
            ),
          ));
    }
    for (let panelBrightness = 0; panelBrightness < 3; panelBrightness++)
      addGeom(
        darkSteelMat,
        strutBetween(
          hullPoint(stations[panelBrightness], bulwarkTopAt(stations[panelBrightness]), sideSign),
          hullPoint(
            stations[panelBrightness + 1],
            bulwarkTopAt(stations[panelBrightness + 1]),
            sideSign,
          ),
          0.07,
          6,
        ),
      );
    let stationIndex = [];
    for (let panelBrightness = 18; panelBrightness <= SHIP_LENGTH - 10.4; panelBrightness += 3)
      stationIndex.push(
        hullPoint(panelBrightness, deckHeightAt(panelBrightness), sideSign).add(
          newVec3(-sideSign * 0.12, 0, 0),
        ),
      );
    addRailing(batcher, darkSteelMat, stationIndex, {
      h: 1.05,
      post: 1.5,
      r: 0.028,
    });
    let stationPos = 4.6,
      nextStationPos = deckHeightAt(stationPos) - 2.3,
      profileAtStation = hullPoint(stationPos, nextStationPos, sideSign),
      profileAtNextStation = hullNormal(stationPos, nextStationPos, sideSign);
    addGeom(
      darkSteelMat,
      strutBetween(
        profileAtStation.clone().addScaledVector(profileAtNextStation, -0.3),
        profileAtStation.clone().addScaledVector(profileAtNextStation, 0.22),
        0.5,
        12,
        !0,
      ),
    );
    let rowIndex = (Y, L, Z) =>
      hullPoint(Y, L, sideSign).addScaledVector(hullNormal(Y, L, sideSign), Z);
    (addGeom(
      darkSteelMat,
      beamBetween(
        rowIndex(stationPos, nextStationPos - 0.1, 0.34),
        rowIndex(stationPos, nextStationPos - 2.3, 0.3),
        0.22,
        0.22,
        0.03,
      ),
    ),
      addGeom(
        darkSteelMat,
        beamBetween(
          rowIndex(stationPos - 0.95, nextStationPos - 2.45, 0.34),
          rowIndex(stationPos + 0.95, nextStationPos - 2.45, 0.34),
          0.42,
          0.42,
          0.05,
        ),
      ));
    for (let panelBrightness of [-0.8, 0.8])
      addGeom(
        darkSteelMat,
        beamBetween(
          rowIndex(stationPos + panelBrightness, nextStationPos - 2.4, 0.3),
          rowIndex(stationPos + panelBrightness * 1.1, nextStationPos - 1.1, 0.34),
          0.5,
          0.12,
          0.02,
        ),
      );
  }
  let nameLabel = ctx.mats.label('KITTIWAKE', {
    color: 'white',
    font: 'sans',
    distress: 0.3,
  });
  {
    let stationIndex = Math.min(12, 1.7 * Math.max(2, nameLabel.aspect || 6));
    (addGeom(
      nameLabel.material,
      hullPatchGeo(7.6, 7.6 + stationIndex, 10.25, 10.25 + 1.7, -1, 0.014, 10, 1),
    ),
      addGeom(
        nameLabel.material,
        hullPatchGeo(7.6, 7.6 + stationIndex, 10.25, 10.25 + 1.7, 1, 0.014, 10, 1),
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
  for (let sideSign = 21.5; sideSign < SHIP_LENGTH - 11; sideSign += 5.5) {
    let stationIndex = hullPoint(sideSign, SHIP_DECK_Y - 0.45, -1);
    addGeom(
      darkSteelMat,
      boxFromBounds(
        stationIndex.x - 0.04,
        stationIndex.y - 0.09,
        stationIndex.z - 0.3,
        stationIndex.x + 0.01,
        stationIndex.y + 0.09,
        stationIndex.z + 0.3,
      ),
    );
    let stationPos = 2.6 + 3.2 * hash2(Math.round(sideSign * 10), 5);
    addGeom(
      rustDecal.material,
      hullPatchGeo(
        sideSign - 0.45,
        sideSign + 0.45,
        SHIP_DECK_Y - 0.5 - stationPos,
        SHIP_DECK_Y - 0.5,
        -1,
        0.012,
        1,
        1,
      ),
    );
  }
  for (let sideSign of [6.4, SHIP_LENGTH - 7])
    for (let stationIndex = 0; stationIndex < 9; stationIndex++) {
      let stationPos = 1.6 + stationIndex * 0.62;
      addGeom(
        whiteMat,
        hullPatchGeo(
          sideSign,
          sideSign + (stationIndex % 2 ? 0.28 : 0.5),
          stationPos,
          stationPos + 0.13,
          -1,
          0.01,
          1,
          1,
        ),
        [1.1, 1.1, 1.05],
      );
    }
  (addGeom(whiteMat, hullPatchGeo(33, 33.9, 3.2, 3.3, -1, 0.01, 1, 1), [1.1, 1.1, 1.05]),
    addGeom(whiteMat, hullPatchGeo(33.4, 33.5, 2.4, 4.1, -1, 0.01, 1, 1), [1.1, 1.1, 1.05]));
  let bowDeckY = deckHeightAt(7);
  for (let sideSign of [-1, 1]) {
    (addGeom(
      darkSteelMat,
      cylinderFromAxis(
        0.55,
        0.55,
        0.9,
        'x',
        SHIP_CENTER_X + sideSign * 1.5,
        bowDeckY + 0.75,
        SHIP_STERN_Z - 6.2,
        12,
      ),
    ),
      addGeom(
        darkSteelMat,
        boxFromBounds(
          SHIP_CENTER_X + sideSign * 0.5,
          bowDeckY,
          SHIP_STERN_Z - 6.9,
          SHIP_CENTER_X + sideSign * 2.6,
          bowDeckY + 0.5,
          SHIP_STERN_Z - 5.5,
          0.04,
        ),
      ));
    for (let stationIndex of [0, 0.7])
      addGeom(
        darkSteelMat,
        cylinderFromAxis(
          0.16,
          0.16,
          0.7,
          'y',
          SHIP_CENTER_X + sideSign * 4.2,
          bowDeckY + 0.35,
          SHIP_STERN_Z - 8.5 - stationIndex,
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
  for (let sideSign of [-1, 1])
    (addGeom(
      darkSteelMat,
      strutBetween(
        [SHIP_CENTER_X + sideSign * 2.5, bowDeckY + 10.2, foremastZ],
        [SHIP_CENTER_X + sideSign * 5.6, bowDeckY + 0.6, foremastZ - 1.2],
        0.022,
        4,
      ),
    ),
      addGeom(
        darkSteelMat,
        strutBetween(
          [SHIP_CENTER_X + sideSign * 2.5, bowDeckY + 10.2, foremastZ],
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
  ].forEach(([sideSign, stationIndex], stationPos) => {
    addGeom(
      hullRedMat,
      boxFromBounds(
        SHIP_CENTER_X - 7.7,
        SHIP_DECK_Y,
        sideSign - stationIndex / 2 - 0.2,
        SHIP_CENTER_X + 7.7,
        SHIP_DECK_Y + 0.42,
        sideSign + stationIndex / 2 + 0.2,
        0.04,
      ),
      [0.6, 0.6, 0.62],
    );
    for (let nextStationPos = 0; nextStationPos < 6; nextStationPos++) {
      let profileAtStation = SHIP_CENTER_X + (nextStationPos - 2.5) * 2.52,
        profileAtNextStation =
          stationPos === 2 ? 2 : 2 + (hash2(nextStationPos * 3 + stationPos, 9) > 0.4 ? 1 : 0);
      for (let rowIndex = 0; rowIndex < profileAtNextStation; rowIndex++) {
        let panelBrightness = SHIP_DECK_Y + 0.44 + rowIndex * 2.61,
          quadCorners =
            containerTints[
              Math.floor(
                hash2(nextStationPos * 5 + rowIndex * 13 + stationPos * 29, 2) *
                  containerTints.length,
              )
            ];
        if (
          (addGeom(
            whiteMat,
            boxFromBounds(
              profileAtStation - 1.22,
              panelBrightness,
              sideSign - stationIndex / 2,
              profileAtStation + 1.22,
              panelBrightness + 2.59,
              sideSign + stationIndex / 2,
              0.035,
            ),
            quadCorners,
          ),
          nextStationPos === 0)
        )
          for (
            let quadNormals = sideSign - stationIndex / 2 + 0.5;
            quadNormals < sideSign + stationIndex / 2 - 0.3;
            quadNormals += 0.58
          )
            addGeom(
              whiteMat,
              boxFromBounds(
                profileAtStation - 1.24,
                panelBrightness + 0.15,
                quadNormals - 0.1,
                profileAtStation - 1.21,
                panelBrightness + 2.45,
                quadNormals + 0.1,
              ),
              quadCorners,
            );
      }
    }
    for (let nextStationPos of [
      sideSign - stationIndex / 2 - 0.45,
      sideSign + stationIndex / 2 + 0.45,
    ]) {
      for (let profileAtStation = 0; profileAtStation <= 6; profileAtStation++)
        addGeom(
          darkSteelMat,
          boxFromBounds(
            SHIP_CENTER_X + (profileAtStation - 3) * 2.52 - 0.05,
            SHIP_DECK_Y,
            nextStationPos - 0.05,
            SHIP_CENTER_X + (profileAtStation - 3) * 2.52 + 0.05,
            SHIP_DECK_Y + 5.6,
            nextStationPos + 0.05,
          ),
        );
      for (let profileAtStation of [SHIP_DECK_Y + 2.9, SHIP_DECK_Y + 5.6])
        addGeom(
          darkSteelMat,
          boxFromBounds(
            SHIP_CENTER_X - 7.6,
            profileAtStation - 0.05,
            nextStationPos - 0.12,
            SHIP_CENTER_X + 7.6,
            profileAtStation + 0.05,
            nextStationPos + 0.12,
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
  ].forEach(([sideSign, stationIndex, stationPos, nextStationPos], profileAtStation) => {
    (addGeom(
      whiteMat,
      boxFromBounds(
        SHIP_CENTER_X - sideSign,
        stationIndex,
        hatchZ1 + nextStationPos * 0.4,
        SHIP_CENTER_X + sideSign,
        stationPos,
        hatchZ0 - nextStationPos,
        0.08,
      ),
      whiteTint,
    ),
      addGeom(
        whiteMat,
        boxFromBounds(
          SHIP_CENTER_X - sideSign - 0.7,
          stationPos - 0.06,
          hatchZ1 + nextStationPos * 0.4 - 0.3,
          SHIP_CENTER_X + sideSign + 0.7,
          stationPos + 0.06,
          hatchZ0 - nextStationPos + 1,
        ),
        [0.7, 0.72, 0.72],
      ));
    let profileAtNextStation = stationPos + 0.06,
      rowIndex = SHIP_CENTER_X - sideSign - 0.67,
      panelBrightness = SHIP_CENTER_X + sideSign + 0.67,
      quadCorners = hatchZ0 - nextStationPos + 0.97,
      quadNormals = hatchZ1 + nextStationPos * 0.4 - 0.27;
    if (
      (addRailing(
        batcher,
        galvMat,
        [
          [rowIndex, profileAtNextStation, quadNormals],
          [rowIndex, profileAtNextStation, quadCorners],
          [panelBrightness, profileAtNextStation, quadCorners],
          [panelBrightness, profileAtNextStation, quadNormals],
        ],
        {
          h: 1.05,
          post: 1.6,
          r: 0.026,
        },
      ),
      profileAtStation < 3)
    )
      for (
        let quadUvs = hatchZ0 - nextStationPos - 1.2, quadTint = 0;
        quadUvs > hatchZ1 + 1.5;
        quadUvs -= 1.45, quadTint++
      ) {
        let quadCenter = hash2(quadTint * 3 + profileAtStation * 11, 4) > 0.8;
        for (let cornerIndex of [-1, 1]) {
          let lampHousing = boxFromBounds(
            SHIP_CENTER_X + cornerIndex * (sideSign + 0.012) - 0.012,
            stationIndex + 1.25,
            quadUvs - 0.33,
            SHIP_CENTER_X + cornerIndex * (sideSign + 0.012) + 0.012,
            stationIndex + 1.85,
            quadUvs + 0.33,
          );
          quadCenter && cornerIndex < 0
            ? addLampGeo(lampHousing)
            : addGeom(darkSteelMat, lampHousing);
        }
      }
    if (profileAtStation < 3)
      for (
        let quadUvs = SHIP_CENTER_X - sideSign + 1, quadTint = 0;
        quadUvs < SHIP_CENTER_X + sideSign - 0.6;
        quadUvs += 1.5, quadTint++
      ) {
        let quadCenter = boxFromBounds(
          quadUvs - 0.33,
          stationIndex + 1.25,
          hatchZ0 - nextStationPos - 0.01,
          quadUvs + 0.33,
          stationIndex + 1.85,
          hatchZ0 - nextStationPos + 0.014,
        );
        hash2(quadTint + profileAtStation * 7, 8) > 0.84
          ? addLampGeo(quadCenter)
          : addGeom(darkSteelMat, quadCenter);
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
    let sideSign = SHIP_CENTER_X - winchHalfW + 0.75, stationIndex = 0;
    sideSign < SHIP_CENTER_X + winchHalfW - 0.4;
    sideSign += 1.05, stationIndex++
  )
    (hash2(stationIndex, 21) > 0.62 &&
      addLampGeo(
        boxFromBounds(
          sideSign - 0.44,
          winchY + 1.36,
          winchZ + 0.02,
          sideSign + 0.44,
          winchY + 2.19,
          winchZ + 0.03,
        ),
      ),
      addGeom(
        whiteMat,
        boxFromBounds(
          sideSign + 0.48,
          winchY + 1.3,
          winchZ,
          sideSign + 0.57,
          winchY + 2.25,
          winchZ + 0.04,
        ),
        whiteTint,
      ));
  for (let sideSign of [-1, 1])
    (addGeom(
      darkSteelMat,
      boxFromBounds(
        SHIP_CENTER_X + sideSign * winchHalfW - 0.02,
        winchY + 1.3,
        winchZ - 5,
        SHIP_CENTER_X + sideSign * winchHalfW + 0.02,
        winchY + 2.25,
        winchZ - 0.2,
      ),
    ),
      addGeom(
        whiteMat,
        boxFromBounds(
          SHIP_CENTER_X + sideSign * 6.4,
          winchY - 0.12,
          winchZ - 3.4,
          SHIP_CENTER_X + sideSign * 8.3,
          winchY + 0.02,
          winchZ + 0.9,
          0.03,
        ),
        whiteTint,
      ),
      addGeom(
        whiteMat,
        boxFromBounds(
          SHIP_CENTER_X + sideSign * 8.22,
          winchY,
          winchZ - 3.4,
          SHIP_CENTER_X + sideSign * 8.3,
          winchY + 1.1,
          winchZ + 0.9,
        ),
        whiteTint,
      ),
      addGeom(
        whiteMat,
        boxFromBounds(
          SHIP_CENTER_X + sideSign * 6.5,
          winchY,
          winchZ + 0.82,
          SHIP_CENTER_X + sideSign * 8.3,
          winchY + 1.1,
          winchZ + 0.9,
        ),
        whiteTint,
      ),
      addGeom(
        darkSteelMat,
        beamBetween(
          [SHIP_CENTER_X + sideSign * 6.6, winchY - 2.6, winchZ - 1.2],
          [SHIP_CENTER_X + sideSign * 8.1, winchY - 0.1, winchZ - 1.2],
          0.12,
          0.12,
        ),
      ),
      lamps.add(
        makeBeaconGeo(SHIP_CENTER_X + sideSign * 8.25, winchY + 1.35, winchZ - 0.4, 0.13),
        sideSign < 0 ? [0.3, 5, 1.6] : [6, 0.4, 0.3],
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
  for (let sideSign of [-2.3, -1.2, 1.2, 2.3])
    addGeom(
      darkSteelMat,
      strutBetween(
        [mastPos.x + sideSign, mastPos.y + 5.36, mastPos.z],
        [mastPos.x + sideSign, mastPos.y + 5.36 + (Math.abs(sideSign) > 2 ? 3.2 : 1.2), mastPos.z],
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
  for (let sideSign of [-1, 1])
    addGeom(
      darkSteelMat,
      strutBetween(
        [mastPos.x + sideSign * 2.3, mastPos.y + 5.3, mastPos.z],
        [SHIP_CENTER_X + sideSign * 6, 24.5, hatchZ1 + 2],
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
  for (let sideSign of [-0.9, 0.5])
    addGeom(
      darkSteelMat,
      cylinderFromAxis(0.28, 0.28, 1.1, 'y', SHIP_CENTER_X, 30.7, funnelZ + sideSign, 10),
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
    let sideSign = SHIP_CENTER_X - 7.9,
      stationIndex = 17.5,
      stationPos = -61,
      nextStationPos = [1.25, 0.42, 0.1],
      profileAtStation = new THREE.CapsuleGeometry(1.15, 3.6, 4, 12);
    (profileAtStation.rotateX(Math.PI / 2),
      profileAtStation.scale(0.95, 0.82, 1),
      profileAtStation.translate(sideSign, stationIndex, stationPos),
      addGeom(whiteMat, profileAtStation, nextStationPos),
      addGeom(
        whiteMat,
        boxFromBounds(
          sideSign - 0.6,
          stationIndex + 0.7,
          stationPos - 1.2,
          sideSign + 0.6,
          stationIndex + 1.25,
          stationPos + 0.9,
          0.12,
        ),
        nextStationPos,
      ));
    for (let profileAtNextStation of [-2.1, 2.1])
      (addGeom(
        darkSteelMat,
        beamBetween(
          [SHIP_CENTER_X - 6.9, 15.9, stationPos + profileAtNextStation],
          [sideSign - 0.2, stationIndex + 2.3, stationPos + profileAtNextStation],
          0.16,
          0.22,
        ),
      ),
        addGeom(
          darkSteelMat,
          strutBetween(
            [sideSign - 0.2, stationIndex + 2.2, stationPos + profileAtNextStation],
            [sideSign, stationIndex + 0.9, stationPos + profileAtNextStation * 0.8],
            0.02,
            4,
          ),
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
    let sideSign = newVec3(32.55, 13, -51.5),
      stationIndex = newVec3(31.4, 1.25, -38.5);
    for (let stationPos of [-0.4, 0.4])
      (addGeom(
        galvMat,
        beamBetween(
          [sideSign.x + stationPos, sideSign.y - 0.1, sideSign.z],
          [stationIndex.x + stationPos, stationIndex.y - 0.1, stationIndex.z],
          0.05,
          0.3,
        ),
      ),
        addGeom(
          galvMat,
          strutBetween(
            [sideSign.x + stationPos, sideSign.y + 1, sideSign.z],
            [stationIndex.x + stationPos, stationIndex.y + 1, stationIndex.z],
            0.025,
            5,
          ),
        ),
        addGeom(
          galvMat,
          strutBetween(
            [sideSign.x + stationPos, sideSign.y + 0.5, sideSign.z],
            [stationIndex.x + stationPos, stationIndex.y + 0.5, stationIndex.z],
            0.02,
            4,
          ),
        ));
    for (let stationPos = 0; stationPos <= 8; stationPos++) {
      let nextStationPos = sideSign.clone().lerp(stationIndex, stationPos / 8);
      for (let profileAtStation of [-0.4, 0.4])
        addGeom(
          galvMat,
          strutBetween(
            [nextStationPos.x + profileAtStation, nextStationPos.y - 0.1, nextStationPos.z],
            [nextStationPos.x + profileAtStation, nextStationPos.y + 1, nextStationPos.z],
            0.02,
            4,
          ),
        );
    }
    for (let stationPos = 1; stationPos < 44; stationPos++) {
      let nextStationPos = sideSign.clone().lerp(stationIndex, stationPos / 44);
      addGeom(
        galvMat,
        boxFromBounds(
          nextStationPos.x - 0.38,
          nextStationPos.y - 0.02,
          nextStationPos.z - 0.12,
          nextStationPos.x + 0.38,
          nextStationPos.y,
          nextStationPos.z + 0.12,
        ),
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
        strutBetween(
          [sideSign.x, sideSign.y + 3.2, sideSign.z + 4],
          [stationIndex.x, stationIndex.y + 1.2, stationIndex.z + 0.3],
          0.014,
          4,
        ),
      ),
      addGeom(
        darkSteelMat,
        beamBetween([33.2, 13.2, sideSign.z + 4], [32.2, 16.4, sideSign.z + 4], 0.14, 0.14),
      ));
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
  for (let sideSign of [-82, -58])
    (addGeom(darkSteelMat, cylinderFromAxis(0.2, 0.26, 0.55, 'y', 29.2, 0.27, sideSign, 10)),
      addGeom(darkSteelMat, cylinderFromAxis(0.34, 0.3, 0.14, 'y', 29.2, 0.6, sideSign, 10)));
  for (let sideSign of [-17.6, -37, -54])
    (addGeom(
      rubberMat,
      cylinderFromAxis(1.25, 1.25, 2.2, 'z', 31.55, SHIP_WATERLINE_Y + 0.35, sideSign, 14),
    ),
      addGeom(
        rubberMat,
        cylinderFromAxis(0.45, 1.25, 0.5, 'z', 31.55, SHIP_WATERLINE_Y + 0.35, sideSign + 1.35, 14),
      ),
      addGeom(
        rubberMat,
        cylinderFromAxis(1.25, 0.45, 0.5, 'z', 31.55, SHIP_WATERLINE_Y + 0.35, sideSign - 1.35, 14),
      ),
      addGeom(
        ropeMat,
        strutBetween(
          [31.55, SHIP_WATERLINE_Y + 1.6, sideSign],
          [29.9, 0.1, sideSign + 0.6],
          0.03,
          4,
        ),
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
      ...hullProfile.map((sideSignOrMaterial) =>
        newVec3(sideSignOrMaterial[0], sideSignOrMaterial[1], sideSignOrMaterial[2]),
      ),
      newVec3(3.43, 0.8, 0),
      ...hullProfile
        .slice()
        .reverse()
        .map((sideSignOrMaterial) =>
          newVec3(sideSignOrMaterial[0], sideSignOrMaterial[1], -sideSignOrMaterial[2]),
        ),
    ],
    hullCurve = new THREE.CatmullRomCurve3(hullPath, !1, 'centripetal'),
    hullTube = new THREE.TubeGeometry(hullCurve, 60, 0.27, 12, !1);
  {
    let sideSignOrMaterial = hullTube.attributes.uv,
      curveParamOrGeometry = hullCurve.getLength();
    for (let pointOrTint = 0; pointOrTint < sideSignOrMaterial.count; pointOrTint++)
      sideSignOrMaterial.setXY(
        pointOrTint,
        sideSignOrMaterial.getX(pointOrTint) * curveParamOrGeometry,
        sideSignOrMaterial.getY(pointOrTint) * 1.7,
      );
  }
  addGeom(plasticMat, hullTube, hullTint);
  for (let sideSignOrMaterial of [-1, 1])
    addGeom(
      plasticMat,
      cylinderFromAxis(0.07, 0.27, 0.42, 'x', -3.56, 0.5, sideSignOrMaterial * 1.03, 12),
      hullTint,
    );
  let ringCount = 11,
    rubRails = [];
  for (let sideSignOrMaterial = 0; sideSignOrMaterial < ringCount; sideSignOrMaterial++) {
    let curveParamOrGeometry = 0.04 + (0.92 * sideSignOrMaterial) / (ringCount - 1),
      pointOrTint = hullCurve.getPointAt(curveParamOrGeometry),
      tangentOrNormal = hullCurve.getTangentAt(curveParamOrGeometry),
      centroidOrGeometry = new THREE.TorusGeometry(0.276, 0.016, 5, 14);
    (centroidOrGeometry.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(newVec3(0, 0, 1), tangentOrNormal),
    ),
      centroidOrGeometry.translate(pointOrTint.x, pointOrTint.y, pointOrTint.z),
      addGeom(plasticMat, centroidOrGeometry, seamTint));
    let outwardReference = newVec3(pointOrTint.x, 0, pointOrTint.z)
      .sub(newVec3(Math.min(pointOrTint.x, 2.2), 0, 0))
      .normalize();
    rubRails.push(
      pointOrTint
        .clone()
        .addScaledVector(outwardReference, 0.2)
        .add(newVec3(0, 0.2, 0)),
    );
  }
  for (let sideSignOrMaterial = 0; sideSignOrMaterial < ringCount - 1; sideSignOrMaterial++)
    addGeom(
      plasticMat,
      strutsAlongPath(
        catenaryPoints(rubRails[sideSignOrMaterial], rubRails[sideSignOrMaterial + 1], 0.1, 4),
        0.012,
        4,
      ),
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
  for (let sideSignOrMaterial of [-1, 1]) {
    for (
      let curveParamOrGeometry = 0;
      curveParamOrGeometry < gunwaleStations.length - 1;
      curveParamOrGeometry++
    ) {
      let pointOrTint = newVec3(
          gunwaleStations[curveParamOrGeometry],
          gunwaleBases[curveParamOrGeometry],
          0,
        ),
        tangentOrNormal = newVec3(
          gunwaleStations[curveParamOrGeometry + 1],
          gunwaleBases[curveParamOrGeometry + 1],
          0,
        ),
        centroidOrGeometry = newVec3(
          gunwaleStations[curveParamOrGeometry],
          gunwaleHeights[curveParamOrGeometry],
          sideSignOrMaterial * gunwaleHalfWidths[curveParamOrGeometry],
        ),
        outwardReference = newVec3(
          gunwaleStations[curveParamOrGeometry + 1],
          gunwaleHeights[curveParamOrGeometry + 1],
          sideSignOrMaterial * gunwaleHalfWidths[curveParamOrGeometry + 1],
        ),
        gunwaleFlareCur = newVec3(
          gunwaleStations[curveParamOrGeometry],
          0.5 + Math.max(0, gunwaleHeights[curveParamOrGeometry] - 0.22) * 0.6,
          sideSignOrMaterial * (gunwaleHalfWidths[curveParamOrGeometry] + 0.1),
        ),
        gunwaleFlareNext = newVec3(
          gunwaleStations[curveParamOrGeometry + 1],
          0.5 + Math.max(0, gunwaleHeights[curveParamOrGeometry + 1] - 0.22) * 0.6,
          sideSignOrMaterial * (gunwaleHalfWidths[curveParamOrGeometry + 1] + 0.1),
        );
      (pushTri(pointOrTint, tangentOrNormal, outwardReference),
        pushTri(pointOrTint, outwardReference, centroidOrGeometry),
        pushTri(centroidOrGeometry, outwardReference, gunwaleFlareNext),
        pushTri(centroidOrGeometry, gunwaleFlareNext, gunwaleFlareCur));
    }
    (pushTri(
      newVec3(-3.4, gunwaleBases[0], 0),
      newVec3(-3.4, gunwaleHeights[0], sideSignOrMaterial * gunwaleHalfWidths[0]),
      newVec3(-3.4, 0.78, sideSignOrMaterial * (gunwaleHalfWidths[0] + 0.1)),
    ),
      pushTri(
        newVec3(-3.4, gunwaleBases[0], 0),
        newVec3(-3.4, 0.78, sideSignOrMaterial * (gunwaleHalfWidths[0] + 0.1)),
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
  for (let sideSignOrMaterial of [-0.43, 0.43])
    addGeom(
      galvMat,
      strutBetween(
        [0.95, 1.2, sideSignOrMaterial],
        [0.95 - Math.sin(0.42) * 0.52, 1.2 + Math.cos(0.42) * 0.52, sideSignOrMaterial],
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
  for (let sideSignOrMaterial of [0, 2.1, 4.2])
    addGeom(
      galvMat,
      strutBetween(
        [0.2, 1.12, -0.12],
        [
          0.2 + Math.sin(-0.5) * Math.cos(sideSignOrMaterial) * -0.17,
          1.12 + Math.cos(-0.5) * Math.cos(sideSignOrMaterial) * 0.17,
          -0.12 + Math.sin(sideSignOrMaterial) * 0.17,
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
  for (let sideSignOrMaterial of [-0.75, -1.75])
    (addGeom(
      orangePaintMat,
      boxFromBounds(
        sideSignOrMaterial - 0.28,
        0.26,
        -0.2,
        sideSignOrMaterial + 0.28,
        0.82,
        0.2,
        0.05,
      ),
      [1, 0.9, 0.85],
    ),
      addGeom(
        blackPolymerMat,
        boxFromBounds(
          sideSignOrMaterial - 0.3,
          0.82,
          -0.22,
          sideSignOrMaterial + 0.3,
          0.93,
          0.22,
          0.04,
        ),
      ),
      addGeom(
        blackPolymerMat,
        boxFromBounds(
          sideSignOrMaterial - 0.34,
          0.93,
          -0.2,
          sideSignOrMaterial - 0.26,
          1.2,
          0.2,
          0.03,
        ),
      ),
      addGeom(
        galvMat,
        strutBetween(
          [sideSignOrMaterial + 0.3, 0.6, -0.22],
          [sideSignOrMaterial + 0.3, 1.02, 0],
          0.014,
          4,
        ),
      ),
      addGeom(
        galvMat,
        strutBetween(
          [sideSignOrMaterial + 0.3, 0.6, 0.22],
          [sideSignOrMaterial + 0.3, 1.02, 0],
          0.014,
          4,
        ),
      ));
  addGeom(orangePaintMat, boxFromBounds(-2.9, 0.26, -0.3, -2.45, 0.58, 0.3, 0.04), [1.1, 0.5, 0.4]);
  for (let sideSignOrMaterial of [-1, 1])
    (addGeom(
      galvMat,
      strutBetween(
        [-2.95, 0.55, sideSignOrMaterial * 0.9],
        [-2.75, 2, sideSignOrMaterial * 0.55],
        0.03,
        6,
      ),
    ),
      addGeom(
        galvMat,
        strutBetween(
          [-2.3, 0.55, sideSignOrMaterial * 0.9],
          [-2.75, 1.3, sideSignOrMaterial * 0.7],
          0.022,
          5,
        ),
      ));
  (addGeom(galvMat, strutBetween([-2.75, 2, -0.55], [-2.75, 2, 0.55], 0.03, 6)),
    addGeom(galvMat, boxFromBounds(-2.88, 2, -0.2, -2.62, 2.04, 0.2)),
    addGeom(blackPolymerMat, cylinderFromAxis(0.05, 0.06, 0.1, 'y', -2.75, 2.09, 0, 8)),
    addGeom(blackPolymerMat, strutBetween([-2.75, 2, 0.42], [-2.9, 3.7, 0.46], 0.011, 5)),
    addGeom(blackPolymerMat, cylinderFromAxis(0.16, 0.16, 0.07, 'y', -2.75, 2.1, -0.36, 10)));
  for (let sideSignOrMaterial of [-0.36, 0.36])
    (addGeom(
      galvMat,
      boxFromBounds(
        -3.6,
        0.42,
        sideSignOrMaterial - 0.16,
        -3.44,
        0.78,
        sideSignOrMaterial + 0.16,
        0.02,
      ),
    ),
      addGeom(
        blackPolymerMat,
        boxFromBounds(
          -4.1,
          0.78,
          sideSignOrMaterial - 0.23,
          -3.48,
          1.4,
          sideSignOrMaterial + 0.23,
          0.09,
        ),
      ),
      addGeom(
        plasticMat,
        boxFromBounds(
          -4.11,
          1,
          sideSignOrMaterial - 0.235,
          -3.47,
          1.05,
          sideSignOrMaterial + 0.235,
        ),
        [1.4, 1.4, 1.4],
      ),
      addGeom(
        blackPolymerMat,
        boxFromBounds(
          -3.92,
          -0.05,
          sideSignOrMaterial - 0.085,
          -3.62,
          0.8,
          sideSignOrMaterial + 0.085,
          0.03,
        ),
      ),
      addGeom(
        blackPolymerMat,
        boxFromBounds(
          -4.02,
          -0.52,
          sideSignOrMaterial - 0.04,
          -3.6,
          -0.05,
          sideSignOrMaterial + 0.04,
          0.015,
        ),
      ),
      addGeom(
        blackPolymerMat,
        cylinderFromAxis(0.07, 0.03, 0.42, 'x', -3.9, -0.3, sideSignOrMaterial, 8),
      ));
  for (let sideSignOrMaterial of [-1.8, 0.4, 1.7])
    (addGeom(
      orangePaintMat,
      cylinderFromAxis(0.11, 0.11, 0.42, 'y', sideSignOrMaterial, 0.42, 1.36, 10),
      [1.2, 0.8, 0.7],
    ),
      addGeom(
        plasticMat,
        strutBetween([sideSignOrMaterial, 0.63, 1.36], [sideSignOrMaterial, 0.78, 1.12], 0.01, 4),
        darkTint,
      ));
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
