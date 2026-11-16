// content/props/basic-builders.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  HALF_PI,
  PartBuilder,
  boxGeometry,
  buildCorrugationStations,
  buildPartsGroup,
  composeTransformMatrix,
  createLatheGeometryFromProfile,
  createPlaneGeometry,
  createPlaneGeometryWorldUV,
  createSphereGeometry,
  cylinderGeometry,
  je,
  loftProfileSurface,
  mapVertices,
  mergeGeometryParts,
  removeGeometryGroup,
  revolveProfileGeometry,
  tagPropUserData,
} from '../../assets/procedural/geometry.js';

import { CONTAINER_LOGO_DECALS, SIGN_DECAL_NAMES } from '../../assets/procedural/textures.js';

import { clampValue, smoothstepRange } from '../../audio/audio.js';

import { getDecalMaterial, getLabelMaterial } from '../backdrop/cranes.js';

import { CONTAINER_PAINT_COLORS, PI } from '../level/placement.js';

import {
  CONTAINER_BODY_MATERIAL_KEY,
  CONTAINER_PARTS_CACHE,
  CONTAINER_VARIANT_COUNT,
  CONTAINER_WIDTH,
  CORNER_BLOCK_DEPTH,
  CORNER_BLOCK_HEIGHT,
  CORNER_BLOCK_LENGTH,
  FRONT_CORRUGATION,
  ROOF_CORRUGATION,
  SIDE_CORRUGATION,
} from './cargo-builders.js';

import { recomputeSmoothNormals, roundedBoxGeometryGrid } from './detail-geometry.js';

import { CONTAINER_OWNER_CODES, CONTAINER_SPECS } from './geometry.js';

import { PROP_SIZES, getPropSize3, getPropSize3Later } from './registry.js';

import {
  PI_LATER,
  PI_RELAY,
  PI_TWO,
  lerpVec3,
  valueNoise2D,
  valueNoise3D,
} from '../../core/math.js';

import { $a } from '../../misc.js';

import { createRoundedRectFanGeometry } from '../../render/effects/particles.js';

/**
 * 生成一个集装箱的全部几何与碰撞盒：角件/角柱、三面波纹板（带凹陷与锈迹顶点色）、门板（可开到指定角度并带锁杆）、内衬与铭牌贴花；结果按参数缓存复用
 */
function buildContainerParts(ctx, type, variant, doorsOpen, wear) {
  let propW = PROP_SIZES[type][0],
    propH = PROP_SIZES[type][1],
    spec = CONTAINER_SPECS[type],
    rand = $a(1e3 + variant * 77 + type.length * 13),
    builder = new PartBuilder(ctx),
    steelMat = builder.M('steel_galv'),
    woodMat = builder.M('wood_pallet'),
    halfWidth = CONTAINER_WIDTH / 2,
    halfLen = propW / 2,
    sideX = halfWidth - 0.012,
    panelStart = -halfLen + 0.085,
    panelEnd = halfLen - 0.135,
    ribStartY = 0.167,
    ribEndY = propH - 0.06,
    dents = [],
    dentCount = Math.round((1 + rand() * 2.4) * (0.4 + wear)),
    clearZones = [
      [-halfLen * 0.75, -halfLen * 0.05],
      [halfLen - 2.2, halfLen],
    ];
  for (let sideSign = 0; sideSign < dentCount; sideSign++) {
    let sideFlag = rand() < 0.5 ? 1 : -1,
      depthSign = 0,
      coordX = 0;
    do ((depthSign = (rand() * 2 - 1) * (halfLen - 0.9)), coordX++);
    while (
      coordX < 8 &&
      clearZones.some(
        (coordY) => depthSign > coordY[0] - 0.4 && depthSign < coordY[1] + 0.4 && rand() < 0.9,
      )
    );
    dents.push({
      side: sideFlag,
      x: sideFlag * depthSign,
      y: 0.45 + rand() * 1.3,
      r: 0.22 + rand() * 0.3,
      depth: 0.025 + rand() * 0.04,
    });
  }
  let rustStreaks = [],
    streakCount = Math.round((propW / 2.2) * (0.5 + wear) * (0.6 + rand()));
  for (let sideSign = 0; sideSign < streakCount * 2; sideSign++)
    rustStreaks.push({
      side: sideSign % 2 ? 1 : -1,
      x: (rand() * 2 - 1) * (halfLen - 0.3),
      w: 0.05 + rand() * 0.12,
      k: 0.4 + rand() * 0.6,
    });
  let baseColor = [0.5, 0.44, 0.38],
    rustColor = [0.62, 0.38, 0.24],
    noiseSeed = variant * 9.7,
    paintColorFn = ($, ue, me) => {
      let ee =
        1 + (valueNoise2D($ * 0.9 + noiseSeed, ue * 1.7 + me * 0.4) - 0.5) * 0.16 * (0.5 + wear);
      ee *= 0.94 + 0.06 * valueNoise2D($ * 6.1 + me * 3.3, ue * 5 + noiseSeed);
      let B = [ee, ee, ee],
        P =
          smoothstepRange(0.62, 0.02, ue) *
          (0.45 + 0.5 * wear) *
          (0.75 + 0.5 * valueNoise2D($ * 2.3 + me, noiseSeed));
      return (
        (B = lerpVec3(
          B,
          [baseColor[0] * ee, baseColor[1] * ee, baseColor[2] * ee],
          Math.min(1, P),
        )),
        B
      );
    };
  builder.defCol.set(CONTAINER_BODY_MATERIAL_KEY, paintColorFn);
  let dentDepthFn = (segRadius, px, py) => {
      let ee = 0;
      for (let B of dents)
        if (B.side === py) {
          let P = Math.hypot(segRadius - B.x, (px - B.y) * 0.9) / B.r;
          if (P < 1) {
            let V = 1 - P * P;
            ee += B.depth * V * V;
          }
        }
      return ee;
    },
    holeColor = [0.035, 0.035, 0.04];
  for (let sideSign of [-1, 1])
    for (let sideFlag of [0, 1])
      for (let depthSign of [-1, 1]) {
        let coordX = sideSign * (halfLen - CORNER_BLOCK_LENGTH / 2),
          coordY = sideFlag ? propH - CORNER_BLOCK_HEIGHT / 2 : CORNER_BLOCK_HEIGHT / 2,
          coordZ = depthSign * (halfWidth - CORNER_BLOCK_DEPTH / 2);
        (builder.box(
          CONTAINER_BODY_MATERIAL_KEY,
          CORNER_BLOCK_LENGTH,
          CORNER_BLOCK_HEIGHT,
          CORNER_BLOCK_DEPTH,
          coordX,
          coordY,
          coordZ,
          {
            r: 0.012,
          },
        ),
          builder.add(
            CONTAINER_BODY_MATERIAL_KEY,
            je(
              createRoundedRectFanGeometry(0.078, 0.052, 3),
              coordX,
              coordY,
              depthSign * (halfWidth + 0.0012),
              [0, depthSign > 0 ? 0 : Math.PI, 0],
            ),
            holeColor,
          ),
          builder.add(
            CONTAINER_BODY_MATERIAL_KEY,
            je(
              createRoundedRectFanGeometry(0.064, 0.05, 3),
              sideSign * (halfLen + 0.0012),
              coordY,
              coordZ,
              [0, (sideSign * Math.PI) / 2, 0],
            ),
            holeColor,
          ),
          sideFlag &&
            builder.add(
              CONTAINER_BODY_MATERIAL_KEY,
              je(createRoundedRectFanGeometry(0.124, 0.064, 3), coordX, propH + 0.0012, coordZ, [
                -Math.PI / 2,
                0,
                0,
              ]),
              holeColor,
            ));
      }
  for (let sideSign of [-1, 1])
    (builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.085,
      propH - 2 * CORNER_BLOCK_HEIGHT + 0.01,
      0.15,
      -halfLen + 0.0465,
      propH / 2,
      sideSign * (halfWidth - 0.079),
      {
        r: 0.014,
      },
    ),
      builder.box(
        CONTAINER_BODY_MATERIAL_KEY,
        0.14,
        propH - 2 * CORNER_BLOCK_HEIGHT + 0.01,
        0.056,
        halfLen - 0.074,
        propH / 2,
        sideSign * (halfWidth - 0.032),
        {
          r: 0.012,
        },
      ),
      builder.box(
        CONTAINER_BODY_MATERIAL_KEY,
        propW - 0.2,
        0.062,
        0.062,
        -0.02,
        propH - 0.031,
        sideSign * (halfWidth - 0.035),
        {
          r: 0.008,
        },
      ),
      builder.box(
        CONTAINER_BODY_MATERIAL_KEY,
        propW - 0.2,
        0.158,
        0.05,
        -0.02,
        0.012 + 0.079,
        sideSign * (halfWidth - 0.029),
        {
          r: 0.008,
        },
      ));
  if (
    (builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.062,
      0.062,
      CONTAINER_WIDTH - 0.2,
      -halfLen + 0.035,
      propH - 0.031,
      0,
      {
        r: 0.008,
      },
    ),
    builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.05,
      0.158,
      CONTAINER_WIDTH - 0.2,
      -halfLen + 0.029,
      0.091,
      0,
      {
        r: 0.008,
      },
    ),
    builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.13,
      0.12,
      CONTAINER_WIDTH - 0.12,
      halfLen - 0.072,
      propH - 0.06,
      0,
      {
        r: 0.01,
      },
    ),
    builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.13,
      0.158,
      CONTAINER_WIDTH - 0.12,
      halfLen - 0.072,
      0.091,
      0,
      {
        r: 0.01,
      },
    ),
    builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.03,
      0.012,
      CONTAINER_WIDTH - 0.4,
      halfLen - 0.012,
      propH - 0.125,
      0,
      {
        r: 0.003,
        rot: [0, 0, -0.5],
      },
    ),
    type === 'container20')
  )
    for (let sideSign of [-1, 1])
      for (let sideFlag of [-1.025, 1.025]) {
        (builder.add(
          CONTAINER_BODY_MATERIAL_KEY,
          je(createPlaneGeometry(0.36, 0.112), sideFlag, 0.075, sideSign * (halfWidth - 0.0035), [
            0,
            sideSign > 0 ? 0 : Math.PI,
            0,
          ]),
          holeColor,
        ),
          builder.box(
            CONTAINER_BODY_MATERIAL_KEY,
            0.46,
            0.018,
            0.012,
            sideFlag,
            0.142,
            sideSign * (halfWidth - 0.002),
            {
              r: 0.003,
            },
          ));
        for (let depthSign of [-1, 1])
          builder.box(
            CONTAINER_BODY_MATERIAL_KEY,
            0.018,
            0.13,
            0.01,
            sideFlag + depthSign * 0.19,
            0.078,
            sideSign * (halfWidth - 0.003),
            {
              r: 0.003,
            },
          );
      }
  let profileHeightSpan = [ribStartY, 0.44, 1.25, propH - 0.5, ribEndY],
    rimStations = buildCorrugationStations(
      panelStart,
      panelEnd,
      SIDE_CORRUGATION.P,
      SIDE_CORRUGATION.d,
      SIDE_CORRUGATION.fo,
      SIDE_CORRUGATION.sl,
      panelStart + 0.02,
    );
  for (let sideSign of [-1, 1]) {
    let sideFlag = loftProfileSurface(
      rimStations,
      profileHeightSpan,
      (coordY, coordZ, falloffValue) => [
        coordY,
        falloffValue,
        sideSign * (sideX + coordZ - dentDepthFn(coordY, falloffValue, sideSign)),
      ],
      {
        center: [0, propH / 2, 0],
      },
    );
    sideFlag.computeVertexNormals();
    let depthSign = sideFlag.attributes.position,
      coordX = new Float32Array(depthSign.count * 3);
    for (let coordY = 0; coordY < depthSign.count; coordY++) {
      let coordZ = depthSign.getX(coordY),
        falloffValue = depthSign.getY(coordY),
        edgeMix = depthSign.getZ(coordY),
        shadeColor = paintColorFn(coordZ, falloffValue, edgeMix),
        edgeDistance = sideX - Math.abs(edgeMix),
        rimShade = smoothstepRange(0.008, 0.034, edgeDistance);
      shadeColor = [
        shadeColor[0] * (1 - 0.17 * rimShade),
        shadeColor[1] * (1 - 0.18 * rimShade),
        shadeColor[2] * (1 - 0.18 * rimShade),
      ];
      let rustFactor = smoothstepRange(propH - 0.75, ribEndY, falloffValue);
      if (rustFactor > 0) {
        for (let streakEntry of rustStreaks)
          if (streakEntry.side === sideSign) {
            let streakFalloff = Math.abs(coordZ - streakEntry.x) / streakEntry.w;
            streakFalloff < 1 &&
              (shadeColor = lerpVec3(
                shadeColor,
                [
                  shadeColor[0] * rustColor[0],
                  shadeColor[1] * rustColor[1],
                  shadeColor[2] * rustColor[2],
                ],
                rustFactor *
                  rustFactor *
                  streakEntry.k *
                  (1 - streakFalloff * streakFalloff) *
                  (0.45 + 0.55 * wear),
              ));
          }
      }
      let dentAmount = dentDepthFn(coordZ, falloffValue, sideSign);
      (dentAmount > 0.004 &&
        (shadeColor = lerpVec3(
          shadeColor,
          [shadeColor[0] * 0.66, shadeColor[1] * 0.46, shadeColor[2] * 0.36],
          Math.min(0.8, dentAmount * 22),
        )),
        (coordX[coordY * 3] = shadeColor[0]),
        (coordX[coordY * 3 + 1] = shadeColor[1]),
        (coordX[coordY * 3 + 2] = shadeColor[2]));
    }
    (sideFlag.setAttribute('color', new THREE.BufferAttribute(coordX, 3)),
      builder.buckets.get(CONTAINER_BODY_MATERIAL_KEY).geos.push(sideFlag));
  }
  for (let sideSign of [-1, 1])
    for (let sideFlag of propW > 7 ? [-1, 1] : [1]) {
      let depthSign = sideSign * sideFlag * (halfLen - 0.62),
        coordX = propH - 0.165,
        coordY = sideSign * (sideX - 0.004);
      builder.box(CONTAINER_BODY_MATERIAL_KEY, 0.24, 0.1, 0.03, depthSign, coordX, coordY, {
        r: 0.008,
      });
      for (let coordZ = -1; coordZ <= 1; coordZ++)
        builder.add(
          CONTAINER_BODY_MATERIAL_KEY,
          je(
            createPlaneGeometry(0.18, 0.012),
            depthSign,
            coordX + coordZ * 0.026,
            sideSign * (sideX + 0.0116),
            [0, sideSign > 0 ? 0 : Math.PI, 0],
          ),
          holeColor,
        );
    }
  {
    let sideSign = buildCorrugationStations(
        -halfWidth + 0.155,
        halfWidth - 0.155,
        ROOF_CORRUGATION.P,
        ROOF_CORRUGATION.d,
        ROOF_CORRUGATION.fo,
        ROOF_CORRUGATION.sl,
        -halfWidth + 0.155 + 0.03,
      ),
      sideFlag = loftProfileSurface(
        sideSign,
        [ribStartY, 1.25, ribEndY],
        (coordX, coordY, coordZ) => [-(halfLen - 0.014 + coordY), coordZ, coordX],
        {
          center: [0, propH / 2, 0],
        },
      ),
      depthSign = -(halfLen - 0.014);
    builder.add(CONTAINER_BODY_MATERIAL_KEY, sideFlag, (coordX, coordY, coordZ) => {
      let falloffValue = paintColorFn(coordX, coordY, coordZ),
        edgeMix = smoothstepRange(0.008, 0.038, coordX - depthSign);
      return [
        falloffValue[0] * (1 - 0.17 * edgeMix),
        falloffValue[1] * (1 - 0.18 * edgeMix),
        falloffValue[2] * (1 - 0.18 * edgeMix),
      ];
    });
  }
  {
    let sideSign = buildCorrugationStations(
        -halfLen + 0.07,
        halfLen - 0.13,
        FRONT_CORRUGATION.P,
        FRONT_CORRUGATION.d,
        FRONT_CORRUGATION.fo,
        FRONT_CORRUGATION.sl,
        -halfLen + 0.1,
      ),
      sideFlag = propH - 0.008,
      depthSign = loftProfileSurface(
        sideSign,
        propW > 7
          ? [-(halfWidth - 0.066), halfWidth - 0.066]
          : [-(halfWidth - 0.066), 0, halfWidth - 0.066],
        (coordX, coordY, coordZ) => [
          coordX,
          sideFlag + coordY + (Math.abs(coordZ) < 0.01 ? 0.006 : 0),
          coordZ,
        ],
        {
          center: [0, propH / 2, 0],
        },
      );
    builder.add(CONTAINER_BODY_MATERIAL_KEY, depthSign, (coordX, coordY, coordZ) => {
      let falloffValue = 0.78 + 0.3 * valueNoise2D(coordX * 0.8 + noiseSeed, coordZ * 1.1),
        edgeMix = smoothstepRange(0.004, 0.018, sideFlag - coordY);
      return [
        falloffValue * (1 - 0.25 * edgeMix),
        falloffValue * (1 - 0.3 * edgeMix) * 0.97,
        falloffValue * (1 - 0.32 * edgeMix) * 0.94,
      ];
    });
  }
  let doorsAreOpen = doorsOpen > 0.03,
    doorZoneTopY = 0.172;
  if (doorsAreOpen) {
    let sideSign = (ee, B, P) => {
        let Y =
          (0.16 +
            0.62 *
              smoothstepRange(-halfLen, halfLen, ee) *
              smoothstepRange(-halfLen, halfLen, ee)) *
          (0.8 + 0.2 * smoothstepRange(0.2, 1.4, B));
        return [Y, Y, Y];
      },
      sideFlag = buildCorrugationStations(
        panelStart,
        panelEnd,
        SIDE_CORRUGATION.P,
        SIDE_CORRUGATION.d,
        SIDE_CORRUGATION.fo,
        SIDE_CORRUGATION.sl,
        panelStart + 0.02,
      );
    for (let coordX of [-1, 1])
      builder.add(
        CONTAINER_BODY_MATERIAL_KEY,
        loftProfileSurface(
          sideFlag,
          [doorZoneTopY, ribEndY - 0.02],
          (coordY, coordZ, falloffValue) => [
            coordY,
            falloffValue,
            coordX * (sideX + coordZ - 0.004),
          ],
          {
            center: [0, propH / 2, 0],
            inward: !0,
          },
        ),
        sideSign,
      );
    (builder.add(
      CONTAINER_BODY_MATERIAL_KEY,
      je(
        createPlaneGeometry(panelEnd - panelStart, 2 * sideX),
        (panelStart + panelEnd) / 2,
        ribEndY - 0.03,
        0,
        [Math.PI / 2, 0, 0],
      ),
      sideSign,
    ),
      builder.add(
        CONTAINER_BODY_MATERIAL_KEY,
        je(
          createPlaneGeometry(2 * sideX, ribEndY - doorZoneTopY),
          panelStart + 0.03,
          (doorZoneTopY + ribEndY) / 2,
          0,
          [0, Math.PI / 2, 0],
        ),
        sideSign,
      ));
    let depthSign = createPlaneGeometryWorldUV(panelEnd - panelStart + 0.1, 2 * sideX - 0.02);
    (builder.add(
      woodMat,
      je(depthSign, (panelStart + panelEnd) / 2 + 0.05, doorZoneTopY, 0, [-Math.PI / 2, 0, 0]),
      (coordX) => {
        let coordY = 0.3 + 0.6 * smoothstepRange(-halfLen, halfLen, coordX) ** 2;
        return [coordY, coordY * 0.97, coordY * 0.93];
      },
    ),
      builder.box(steelMat, 0.05, 0.006, 2 * sideX - 0.1, halfLen - 0.11, doorZoneTopY + 0.001, 0, {
        r: 0.002,
      }));
  }
  let doorFrameBottom = 0.175,
    doorFrameTop = propH - 0.124,
    doorFrameSpan = doorFrameTop - doorFrameBottom,
    doorDepth = halfWidth - 0.058 - 0.004,
    doorStartX = halfLen - 0.066,
    paintFn = ($, ue, me) => paintColorFn($, ue, me),
    colliders = [];
  for (let sideSign of [1, -1]) {
    let sideFlag =
        doorsOpen * (sideSign > 0 ? 1 : 0.88) * THREE.MathUtils.degToRad(sideSign > 0 ? 112 : 100),
      depthSign = sideSign * (halfWidth - 0.058);
    builder.push(composeTransformMatrix(doorStartX, 0, depthSign, [0, -sideSign * sideFlag, 0]));
    let coordX = (k) => -sideSign * k,
      coordY = (doorFrameBottom + doorFrameTop) / 2;
    builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.034,
      doorFrameSpan,
      doorDepth - 0.006,
      0,
      coordY,
      coordX(doorDepth / 2),
      {
        r: 0.008,
        col: paintFn,
      },
    );
    let coordZ = type === 'container40hc' ? 7 : 6,
      falloffValue = doorFrameBottom + 0.085,
      edgeMix = doorFrameTop - 0.085,
      shadeColor = (edgeMix - falloffValue) / coordZ,
      edgeDistance = 0.019,
      rimShade = 0.031,
      rustFactor = [];
    for (let ribIndex = 0; ribIndex < coordZ; ribIndex++) {
      let ribY = falloffValue + ribIndex * shadeColor;
      rustFactor.push(
        [ribY, edgeDistance],
        [ribY + 0.022, edgeDistance],
        [ribY + 0.05, rimShade],
        [ribY + shadeColor - 0.05, rimShade],
        [ribY + shadeColor - 0.022, edgeDistance],
      );
    }
    (rustFactor.push([edgeMix, edgeDistance]),
      builder.add(
        CONTAINER_BODY_MATERIAL_KEY,
        loftProfileSurface(
          rustFactor,
          [0.075, doorDepth - 0.085],
          (ribIndex, ribY, handleY) => [ribY, ribIndex, coordX(handleY)],
          {
            center: [-1, coordY, coordX(doorDepth / 2)],
          },
        ),
        (ribIndex, ribY, handleY) => paintColorFn(ribIndex, ribY, handleY),
      ));
    let dentAmount = (k) => falloffValue + (k + 0.5) * shadeColor,
      streakEntry = [0.05, 0.05, 0.05];
    (builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.022,
      doorFrameSpan + 0.012,
      0.018,
      0.004,
      coordY,
      coordX(doorDepth + 0.001),
      {
        r: 0,
        col: streakEntry,
      },
    ),
      builder.box(
        CONTAINER_BODY_MATERIAL_KEY,
        0.022,
        0.016,
        doorDepth,
        0.004,
        doorFrameTop + 0.004,
        coordX(doorDepth / 2),
        {
          r: 0,
          col: streakEntry,
        },
      ),
      builder.box(
        CONTAINER_BODY_MATERIAL_KEY,
        0.022,
        0.016,
        doorDepth,
        0.004,
        doorFrameBottom - 0.004,
        coordX(doorDepth / 2),
        {
          r: 0,
          col: streakEntry,
        },
      ));
    let streakFalloff = type === 'container40hc' ? 5 : 4;
    for (let ribIndex = 0; ribIndex < streakFalloff; ribIndex++) {
      let ribY = doorFrameBottom + 0.16 + (ribIndex * (doorFrameSpan - 0.32)) / (streakFalloff - 1);
      (builder.box(CONTAINER_BODY_MATERIAL_KEY, 0.012, 0.062, 0.15, 0.021, ribY, coordX(0.085), {
        r: 0,
      }),
        builder.cyl(steelMat, 0.013, 0.013, 0.086, 0.026, ribY, coordX(-0.002), {
          seg: 6,
          open: !0,
        }));
    }
    for (let ribIndex of [0.31, 0.83]) {
      builder.cyl(steelMat, 0.0155, 0.0155, doorFrameSpan + 0.2, 0.052, coordY, coordX(ribIndex), {
        seg: 7,
        open: !0,
      });
      for (let handleEndY of [-1, 1])
        (builder.add(
          steelMat,
          je(
            boxGeometry(0.03, 0.045, 0.085),
            0.052 - 0.004,
            coordY + handleEndY * (doorFrameSpan / 2 + 0.065),
            coordX(ribIndex),
          ),
        ),
          builder.box(
            CONTAINER_BODY_MATERIAL_KEY,
            0.03,
            0.05,
            0.075,
            0.052 - 0.012,
            coordY + handleEndY * (doorFrameSpan / 2 - 0.035),
            coordX(ribIndex),
            {
              r: 0,
            },
          ));
      for (let handleEndY of [
        doorFrameBottom + doorFrameSpan * 0.3,
        doorFrameBottom + doorFrameSpan * 0.72,
      ])
        builder.box(
          CONTAINER_BODY_MATERIAL_KEY,
          0.026,
          0.04,
          0.07,
          0.052 - 0.012,
          handleEndY,
          coordX(ribIndex),
          {
            r: 0,
          },
        );
      let handleY = 1.02 + (ribIndex > 0.5 ? 0 : 0.13),
        handleSide = ribIndex > 0.5 ? -1 : 1;
      (builder.box(steelMat, 0.02, 0.05, 0.05, 0.052 + 0.008, handleY, coordX(ribIndex), {
        r: 0,
      }),
        builder.box(
          steelMat,
          0.011,
          0.032,
          0.36,
          0.052 + 0.016,
          handleY,
          coordX(ribIndex + handleSide * 0.19),
          {
            r: 0.004,
          },
        ),
        builder.box(
          CONTAINER_BODY_MATERIAL_KEY,
          0.03,
          0.07,
          0.05,
          0.052 - 0.008,
          handleY,
          coordX(ribIndex + handleSide * 0.33),
          {
            r: 0,
          },
        ),
        builder.box(
          steelMat,
          0.012,
          0.085,
          0.012,
          0.052 + 0.012,
          handleY + 0.005,
          coordX(ribIndex + handleSide * 0.33),
          {
            r: 0,
          },
        ));
    }
    let decalOffsetX = 0.031 + 0.0025,
      uvAttribute = [0, Math.PI / 2, 0],
      vertexIndex = (k, ce, ve, _e, Te) => {
        let Pe = ce * k.aspect;
        (Te && Pe > Te && ((ce *= Te / Pe), (Pe = Te)),
          builder.add(
            k.material,
            je(createPlaneGeometry(Pe, ce), decalOffsetX, ve, coordX(_e), uvAttribute),
            null,
            !0,
          ));
      };
    if (sideSign < 0) {
      (vertexIndex(
        getLabelMaterial(ctx, CONTAINER_OWNER_CODES[variant % CONTAINER_OWNER_CODES.length], {
          color: 'white',
          font: 'stencil',
          distress: 0.3,
        }),
        0.115,
        dentAmount(coordZ - 1),
        doorDepth / 2,
        doorDepth - 0.24,
      ),
        vertexIndex(
          getLabelMaterial(ctx, spec.type, {
            color: 'white',
            font: 'stencil',
            distress: 0.3,
          }),
          0.1,
          dentAmount(coordZ - 2),
          doorDepth / 2 + 0.2,
          0.4,
        ));
      let ribIndex = {
        color: 'white',
        font: 'sans',
        distress: 0.2,
      };
      (vertexIndex(
        getLabelMaterial(ctx, 'MAX GROSS ' + spec.gross + ' KG', ribIndex),
        0.052,
        dentAmount(coordZ - 3) + 0.062,
        doorDepth / 2 - 0.01,
        0.44,
      ),
        vertexIndex(
          getLabelMaterial(ctx, 'TARE ' + spec.tare + ' KG   NET ' + spec.net + ' KG', ribIndex),
          0.045,
          dentAmount(coordZ - 3),
          doorDepth / 2 - 0.01,
          0.44,
        ),
        vertexIndex(
          getLabelMaterial(ctx, 'CU.CAP. ' + spec.cu + ' CU.M', ribIndex),
          0.045,
          dentAmount(coordZ - 3) - 0.062,
          doorDepth / 2 - 0.01,
          0.44,
        ));
    } else
      (vertexIndex(
        getDecalMaterial(ctx, CONTAINER_LOGO_DECALS[variant % 4]),
        0.2,
        dentAmount(coordZ - 1),
        doorDepth / 2,
        doorDepth - 0.36,
      ),
        vertexIndex(
          getDecalMaterial(ctx, 'csc_plate'),
          0.17,
          dentAmount(1),
          doorDepth / 2 + 0.05,
          0.36,
        ),
        type === 'container40hc' &&
          vertexIndex(
            getDecalMaterial(ctx, 'caution_stripes'),
            0.1,
            doorFrameTop - 0.04,
            doorDepth / 2,
            doorDepth - 0.1,
          ));
    if ((builder.pop(), doorsAreOpen))
      for (let ribIndex = 0; ribIndex < 3; ribIndex++) {
        let ribY = (doorDepth * ribIndex) / 3,
          handleY = (doorDepth * (ribIndex + 1)) / 3,
          handleSide = [
            doorStartX + Math.sin(sideFlag) * ribY,
            depthSign - sideSign * Math.cos(sideFlag) * ribY,
          ],
          handleEndY = [
            doorStartX + Math.sin(sideFlag) * handleY,
            depthSign - sideSign * Math.cos(sideFlag) * handleY,
          ];
        colliders.push({
          min: [
            Math.min(handleSide[0], handleEndY[0]) - 0.03,
            doorFrameBottom,
            Math.min(handleSide[1], handleEndY[1]) - 0.03,
          ],
          max: [
            Math.max(handleSide[0], handleEndY[0]) + 0.03,
            doorFrameTop,
            Math.max(handleSide[1], handleEndY[1]) + 0.03,
          ],
          surface: 'metal',
        });
      }
  }
  for (let sideSign of [1, -1])
    for (let sideFlag of [0.31, 0.83])
      for (let depthSign of [-1, 1]) {
        let coordX = sideSign * (halfWidth - 0.058) - sideSign * sideFlag;
        builder.add(
          CONTAINER_BODY_MATERIAL_KEY,
          je(
            boxGeometry(0.035, 0.05, 0.11),
            halfLen - 0.03,
            depthSign > 0 ? propH - 0.07 : 0.115,
            coordX,
          ),
        );
      }
  let placeDoorDecal = ($, ue, me, ee, B, P) => {
      let V = B * $.aspect;
      P && V > P && ((B *= P / V), (V = P));
      let Y = me - V / 2,
        L = me + V / 2,
        Z = ue > 0 ? Y : -L,
        J = ue > 0 ? L : -Y,
        oe = buildCorrugationStations(
          Math.max(panelStart, Z),
          Math.min(panelEnd, J),
          SIDE_CORRUGATION.P,
          SIDE_CORRUGATION.d,
          SIDE_CORRUGATION.fo,
          SIDE_CORRUGATION.sl,
          panelStart + 0.02,
        ),
        fe = ee - B / 2,
        le = ee + B / 2,
        R = loftProfileSurface(
          oe,
          [fe, le],
          (ae, k, ce) => [ae, ce, ue * (sideX + k + 0.003 - dentDepthFn(ae, ce, ue))],
          {
            center: [0, propH / 2, 0],
          },
        ),
        I = R.attributes.position,
        se = R.attributes.uv;
      for (let ae = 0; ae < I.count; ae++) {
        let k = (I.getX(ae) - Z) / (J - Z);
        se.setXY(ae, ue > 0 ? k : 1 - k, (I.getY(ae) - fe) / B);
      }
      return (builder.add($.material, R, null, !0), V);
    },
    ownerLabel = getLabelMaterial(
      ctx,
      CONTAINER_OWNER_CODES[variant % CONTAINER_OWNER_CODES.length],
      {
        color: 'white',
        font: 'stencil',
        distress: 0.3,
      },
    ),
    typeLabel = getLabelMaterial(ctx, spec.type, {
      color: 'white',
      font: 'stencil',
      distress: 0.3,
    }),
    logoDecal = getDecalMaterial(ctx, CONTAINER_LOGO_DECALS[variant % 4]);
  for (let sideSign of [-1, 1]) {
    let sideFlag = Math.min(propH * 0.4, 1.05),
      depthSign = Math.min(sideFlag * logoDecal.aspect, type === 'container20' ? 2.2 : 3.4);
    placeDoorDecal(
      logoDecal,
      sideSign,
      type === 'container20' ? -0.75 : -halfLen * 0.42,
      propH * 0.52,
      depthSign / logoDecal.aspect,
      depthSign,
    );
    let coordX = Math.min(0.14 * ownerLabel.aspect, 1.9);
    placeDoorDecal(ownerLabel, sideSign, halfLen - 0.3 - coordX / 2, propH - 0.32, 0.14, 1.9);
    let coordY = Math.min(0.11 * typeLabel.aspect, 0.6);
    placeDoorDecal(typeLabel, sideSign, halfLen - 0.3 - coordY / 2, propH - 0.52, 0.11, 0.6);
    let coordZ = Math.round((1 + rand() * 2) * (0.4 + wear) * (propW > 7 ? 1.6 : 1));
    for (let falloffValue = 0; falloffValue < coordZ; falloffValue++) {
      let edgeMix = getDecalMaterial(ctx, rand() < 0.6 ? 'rust_run' : 'grime_streak'),
        shadeColor = 0.5 + rand() * 0.7,
        edgeDistance = Math.min(0.5, Math.max(0.16, shadeColor * edgeMix.aspect));
      placeDoorDecal(
        {
          material: edgeMix.material,
          aspect: edgeDistance / shadeColor,
        },
        sideSign,
        (rand() * 2 - 1) * (halfLen - 0.6),
        ribEndY - shadeColor / 2 - 0.005,
        shadeColor,
      );
    }
  }
  return (
    doorsAreOpen
      ? colliders.push(
          {
            min: [-halfLen, 0, -halfWidth],
            max: [halfLen, doorZoneTopY, halfWidth],
            surface: 'wood',
          },
          {
            min: [-halfLen, propH - 0.09, -halfWidth],
            max: [halfLen, propH, halfWidth],
            surface: 'metal',
          },
          {
            min: [-halfLen, 0, -halfWidth],
            max: [halfLen, propH, -halfWidth + 0.07],
            surface: 'metal',
          },
          {
            min: [-halfLen, 0, halfWidth - 0.07],
            max: [halfLen, propH, halfWidth],
            surface: 'metal',
          },
          {
            min: [-halfLen, 0, -halfWidth],
            max: [-halfLen + 0.07, propH, halfWidth],
            surface: 'metal',
          },
        )
      : colliders.push({
          min: [-halfLen, 0, -halfWidth],
          max: [halfLen, propH, halfWidth],
          surface: 'metal',
        }),
    {
      parts: builder.parts(),
      colliders: colliders,
    }
  );
}

/**
 * 集装箱实例化入口：查零件缓存 → 按色号挑漆材质（顶点色相乘）→ 组装 Group 并打上尺寸/碰撞盒元数据
 */
export function buildBasicContainer(ctx, type, contOpts = {}) {
  let spec = CONTAINER_SPECS[type],
    seed = contOpts.seed === void 0 ? 0 : Math.abs(Math.floor(contOpts.seed)),
    variant = seed % CONTAINER_VARIANT_COUNT,
    doorsOpen = Math.round(THREE.MathUtils.clamp(contOpts.doors || 0, 0, 1) * 10) / 10,
    wear =
      Math.round(THREE.MathUtils.clamp(contOpts.wear === void 0 ? 0.5 : contOpts.wear, 0, 1) * 2) /
      2,
    cacheKey = type + '|' + variant + '|' + doorsOpen + '|' + wear,
    partsCache = CONTAINER_PARTS_CACHE.get(ctx.mats);
  (partsCache || ((partsCache = new Map()), CONTAINER_PARTS_CACHE.set(ctx.mats, partsCache)),
    partsCache.has(cacheKey) ||
      partsCache.set(cacheKey, buildContainerParts(ctx, type, variant, doorsOpen, wear)));
  let cachedParts = partsCache.get(cacheKey),
    paintColor = contOpts.color;
  CONTAINER_PAINT_COLORS.includes(paintColor) ||
    (paintColor =
      contOpts.seed === void 0
        ? spec.def
        : CONTAINER_PAINT_COLORS[(seed * 7 + 3) % CONTAINER_PAINT_COLORS.length]);
  let group = buildPartsGroup(
      cachedParts.parts,
      new Map([
        [
          CONTAINER_BODY_MATERIAL_KEY,
          ctx.mats.get('paint_' + paintColor, {
            vertexColors: !0,
          }),
        ],
      ]),
    ),
    size = PROP_SIZES[type];
  return (
    (group.userData.color = paintColor),
    (group.userData.doors = doorsOpen),
    tagPropUserData(
      group,
      type,
      [size[0], size[1], size[2]],
      cachedParts.colliders.map((collider) => ({
        min: collider.min.slice(),
        max: collider.max.slice(),
        surface: collider.surface,
      })),
    )
  );
}

/**
 * 新泽西混凝土隔离墩：12 点梯形剖面放样 + 凿痕/污渍/缺角顶点色、顶部吊装孔与反光片，可选黄色警示带；碰撞盒分成底座与墙体两段
 */
export function buildJerseyBarrier(ctx, opts = {}) {
  let builder = new PartBuilder(ctx),
    seed = opts.seed | 0,
    rand = $a(seed + 11),
    noiseOffset = seed * 3.7,
    concreteMat = builder.M('concrete', {
      vertexColors: !0,
    }),
    profile = [
      [-0.3, 0],
      [0.3, 0],
      [0.3, 0.076],
      [0.127, 0.33],
      [0.1, 0.57],
      [0.077, 0.79],
      [0.06, 0.81],
      [-0.06, 0.81],
      [-0.077, 0.79],
      [-0.1, 0.57],
      [-0.127, 0.33],
      [-0.3, 0.076],
    ],
    stations = [-1.5, -1.47];
  for (let stationCoord = -1.25; stationCoord <= 1.26; stationCoord += 0.25)
    stations.push(stationCoord);
  stations.push(1.47, 1.5);
  let dents = [];
  for (let stationCoord = 0; stationCoord < 7; stationCoord++)
    dents.push([(rand() * 2 - 1) * 1.5, rand() * 0.8, 0.08 + rand() * 0.14, rand() < 0.5 ? 1 : -1]);
  let shell = loftProfileSurface(
    profile,
    stations,
    (stationCoord, profileHeight, depthCoord) => {
      let baseTint = Math.abs(depthCoord) > 1.49 ? 1 : 0;
      return [
        depthCoord,
        profileHeight - baseTint * 0.022 * (profileHeight / 0.81),
        stationCoord * (1 - baseTint * 0.09),
      ];
    },
    {
      closed: !0,
      caps: !0,
    },
  );
  builder.add(concreteMat, shell, (stationCoord, profileHeight, depthCoord) => {
    let baseTint =
        0.86 +
        0.2 * valueNoise2D(stationCoord * 1.3 + noiseOffset, profileHeight * 3 + depthCoord * 2) +
        0.08 * valueNoise2D(stationCoord * 7, profileHeight * 9 + noiseOffset),
      vertexColor = [baseTint, baseTint * 0.99, baseTint * 0.97];
    vertexColor = lerpVec3(
      vertexColor,
      [baseTint * 0.5, baseTint * 0.48, baseTint * 0.44],
      smoothstepRange(0.3, 0, profileHeight) * 0.8,
    );
    let stainAmount =
      smoothstepRange(0.55, 0.8, valueNoise2D(stationCoord * 4.5 + noiseOffset, 3.3)) *
      smoothstepRange(0.25, 0.8, profileHeight);
    vertexColor = lerpVec3(
      vertexColor,
      [baseTint * 0.62, baseTint * 0.6, baseTint * 0.56],
      stainAmount * 0.6,
    );
    let rustAmount =
      smoothstepRange(
        0.6,
        0.85,
        valueNoise2D(stationCoord * 2.1 + noiseOffset * 2, depthCoord * 3),
      ) *
      smoothstepRange(0.2, 0.33, profileHeight) *
      smoothstepRange(0.62, 0.4, profileHeight);
    vertexColor = lerpVec3(vertexColor, [0.22, 0.22, 0.22], rustAmount * 0.65);
    for (let dentRecord of dents)
      if (Math.sign(depthCoord || 1) === dentRecord[3]) {
        let dentFalloff =
          Math.hypot(stationCoord - dentRecord[0], profileHeight - dentRecord[1]) / dentRecord[2];
        dentFalloff < 1 &&
          (vertexColor = lerpVec3(vertexColor, [1.12, 1.1, 1.05], (1 - dentFalloff) * 0.7));
      }
    return (
      Math.abs(stationCoord) > 1.4 &&
        (vertexColor = lerpVec3(
          vertexColor,
          [1.08, 1.06, 1.02],
          0.4 * valueNoise2D(profileHeight * 9, depthCoord * 9 + noiseOffset),
        )),
      vertexColor
    );
  });
  let fittingColor = [0.05, 0.05, 0.05];
  for (let stationCoord of [-1, 1])
    for (let profileHeight of [-0.85, 0.85])
      (builder.add(
        concreteMat,
        je(createPlaneGeometry(0.3, 0.058), profileHeight, 0.03, stationCoord * 0.3008, [
          0,
          stationCoord > 0 ? 0 : PI,
          0,
        ]),
        fittingColor,
      ),
        builder.box(concreteMat, 0.34, 0.012, 0.012, profileHeight, 0.064, stationCoord * 0.3, {
          r: 0.003,
          col: [0.7, 0.7, 0.68],
        }));
  for (let stationCoord of [-0.9, 0.9])
    builder.tube(
      builder.M('steel_rust'),
      [
        [stationCoord - 0.05, 0.8, 0],
        [stationCoord - 0.04, 0.85, 0],
        [stationCoord + 0.04, 0.85, 0],
        [stationCoord + 0.05, 0.8, 0],
      ],
      0.008,
      {
        seg: 5,
      },
    );
  if (opts.stripe) {
    let stationCoord = builder.M('hazard_stripes');
    builder.add(
      stationCoord,
      je(createPlaneGeometryWorldUV(2.9, 0.118), 0, 0.8125, 0, [-PI / 2, 0, 0]),
    );
    for (let profileHeight of [-1, 1])
      builder.add(
        stationCoord,
        je(createPlaneGeometryWorldUV(2.9, 0.2), 0, 0.68, profileHeight * 0.0905, [
          profileHeight > 0 ? -0.108 : 0.108,
          profileHeight > 0 ? 0 : PI,
          0,
        ]),
      );
  }
  return tagPropUserData(builder.group(), 'jersey_barrier', getPropSize3('jersey_barrier'), [
    {
      min: [-1.5, 0, -0.3],
      max: [1.5, 0.33, 0.3],
      surface: 'concrete',
    },
    {
      min: [-1.5, 0.33, -0.13],
      max: [1.5, 0.81, 0.13],
      surface: 'concrete',
    },
  ]);
}

/**
 * 在灯杆顶部装一只泛光灯头：外壳+发光面+散热鳍片+接线盒，按 yaw/tilt 定位，可复用成整排灯头
 */
function addFloodlightHead(builder, frameMat, housingMat, lensMat, posX, posY, posZ, yaw, tilt) {
  (builder.push(composeTransformMatrix(posX, posY, posZ, [0, yaw, 0])),
    builder.push(composeTransformMatrix(0, 0, 0, [0, 0, tilt])),
    builder.box(housingMat, 0.1, 0.34, 0.46, 0.09, 0, 0, {
      r: 0.014,
    }),
    builder.add(
      lensMat,
      je(createPlaneGeometry(0.4, 0.28), 0.1415, 0, 0, [0, PI / 2, 0]),
      null,
      !0,
    ),
    builder.box(housingMat, 0.012, 0.018, 0.47, 0.146, 0.156, 0, {
      r: 0,
    }),
    builder.box(housingMat, 0.012, 0.018, 0.47, 0.146, -0.156, 0, {
      r: 0,
    }),
    builder.box(housingMat, 0.012, 0.33, 0.018, 0.146, 0, 0.222, {
      r: 0,
    }),
    builder.box(housingMat, 0.012, 0.33, 0.018, 0.146, 0, -0.222, {
      r: 0,
    }),
    builder.box(housingMat, 0.09, 0.008, 0.48, 0.17, 0.175, 0, {
      r: 0,
      rot: [0, 0, -0.12],
    }));
  for (let finOffset = -3; finOffset <= 3; finOffset++)
    builder.add(housingMat, je(boxGeometry(0.045, 0.3, 0.008), 0.02, 0, finOffset * 0.062));
  (builder.pop(),
    builder.box(frameMat, 0.03, 0.05, 0.56, 0.02, -0.02, 0, {
      r: 0.004,
    }));
  for (let finOffset of [-1, 1])
    builder.box(frameMat, 0.1, 0.05, 0.012, 0.05, -0.02, finOffset * 0.275, {
      r: 0,
      rot: [0, 0, tilt * 0.5],
    });
  builder.pop();
}

/**
 * 高杆灯：混凝土基座、8.6° 收分的锥形杆身、法兰螺栓、爬梯与顶部横梁挂 4 只泛光灯；把灯位写进 userData.lamps 供光照系统点亮
 */
export function buildLightMast(ctx, options = {}) {
  let builder = new PartBuilder(ctx),
    steelMat = builder.M('steel_galv'),
    concreteMat = builder.M('concrete', {
      vertexColors: !0,
    }),
    steelDarkMat = builder.M('steel_dark'),
    lensMat = ctx.mats.emissive(16769981, options.on === !1 ? 0.02 : 8);
  (builder.box(concreteMat, 0.8, 0.32, 0.8, 0, 0.16, 0, {
    r: 0.03,
    col: (x, y, b) => {
      let m = 0.62 + 0.36 * smoothstepRange(0, 0.3, y) + 0.1 * valueNoise2D(x * 5, b * 5);
      return [m, m, m * 0.97];
    },
  }),
    builder.box(steelMat, 0.5, 0.03, 0.5, 0, 0.335, 0, {
      r: 0.006,
    }));
  for (let vertexX = 0; vertexX < 8; vertexX++) {
    let vertexY = ((vertexX + 0.5) * PI) / 4,
      vertexZ = Math.cos(vertexY) * 0.215,
      shadeValue = Math.sin(vertexY) * 0.215;
    (builder.cyl(steelMat, 0.014, 0.014, 0.1, vertexZ, 0.38, shadeValue, {
      seg: 6,
    }),
      builder.cyl(steelMat, 0.027, 0.027, 0.024, vertexZ, 0.362, shadeValue, {
        seg: 6,
        flat: !0,
      }));
  }
  let poleBaseY = 0.35,
    poleTopY = 13.3,
    poleRadiusBase = 0.168,
    poleRadiusTop = 0.07,
    poleRadiusAt = (x) =>
      poleRadiusBase +
      ((poleRadiusTop - poleRadiusBase) * (x - poleBaseY)) / (poleTopY - poleBaseY),
    poleSections = [
      [poleBaseY, 4.75, 0],
      [4.6, 9.15, 0.007],
      [9, poleTopY, 0.014],
    ];
  for (let [vertexX, vertexY, vertexZ] of poleSections)
    builder.cyl(
      steelMat,
      poleRadiusAt(vertexY) + vertexZ,
      poleRadiusAt(vertexX) + vertexZ,
      vertexY - vertexX,
      0,
      (vertexX + vertexY) / 2,
      0,
      {
        seg: 8,
        flat: !0,
        open: !0,
        rot: [0, PI / 8, 0],
      },
    );
  for (let vertexX = 0; vertexX < 4; vertexX++) {
    let vertexY = (vertexX * PI) / 2;
    builder.box(
      steelMat,
      0.012,
      0.2,
      0.12,
      Math.cos(vertexY) * 0.2,
      0.45,
      -Math.sin(vertexY) * 0.2,
      {
        r: 0,
        rot: [0, vertexY + PI / 2, 0],
      },
    );
  }
  (builder.cyl(steelMat, 0.2, 0.2, 0.02, 0, 0.36, 0, {
    seg: 8,
    rot: [0, PI / 8, 0],
  }),
    builder.cyl(steelMat, 0.09, 0.09, 0.03, 0, poleTopY, 0, {
      seg: 8,
      rot: [0, PI / 8, 0],
    }));
  let plateX = poleRadiusAt(1.05) * 0.924;
  (builder.box(steelMat, 0.13, 0.52, 0.012, 0, 1.05, plateX + 0.005, {
    r: 0.004,
  }),
    builder.box(steelDarkMat, 0.03, 0.045, 0.012, 0.04, 1.05, plateX + 0.013, {
      r: 0.003,
    }),
    builder.decal(getDecalMaterial(ctx, 'hazard_voltage'), 0.09, -0.01, 1.2, plateX + 0.0125, null),
    builder.tube(
      steelDarkMat,
      [
        [-0.3, 0.3, 0.28],
        [-0.3, 0.52, 0.28],
        [-0.24, 0.72, 0.2],
        [-0.1, 0.8, 0.1],
      ],
      0.024,
      {
        seg: 6,
      },
    ),
    builder.cyl(steelDarkMat, 0.034, 0.034, 0.03, -0.3, 0.335, 0.28, {
      seg: 8,
    }),
    builder.bar(steelMat, [0.1, 3, -0.13], [0.42, 3, -0.13], 0.012),
    builder.bar(steelMat, [0.1, 3, 0.13], [0.42, 3, 0.13], 0.012),
    builder.bar(steelMat, [0.42, 3, -0.16], [0.42, 3, 0.16], 0.012, {
      caps: !0,
    }),
    builder.bar(steelMat, [0.42, 3, -0.13], [0.42, 3.09, -0.13], 0.012, {
      caps: !0,
    }),
    builder.bar(steelMat, [0.42, 3, 0.13], [0.42, 3.09, 0.13], 0.012, {
      caps: !0,
    }),
    builder.cyl(steelMat, poleRadiusAt(3) + 0.012, poleRadiusAt(3) + 0.012, 0.05, 0, 3, 0, {
      seg: 8,
      rot: [0, PI / 8, 0],
    }));
  let rungIndex = 0;
  for (let vertexX = 3.45; vertexX < 12.9; vertexX += 0.38, rungIndex++) {
    let vertexY = rungIndex % 2 ? 1 : -1;
    builder.bar(
      steelMat,
      [0, vertexX, vertexY * poleRadiusAt(vertexX) * 0.8],
      [0, vertexX, vertexY * (poleRadiusAt(vertexX) + 0.15)],
      0.009,
      {
        seg: 5,
        caps: !0,
      },
    );
  }
  let crossbarY = poleTopY + 0.12;
  (builder.box(steelMat, 0.1, 0.1, 1.9, 0, crossbarY, 0, {
    r: 0.012,
  }),
    builder.box(steelMat, 0.5, 0.07, 0.07, 0, crossbarY + 0.085, 0.55, {
      r: 0.01,
    }),
    builder.box(steelMat, 0.5, 0.07, 0.07, 0, crossbarY + 0.085, -0.55, {
      r: 0.01,
    }),
    builder.beam(steelMat, [0, poleTopY - 0.5, 0.08], [0, crossbarY - 0.03, 0.7], 0.04, 0.04),
    builder.beam(steelMat, [0, poleTopY - 0.5, -0.08], [0, crossbarY - 0.03, -0.7], 0.04, 0.04));
  for (let vertexX of [-0.55, 0.55])
    (addFloodlightHead(
      builder,
      steelMat,
      steelDarkMat,
      lensMat,
      0.22,
      crossbarY - 0.14,
      vertexX,
      0,
      -0.62,
    ),
      addFloodlightHead(
        builder,
        steelMat,
        steelDarkMat,
        lensMat,
        -0.22,
        crossbarY - 0.14,
        vertexX,
        PI,
        -0.62,
      ));
  (builder.box(steelDarkMat, 0.16, 0.2, 0.12, 0, poleTopY - 0.25, -0.14, {
    r: 0.01,
  }),
    builder.bar(steelMat, [0, crossbarY, 0], [0, 14, 0], 0.012, {
      r2: 0.003,
      seg: 5,
      caps: !0,
    }));
  let group = builder.group();
  group.userData.lamps = [];
  for (let vertexX of [-0.55, 0.55])
    for (let vertexY of [-1, 1])
      group.userData.lamps.push({
        pos: [vertexY * 0.34, crossbarY - 0.22, vertexX],
        dir: [vertexY * 0.81, -0.58, 0],
        color: 16769981,
      });
  return tagPropUserData(group, 'light_mast', getPropSize3('light_mast'), [
    {
      min: [-0.4, 0, -0.4],
      max: [0.4, 0.32, 0.4],
      surface: 'concrete',
    },
    {
      min: [-0.17, 0.32, -0.17],
      max: [0.17, 14, 0.17],
      surface: 'metal',
    },
  ]);
}

/**
 * 3m 链网围栏单元：立柱、上下横管、轻微波浪的网面与顶部拉伸刺丝；posts/lean 参数控制单/双侧立柱与刺丝倾倒方向
 */
export function buildFencePanel(ctx, fenceOpts = {}) {
  let builder = new PartBuilder(ctx),
    rand = $a((fenceOpts.seed | 0) + 5),
    steelMat = builder.M('steel_galv'),
    concreteMat = builder.M('concrete', {
      vertexColors: !0,
    }),
    meshMat = builder.M('chainlink', {
      doubleSide: !0,
    }),
    postsMode = fenceOpts.posts || 'both',
    leanDir = fenceOpts.lean === 1 ? 1 : -1,
    postXs =
      postsMode === 'both'
        ? [-1.5, 1.5]
        : postsMode === 'left'
          ? [-1.5]
          : postsMode === 'right'
            ? [1.5]
            : [];
  for (let idx of postXs) {
    (builder.box(concreteMat, 0.32, 0.09, 0.32, idx, 0.035, 0, {
      r: 0.02,
      col: (d, v) => {
        let g = 0.6 + 0.4 * smoothstepRange(0, 0.08, v);
        return [g, g, g];
      },
    }),
      builder.cyl(steelMat, 0.03, 0.03, 2.02, idx, 1.05, 0, {
        seg: 8,
        open: !0,
      }),
      builder.cyl(steelMat, 0.05, 0.05, 0.012, idx, 0.086, 0, {
        seg: 8,
      }),
      builder.bar(steelMat, [idx, 2.02, 0], [idx, 2.4 - 0.02, leanDir * 0.36], 0.019, {
        seg: 6,
        caps: !0,
      }),
      builder.cyl(steelMat, 0.034, 0.034, 0.05, idx, 2.03, 0, {
        seg: 8,
      }));
    for (let surfaceU of [0.2, 1.05, 1.9])
      builder.cyl(steelMat, 0.034, 0.034, 0.03, idx, surfaceU, 0, {
        seg: 8,
        open: !0,
      });
  }
  builder.bar(steelMat, [-1.5, 2, 0.036], [1.5, 2, 0.036], 0.021, {
    seg: 7,
  });
  for (let idx of [0.09, 1.02])
    builder.bar(steelMat, [-1.5, idx, 0.012], [1.5, idx, 0.012], 0.0035, {
      seg: 4,
    });
  (builder.box(steelMat, 0.008, 1.9, 0.02, -1.462, 1.03, 0.012, {
    r: 0,
  }),
    builder.box(steelMat, 0.008, 1.9, 0.02, 1.462, 1.03, 0.012, {
      r: 0,
    }));
  let meshPlane = new THREE.PlaneGeometry(2.92, 1.93, 6, 3),
    meshPos = meshPlane.attributes.position,
    meshUv = meshPlane.attributes.uv;
  for (let idx = 0; idx < meshPos.count; idx++) {
    let surfaceU = meshPos.getX(idx),
      surfaceV = meshPos.getY(idx);
    (meshUv.setXY(idx, surfaceU + 1.5, surfaceV + 1),
      meshPos.setZ(
        idx,
        0.012 +
          0.02 *
            (valueNoise2D(surfaceU * 1.3 + (fenceOpts.seed | 0), surfaceV * 1.5) - 0.5) *
            (1 - Math.abs(surfaceU) / 1.46),
      ));
  }
  (meshPlane.computeVertexNormals(), builder.add(meshMat, je(meshPlane, 0, 1.025, 0)));
  for (let idx = 0; idx < 3; idx++) {
    let surfaceU = 0.3 + idx * 0.33,
      surfaceV = 2.02 + surfaceU * 0.36,
      greyTone = leanDir * surfaceU * 0.36;
    builder.bar(steelMat, [-1.5, surfaceV, greyTone], [1.5, surfaceV, greyTone], 0.0032, {
      seg: 4,
    });
    for (let barbX = -1.42 + (idx % 2) * 0.09; barbX < 1.45; barbX += 0.18)
      builder.add(
        steelMat,
        je(boxGeometry(0.004, 0.032, 0.004), barbX, surfaceV, greyTone, [
          rand() * 3,
          0,
          0.8 + rand(),
        ]),
      );
  }
  for (let idx = 0; idx < 5; idx++)
    builder.add(steelMat, je(boxGeometry(0.012, 0.012, 0.03), -1.2 + idx * 0.6, 2, 0.02));
  return tagPropUserData(builder.group(), 'fence_panel', getPropSize3('fence_panel'), [
    {
      min: [-1.5, 0, -0.04],
      max: [1.5, 2.4, 0.04],
      surface: 'metal',
    },
  ]);
}

/**
 * 岗亭：2.6×2.2m 带玻璃窗的板房，含窗框、窗台、屋顶飞檐、雨落管、桌面、显示器与「GATE CONTROL」铭牌，灯位写进 userData.lamps
 */
export function buildGuardBooth(ctx, boothOpts = {}) {
  let builder = new PartBuilder(ctx),
    seed = boothOpts.seed | 0,
    noiseOffset = seed * 1.3,
    boothWidth = 2.6,
    boothDepth = 2.2,
    halfWidth = boothWidth / 2,
    halfDepth = boothDepth / 2,
    wallMat = builder.M(
      'paint_' + (['white', 'grey', 'teal'].includes(boothOpts.color) ? boothOpts.color : 'white'),
      {
        vertexColors: !0,
      },
    ),
    steelDarkMat = builder.M('steel_dark'),
    steelGalvMat = builder.M('steel_galv'),
    glassMat = builder.M('glass', {
      doubleSide: !0,
    }),
    woodMat = builder.M('wood_dark'),
    polymerMat = builder.M('polymer_black'),
    paintColorFn = (H, O, q) => {
      let U =
        (0.9 + 0.14 * valueNoise2D(H * 2 + noiseOffset, O * 2 + q)) *
        (0.6 + 0.4 * smoothstepRange(0.1, 0.7, O)) *
        (1 - 0.25 * smoothstepRange(2.25, 2.45, O));
      return [U, U * 0.985, U * 0.96];
    };
  builder.defCol.set(wallMat, paintColorFn);
  let baseHeight = 0.12,
    sillHeight = 1,
    glassTopY = 2.08,
    roofHeight = 2.42;
  builder.box(steelDarkMat, boothWidth, 0.12, boothDepth, 0, 0.06, 0, {
    r: 0.015,
  });
  for (let layoutOffset of [-0.7, 0.7])
    builder.box(steelDarkMat, boothWidth + 0.06, 0.06, 0.1, 0, 0.03, layoutOffset, {
      r: 0.01,
    });
  for (let layoutOffset of [-1, 1])
    for (let sideSignValue of [-1, 1])
      builder.box(
        wallMat,
        0.09,
        roofHeight - baseHeight,
        0.09,
        layoutOffset * (halfWidth - 0.045),
        (roofHeight + baseHeight) / 2,
        sideSignValue * (halfDepth - 0.045),
        {
          r: 0.012,
        },
      );
  let doorLeftX = 0.3,
    doorRightX = 1.12,
    buildSideWall = (H, O) => {
      let q =
        O > 0 ? [[-halfWidth + 0.09, doorLeftX - 0.04]] : [[-halfWidth + 0.09, halfWidth - 0.09]];
      for (let [U, T] of q) {
        (builder.box(
          wallMat,
          T - U,
          sillHeight - baseHeight,
          0.05,
          (U + T) / 2,
          (sillHeight + baseHeight) / 2,
          H,
          {
            r: 0.006,
          },
        ),
          builder.box(wallMat, T - U, 0.05, 0.075, (U + T) / 2, sillHeight + 0.01, H + O * 0.005, {
            r: 0.008,
          }),
          builder.box(
            glassMat,
            T - U,
            glassTopY - sillHeight - 0.03,
            0.008,
            (U + T) / 2,
            (sillHeight + glassTopY) / 2 + 0.01,
            H,
            {
              r: 0,
            },
          ));
        let D = T - U > 1.6 ? 2 : 1;
        for (let C = 1; C <= D; C++)
          builder.box(
            wallMat,
            0.04,
            glassTopY - sillHeight,
            0.05,
            U + ((T - U) * C) / (D + 1),
            (sillHeight + glassTopY) / 2,
            H,
            {
              r: 0.006,
            },
          );
        for (let C = 1; C < 3; C++)
          builder.box(
            wallMat,
            0.006,
            sillHeight - baseHeight - 0.04,
            0.056,
            U + ((T - U) * C) / 3,
            (sillHeight + baseHeight) / 2,
            H,
            {
              r: 0,
            },
          );
      }
      builder.box(
        wallMat,
        boothWidth - 0.18,
        roofHeight - glassTopY,
        0.05,
        0,
        (roofHeight + glassTopY) / 2,
        H,
        {
          r: 0.006,
        },
      );
    };
  (buildSideWall(halfDepth - 0.03, 1), buildSideWall(-halfDepth + 0.03, -1));
  for (let layoutOffset of [-1, 1]) {
    let sideSignValue = layoutOffset * (halfWidth - 0.03);
    (builder.box(
      wallMat,
      0.05,
      sillHeight - baseHeight,
      boothDepth - 0.18,
      sideSignValue,
      (sillHeight + baseHeight) / 2,
      0,
      {
        r: 0.006,
      },
    ),
      builder.box(
        wallMat,
        0.075,
        0.05,
        boothDepth - 0.18,
        sideSignValue + layoutOffset * 0.005,
        sillHeight + 0.01,
        0,
        {
          r: 0.008,
        },
      ),
      builder.box(
        glassMat,
        0.008,
        glassTopY - sillHeight - 0.03,
        boothDepth - 0.18,
        sideSignValue,
        (sillHeight + glassTopY) / 2 + 0.01,
        0,
        {
          r: 0,
        },
      ),
      builder.box(
        wallMat,
        0.05,
        glassTopY - sillHeight,
        0.04,
        sideSignValue,
        (sillHeight + glassTopY) / 2,
        0,
        {
          r: 0.006,
        },
      ),
      builder.box(
        wallMat,
        0.05,
        roofHeight - glassTopY,
        boothDepth - 0.18,
        sideSignValue,
        (roofHeight + glassTopY) / 2,
        0,
        {
          r: 0.006,
        },
      ));
  }
  let frontZ = halfDepth - 0.03;
  (builder.box(
    wallMat,
    0.05,
    glassTopY - baseHeight,
    0.07,
    doorLeftX - 0.015,
    (glassTopY + baseHeight) / 2,
    frontZ,
    {
      r: 0.006,
    },
  ),
    builder.box(
      wallMat,
      0.05,
      glassTopY - baseHeight,
      0.07,
      doorRightX + 0.015,
      (glassTopY + baseHeight) / 2,
      frontZ,
      {
        r: 0.006,
      },
    ),
    builder.box(
      wallMat,
      halfWidth - 0.09 - doorRightX - 0.04,
      glassTopY - baseHeight,
      0.05,
      (halfWidth - 0.09 + doorRightX + 0.04) / 2,
      (glassTopY + baseHeight) / 2,
      frontZ,
      {
        r: 0.006,
      },
    ));
  let windowWidth = doorRightX - doorLeftX - 0.02,
    windowCenterX = (doorLeftX + doorRightX) / 2;
  (builder.box(
    wallMat,
    windowWidth,
    sillHeight - baseHeight - 0.01,
    0.04,
    windowCenterX,
    (sillHeight + baseHeight) / 2,
    frontZ + 0.005,
    {
      r: 0.006,
    },
  ),
    builder.box(wallMat, windowWidth, 0.07, 0.04, windowCenterX, glassTopY - 0.04, frontZ + 0.005, {
      r: 0.006,
    }));
  for (let layoutOffset of [-1, 1])
    builder.box(
      wallMat,
      0.07,
      glassTopY - sillHeight,
      0.04,
      windowCenterX + layoutOffset * (windowWidth / 2 - 0.035),
      (sillHeight + glassTopY) / 2,
      frontZ + 0.005,
      {
        r: 0.006,
      },
    );
  (builder.box(
    glassMat,
    windowWidth - 0.12,
    glassTopY - sillHeight - 0.08,
    0.008,
    windowCenterX,
    (sillHeight + glassTopY) / 2 - 0.02,
    frontZ + 0.005,
    {
      r: 0,
    },
  ),
    builder.box(
      steelGalvMat,
      windowWidth - 0.06,
      0.22,
      0.004,
      windowCenterX,
      baseHeight + 0.14,
      frontZ + 0.027,
      {
        r: 0,
      },
    ),
    builder.box(steelGalvMat, 0.03, 0.14, 0.02, doorLeftX + 0.09, 1.05, frontZ + 0.035, {
      r: 0.004,
    }),
    builder.bar(
      steelGalvMat,
      [doorLeftX + 0.09, 1, frontZ + 0.06],
      [doorLeftX + 0.2, 1, frontZ + 0.06],
      0.009,
      {
        caps: !0,
      },
    ));
  for (let layoutOffset of [0.4, 1.75])
    builder.cyl(steelGalvMat, 0.012, 0.012, 0.1, doorRightX + 0.002, layoutOffset, frontZ + 0.03, {
      seg: 6,
    });
  (builder.box(steelDarkMat, 0.9, 0.03, 0.3, windowCenterX, 0.105, halfDepth + 0.15, {
    r: 0.006,
  }),
    builder.box(wallMat, boothWidth + 0.36, 0.1, boothDepth + 0.4, 0, roofHeight + 0.05, 0, {
      r: 0.02,
      col: (H, O, q) => {
        let U = 0.72 + 0.2 * valueNoise2D(H * 1.5, q * 1.5 + noiseOffset);
        return [U, U, U * 0.97];
      },
    }),
    builder.box(steelDarkMat, boothWidth + 0.3, 0.03, boothDepth + 0.34, 0, roofHeight + 0.112, 0, {
      r: 0.01,
    }));
  for (let layoutOffset of [-1, 1])
    builder.box(
      steelGalvMat,
      boothWidth + 0.36,
      0.06,
      0.08,
      0,
      roofHeight - 0.005,
      layoutOffset * (halfDepth + 0.2 + 0.03),
      {
        r: 0.012,
      },
    );
  builder.tube(
    steelGalvMat,
    [
      [-halfWidth - 0.16, roofHeight - 0.03, halfDepth + 0.23],
      [-halfWidth - 0.1, roofHeight - 0.2, halfDepth + 0.1],
      [-halfWidth - 0.03, roofHeight - 0.4, halfDepth + 0.03],
      [-halfWidth - 0.03, 0.2, halfDepth + 0.03],
      [-halfWidth - 0.1, 0.06, halfDepth + 0.1],
    ],
    0.03,
    {
      seg: 6,
      tension: 0.2,
    },
  );
  let deskX = -halfWidth - 0.17;
  (builder.box(wallMat, 0.3, 0.52, 0.78, deskX, 0.62, -0.25, {
    r: 0.02,
  }),
    builder.add(
      wallMat,
      je(createRoundedRectFanGeometry(0.44, 0.44, 6), deskX - 0.151, 0.62, -0.14, [0, -PI / 2, 0]),
      [0.06, 0.06, 0.06],
    ));
  for (let layoutOffset = -3; layoutOffset <= 3; layoutOffset++)
    builder.add(
      steelDarkMat,
      je(
        boxGeometry(0.006, 0.008, Math.sqrt(0.22 * 0.22 - (layoutOffset * 0.06) ** 2) * 2),
        deskX - 0.154,
        0.62 + layoutOffset * 0.06,
        -0.14,
      ),
    );
  builder.cyl(steelDarkMat, 0.05, 0.05, 0.012, deskX - 0.156, 0.62, -0.14, {
    seg: 8,
    rot: [0, 0, PI / 2],
  });
  for (let layoutOffset of [-0.55, 0.05])
    builder.beam(
      steelDarkMat,
      [-halfWidth, 0.32, layoutOffset],
      [deskX - 0.1, 0.34, layoutOffset],
      0.03,
      0.03,
      {
        r: 0,
      },
    );
  (builder.tube(
    builder.M('rubber'),
    [
      [deskX + 0.05, 0.86, 0.14],
      [deskX + 0.06, 1, 0.2],
      [-halfWidth - 0.02, 1.25, 0.24],
      [-halfWidth - 0.02, 2.2, 0.24],
    ],
    0.014,
    {
      seg: 5,
    },
  ),
    builder.add(
      builder.M('floor_epoxy'),
      je(createPlaneGeometryWorldUV(boothWidth - 0.1, boothDepth - 0.1), 0, 0.122, 0, [
        -PI / 2,
        0,
        0,
      ]),
    ),
    builder.box(woodMat, 0.6, 0.04, boothDepth - 0.3, -halfWidth + 0.4, 0.76, 0, {
      r: 0.008,
    }));
  for (let layoutOffset of [-0.85, 0.85])
    builder.box(steelDarkMat, 0.5, 0.64, 0.03, -halfWidth + 0.4, 0.44, layoutOffset, {
      r: 0.005,
    });
  (builder.box(polymerMat, 0.05, 0.32, 0.5, -halfWidth + 0.3, 1.02, -0.3, {
    r: 0.01,
    rot: [0, 0.25, 0],
  }),
    builder.add(
      ctx.mats.emissive(9418984, 1.6),
      je(createPlaneGeometry(0.45, 0.27), -halfWidth + 0.3 + 0.027, 1.02, -0.3 - 0.007, [
        0,
        PI / 2 + 0.25,
        0,
      ]),
      null,
      !0,
    ),
    builder.box(polymerMat, 0.05, 0.1, 0.06, -halfWidth + 0.28, 0.83, -0.3, {
      r: 0.008,
    }),
    builder.box(polymerMat, 0.18, 0.015, 0.22, -halfWidth + 0.28, 0.787, -0.3, {
      r: 0.004,
    }),
    builder.box(polymerMat, 0.14, 0.02, 0.42, -halfWidth + 0.52, 0.79, -0.25, {
      r: 0.004,
    }),
    builder.box(polymerMat, 0.46, 0.07, 0.46, -halfWidth + 1, 0.5, -0.2, {
      r: 0.02,
      rot: [0, 0.3, 0],
    }),
    builder.box(polymerMat, 0.07, 0.55, 0.42, -halfWidth + 1.22, 0.86, -0.13, {
      r: 0.02,
      rot: [0, 0.3, -0.12],
    }),
    builder.cyl(steelDarkMat, 0.025, 0.025, 0.36, -halfWidth + 1, 0.3, -0.2, {
      seg: 6,
    }));
  for (let layoutOffset = 0; layoutOffset < 5; layoutOffset++) {
    let sideSignValue = layoutOffset * PI * 0.4;
    builder.beam(
      steelDarkMat,
      [-halfWidth + 1, 0.16, -0.2],
      [
        -halfWidth + 1 + Math.cos(sideSignValue) * 0.26,
        0.14,
        -0.2 + Math.sin(sideSignValue) * 0.26,
      ],
      0.03,
      0.025,
      {
        r: 0,
      },
    );
  }
  (builder.box(steelDarkMat, 0.2, 0.07, 0.1, windowCenterX, glassTopY + 0.19, halfDepth + 0.03, {
    r: 0.012,
  }),
    builder.add(
      ctx.mats.emissive(16767398, boothOpts.on === !1 ? 0.02 : 5),
      je(createPlaneGeometry(0.17, 0.05), windowCenterX, glassTopY + 0.152, halfDepth + 0.035, [
        PI / 2,
        0,
        0,
      ]),
      null,
      !0,
    ),
    builder.decal(
      getLabelMaterial(ctx, 'GATE CONTROL', {
        color: 'black',
        font: 'stencil',
        distress: 0.2,
      }),
      0.1,
      -0.45,
      (roofHeight + glassTopY) / 2,
      halfDepth - 0.003,
      null,
      0.9,
    ),
    builder.decal(getDecalMaterial(ctx, 'berth4'), 0.34, halfWidth - 0.003, 0.56, 0.3, [
      0,
      PI / 2,
      0,
    ]),
    builder.decal(
      getDecalMaterial(ctx, 'no_entry'),
      0.2,
      windowCenterX,
      0.72,
      frontZ + 0.0265,
      null,
    ),
    builder.decal(
      getDecalMaterial(ctx, 'grime_streak'),
      0.7,
      -0.6,
      0.55,
      halfDepth - 0.003,
      null,
      0.3,
    ),
    builder.decal(
      getDecalMaterial(ctx, 'rust_run'),
      0.6,
      -halfWidth + 0.003 - 0,
      0.6,
      0.55,
      [0, -PI / 2, 0],
      0.25,
    ));
  let group = builder.group();
  return (
    (group.userData.lamps = [
      {
        pos: [windowCenterX, glassTopY + 0.14, halfDepth + 0.04],
        dir: [0, -1, 0.2],
        color: 16767398,
      },
    ]),
    tagPropUserData(group, 'guard_booth', getPropSize3('guard_booth'), [
      {
        min: [-halfWidth, 0, -halfDepth],
        max: [halfWidth, 2.54, halfDepth],
        surface: 'metal',
      },
    ])
  );
}

/**
 * 道闸：机箱、可绕轴转动的起落杆（open 参数 0..1 控制角度）、红白相间反光段与配对立柱；抬起时补一段碰撞盒防止穿模
 */
export function buildGateArm(ctx, armOpts = {}) {
  let builder = new PartBuilder(ctx),
    openAmount = THREE.MathUtils.clamp(armOpts.open || 0, 0, 1),
    orangeMat = builder.M('paint_orange', {
      vertexColors: !0,
    }),
    whiteMat = builder.M('paint_white'),
    redMat = builder.M('paint_red'),
    steelDarkMat = builder.M('steel_dark'),
    steelGalvMat = builder.M('steel_galv'),
    yellowMat = builder.M('paint_yellow'),
    housingX = -2.5 + 0.19,
    armY = 0.92;
  (builder.box(builder.M('concrete'), 0.5, 0.06, 0.46, housingX, 0.03, 0, {
    r: 0.015,
  }),
    builder.box(orangeMat, 0.36, 1, 0.3, housingX, 0.56, 0, {
      r: 0.02,
      col: (y, b) => {
        let m = 0.6 + 0.4 * smoothstepRange(0.05, 0.5, b);
        return [m, m, m];
      },
    }),
    builder.box(steelDarkMat, 0.4, 0.04, 0.34, housingX, 1.075, 0, {
      r: 0.012,
    }),
    builder.box(orangeMat, 0.3, 0.6, 0.012, housingX, 0.5, 0.151, {
      r: 0.004,
      col: [0.9, 0.9, 0.9],
    }),
    builder.cyl(steelGalvMat, 0.012, 0.012, 0.016, housingX + 0.1, 0.5, 0.16, {
      seg: 6,
      rot: [PI / 2, 0, 0],
    }),
    builder.decal(getDecalMaterial(ctx, 'hazard_general'), 0.14, housingX, 0.9, 0.153, null),
    builder.decal(
      getDecalMaterial(ctx, 'caution_stripes'),
      0.08,
      housingX,
      0.12,
      0.153,
      null,
      0.34,
    ),
    builder.cyl(steelDarkMat, 0.03, 0.03, 0.05, housingX, 1.12, 0, {
      seg: 8,
    }),
    builder.add(
      ctx.mats.emissive(16734750, 2.2),
      je(cylinderGeometry(0.026, 0.026, 0.045, 8), housingX, 1.165, 0),
      null,
      !0,
    ),
    builder.push(composeTransformMatrix(housingX, armY, 0, [0, 0, openAmount * 1.48])),
    builder.cyl(steelDarkMat, 0.075, 0.075, 0.36, 0, 0, 0, {
      seg: 10,
      rot: [PI / 2, 0, 0],
    }));
  for (let colorSlotArg of [-1, 1])
    builder.box(steelDarkMat, 0.62, 0.11, 0.012, 0.05, 0, colorSlotArg * 0.175, {
      r: 0.004,
    });
  builder.box(steelDarkMat, 0.3, 0.16, 0.3, -0.33, -0.02, 0, {
    r: 0.02,
  });
  let armLength = 4.62,
    armStartX = 0.12,
    stripeCount = 9,
    stripeWidth = armLength / stripeCount;
  for (let colorSlotArg = 0; colorSlotArg < stripeCount; colorSlotArg++)
    builder.box(
      colorSlotArg % 2 ? whiteMat : redMat,
      stripeWidth + 0.001,
      0.1 - colorSlotArg * 0.003,
      0.05,
      armStartX + stripeWidth * (colorSlotArg + 0.5),
      0,
      0,
      {
        r: 0.008,
      },
    );
  (builder.box(steelDarkMat, 0.03, 0.11, 0.06, armStartX + armLength + 0.012, 0, 0, {
    r: 0.008,
  }),
    builder.add(
      ctx.mats.emissive(16722450, 1.5),
      je(boxGeometry(0.05, 0.03, 0.054), armStartX + armLength - 0.5, 0.058, 0),
      null,
      !0,
    ),
    builder.pop());
  let postX = 2.5 - 0.1;
  (builder.box(builder.M('concrete'), 0.3, 0.05, 0.3, postX, 0.025, 0, {
    r: 0.012,
  }),
    builder.cyl(yellowMat, 0.04, 0.04, 0.8, postX, 0.45, 0, {
      seg: 8,
    }),
    builder.box(yellowMat, 0.14, 0.02, 0.16, postX, 0.855, 0, {
      r: 0.005,
    }));
  for (let colorSlotArg of [-1, 1])
    builder.box(yellowMat, 0.14, 0.14, 0.014, postX, 0.93, colorSlotArg * 0.073, {
      r: 0.004,
    });
  builder.cyl(steelGalvMat, 0.07, 0.07, 0.01, postX, 0.055, 0, {
    seg: 8,
  });
  let colliders = [
    {
      min: [housingX - 0.2, 0, -0.17],
      max: [housingX + 0.2, 1.1, 0.17],
      surface: 'metal',
    },
    {
      min: [postX - 0.07, 0, -0.08],
      max: [postX + 0.07, 1, 0.08],
      surface: 'metal',
    },
  ];
  return (
    openAmount < 0.5 &&
      colliders.push({
        min: [housingX, armY - 0.07, -0.04],
        max: [postX, armY + 0.07, 0.04],
        surface: 'metal',
      }),
    tagPropUserData(builder.group(), 'gate_arm', getPropSize3('gate_arm'), colliders)
  );
}

/**
 * 码头系船柱：双柱帽形回转体 + 锈蚀底座 + 螺栓，钢面用值噪声做出即将锈穿的斑驳
 */
export function buildMooringBollard(ctx, bollardOpts = {}) {
  let builder = new PartBuilder(ctx),
    noiseOffset = (bollardOpts.seed | 0) * 2.1,
    bodyMat = builder.M('steel_dark', {
      vertexColors: !0,
    }),
    rustMat = builder.M('steel_rust'),
    paintColorFn = (a, l, c) => {
      let u = smoothstepRange(0.3, 0.4, l) * smoothstepRange(0.47, 0.4, l),
        h = 0.75 + 0.4 * valueNoise2D(a * 6 + noiseOffset, c * 6 + l * 4) + u * 0.9;
      return [h, h * 0.97, h * 0.93];
    };
  (builder.defCol.set(bodyMat, paintColorFn),
    builder.cyl(bodyMat, 0.34, 0.35, 0.045, 0, 0.0225, 0, {
      seg: 20,
    }),
    builder.cyl(rustMat, 0.37, 0.37, 0.006, 0, 0.003, 0, {
      seg: 20,
    }));
  for (let boltIdx = 0; boltIdx < 6; boltIdx++) {
    let boltAngle = (boltIdx * PI) / 3 + 0.3;
    (builder.cyl(
      rustMat,
      0.026,
      0.026,
      0.03,
      Math.cos(boltAngle) * 0.285,
      0.058,
      Math.sin(boltAngle) * 0.285,
      {
        seg: 6,
        flat: !0,
      },
    ),
      builder.cyl(
        rustMat,
        0.013,
        0.013,
        0.022,
        Math.cos(boltAngle) * 0.285,
        0.08,
        Math.sin(boltAngle) * 0.285,
        {
          seg: 6,
        },
      ));
  }
  (builder.add(
    bodyMat,
    createLatheGeometryFromProfile(
      [
        [0.25, 0.045],
        [0.21, 0.08],
        [0.165, 0.16],
        [0.145, 0.27],
        [0.15, 0.36],
        [0.17, 0.43],
        [0.19, 0.5],
        [0.17, 0.57],
        [0.1, 0.6],
        [0, 0.602],
      ],
      18,
    ),
  ),
    builder.cyl(bodyMat, 0.105, 0.115, 0.5, 0, 0.485, 0, {
      seg: 14,
      open: !0,
      rot: [0, 0, PI / 2],
    }));
  for (let boltIdx of [-1, 1]) {
    let boltAngle = createSphereGeometry(0.108, 14, 8);
    (boltAngle.scale(0.55, 1, 1),
      builder.add(bodyMat, je(boltAngle, boltIdx * 0.25, 0.485, 0)),
      builder.cyl(bodyMat, 0.125, 0.125, 0.03, boltIdx * 0.235, 0.485, 0, {
        seg: 14,
        rot: [0, 0, PI / 2],
      }));
  }
  return tagPropUserData(builder.group(), 'bollard_mooring', getPropSize3('bollard_mooring'), [
    {
      min: [-0.3, 0, -0.22],
      max: [0.3, 0.6, 0.22],
      surface: 'metal',
    },
  ]);
}

/**
 * 1m 黄色警示立柱：分段圆柱，把两段反光带用深色顶点色标出来，顶部球头与四颗地脚螺栓固定
 */
export function buildBollardPost(ctx, postOpts = {}) {
  let builder = new PartBuilder(ctx),
    noiseOffset = (postOpts.seed | 0) * 1.7,
    yellowMat = builder.M('paint_yellow', {
      vertexColors: !0,
    }),
    steelMat = builder.M('steel_galv'),
    postRadius = 0.083,
    isBand = (u) => (u > 0.6 && u < 0.69) || (u > 0.78 && u < 0.87),
    bandStations = [0.012, 0.3, 0.6, 0.6001, 0.69, 0.6901, 0.78, 0.7801, 0.87, 0.8701, 0.955];
  for (let stationIdx = 0; stationIdx < bandStations.length - 1; stationIdx++) {
    let segStart = bandStations[stationIdx],
      segEnd = bandStations[stationIdx + 1];
    if (segEnd - segStart < 0.001) continue;
    let inBand = isBand((segStart + segEnd) / 2);
    builder.cyl(
      yellowMat,
      postRadius,
      postRadius,
      segEnd - segStart,
      0,
      (segStart + segEnd) / 2,
      0,
      {
        seg: 14,
        open: !0,
        col: (d, v, g) => {
          if (inBand) return [0.05, 0.05, 0.05];
          let x =
            (0.55 + 0.45 * smoothstepRange(0, 0.35, v)) *
            (0.9 + 0.2 * valueNoise2D(d * 30 + noiseOffset, v * 6 + g * 30));
          return [x, x * 0.97, x * 0.9];
        },
      },
    );
  }
  let capGeo = createSphereGeometry(postRadius, 14, 5, PI * 2, 0, PI / 2);
  (capGeo.scale(1, 0.55, 1),
    builder.add(yellowMat, je(capGeo, 0, 0.955, 0), [0.95, 0.93, 0.88]),
    builder.cyl(steelMat, 0.085, 0.085, 0.012, 0, 0.006, 0, {
      seg: 4,
      rot: [0, PI / 4, 0],
    }),
    builder.box(steelMat, 0.17, 0.012, 0.17, 0, 0.006, 0, {
      r: 0.004,
    }));
  for (let stationIdx of [-1, 1])
    for (let segStart of [-1, 1])
      builder.cyl(steelMat, 0.011, 0.011, 0.012, stationIdx * 0.066, 0.017, segStart * 0.066, {
        seg: 6,
      });
  return (
    builder.cyl(yellowMat, postRadius + 0.006, postRadius + 0.006, 0.02, 0, 0.022, 0, {
      seg: 14,
      open: !0,
      col: [0.5, 0.48, 0.42],
    }),
    tagPropUserData(builder.group(), 'bollard_post', getPropSize3('bollard_post'), [
      {
        min: [-0.085, 0, -0.085],
        max: [0.085, 1, 0.085],
        surface: 'metal',
      },
    ])
  );
}

/**
 * 5 条英文安全标语，标志牌下副牌文案的随机池
 */
var SIGN_TEXTS = [
  'AUTHORISED PERSONNEL ONLY',
  'NO PEDESTRIANS',
  'HI-VIS AND HELMET',
  'AUTOMATED VEHICLES',
  'KEEP CLEAR',
];

/**
 * 立式标志牌：混凝土墩+镀锌管、铝背板 + 主图标 + 副牌文字，带轻微歪斜与安装抱箍；牌面碰撞盒标了 bulletOnly，只挡子弹不挡人
 */
export function buildSignPost(ctx, opts = {}) {
  let builder = new PartBuilder(ctx),
    seed = opts.seed | 0,
    steelMat = builder.M('steel_galv'),
    aluMat = builder.M('aluminium'),
    whiteMat = builder.M('paint_white'),
    yellowMat = builder.M('paint_yellow'),
    decalName = SIGN_DECAL_NAMES.includes(opts.sign)
      ? opts.sign
      : SIGN_DECAL_NAMES[seed % SIGN_DECAL_NAMES.length];
  (builder.box(builder.M('concrete'), 0.3, 0.07, 0.3, 0, 0.03, 0, {
    r: 0.015,
  }),
    builder.box(steelMat, 0.05, 2.38, 0.05, 0, 1.2, 0, {
      r: 0.006,
    }),
    builder.box(steelMat, 0.058, 0.012, 0.058, 0, 2.395, 0, {
      r: 0.004,
    }),
    builder.box(steelMat, 0.13, 0.012, 0.13, 0, 0.07, 0, {
      r: 0.003,
    }));
  let tilt = ((seed % 5) - 2) * 0.006;
  (builder.push(composeTransformMatrix(0, 0, 0, [0, 0, tilt])),
    builder.box(aluMat, 0.6, 0.6, 0.004, 0, 2.02, 0.031, {
      r: 0.0015,
    }),
    builder.box(
      decalName.startsWith('hazard') ? yellowMat : whiteMat,
      0.58,
      0.58,
      0.002,
      0,
      2.02,
      0.034,
      {
        r: 8e-4,
      },
    ),
    builder.decal(getDecalMaterial(ctx, decalName), 0.5, 0, 2.02, 0.0362, null, 0.5),
    builder.box(aluMat, 0.6, 0.22, 0.004, 0, 1.56, 0.031, {
      r: 0.0015,
    }),
    builder.box(whiteMat, 0.58, 0.2, 0.002, 0, 1.56, 0.034, {
      r: 8e-4,
    }),
    builder.decal(
      getLabelMaterial(ctx, opts.text || SIGN_TEXTS[seed % SIGN_TEXTS.length], {
        color: 'black',
        font: 'sans',
        distress: 0.15,
      }),
      0.07,
      0,
      1.56,
      0.0362,
      null,
      0.52,
    ));
  for (let bracketY of [1.85, 2.2, 1.56])
    (builder.box(steelMat, 0.5, 0.03, 0.012, 0, bracketY, 0.024, {
      r: 0,
    }),
      builder.box(steelMat, 0.09, 0.04, 0.07, 0, bracketY, -0.002, {
        r: 0.004,
      }));
  for (let [bracketY, boltY] of [
    [-0.26, 2.28],
    [0.26, 2.28],
    [-0.26, 1.76],
    [0.26, 1.76],
  ])
    builder.cyl(steelMat, 0.008, 0.008, 0.004, bracketY, boltY, 0.0365, {
      seg: 6,
      rot: [PI / 2, 0, 0],
    });
  return (
    builder.pop(),
    tagPropUserData(builder.group(), 'sign_post', getPropSize3('sign_post'), [
      {
        min: [-0.03, 0, -0.03],
        max: [0.03, 2.4, 0.03],
        surface: 'metal',
      },
      {
        min: [-0.3, 1.44, 0.02],
        max: [0.3, 2.33, 0.04],
        surface: 'metal',
        bulletOnly: !0,
      },
    ])
  );
}

/**
 * 移动式泛光灯架：三脚架、可转动的双灯头与拖地电缆、沙袋压脚，灯位写入 userData.lamps
 */
export function buildFloodlightStand(ctx, opts = {}) {
  let builder = new PartBuilder(ctx),
    seed = opts.seed | 0,
    rand = $a(seed + 3),
    yellowMat = builder.M('paint_yellow'),
    steelDarkMat = builder.M('steel_dark'),
    aluMat = builder.M('aluminium'),
    rubberMat = builder.M('rubber'),
    lensMat = ctx.mats.emissive(16773596, opts.on === !1 ? 0.02 : 10);
  (builder.cyl(aluMat, 0.021, 0.021, 1.1, 0, 0.75, 0, {
    seg: 8,
    open: !0,
  }),
    builder.cyl(aluMat, 0.016, 0.016, 0.9, 0, 1.6, 0, {
      seg: 8,
      open: !0,
    }),
    builder.cyl(steelDarkMat, 0.03, 0.03, 0.06, 0, 1.3, 0, {
      seg: 8,
    }),
    builder.bar(steelDarkMat, [0.03, 1.3, 0], [0.085, 1.3, 0], 0.008, {
      caps: !0,
    }),
    builder.box(steelDarkMat, 0.02, 0.03, 0.05, 0.09, 1.3, 0, {
      r: 0.005,
    }),
    builder.cyl(steelDarkMat, 0.032, 0.032, 0.07, 0, 0.82, 0, {
      seg: 8,
    }),
    builder.cyl(steelDarkMat, 0.03, 0.03, 0.05, 0, 0.36, 0, {
      seg: 8,
    }));
  for (let legIndex = 0; legIndex < 3; legIndex++) {
    let legAngle = (legIndex * PI * 2) / 3 + 0.5,
      cosAngle = Math.cos(legAngle),
      sinAngle = Math.sin(legAngle);
    (builder.bar(
      aluMat,
      [cosAngle * 0.035, 0.82, sinAngle * 0.035],
      [cosAngle * 0.5, 0.025, sinAngle * 0.5],
      0.013,
      {
        seg: 6,
      },
    ),
      builder.bar(
        aluMat,
        [cosAngle * 0.03, 0.36, sinAngle * 0.03],
        [cosAngle * 0.3, 0.37, sinAngle * 0.3],
        0.008,
        {
          seg: 5,
        },
      ),
      builder.add(
        rubberMat,
        je(createSphereGeometry(0.028, 8, 5), cosAngle * 0.5, 0.02, sinAngle * 0.5),
      ));
  }
  builder.box(steelDarkMat, 0.05, 0.04, 0.72, 0, 2.03, 0, {
    r: 0.008,
  });
  for (let legIndex of [-1, 1]) {
    (builder.push(composeTransformMatrix(0.03, 2.03, legIndex * 0.2, [0, legIndex * -0.12, 0])),
      builder.push(composeTransformMatrix(0, 0, 0, [0, 0, -0.22])),
      builder.box(yellowMat, 0.075, 0.24, 0.32, 0.06, 0.02, 0, {
        r: 0.012,
      }),
      builder.add(
        lensMat,
        je(createPlaneGeometry(0.28, 0.2), 0.0985, 0.02, 0, [0, PI / 2, 0]),
        null,
        !0,
      ),
      builder.box(steelDarkMat, 0.012, 0.25, 0.012, 0.1, 0.02, 0.157, {
        r: 0,
      }),
      builder.box(steelDarkMat, 0.012, 0.25, 0.012, 0.1, 0.02, -0.157, {
        r: 0,
      }),
      builder.box(steelDarkMat, 0.012, 0.012, 0.33, 0.1, 0.143, 0, {
        r: 0,
      }),
      builder.box(steelDarkMat, 0.012, 0.012, 0.33, 0.1, -0.103, 0, {
        r: 0,
      }));
    for (let legAngle = -3; legAngle <= 3; legAngle++)
      builder.add(steelDarkMat, je(boxGeometry(0.035, 0.2, 0.006), 0.008, 0.02, legAngle * 0.043));
    (builder.tube(
      yellowMat,
      [
        [0.05, 0.14, -0.1],
        [0.05, 0.2, -0.06],
        [0.05, 0.2, 0.06],
        [0.05, 0.14, 0.1],
      ],
      0.008,
      {
        seg: 5,
      },
    ),
      builder.pop(),
      builder.pop());
  }
  let lampYaw = rand() * PI * 2,
    cosYaw = Math.cos(lampYaw),
    sinYaw = Math.sin(lampYaw);
  (builder.tube(
    rubberMat,
    [
      [0, 2, 0.03],
      [-0.03, 1.7, 0.04],
      [0.035, 1.25, 0.02],
      [-0.03, 0.9, 0.03],
      [0.05, 0.5, 0.06],
      [0.12, 0.08, 0.1],
      [0.25, 0.012, 0.16],
      [0.3 + cosYaw * 0.3, 0.012, 0.2 + sinYaw * 0.3],
      [0.2 + cosYaw * 0.75 - sinYaw * 0.2, 0.012, 0.1 + sinYaw * 0.75 + cosYaw * 0.2],
      [cosYaw * 1.2, 0.012, sinYaw * 1.2],
    ],
    0.011,
    {
      seg: 5,
    },
  ),
    builder.box(yellowMat, 0.09, 0.05, 0.06, cosYaw * 1.24, 0.026, sinYaw * 1.24, {
      r: 0.01,
      rot: [0, -lampYaw, 0],
    }));
  let group = builder.group();
  return (
    (group.userData.lamps = [
      {
        pos: [0.14, 2.03, 0],
        dir: [0.976, -0.218, 0],
        color: 16773596,
      },
    ]),
    tagPropUserData(group, 'floodlight_stand', getPropSize3('floodlight_stand'), [
      {
        min: [-0.12, 0, -0.12],
        max: [0.12, 2.2, 0.12],
        surface: 'metal',
      },
    ])
  );
}

/**
 * 12 级钢楼梯：花纹板踏步 + 黄色防滑边条、两侧斜梁与扶手（含竖杆与弯头），逐级写碰撞盒，末端带一小段平台
 */
export function buildMetalStairs(ctx, options = {}) {
  let builder = new PartBuilder(ctx),
    treadMat = builder.M('diamond_plate'),
    frameMat = builder.M('steel_dark'),
    railMat = builder.M('paint_yellow'),
    steelGalvMat = builder.M('steel_galv'),
    stepCount = 12,
    stepRise = 0.2,
    stepRun = 0.2,
    startX = -1.5,
    halfWidth = 0.5,
    endX = startX + stepCount * stepRun,
    colliders = [];
  for (let walkX = 0; walkX < stepCount; walkX++) {
    let stepTopY = (walkX + 1) * stepRise,
      stepX = startX + walkX * stepRun;
    (builder.box(treadMat, 0.25, 0.03, 0.9, stepX + 0.125, stepTopY - 0.015, 0, {
      r: 0.005,
    }),
      builder.box(railMat, 0.035, 0.034, 0.9, stepX + 0.016, stepTopY - 0.015, 0, {
        r: 0.006,
      }));
    for (let sideSign of [-1, 1])
      builder.box(frameMat, 0.2, 0.05, 0.01, stepX + 0.13, stepTopY - 0.05, sideSign * 0.452, {
        r: 0,
      });
    colliders.push({
      min: [stepX, 0, -halfWidth],
      max: [stepX + stepRun, stepTopY, halfWidth],
      surface: 'metal',
    });
  }
  for (let walkX of [-1, 1]) {
    (builder.beam(
      frameMat,
      [startX + 0.07, 0.13, walkX * 0.465],
      [endX + 0.04, 2.5, walkX * 0.465],
      0.24,
      0.014,
      {
        r: 0.004,
      },
    ),
      builder.box(steelGalvMat, 0.3, 0.012, 0.12, startX + 0.06, 0.006, walkX * 0.465, {
        r: 0,
      }));
    for (let stepTopY of [-0.08, 0.1])
      builder.cyl(steelGalvMat, 0.012, 0.012, 0.02, startX + 0.06 + stepTopY, 0.02, walkX * 0.5, {
        seg: 6,
      });
  }
  let landingX = (stepCount + 1) * stepRise;
  (builder.box(treadMat, 0.64, 0.035, 0.96, endX + 0.3, landingX - 0.0175, 0, {
    r: 0.005,
  }),
    builder.box(railMat, 0.035, 0.038, 0.96, endX + 0.016, landingX - 0.0175, 0, {
      r: 0.006,
    }));
  for (let walkX of [-1, 1])
    builder.box(frameMat, 0.66, 0.16, 0.06, endX + 0.3, landingX - 0.115, walkX * 0.47, {
      r: 0.008,
    });
  (builder.box(frameMat, 0.06, 0.16, 0.96, 1.47, landingX - 0.115, 0, {
    r: 0.008,
  }),
    builder.box(frameMat, 0.06, 0.12, 0.9, endX + 0.02, landingX - 0.1, 0, {
      r: 0.008,
    }));
  for (let walkX of [-1, 1])
    (builder.box(frameMat, 0.08, landingX - 0.19, 0.08, 1.44, (landingX - 0.19) / 2, walkX * 0.45, {
      r: 0.008,
    }),
      builder.box(steelGalvMat, 0.18, 0.012, 0.18, 1.44, 0.006, walkX * 0.45, {
        r: 0,
      }),
      builder.beam(
        frameMat,
        [1.44, 1.5, walkX * 0.45],
        [endX + 0.1, landingX - 0.2, walkX * 0.45],
        0.05,
        0.05,
        {
          r: 0.006,
        },
      ));
  (builder.beam(frameMat, [1.44, 0.15, -0.42], [1.44, 2.2, 0.42], 0.045, 0.008, {
    r: 0,
  }),
    builder.beam(frameMat, [1.44, 0.15, 0.42], [1.44, 2.2, -0.42], 0.045, 0.008, {
      r: 0,
    }),
    builder.box(frameMat, 0.06, 0.06, 0.82, 1.44, 1.2, 0, {
      r: 0.006,
    }),
    colliders.push({
      min: [endX, landingX - 0.2, -halfWidth],
      max: [1.5, landingX, halfWidth],
      surface: 'metal',
    }));
  for (let walkX of [-1, 1])
    colliders.push({
      min: [1.4, 0, walkX * 0.45 - 0.04],
      max: [1.48, landingX - 0.2, walkX * 0.45 + 0.04],
      surface: 'metal',
    });
  let heightAt = (g) => ((g - startX) / stepRun) * stepRise + stepRise;
  for (let walkX of [-1, 1]) {
    let stepTopY = walkX * 0.485,
      stepX = [
        [startX + 0.1, heightAt(startX + 0.1)],
        [startX + 0.9, heightAt(startX + 0.9) - 0.1],
        [startX + 1.7, heightAt(startX + 1.7) - 0.1],
        [endX + 0.03, landingX],
        [1.47, landingX],
      ];
    for (let [sideSign, railBarRadius] of stepX)
      (builder.bar(
        railMat,
        [sideSign, railBarRadius - 0.12, stepTopY],
        [sideSign, railBarRadius + 1, stepTopY],
        0.019,
        {
          seg: 7,
        },
      ),
        builder.box(
          frameMat,
          0.07,
          0.1,
          0.012,
          sideSign,
          railBarRadius - 0.1,
          stepTopY - walkX * 0.012,
          {
            r: 0,
          },
        ));
    for (let sideSign of [1, 0.52]) {
      let railBarRadius = sideSign === 1 ? 0.021 : 0.016;
      (builder.bar(
        railMat,
        [stepX[0][0], stepX[0][1] + sideSign, stepTopY],
        [stepX[3][0], stepX[3][1] + sideSign, stepTopY],
        railBarRadius,
        {
          seg: 7,
        },
      ),
        builder.bar(
          railMat,
          [stepX[3][0], stepX[3][1] + sideSign, stepTopY],
          [stepX[4][0], stepX[4][1] + sideSign, stepTopY],
          railBarRadius,
          {
            seg: 7,
          },
        ),
        builder.add(
          railMat,
          je(
            createSphereGeometry(railBarRadius * 1.05, 7, 5),
            stepX[3][0],
            stepX[3][1] + sideSign,
            stepTopY,
          ),
        ),
        builder.add(
          railMat,
          je(
            createSphereGeometry(railBarRadius * 1.05, 7, 5),
            stepX[0][0],
            stepX[0][1] + sideSign,
            stepTopY,
          ),
        ),
        builder.add(
          railMat,
          je(
            createSphereGeometry(railBarRadius * 1.05, 7, 5),
            stepX[4][0],
            stepX[4][1] + sideSign,
            stepTopY,
          ),
        ));
    }
    (builder.box(frameMat, 0.6, 0.1, 0.008, endX + 0.3, landingX + 0.05, walkX * 0.476, {
      r: 0,
    }),
      colliders.push({
        min: [endX, landingX, stepTopY - 0.03],
        max: [1.5, landingX + 1.02, stepTopY + 0.03],
        surface: 'metal',
      }));
  }
  return tagPropUserData(
    builder.group(),
    'stairs_metal',
    getPropSize3Later('stairs_metal'),
    colliders,
  );
}

/**
 * 3m 走道板：格栅铺面（细密横条 + 纵向支撑）、边框、可选单/双侧黄色护栏与踢脚板，护栏段单独出碰撞盒
 */
export function buildCatwalk(ctx, options = {}) {
  let builder = new PartBuilder(ctx),
    frameMat = builder.M('steel_dark'),
    railMat = builder.M('paint_yellow'),
    deckMat = builder.M('steel_galv'),
    railsMode = options.rails || 'both',
    railSides =
      railsMode === 'both'
        ? [-1, 1]
        : railsMode === 'left'
          ? [-1]
          : railsMode === 'right'
            ? [1]
            : [],
    deckY = 0.05;
  for (let spanU = -0.51; spanU <= 0.511; spanU += 0.034)
    builder.add(deckMat, je(boxGeometry(2.98, 0.03, 0.004), 0, deckY - 0.015, spanU));
  for (let spanU = -1.45; spanU <= 1.451; spanU += 0.1)
    builder.add(deckMat, je(boxGeometry(0.006, 0.006, 1.04), spanU, deckY - 0.004, 0));
  for (let spanU of [-1, 1])
    (builder.add(deckMat, je(boxGeometry(2.99, 0.032, 0.005), 0, deckY - 0.016, spanU * 0.525)),
      builder.add(deckMat, je(boxGeometry(0.005, 0.032, 1.05), spanU * 1.493, deckY - 0.016, 0)));
  for (let spanU of [-1, 1])
    builder.box(frameMat, 3, 0.18, 0.06, 0, deckY - 0.09, spanU * 0.565, {
      r: 0.008,
    });
  for (let spanU of [-1.45, -0.5, 0.5, 1.45])
    builder.box(frameMat, 0.05, 0.1, 1.08, spanU, deckY - 0.085, 0, {
      r: 0.006,
    });
  let colliders = [
    {
      min: [-1.5, deckY - 0.08, -0.6],
      max: [1.5, deckY, 0.6],
      surface: 'metal',
    },
  ];
  for (let spanU of railSides) {
    let railZ = spanU * 0.565;
    builder.box(frameMat, 3, 0.1, 0.008, 0, deckY + 0.05, spanU * 0.535, {
      r: 0,
    });
    for (let postOffset of [-1.42, 0, 1.42])
      (builder.box(railMat, 0.045, 1.07, 0.045, postOffset, deckY + 0.52, railZ, {
        r: 0.006,
      }),
        builder.box(frameMat, 0.09, 0.012, 0.09, postOffset, deckY + 0.006, railZ, {
          r: 0,
        }));
    (builder.bar(railMat, [-1.5, deckY + 1.05, railZ], [1.5, deckY + 1.05, railZ], 0.021, {
      seg: 7,
      caps: !0,
    }),
      builder.bar(railMat, [-1.5, deckY + 0.55, railZ], [1.5, deckY + 0.55, railZ], 0.016, {
        seg: 6,
        caps: !0,
      }),
      colliders.push({
        min: [-1.5, deckY, railZ - 0.035],
        max: [1.5, deckY + 1.05, railZ + 0.035],
        surface: 'metal',
      }));
  }
  return tagPropUserData(builder.group(), 'catwalk', getPropSize3Later('catwalk'), colliders);
}

/**
 * 在一个位置上拼出标准木托盘的上中下三层板条与垫块，货架上的货垛底座复用它
 */
function addPalletDeck(builder, mat, posX, posY, posZ) {
  for (let slatIdx = -2; slatIdx <= 2; slatIdx++)
    builder.add(
      mat,
      je(
        boxGeometry(0.14 + (slatIdx === 0 ? 0.02 : 0), 0.022, 1),
        posX + slatIdx * 0.2525,
        posY + 0.133,
        posZ,
      ),
    );
  for (let slatIdx of [-1, 0, 1])
    builder.add(mat, je(boxGeometry(1.15, 0.022, 0.1), posX, posY + 0.111, posZ + slatIdx * 0.45));
  for (let slatIdx of [-1, 0, 1])
    for (let blockIdx of [-1, 0, 1])
      builder.add(
        mat,
        je(
          boxGeometry(0.14, 0.078, 0.1),
          posX + blockIdx * 0.505,
          posY + 0.061,
          posZ + slatIdx * 0.45,
        ),
      );
  for (let slatIdx of [-1, 0, 1])
    builder.add(mat, je(boxGeometry(1.15, 0.022, 0.1), posX, posY + 0.011, posZ + slatIdx * 0.45));
}

/**
 * 往货架层上码货：四种载荷形态（纸箱垛 / 缠膜托盘 / 四只化工桶 / 叠托盘），带贴花与薄膜缠绕细节
 */
function addShelfLoad(builder, mats, kind, loadX, loadY, loadZ, rand) {
  addPalletDeck(builder, mats.wood, loadX, loadY, loadZ);
  let loadBaseY = loadY + 0.144;
  if (kind === 'cartons') {
    let layerCount = 2 + Math.floor(rand() * 2),
      boxHeight = 0.36;
    for (let layerIndex = 0; layerIndex < layerCount; layerIndex++)
      for (let sideSign of [-1, 1])
        for (let depthSign of [-1, 1])
          (layerIndex === layerCount - 1 && rand() < 0.25) ||
            (builder.box(
              mats.card,
              0.53,
              boxHeight - 0.006,
              0.46,
              loadX + sideSign * 0.272 + (rand() - 0.5) * 0.02,
              loadBaseY + boxHeight * (layerIndex + 0.5),
              loadZ + depthSign * 0.237 + (rand() - 0.5) * 0.02,
              {
                r: 0.008,
                rot: [0, (rand() - 0.5) * 0.05, 0],
              },
            ),
            builder.add(
              mats.tape,
              je(
                boxGeometry(0.535, 0.002, 0.05),
                loadX + sideSign * 0.272,
                loadBaseY + boxHeight * (layerIndex + 1) - 0.004,
                loadZ + depthSign * 0.237,
              ),
            ));
    for (let layerIndex of [-0.3, 0.3])
      (builder.add(
        mats.poly,
        je(
          boxGeometry(0.016, layerCount * boxHeight + 0.004, 0.002),
          loadX + layerIndex,
          loadBaseY + (layerCount * boxHeight) / 2,
          loadZ + 0.475,
        ),
      ),
        builder.add(
          mats.poly,
          je(
            boxGeometry(0.016, layerCount * boxHeight + 0.004, 0.002),
            loadX + layerIndex,
            loadBaseY + (layerCount * boxHeight) / 2,
            loadZ - 0.475,
          ),
        ));
  } else if (kind === 'wrapped') {
    let layerCount = 0.9 + rand() * 0.25;
    (builder.box(mats.card, 1.08, layerCount, 0.92, loadX, loadBaseY + layerCount / 2, loadZ, {
      r: 0.012,
    }),
      builder.box(
        mats.wrap,
        1.1,
        layerCount + 0.012,
        0.94,
        loadX,
        loadBaseY + layerCount / 2 + 0.002,
        loadZ,
        {
          r: 0.03,
        },
      ));
    for (let boxHeight of [-1, 1])
      for (let layerIndex of [-1, 1])
        builder.box(
          mats.card,
          0.05,
          layerCount * 0.96,
          0.05,
          loadX + boxHeight * 0.535,
          loadBaseY + layerCount / 2,
          loadZ + layerIndex * 0.455,
          {
            r: 0.004,
          },
        );
    builder.decal(
      getLabelMaterial(builder.G, 'LOT ' + (1e3 + Math.floor(rand() * 8999)), {
        color: 'black',
        font: 'sans',
        distress: 0.1,
      }),
      0.06,
      loadX + 0.2,
      loadBaseY + layerCount * 0.7,
      loadZ + 0.474,
      null,
      0.3,
    );
  } else if (kind === 'drums') {
    for (let layerCount of [-1, 1])
      for (let boxHeight of [-1, 1]) {
        let layerIndex = loadX + layerCount * 0.285,
          sideSign = loadZ + boxHeight * 0.24,
          depthSign = rand() < 0.3 ? mats.drum2 : mats.drum;
        builder.cyl(depthSign, 0.225, 0.225, 0.86, layerIndex, loadBaseY + 0.43, sideSign, {
          seg: 14,
          open: !0,
        });
        for (let bandHeight of [0.29, 0.58])
          builder.cyl(
            depthSign,
            0.233,
            0.233,
            0.022,
            layerIndex,
            loadBaseY + bandHeight,
            sideSign,
            {
              seg: 14,
              open: !0,
            },
          );
        (builder.cyl(depthSign, 0.232, 0.232, 0.02, layerIndex, loadBaseY + 0.85, sideSign, {
          seg: 14,
          open: !0,
        }),
          builder.cyl(depthSign, 0.232, 0.232, 0.02, layerIndex, loadBaseY + 0.01, sideSign, {
            seg: 14,
            open: !0,
          }),
          builder.add(
            mats.dark,
            je(
              createRoundedRectFanGeometry(0.44, 0.44, 4),
              layerIndex,
              loadBaseY + 0.845,
              sideSign,
              [-PI_LATER / 2, 0, 0],
            ),
          ),
          builder.cyl(mats.dark, 0.03, 0.03, 0.02, layerIndex + 0.13, loadBaseY + 0.855, sideSign, {
            seg: 6,
          }));
      }
    (builder.add(
      mats.poly,
      je(boxGeometry(1.04, 0.03, 0.002), loadX, loadBaseY + 0.6, loadZ + 0.468),
    ),
      builder.add(
        mats.poly,
        je(boxGeometry(1.04, 0.03, 0.002), loadX, loadBaseY + 0.6, loadZ - 0.468),
      ));
  } else if (kind === 'pallets') {
    let layerCount = 2 + Math.floor(rand() * 4);
    for (let boxHeight = 0; boxHeight < layerCount; boxHeight++)
      addPalletDeck(
        builder,
        mats.wood,
        loadX + (rand() - 0.5) * 0.04,
        loadBaseY + boxHeight * 0.146,
        loadZ + (rand() - 0.5) * 0.04,
      );
  }
}

/**
 * 重型横梁式货架：橙色立柱 + 三层层梁 + 镀锌格栅与层板，每层两侧随机摆放载荷形态，并贴 BAY/MAX 2000 KG 铭牌
 */
export function buildShelfRack(ctx, opts = {}) {
  let builder = new PartBuilder(ctx),
    seed = opts.seed | 0,
    rand = $a(seed + 21),
    uprightMat = builder.M('paint_blue', {
      vertexColors: !0,
    }),
    beamMat = builder.M('paint_orange'),
    steelGalvMat = builder.M('steel_galv'),
    loadMats = {
      wood: builder.M('wood_pallet'),
      card: builder.M('cardboard'),
      tape: builder.M('polymer_tan'),
      poly: builder.M('polymer_black'),
      wrap: builder.M('glass_dirty'),
      drum: builder.M('plastic_blue'),
      drum2: builder.M('paint_red'),
      dark: builder.M('steel_dark'),
    },
    rackHeight = 4.2,
    halfWidth = 1.305,
    halfDepth = 0.5,
    edgeColor = [0.04, 0.04, 0.05];
  for (let shelfY of [-1, 1]) {
    for (let sideSign of [-1, 1]) {
      (builder.box(
        uprightMat,
        0.09,
        rackHeight,
        0.07,
        shelfY * halfWidth,
        rackHeight / 2,
        sideSign * halfDepth,
        {
          r: 0.008,
          col: (y, b) => {
            let m = 0.7 + 0.3 * smoothstepRange(0, 0.5, b);
            return [m, m, m];
          },
        },
      ),
        builder.box(
          steelGalvMat,
          0.14,
          0.01,
          0.12,
          shelfY * halfWidth,
          0.005,
          sideSign * halfDepth,
          {
            r: 0,
          },
        ));
      for (let loadKindName of [-0.05, 0.05])
        builder.cyl(
          steelGalvMat,
          0.01,
          0.01,
          0.02,
          shelfY * halfWidth + loadKindName,
          0.016,
          sideSign * halfDepth,
          {
            seg: 6,
          },
        );
      for (let loadKindName = 0.12; loadKindName < rackHeight - 0.05; loadKindName += 0.1)
        for (let paintRow of [-0.022, 0.022])
          builder.add(
            uprightMat,
            je(
              createPlaneGeometry(0.014, 0.034),
              shelfY * halfWidth + paintRow,
              loadKindName,
              sideSign * (halfDepth + 0.0356),
              [0, sideSign > 0 ? 0 : PI_LATER, 0],
            ),
            edgeColor,
          );
    }
    let shelfLevel = [0.2, 1.1, 2, 2.9, 3.8];
    for (let sideSign = 0; sideSign < shelfLevel.length; sideSign++)
      (builder.box(
        uprightMat,
        0.03,
        0.03,
        2 * halfDepth - 0.07,
        shelfY * halfWidth,
        shelfLevel[sideSign],
        0,
        {
          r: 0,
        },
      ),
        sideSign < shelfLevel.length - 1 &&
          builder.beam(
            uprightMat,
            [
              shelfY * halfWidth,
              shelfLevel[sideSign],
              sideSign % 2 ? halfDepth - 0.04 : -halfDepth + 0.04,
            ],
            [
              shelfY * halfWidth,
              shelfLevel[sideSign + 1],
              sideSign % 2 ? -halfDepth + 0.04 : halfDepth - 0.04,
            ],
            0.03,
            0.03,
            {
              r: 0,
            },
          ));
    builder.box(
      builder.M('paint_yellow'),
      0.14,
      0.4,
      0.02,
      shelfY * halfWidth,
      0.2,
      halfDepth + 0.06,
      {
        r: 0.006,
      },
    );
  }
  let beamYs = [1.45, 2.86];
  for (let shelfY of beamYs) {
    for (let shelfLevel of [-1, 1]) {
      builder.box(
        beamMat,
        2 * halfWidth - 0.09,
        0.12,
        0.05,
        0,
        shelfY,
        shelfLevel * (halfDepth + 0.01),
        {
          r: 0.008,
        },
      );
      for (let sideSign of [-1, 1])
        builder.box(
          beamMat,
          0.012,
          0.2,
          0.065,
          sideSign * (halfWidth - 0.051),
          shelfY - 0.02,
          shelfLevel * (halfDepth + 0.005),
          {
            r: 0,
          },
        );
    }
    for (let shelfLevel of [-0.85, 0, 0.85])
      builder.add(
        steelGalvMat,
        je(boxGeometry(0.04, 0.025, 2 * halfDepth), shelfLevel, shelfY + 0.045, 0),
      );
    for (let shelfLevel = -0.45; shelfLevel <= 0.451; shelfLevel += 0.1)
      builder.add(
        steelGalvMat,
        je(boxGeometry(2 * halfWidth - 0.1, 0.005, 0.005), 0, shelfY + 0.062, shelfLevel),
      );
    for (let shelfLevel = -1.2; shelfLevel <= 1.201; shelfLevel += 0.2)
      builder.add(
        steelGalvMat,
        je(boxGeometry(0.005, 0.005, 2 * halfDepth + 0.04), shelfLevel, shelfY + 0.066, 0),
      );
  }
  (builder.decal(
    getLabelMaterial(
      ctx,
      'BAY ' + String.fromCharCode(65 + (seed % 6)) + '-' + (10 + (seed % 40)),
      {
        color: 'black',
        font: 'sans',
        distress: 0.1,
      },
    ),
    0.07,
    0,
    beamYs[0],
    halfDepth + 0.0365,
    null,
    0.34,
  ),
    builder.decal(
      getLabelMaterial(ctx, 'MAX 2000 KG / LEVEL', {
        color: 'black',
        font: 'sans',
        distress: 0.1,
      }),
      0.045,
      0.6,
      beamYs[1],
      halfDepth + 0.0365,
      null,
      0.5,
    ));
  let loadKinds = ['cartons', 'wrapped', 'drums', 'cartons', 'wrapped', 'pallets', 'none'];
  return (
    [0, beamYs[0] + 0.068, beamYs[1] + 0.068].forEach((shelfY, shelfLevel) => {
      for (let sideSign of [-1, 1]) {
        let loadKindName = loadKinds[Math.floor(rand() * loadKinds.length)];
        (shelfLevel === 2 && loadKindName === 'drums' && (loadKindName = 'wrapped'),
          loadKindName !== 'none' &&
            addShelfLoad(
              builder,
              loadMats,
              loadKindName,
              sideSign * 0.615 + (rand() - 0.5) * 0.03,
              shelfY,
              (rand() - 0.5) * 0.05,
              rand,
            ));
      }
    }),
    tagPropUserData(builder.group(), 'shelf_rack', getPropSize3Later('shelf_rack'), [
      {
        min: [-1.35, 0, -0.55],
        max: [1.35, 4.2, 0.55],
        surface: 'metal',
      },
    ])
  );
}

/**
 * 冷藏箱机组：白色外壳、双风扇格栅、压缩机与铜管、控制面板指示灯、电源电缆与排水管；flip 参数决定机组朝向，装在集装箱端面
 */
export function buildReeferUnit(ctx, unitOpts = {}) {
  let builder = new PartBuilder(ctx),
    seed = unitOpts.seed | 0,
    noiseOffset = seed * 2.3,
    shellMat = builder.M('paint_white', {
      vertexColors: !0,
    }),
    steelDarkMat = builder.M('steel_dark'),
    steelGalvMat = builder.M('steel_galv'),
    greyMat = builder.M('paint_grey'),
    brassMat = builder.M('brass'),
    rubberMat = builder.M('rubber'),
    aluMat = builder.M('aluminium'),
    paintColorFn = (g, x, y) => {
      let b =
        (0.86 + 0.18 * valueNoise2D(y * 2 + noiseOffset, x * 2)) *
        (0.62 + 0.38 * smoothstepRange(0, 0.6, x));
      return [b, b * 0.985, b * 0.955];
    };
  builder.defCol.set(shellMat, paintColorFn);
  let darkColor = [0.05, 0.05, 0.055];
  unitOpts.flip || builder.push(composeTransformMatrix(0, 0, 0, [0, PI_LATER, 0]));
  let frontX = 0.13;
  builder.box(shellMat, 0.38, 2.3, 2.3, -0.06, 1.15, 0, {
    r: 0.012,
  });
  for (let sideSignValue of [-1, 1])
    builder.box(shellMat, 0.12, 2.3, 0.09, 0.19, 1.15, sideSignValue * 1.105, {
      r: 0.012,
    });
  (builder.box(shellMat, 0.12, 0.09, 2.12, 0.19, 2.255, 0, {
    r: 0.012,
  }),
    builder.box(shellMat, 0.12, 0.1, 2.12, 0.19, 0.05, 0, {
      r: 0.012,
    }),
    builder.box(shellMat, 0.1, 0.06, 2.12, 0.18, 1.42, 0, {
      r: 0.01,
    }),
    builder.box(shellMat, 0.1, 0.06, 2.12, 0.18, 0.9, 0, {
      r: 0.01,
    }));
  for (let sideSignValue of [0.3, 0.9, 1.5, 2.1])
    for (let louverAxisOffset of [-1, 1])
      builder.cyl(
        steelGalvMat,
        0.014,
        0.014,
        0.012,
        0.255,
        sideSignValue,
        louverAxisOffset * 1.105,
        {
          seg: 6,
          rot: [0, 0, PI_LATER / 2],
        },
      );
  for (let sideSignValue of [-0.8, -0.3, 0.3, 0.8])
    for (let louverAxisOffset of [0.05, 2.255])
      builder.cyl(steelGalvMat, 0.014, 0.014, 0.012, 0.255, louverAxisOffset, sideSignValue, {
        seg: 6,
        rot: [0, 0, PI_LATER / 2],
      });
  for (let sideSignValue of [-1, 1]) {
    let louverAxisOffset = sideSignValue * 0.53,
      fanAxisCoord = 1.83;
    (builder.add(
      shellMat,
      je(
        createRoundedRectFanGeometry(0.66, 0.66, 6),
        frontX + 0.004,
        fanAxisCoord,
        louverAxisOffset,
        [0, PI_LATER / 2, 0],
      ),
      darkColor,
    ),
      builder.cyl(shellMat, 0.335, 0.345, 0.1, frontX + 0.05, fanAxisCoord, louverAxisOffset, {
        seg: 20,
        open: !0,
        rot: [0, 0, PI_LATER / 2],
      }),
      builder.cyl(shellMat, 0.36, 0.36, 0.014, frontX + 0.006, fanAxisCoord, louverAxisOffset, {
        seg: 20,
        open: !0,
        rot: [0, 0, PI_LATER / 2],
      }));
    for (let grillBarIndex = 0; grillBarIndex < 3; grillBarIndex++)
      builder.add(
        steelDarkMat,
        je(boxGeometry(0.012, 0.6, 0.12), frontX + 0.04, fanAxisCoord, louverAxisOffset, [
          (grillBarIndex * PI_LATER) / 3 + sideSignValue * 0.4,
          0.5,
          0,
        ]),
      );
    builder.cyl(steelDarkMat, 0.07, 0.07, 0.06, frontX + 0.05, fanAxisCoord, louverAxisOffset, {
      seg: 10,
      rot: [0, 0, PI_LATER / 2],
    });
    for (let grillBarIndex = 0; grillBarIndex < 8; grillBarIndex++) {
      let radialBarAngle = (grillBarIndex * PI_LATER) / 4;
      builder.add(
        steelGalvMat,
        je(boxGeometry(0.005, 0.66, 0.005), frontX + 0.098, fanAxisCoord, louverAxisOffset, [
          radialBarAngle,
          0,
          0,
        ]),
      );
    }
    for (let grillBarIndex of [0.12, 0.22, 0.32])
      builder.cyl(
        steelGalvMat,
        grillBarIndex,
        grillBarIndex,
        0.006,
        frontX + 0.1,
        fanAxisCoord,
        louverAxisOffset,
        {
          seg: 20,
          open: !0,
          rot: [0, 0, PI_LATER / 2],
        },
      );
  }
  builder.decal(
    getLabelMaterial(ctx, 'KELVAR  MARINE  REFRIGERATION', {
      color: 'black',
      font: 'sans',
      distress: 0.2,
    }),
    0.05,
    0.2505,
    2.255,
    0,
    [0, PI_LATER / 2, 0],
    1.2,
  );
  for (let sideSignValue of [-1, 1]) {
    builder.add(
      shellMat,
      je(createPlaneGeometry(0.98, 0.44), frontX + 0.004, 1.16, sideSignValue * 0.53, [
        0,
        PI_LATER / 2,
        0,
      ]),
      darkColor,
    );
    for (let louverAxisOffset = 0; louverAxisOffset < 9; louverAxisOffset++)
      builder.box(
        shellMat,
        0.06,
        0.006,
        0.98,
        frontX + 0.035,
        0.965 + louverAxisOffset * 0.049,
        sideSignValue * 0.53,
        {
          r: 0,
          rot: [0, 0, -0.75],
        },
      );
    builder.box(shellMat, 0.05, 0.46, 0.03, frontX + 0.03, 1.16, sideSignValue * 0.53, {
      r: 0.005,
    });
  }
  (builder.add(
    shellMat,
    je(createPlaneGeometry(1, 0.76), frontX + 0.004, 0.49, -0.53, [0, PI_LATER / 2, 0]),
    darkColor,
  ),
    builder.cyl(steelDarkMat, 0.15, 0.15, 0.46, frontX + 0.1, 0.36, -0.58, {
      seg: 14,
      open: !0,
      rot: [PI_LATER / 2, 0, 0],
    }));
  for (let sideSignValue of [-1, 1]) {
    let louverAxisOffset = createSphereGeometry(0.15, 14, 6);
    (louverAxisOffset.scale(1, 1, 0.45),
      builder.add(
        steelDarkMat,
        je(louverAxisOffset, frontX + 0.1, 0.36, -0.58 + sideSignValue * 0.23),
      ));
  }
  (builder.box(steelDarkMat, 0.26, 0.03, 0.5, frontX + 0.1, 0.19, -0.58, {
    r: 0.006,
  }),
    builder.cyl(aluMat, 0.07, 0.07, 0.4, frontX + 0.07, 0.5, -0.17, {
      seg: 10,
    }),
    builder.tube(
      brassMat,
      [
        [frontX + 0.1, 0.5, -0.5],
        [frontX + 0.1, 0.68, -0.5],
        [frontX + 0.08, 0.78, -0.4],
        [frontX + 0.08, 0.8, -0.2],
        [frontX + 0.07, 0.72, -0.17],
      ],
      0.012,
      {
        seg: 6,
      },
    ),
    builder.tube(
      brassMat,
      [
        [frontX + 0.12, 0.42, -0.36],
        [frontX + 0.14, 0.6, -0.33],
        [frontX + 0.1, 0.84, -0.34],
        [frontX + 0.06, 0.88, -0.6],
        [frontX + 0.03, 0.88, -0.9],
      ],
      0.009,
      {
        seg: 6,
      },
    ),
    builder.tube(
      brassMat,
      [
        [frontX + 0.1, 0.36, -0.82],
        [frontX + 0.1, 0.36, -0.93],
        [frontX + 0.06, 0.6, -0.96],
        [frontX + 0.04, 0.86, -0.96],
      ],
      0.012,
      {
        seg: 6,
      },
    ),
    builder.box(builder.M('paint_red'), 0.04, 0.05, 0.05, frontX + 0.12, 0.6, -0.33, {
      r: 0.008,
    }));
  let controlPanelZ = 0.55;
  (builder.box(greyMat, 0.11, 0.56, 0.74, frontX + 0.055, 0.5, controlPanelZ, {
    r: 0.012,
  }),
    builder.box(greyMat, 0.012, 0.5, 0.68, frontX + 0.114, 0.5, controlPanelZ, {
      r: 0.004,
    }),
    builder.add(
      steelDarkMat,
      je(createPlaneGeometry(0.26, 0.11), frontX + 0.1215, 0.66, controlPanelZ - 0.1, [
        0,
        PI_LATER / 2,
        0,
      ]),
    ),
    builder.add(
      ctx.mats.emissive(16757850, 2.4),
      je(createPlaneGeometry(0.15, 0.05), frontX + 0.122, 0.665, controlPanelZ - 0.06, [
        0,
        PI_LATER / 2,
        0,
      ]),
      null,
      !0,
    ),
    builder.add(
      ctx.mats.emissive(5832570, 3),
      je(createPlaneGeometry(0.014, 0.014), frontX + 0.122, 0.66, controlPanelZ - 0.2, [
        0,
        PI_LATER / 2,
        0,
      ]),
      null,
      !0,
    ));
  for (let sideSignValue = 0; sideSignValue < 4; sideSignValue++)
    for (let louverAxisOffset = 0; louverAxisOffset < 2; louverAxisOffset++)
      builder.box(
        steelDarkMat,
        0.008,
        0.03,
        0.03,
        frontX + 0.122,
        0.5 - louverAxisOffset * 0.045,
        controlPanelZ - 0.04 - sideSignValue * 0.045,
        {
          r: 0.003,
        },
      );
  return (
    builder.box(
      builder.M('paint_red'),
      0.03,
      0.09,
      0.03,
      frontX + 0.13,
      0.42,
      controlPanelZ + 0.22,
      {
        r: 0.006,
      },
    ),
    builder.cyl(steelGalvMat, 0.012, 0.012, 0.1, frontX + 0.124, 0.5, controlPanelZ + 0.325, {
      seg: 6,
    }),
    builder.decal(
      getDecalMaterial(ctx, 'hazard_voltage'),
      0.11,
      frontX + 0.1215,
      0.64,
      controlPanelZ + 0.2,
      [0, PI_LATER / 2, 0],
    ),
    builder.tube(
      rubberMat,
      [
        [frontX + 0.06, 0.78, controlPanelZ + 0.2],
        [frontX + 0.06, 0.95, controlPanelZ + 0.25],
        [frontX + 0.05, 1.4, controlPanelZ + 0.5],
        [frontX + 0.05, 1.5, controlPanelZ - 0],
      ],
      0.012,
      {
        seg: 5,
      },
    ),
    builder.tube(
      rubberMat,
      [
        [frontX + 0.06, 0.78, controlPanelZ - 0.2],
        [frontX + 0.06, 0.92, controlPanelZ - 0.3],
        [frontX + 0.05, 0.93, -0.1],
      ],
      0.01,
      {
        seg: 5,
      },
    ),
    builder.cyl(steelGalvMat, 0.022, 0.022, 0.04, frontX + 0.06, 0.2, controlPanelZ + 0.2, {
      seg: 8,
    }),
    builder.tube(
      rubberMat,
      [
        [frontX + 0.06, 0.2, controlPanelZ + 0.2],
        [frontX + 0.08, 0.12, controlPanelZ + 0.1],
        [frontX + 0.1, 0.16, controlPanelZ - 0.15],
        [frontX + 0.1, 0.2, controlPanelZ - 0.3],
        [frontX + 0.1, 0.13, controlPanelZ - 0.36],
        [frontX + 0.09, 0.12, controlPanelZ - 0.1],
        [frontX + 0.09, 0.14, controlPanelZ + 0.05],
      ],
      0.016,
      {
        seg: 6,
      },
    ),
    builder.box(
      builder.M('paint_blue'),
      0.07,
      0.07,
      0.12,
      frontX + 0.09,
      0.14,
      controlPanelZ + 0.1,
      {
        r: 0.015,
      },
    ),
    builder.decal(
      getDecalMaterial(ctx, 'grime_streak'),
      0.8,
      0.2512,
      0.5,
      -1.105,
      [0, PI_LATER / 2, 0],
      0.08,
    ),
    unitOpts.flip || builder.pop(),
    tagPropUserData(builder.group(), 'reefer_unit', getPropSize3Later('reefer_unit'), [
      {
        min: [-0.25, 0, -1.15],
        max: [0.25, 2.3, 1.15],
        surface: 'metal',
      },
    ])
  );
}

/**
 * 中继节点「通电」状态的青色电光颜色，是任务目标的常态色
 */
var RELAY_COLOR_LIVE = new THREE.Color(16752680);

/**
 * 中继节点「已切断」状态的余烬橙色，切断后先闪几下再熄灭
 */
var RELAY_COLOR_CUT = new THREE.Color(16721940);

/**
 * 「正在被切断」时的爆闪色（偏白），与电弧闪烁频率一起构成切割反馈
 */
var RELAY_COLOR_CUTTING = new THREE.Color(16767392);

/**
 * 任务目标中继柜：配电柜体+可开合检修门+接线端子与线缆、三脚桁架天线与避雷针；暴露 setState/update 做 live→cutting→cut 的电光与散热风扇动画，是三个 uplink 目标的实体
 */
export function buildRelayNode(ctx, nodeOpts = {}) {
  let seed = nodeOpts.seed | 0,
    noiseOffset = seed * 1.9,
    nodeLabel = nodeOpts.id || nodeOpts.label || 'ABC'[seed % 3],
    builder = new PartBuilder(ctx),
    doorBuilder = new PartBuilder(ctx),
    ledBuilder = new PartBuilder(ctx),
    antennaBuilder = new PartBuilder(ctx),
    cabinetMat = builder.M('paint_grey', {
      vertexColors: !0,
    }),
    steelDarkMat = builder.M('steel_dark'),
    steelGalvMat = builder.M('steel_galv'),
    aluMat = builder.M('aluminium'),
    rubberMat = builder.M('rubber'),
    concreteMat = builder.M('concrete', {
      vertexColors: !0,
    }),
    paintColorFn = (le, R, I) => {
      let se =
        (0.88 + 0.2 * valueNoise2D(le * 3 + noiseOffset, R * 3 + I * 2)) *
        (0.6 + 0.4 * smoothstepRange(0.16, 0.7, R));
      return [se, se, se * 0.98];
    };
  (builder.defCol.set(cabinetMat, paintColorFn),
    doorBuilder.defCol.set(cabinetMat, (sideSign, vCoord, wCoord) => {
      let shadeValue = 0.9 + 0.14 * valueNoise2D(sideSign * 4 + noiseOffset, vCoord * 3);
      return [shadeValue, shadeValue, shadeValue];
    }));
  let darkColor = [0.035, 0.035, 0.04],
    emissiveOpts = {
      em: !0,
    };
  (builder.box(concreteMat, 1.36, 0.16, 0.96, 0, 0.08, 0, {
    r: 0.025,
    col: (le, R, I) => {
      let se = 0.6 + 0.38 * smoothstepRange(0, 0.15, R) + 0.1 * valueNoise2D(le * 5, I * 5);
      return [se, se, se * 0.97];
    },
  }),
    builder.decal(getDecalMaterial(ctx, 'caution_stripes'), 0.1, 0, 0.085, 0.4815, null, 1.2));
  for (let sideSign of [-1, 1])
    for (let vCoord of [-1, 1])
      (builder.cyl(steelGalvMat, 0.016, 0.016, 0.03, sideSign * 0.44, 0.185, vCoord * 0.36, {
        seg: 6,
      }),
        builder.box(steelGalvMat, 0.1, 0.012, 0.1, sideSign * 0.44, 0.166, vCoord * 0.36, {
          r: 0,
        }));
  let cabinetLeft = -0.5,
    cabinetRight = 0.5,
    cabinetBottom = 0.18,
    cabinetTop = 1.62,
    doorZ = -0.3,
    cabinetFrontZ = 0.3,
    panelThickness = 0.025,
    cabinetMidY = (cabinetBottom + cabinetTop) / 2,
    cabinetHeight = cabinetTop - cabinetBottom;
  builder.box(
    cabinetMat,
    1,
    cabinetHeight,
    panelThickness,
    0,
    cabinetMidY,
    doorZ + panelThickness / 2,
    {
      r: 0.006,
    },
  );
  for (let sideSign of [-1, 1])
    builder.box(
      cabinetMat,
      panelThickness,
      cabinetHeight,
      0.6,
      sideSign * (0.5 - panelThickness / 2),
      cabinetMidY,
      0,
      {
        r: 0.006,
      },
    );
  (builder.box(cabinetMat, 1, panelThickness, 0.6, 0, cabinetBottom + panelThickness / 2, 0, {
    r: 0.006,
  }),
    builder.box(cabinetMat, 1, panelThickness, 0.6, 0, cabinetTop - panelThickness / 2, 0, {
      r: 0.006,
    }),
    builder.box(cabinetMat, panelThickness, cabinetHeight, 0.58, 0, cabinetMidY, 0, {
      r: 0.004,
    }),
    builder.box(
      cabinetMat,
      1,
      0.12,
      panelThickness,
      0,
      cabinetTop - 0.06,
      cabinetFrontZ - panelThickness / 2,
      {
        r: 0.006,
      },
    ),
    builder.box(
      cabinetMat,
      1,
      0.07,
      panelThickness,
      0,
      cabinetBottom + 0.035,
      cabinetFrontZ - panelThickness / 2,
      {
        r: 0.006,
      },
    ),
    builder.box(steelDarkMat, 1.04, 0.04, 0.64, 0, cabinetBottom - 0.01, 0, {
      r: 0.008,
    }),
    builder.box(cabinetMat, 1.12, 0.05, 0.74, 0, cabinetTop + 0.025, 0.01, {
      r: 0.012,
    }));
  for (let sideSign of [-1, 1])
    builder.tube(
      steelGalvMat,
      [
        [sideSign * 0.4 - 0.04, cabinetTop + 0.05, 0.2],
        [sideSign * 0.4 - 0.03, cabinetTop + 0.1, 0.2],
        [sideSign * 0.4 + 0.03, cabinetTop + 0.1, 0.2],
        [sideSign * 0.4 + 0.04, cabinetTop + 0.05, 0.2],
      ],
      0.008,
      {
        seg: 5,
      },
    );
  let panelColorFn = (le, R, I) => [0.16, 0.16, 0.17];
  (builder.add(
    cabinetMat,
    je(
      createPlaneGeometry(0.45, cabinetHeight - 0.06),
      -0.25,
      cabinetMidY,
      doorZ + panelThickness + 0.002,
    ),
    panelColorFn,
  ),
    builder.add(
      cabinetMat,
      je(
        createPlaneGeometry(0.55, cabinetHeight - 0.06),
        cabinetLeft + panelThickness + 0.002,
        cabinetMidY,
        0,
        [0, PI_RELAY / 2, 0],
      ),
      panelColorFn,
    ),
    builder.add(
      cabinetMat,
      je(
        createPlaneGeometry(0.55, cabinetHeight - 0.06),
        -panelThickness / 2 - 0.002,
        cabinetMidY,
        0,
        [0, -PI_RELAY / 2, 0],
      ),
      panelColorFn,
    ));
  for (let sideSign = 0; sideSign < 5; sideSign++) {
    let vCoord = 0.42 + sideSign * 0.22;
    (builder.box(steelDarkMat, 0.42, 0.17, 0.4, -0.25, vCoord, -0.05, {
      r: 0.008,
    }),
      builder.box(aluMat, 0.4, 0.02, 0.012, -0.25, vCoord + 0.06, 0.152, {
        r: 0,
      }));
    for (let wCoord = 0; wCoord < 4; wCoord++)
      ledBuilder.add(
        emissiveOpts,
        je(createPlaneGeometry(0.012, 0.012), -0.41 + wCoord * 0.035, vCoord - 0.04, 0.1512),
      );
    for (let wCoord = 0; wCoord < 3; wCoord++)
      builder.add(
        steelDarkMat,
        je(
          createRoundedRectFanGeometry(0.03, 0.022, 2),
          -0.2 + wCoord * 0.06,
          vCoord - 0.03,
          0.1512,
        ),
        darkColor,
      );
  }
  let cableMats = [rubberMat, rubberMat, rubberMat];
  for (let sideSign = 0; sideSign < 4; sideSign++)
    builder.tube(
      cableMats[sideSign % 3],
      [
        [-0.2 + (sideSign % 3) * 0.06, 0.39 + sideSign * 0.22, 0.15],
        [-0.14 + (sideSign % 3) * 0.05, 0.36 + sideSign * 0.22, 0.24],
        [-0.07, 0.55 + sideSign * 0.22, 0.22],
        [-0.2 + ((sideSign + 1) % 3) * 0.06, 0.61 + sideSign * 0.22, 0.15],
      ],
      0.007,
      {
        seg: 5,
      },
    );
  let doorWidth = 0.474,
    doorHeight = 1.3,
    doorCenterY = 0.9,
    buildDoor = (le, R, I) => {
      let se = R + doorWidth / 2,
        ae = 0;
      (le.box(cabinetMat, doorWidth, doorHeight, 0.024, se, doorCenterY, ae, {
        r: 0.006,
      }),
        le.box(
          cabinetMat,
          doorWidth - 0.07,
          doorHeight - 0.07,
          0.006,
          se,
          doorCenterY,
          ae + 0.013,
          {
            r: 0.003,
          },
        ));
      for (let ve of [doorCenterY + 0.36, doorCenterY - 0.4]) {
        le.add(
          cabinetMat,
          je(createPlaneGeometry(doorWidth - 0.14, 0.3), se, ve, ae + 0.0165),
          darkColor,
        );
        for (let _e = 0; _e < 7; _e++)
          le.box(
            cabinetMat,
            doorWidth - 0.13,
            0.034,
            0.005,
            se,
            ve - 0.125 + _e * 0.042,
            ae + 0.027,
            {
              r: 0,
              rot: [0.75, 0, 0],
            },
          );
        (le.box(cabinetMat, 0.02, 0.31, 0.02, se - (doorWidth - 0.13) / 2, ve, ae + 0.022, {
          r: 0.003,
        }),
          le.box(cabinetMat, 0.02, 0.31, 0.02, se + (doorWidth - 0.13) / 2, ve, ae + 0.022, {
            r: 0.003,
          }));
      }
      let k = I ? R + 0.07 : R + doorWidth - 0.07;
      (le.box(steelDarkMat, 0.045, 0.2, 0.02, k, doorCenterY - 0.02, ae + 0.026, {
        r: 0.006,
      }),
        le.box(steelGalvMat, 0.028, 0.13, 0.018, k, doorCenterY + 0, ae + 0.042, {
          r: 0.006,
        }),
        le.cyl(steelGalvMat, 0.012, 0.012, 0.012, k, doorCenterY - 0.09, ae + 0.04, {
          seg: 8,
          rot: [PI_RELAY / 2, 0, 0],
        }));
      let ce = I ? R + doorWidth : R;
      for (let ve of [doorCenterY - 0.5, doorCenterY, doorCenterY + 0.5])
        le.cyl(steelGalvMat, 0.011, 0.011, 0.09, ce, ve, ae + 0.016, {
          seg: 6,
        });
    };
  (builder.push(composeTransformMatrix(0, 0, cabinetFrontZ - 0.004)),
    buildDoor(builder, 0.013, !0),
    builder.decal(
      getLabelMaterial(ctx, 'RELAY ' + nodeLabel, {
        color: 'yellow',
        font: 'stencil',
        distress: 0.15,
      }),
      0.12,
      0.013 + doorWidth / 2,
      doorCenterY + 0.02,
      0.018,
      null,
      doorWidth - 0.1,
    ),
    builder.decal(
      getLabelMaterial(ctx, 'HARBORMASTER UPLINK', {
        color: 'white',
        font: 'sans',
        distress: 0.15,
      }),
      0.034,
      0.013 + doorWidth / 2,
      doorCenterY - 0.1,
      0.018,
      null,
      doorWidth - 0.1,
    ),
    builder.decal(
      getDecalMaterial(ctx, 'hazard_voltage'),
      0.13,
      0.013 + doorWidth / 2 + 0.1,
      doorCenterY + 0.14,
      0.018,
      null,
    ),
    builder.pop());
  let doorOffset = [-0.487, 0, cabinetFrontZ - 0.004];
  (buildDoor(doorBuilder, 0, !1),
    doorBuilder.decal(
      getDecalMaterial(ctx, 'hazard_general'),
      0.13,
      doorWidth / 2,
      doorCenterY + 0.1,
      0.018,
      null,
    ),
    doorBuilder.box(
      cabinetMat,
      doorWidth - 0.1,
      0.03,
      0.014,
      doorWidth / 2,
      doorCenterY + 0.55,
      -0.018,
      {
        r: 0.003,
      },
    ),
    doorBuilder.box(
      cabinetMat,
      doorWidth - 0.1,
      0.03,
      0.014,
      doorWidth / 2,
      doorCenterY - 0.55,
      -0.018,
      {
        r: 0.003,
      },
    ),
    doorBuilder.box(cabinetMat, 0.03, 1.1, 0.014, 0.07, doorCenterY, -0.018, {
      r: 0.003,
    }),
    doorBuilder.box(cabinetMat, 0.03, 1.1, 0.014, doorWidth - 0.07, doorCenterY, -0.018, {
      r: 0.003,
    }),
    doorBuilder.box(steelDarkMat, 0.24, 0.3, 0.02, doorWidth / 2, doorCenterY - 0.05, -0.02, {
      r: 0.004,
    }),
    doorBuilder.add(
      getLabelMaterial(ctx, 'WIRING DIAGRAM  SLT-R4', {
        color: 'white',
        font: 'sans',
        distress: 0.1,
      }).material,
      je(createPlaneGeometry(0.2, 0.03), doorWidth / 2, doorCenterY + 0.03, -0.0305, [
        0,
        PI_RELAY,
        0,
      ]),
      null,
      !0,
    ));
  for (let sideSign of [doorCenterY + 0.36, doorCenterY - 0.4])
    doorBuilder.add(
      cabinetMat,
      je(createPlaneGeometry(doorWidth - 0.14, 0.3), doorWidth / 2, sideSign, -0.0125, [
        0,
        PI_RELAY,
        0,
      ]),
      darkColor,
    );
  doorBuilder.decal(
    getLabelMaterial(ctx, 'ISOLATE BEFORE SERVICE', {
      color: 'white',
      font: 'sans',
      distress: 0.15,
    }),
    0.03,
    doorWidth / 2,
    doorCenterY - 0.03,
    0.018,
    null,
    doorWidth - 0.1,
  );
  for (let sideSign of [-1, 1]) {
    builder.box(aluMat, 0.012, 0.98, 0.5, sideSign * 0.506, 1.06, 0, {
      r: 0.003,
    });
    for (let vCoord = -6; vCoord <= 6; vCoord++)
      builder.add(
        aluMat,
        je(boxGeometry(0.06, 0.94, 0.007), sideSign * 0.54, 1.06, vCoord * 0.038),
      );
    builder.box(cabinetMat, 0.075, 0.03, 0.52, sideSign * 0.54, 1.56, 0, {
      r: 0.006,
    });
  }
  for (let sideSign = 0; sideSign < 3; sideSign++) {
    let vCoord = -0.17 + sideSign * 0.17,
      wCoord = 0.44 - sideSign * 0.02,
      shadeValue = 0.86 + sideSign * 0.07;
    (builder.tube(
      rubberMat,
      [
        [0.5, wCoord, vCoord],
        [0.6, wCoord, vCoord],
        [0.72 + sideSign * 0.04, wCoord - 0.06, vCoord],
        [shadeValue - 0.02, 0.16, vCoord + 0.02],
        [shadeValue, -0.03, vCoord + 0.02],
      ],
      0.04,
      {
        seg: 8,
        tension: 0.4,
      },
    ),
      builder.cyl(steelGalvMat, 0.055, 0.055, 0.05, 0.515, wCoord, vCoord, {
        seg: 8,
        flat: !0,
        rot: [0, 0, PI_RELAY / 2],
      }),
      builder.cyl(steelGalvMat, 0.06, 0.066, 0.03, shadeValue, 0.015, vCoord + 0.02, {
        seg: 8,
      }));
  }
  (builder.tube(
    rubberMat,
    [
      [-0.3, 0.35, doorZ],
      [-0.3, 0.33, doorZ - 0.1],
      [-0.34, 0.2, doorZ - 0.2],
      [-0.5, 0.165, doorZ - 0.3],
      [-0.9, 0.02, doorZ - 0.36],
      [-1.5, 0.018, doorZ - 0.2],
    ],
    0.022,
    {
      seg: 6,
    },
  ),
    builder.box(steelDarkMat, 0.3, 0.22, 0.1, 0.2, 0.75, doorZ - 0.05, {
      r: 0.012,
    }),
    builder.tube(
      rubberMat,
      [
        [0.2, 0.86, doorZ - 0.06],
        [0.2, 1.2, doorZ - 0.04],
        [-0.1, 1.55, doorZ - 0.03],
        [-0.3, 1.66, -0.16],
      ],
      0.012,
      {
        seg: 5,
      },
    ));
  let beaconX = -0.3,
    beaconY = -0.14,
    rackTopY = cabinetTop + 0.05,
    mastTopY = 2.5,
    mastFeet = [0, 1, 2].map((sideSign) => [
      beaconX + Math.cos(sideSign * 2.094 + 0.52) * 0.085,
      beaconY + Math.sin(sideSign * 2.094 + 0.52) * 0.085,
    ]);
  builder.box(steelGalvMat, 0.24, 0.012, 0.24, beaconX, rackTopY + 0.006, beaconY, {
    r: 0,
  });
  for (let sideSign = 0; sideSign < 3; sideSign++) {
    let vCoord = mastFeet[sideSign],
      wCoord = mastFeet[(sideSign + 1) % 3];
    builder.bar(
      steelGalvMat,
      [vCoord[0], rackTopY, vCoord[1]],
      [vCoord[0], mastTopY, vCoord[1]],
      0.011,
      {
        seg: 6,
      },
    );
    let shadeValue = 5,
      localZ = (mastTopY - rackTopY) / shadeValue;
    for (let localX = 0; localX < shadeValue; localX++)
      (builder.bar(
        steelGalvMat,
        [vCoord[0], rackTopY + localX * localZ, vCoord[1]],
        [wCoord[0], rackTopY + (localX + 1) * localZ, wCoord[1]],
        0.005,
        {
          seg: 4,
        },
      ),
        builder.bar(
          steelGalvMat,
          [vCoord[0], rackTopY + (localX + 1) * localZ, vCoord[1]],
          [wCoord[0], rackTopY + (localX + 1) * localZ, wCoord[1]],
          0.005,
          {
            seg: 4,
          },
        ));
  }
  (builder.cyl(steelGalvMat, 0.11, 0.11, 0.014, beaconX, mastTopY + 0.007, beaconY, {
    seg: 10,
  }),
    builder.cyl(steelDarkMat, 0.05, 0.06, 0.1, beaconX, mastTopY + 0.06, beaconY, {
      seg: 10,
    }));
  let addMastRod = (le, R, I) => {
    (builder.cyl(steelDarkMat, 0.016, 0.02, 0.07, le, cabinetTop + 0.085, R, {
      seg: 8,
    }),
      builder.cyl(steelGalvMat, 0.011, 0.011, 0.06, le, cabinetTop + 0.15, R, {
        seg: 6,
      }),
      builder.bar(steelDarkMat, [le, cabinetTop + 0.17, R], [le + 0.02, I, R - 0.015], 0.005, {
        r2: 0.0018,
        seg: 5,
        caps: !0,
      }));
  };
  (addMastRod(0.4, -0.24, 3.15),
    addMastRod(0.26, -0.24, 2.72),
    builder.cyl(steelDarkMat, 0.03, 0.03, 0.26, 0.42, cabinetTop + 0.18, 0.18, {
      seg: 8,
    }),
    builder.add(
      steelDarkMat,
      je(
        createSphereGeometry(0.03, 8, 4, PI_RELAY * 2, 0, PI_RELAY / 2),
        0.42,
        cabinetTop + 0.31,
        0.18,
      ),
    ));
  let dishGeometry = createLatheGeometryFromProfile(
    [
      [0, 0],
      [0.06, 0.006],
      [0.12, 0.024],
      [0.18, 0.054],
      [0.215, 0.078],
      [0.222, 0.078],
      [0.185, 0.05],
      [0.12, 0.016],
      [0.06, -0.003],
      [0, -0.01],
    ],
    18,
  );
  (dishGeometry.computeVertexNormals(),
    antennaBuilder.add(aluMat, je(dishGeometry, 0, 0.3, 0.02, [PI_RELAY / 2 - 0.12, 0, 0])),
    antennaBuilder.cyl(aluMat, 0.022, 0.03, 0.2, 0, 0.1, 0, {
      seg: 8,
    }),
    antennaBuilder.box(aluMat, 0.07, 0.1, 0.06, 0, 0.26, -0.02, {
      r: 0.01,
    }));
  for (let sideSign of [0.5, 2.6, 4.7])
    antennaBuilder.bar(
      aluMat,
      [Math.cos(sideSign) * 0.2, 0.3 + Math.sin(sideSign) * 0.2, 0.09],
      [0, 0.325, 0.25],
      0.0045,
      {
        seg: 4,
      },
    );
  antennaBuilder.cyl(aluMat, 0.022, 0.016, 0.05, 0, 0.325, 0.25, {
    seg: 8,
    rot: [PI_RELAY / 2, 0, 0],
  });
  let beaconPos = [beaconX, mastTopY + 0.11, beaconY];
  (builder.box(steelDarkMat, 0.9, 0.07, 0.03, 0, cabinetTop - 0.06, cabinetFrontZ + 0.012, {
    r: 0.008,
  }),
    ledBuilder.add(
      emissiveOpts,
      je(createPlaneGeometry(0.84, 0.036), 0, cabinetTop - 0.06, cabinetFrontZ + 0.0275),
    ));
  for (let sideSign = 1; sideSign < 6; sideSign++)
    builder.add(
      steelDarkMat,
      je(
        boxGeometry(0.008, 0.05, 0.006),
        -0.42 + sideSign * 0.14,
        cabinetTop - 0.06,
        cabinetFrontZ + 0.028,
      ),
    );
  (builder.box(steelDarkMat, 0.6, 0.06, 0.03, 0, cabinetTop - 0.06, doorZ - 0.012, {
    r: 0.008,
  }),
    ledBuilder.add(
      emissiveOpts,
      je(createPlaneGeometry(0.54, 0.03), 0, cabinetTop - 0.06, doorZ - 0.0275, [0, PI_RELAY, 0]),
    ));
  for (let sideSign of [-1, 1])
    (builder.box(steelDarkMat, 0.03, 1.2, 0.03, sideSign * 0.5, 0.86, cabinetFrontZ, {
      r: 0.008,
      rot: [0, PI_RELAY / 4, 0],
    }),
      ledBuilder.add(
        emissiveOpts,
        je(createPlaneGeometry(0.014, 1.14), sideSign * 0.5, 0.86, cabinetFrontZ + 0.0215, [
          0,
          (sideSign * PI_RELAY) / 4,
          0,
        ]).translate(sideSign * 0.0152, 0, 0),
      ),
      ledBuilder.add(
        emissiveOpts,
        je(createPlaneGeometry(0.014, 0.9), sideSign * 0.5715, 1.06, 0.262, [
          0,
          (sideSign * PI_RELAY) / 2,
          0,
        ]),
      ));
  for (let sideSign of [-1, 1])
    (builder.box(steelDarkMat, 0.03, 0.06, 0.46, sideSign * 0.587, cabinetTop - 0.01, 0, {
      r: 0.008,
    }),
      ledBuilder.add(
        emissiveOpts,
        je(createPlaneGeometry(0.4, 0.032), sideSign * 0.6025, cabinetTop - 0.01, 0, [
          0,
          (sideSign * PI_RELAY) / 2,
          0,
        ]),
      ));
  (builder.cyl(steelDarkMat, 0.028, 0.028, 0.02, beaconX + 0.2, cabinetTop + 0.06, beaconY, {
    seg: 8,
  }),
    builder.bar(
      steelGalvMat,
      [beaconX + 0.2, cabinetTop + 0.06, beaconY],
      [beaconX + 0.2, 2.64, beaconY],
      0.009,
      {
        seg: 6,
      },
    ),
    ledBuilder.add(
      emissiveOpts,
      je(cylinderGeometry(0.045, 0.045, 0.1, 10), beaconX + 0.2, 2.69, beaconY),
    ),
    builder.cyl(steelDarkMat, 0.05, 0.05, 0.014, beaconX + 0.2, 2.747, beaconY, {
      seg: 10,
    }),
    builder.cyl(steelDarkMat, 0.05, 0.05, 0.014, beaconX + 0.2, 2.633, beaconY, {
      seg: 10,
    }),
    builder.decal(
      getDecalMaterial(ctx, 'rust_run'),
      0.5,
      0.5135,
      0.3,
      0.2,
      [0, PI_RELAY / 2, 0],
      0.14,
    ),
    builder.decal(
      getDecalMaterial(ctx, 'grime_streak'),
      0.6,
      -0.2,
      1.2,
      doorZ - 0.001,
      [0, PI_RELAY, 0],
      0.2,
    ));
  let group = builder.group(),
    dynamicGroup = new THREE.Group();
  ((dynamicGroup.userData.noMerge = !0),
    (dynamicGroup.name = 'relay_dynamic'),
    group.add(dynamicGroup));
  let ledMaterial = ctx.mats.emissive(16752680, 4);
  ledMaterial = ledMaterial.clone();
  let ledMesh = new THREE.Mesh(
    mergeGeometryParts(ledBuilder.buckets.get(emissiveOpts).geos),
    ledMaterial,
  );
  ((ledMesh.userData.noMerge = !0), dynamicGroup.add(ledMesh));
  let doorChildren = doorBuilder.group().children.slice();
  for (let sideSign of doorChildren)
    (sideSign.position.set(doorOffset[0], doorOffset[1], doorOffset[2]),
      (sideSign.userData.noMerge = !0),
      dynamicGroup.add(sideSign));
  let ledChildren = antennaBuilder.group().children.slice();
  for (let sideSign of ledChildren)
    (sideSign.position.set(beaconPos[0], beaconPos[1], beaconPos[2]),
      (sideSign.userData.noMerge = !0),
      dynamicGroup.add(sideSign));
  let tempColor = new THREE.Color(),
    setEmissive = (le, R) => {
      if (ledMaterial.userData && typeof ledMaterial.userData.setEmissive == 'function') {
        ledMaterial.userData.setEmissive(le, R);
        return;
      }
      ledMaterial.emissive && ledMaterial.emissive.isColor && ledMaterial.isMeshStandardMaterial
        ? (ledMaterial.emissive.copy(le), (ledMaterial.emissiveIntensity = R))
        : ledMaterial.uniforms &&
            ledMaterial.uniforms.color &&
            ledMaterial.uniforms.color.value &&
            ledMaterial.uniforms.color.value.isColor
          ? (ledMaterial.uniforms.color.value.copy(le).multiplyScalar(R),
            ledMaterial.uniforms.intensity && (ledMaterial.uniforms.intensity.value = 1))
          : ledMaterial.color &&
            ledMaterial.color.isColor &&
            ledMaterial.color.copy(le).multiplyScalar(R);
    },
    state = 'live',
    elapsed = (seed % 7) * 0.9,
    cutElapsed = 0,
    spinSpeed = 0.7,
    gateAngle = 0,
    gateVelocity = 0,
    gateTarget = 0,
    userData = group.userData;
  if (
    ((userData.state = state),
    (userData.beacon = [beaconX + 0.2, 2.68, beaconY]),
    (userData.interact = [0, 1, 0.75]),
    (userData.emissiveMaterial = ledMaterial),
    (userData.level = 0),
    (userData.setState = (sideSign) => {
      (sideSign !== 'live' && sideSign !== 'cutting' && sideSign !== 'cut') ||
        (sideSign !== state &&
          ((state = sideSign),
          (userData.state = sideSign),
          sideSign === 'cut' && ((cutElapsed = 0), (gateTarget = 1.32), (gateVelocity = 2.5)),
          sideSign === 'live' && (gateTarget = 0)));
    }),
    (userData.update = (sideSign) => {
      ((sideSign = Math.min(sideSign || 0, 0.1)), (elapsed += sideSign));
      let vCoord = 0,
        wCoord = RELAY_COLOR_LIVE,
        shadeValue = 0.7;
      if (state === 'live') vCoord = 5.5 + 3 * Math.sin(elapsed * 2.2);
      else if (state === 'cutting') {
        let localZ = Math.sin(elapsed * 2 * PI_RELAY * 5.5) > 0;
        ((vCoord = localZ ? 9 : 0.5),
          (wCoord = localZ ? RELAY_COLOR_CUTTING : RELAY_COLOR_LIVE),
          (shadeValue = 2.6 + Math.sin(elapsed * 9) * 1.5));
      } else if (
        ((cutElapsed += sideSign), (wCoord = RELAY_COLOR_CUT), (shadeValue = 0), cutElapsed < 0.3)
      )
        vCoord = 9;
      else if (cutElapsed < 2.6) {
        let localZ = 1 - (cutElapsed - 0.3) / 2.3;
        vCoord =
          7 *
          localZ *
          localZ *
          (Math.sin(cutElapsed * 37) * Math.sin(cutElapsed * 13.3) > -0.2 ? 1 : 0.08);
      } else vCoord = 0;
      if (
        ((userData.level = vCoord),
        setEmissive(tempColor.copy(wCoord), vCoord),
        (spinSpeed +=
          (shadeValue - spinSpeed) * Math.min(1, sideSign * (state === 'cut' ? 1.6 : 3))),
        Math.abs(spinSpeed) > 0.001)
      )
        for (let localZ of ledChildren) localZ.rotateY(spinSpeed * sideSign);
      if (Math.abs(gateTarget - gateAngle) > 1e-4 || Math.abs(gateVelocity) > 0.001) {
        gateVelocity += (-(gateAngle - gateTarget) * 30 - gateVelocity * 3.2) * sideSign;
        let localZ = gateAngle + gateVelocity * sideSign;
        (localZ < 0 && ((localZ = 0), (gateVelocity = Math.abs(gateVelocity) * 0.3)),
          localZ > 1.9 && ((localZ = 1.9), (gateVelocity = -Math.abs(gateVelocity) * 0.4)));
        let localX = localZ - gateAngle;
        gateAngle = localZ;
        for (let edgeX of doorChildren) edgeX.rotateY(-localX);
      }
    }),
    nodeOpts.state === 'cut')
  ) {
    userData.setState('cut');
    for (let sideSign = 0; sideSign < 80; sideSign++) userData.update(0.05);
  } else
    (nodeOpts.state === 'cutting' && userData.setState('cutting'),
      userData.update(0),
      state === 'live' && setEmissive(tempColor.copy(RELAY_COLOR_LIVE), 6));
  return tagPropUserData(group, 'relay_node', PROP_SIZES.relay_node.slice(0, 3), [
    {
      min: [-0.68, 0, -0.48],
      max: [0.68, 0.16, 0.48],
      surface: 'concrete',
    },
    {
      min: [-0.57, 0.16, -0.32],
      max: [0.57, 1.67, 0.33],
      surface: 'metal',
    },
    {
      min: [-0.42, 1.67, -0.26],
      max: [-0.18, 2.5, -0.02],
      surface: 'metal',
      bulletOnly: !0,
    },
  ]);
}

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

/**
 * 两轮手推车：底部承托板 + 后倾双竖梁 + 三道横梁 + 顶部手柄 + 橡胶车轮。
 * 竖梁后倾约 8°，让重心落在轮轴上方，与实物一致；承托板前缘上卷 8mm 便于铲进托盘。
 */
export function buildHandTruck(ctx, truckOpts = {}) {
  let builder = new PartBuilder(ctx),
    yellowPaint = builder.M('paint_yellow'),
    galvSteel = builder.M('steel_galv'),
    darkSteel = builder.M('steel_dark'),
    rubberMat = builder.M('rubber'),
    halfWidth = 0.2,
    railHeight = 1.2,
    railBaseY = 0.05,
    tilt = 0.14,
    baseZ = 0.06,
    railZ = (height) => baseZ - (height - railBaseY) * Math.tan(tilt);
  builder.box(yellowPaint, 0.5, 0.028, 0.28, 0, 0.034, 0.17, { r: 0.008 });
  builder.box(galvSteel, 0.44, 0.012, 0.02, 0, 0.05, 0.035, { r: 0.004 });
  for (let sideSign of [-1, 1]) {
    let railMidY = railBaseY + railHeight / 2;
    (builder.cyl(yellowPaint, 0.019, 0.019, railHeight, sideSign * halfWidth, railMidY, railZ(railMidY), {
      seg: 12,
      rot: [-tilt, 0, 0],
    }),
      builder.cyl(darkSteel, 0.023, 0.023, 0.035, sideSign * halfWidth, railBaseY, railZ(railBaseY), {
        seg: 12,
        rot: [-tilt, 0, 0],
      }));
  }
  for (let braceY of [0.34, 0.72, 1.08])
    builder.cyl(yellowPaint, 0.015, 0.015, halfWidth * 2, 0, braceY, railZ(braceY), {
      seg: 10,
      rot: [0, 0, HALF_PI],
    });
  let handleY = railBaseY + railHeight + 0.02;
  builder.cyl(galvSteel, 0.02, 0.02, halfWidth * 2 + 0.06, 0, handleY, railZ(handleY), {
    seg: 12,
    rot: [0, 0, HALF_PI],
  });
  for (let sideSign of [-1, 1])
    builder.cyl(rubberMat, 0.027, 0.027, 0.1, sideSign * (halfWidth - 0.03), handleY, railZ(handleY), {
      seg: 12,
      rot: [0, 0, HALF_PI],
    });
  let axleY = 0.17,
    axleZ = railZ(axleY) - 0.02;
  builder.cyl(darkSteel, 0.013, 0.013, 0.52, 0, axleY, axleZ, { seg: 10, rot: [0, 0, HALF_PI] });
  for (let sideSign of [-1, 1]) {
    (builder.cyl(rubberMat, 0.165, 0.165, 0.05, sideSign * 0.238, axleY, axleZ, {
      seg: 20,
      rot: [0, 0, HALF_PI],
    }),
      builder.cyl(galvSteel, 0.075, 0.075, 0.055, sideSign * 0.238, axleY, axleZ, {
        seg: 14,
        rot: [0, 0, HALF_PI],
      }));
  }
  return tagPropUserData(builder.group(), 'hand_truck', getPropSize3('hand_truck'), [
    {
      min: [-0.28, 0, -0.17],
      max: [0.28, 1.27, 0.31],
      surface: 'metal',
    },
  ]);
}

/**
 * 被遗弃的轿车：车身按 31 个截面沿车长放样。侧视轮廓在 A/C 柱处陡转形成挡风与后窗倾角，
 * 底部高度在四个轮位抬到 0.68 让轮子露出来（等效轮拱），车顶较腰线收窄 17% 形成肩线；
 * 车漆按三维噪声褪色、下沿叠锈，左前轮亏气、整车微倾
 */
export function buildAbandonedSedan(ctx, sedanOpts = {}) {
  let builder = new PartBuilder(ctx),
    paintMat = builder.M('paint_red', {
      vertexColors: !0,
    }),
    glassMat = builder.M('glass'),
    trimMat = builder.M('steel_dark'),
    chromeMat = builder.M('steel_galv'),
    rustMat = builder.M('steel_rust'),
    headlampMat = ctx.mats.emissive(15192520, 0.4),
    tailLampMat = ctx.mats.emissive(6555930, 0.35),
    tireMat = builder.M('tire'),
    plateMat = builder.M('paint_white'),
    noiseSeed = (((sedanOpts.seed | 0) % 7) + 1) * 0.61,
    SECTIONS = [
      [-2.2, 0.68, 0.46, 0.84],
      [-2.1, 0.76, 0.4, 0.88],
      [-1.98, 0.81, 0.34, 0.915],
      [-1.86, 0.835, 0.31, 0.935],
      [-1.76, 0.845, 0.46, 0.945],
      [-1.66, 0.85, 0.62, 0.955],
      [-1.5, 0.855, 0.68, 0.965],
      [-1.32, 0.857, 0.68, 0.975],
      [-1.16, 0.856, 0.62, 0.985],
      [-1.06, 0.854, 0.46, 1.0],
      [-0.98, 0.852, 0.3, 1.06],
      [-0.88, 0.85, 0.29, 1.21],
      [-0.76, 0.848, 0.28, 1.34],
      [-0.64, 0.845, 0.27, 1.44],
      [-0.4, 0.845, 0.26, 1.475],
      [0.0, 0.845, 0.26, 1.485],
      [0.34, 0.845, 0.26, 1.475],
      [0.56, 0.843, 0.26, 1.43],
      [0.68, 0.84, 0.27, 1.34],
      [0.82, 0.838, 0.28, 1.19],
      [0.96, 0.836, 0.29, 1.07],
      [1.06, 0.834, 0.3, 1.0],
      [1.16, 0.832, 0.44, 0.985],
      [1.28, 0.83, 0.62, 0.975],
      [1.42, 0.828, 0.68, 0.968],
      [1.56, 0.825, 0.62, 0.962],
      [1.68, 0.82, 0.46, 0.955],
      [1.78, 0.815, 0.33, 0.945],
      [1.96, 0.8, 0.32, 0.925],
      [2.08, 0.76, 0.36, 0.9],
      [2.16, 0.7, 0.42, 0.87],
      [2.2, 0.64, 0.48, 0.82],
    ],
    sectionByZ = new Map(SECTIONS.map((spec) => [spec[0], spec])),
    bodySection = (() => {
      let pts = [],
        cornerR = 0.2,
        arc = (cx, cy, a0, a1) => {
          for (let step = 0; step <= 4; step++) {
            let ang = a0 + ((a1 - a0) * step) / 4;
            pts.push([cx + Math.cos(ang) * cornerR, cy + Math.sin(ang) * cornerR]);
          }
        },
        halfPi = HALF_PI;
      return (
        arc(1 - cornerR, cornerR, -halfPi, 0),
        arc(1 - cornerR, 1 - cornerR, 0, halfPi),
        arc(-1 + cornerR, 1 - cornerR, halfPi, Math.PI),
        arc(-1 + cornerR, cornerR, Math.PI, Math.PI * 1.5),
        pts
      );
    })(),
    bodyGeo = loftProfileSurface(
      bodySection,
      SECTIONS.map((spec) => spec[0]),
      (coordU, coordV, stationZ) => {
        let [, halfWidth, yBottom, yTop] = sectionByZ.get(stationZ),
          shoulderTaper = 1 - 0.17 * smoothstepRange(0.42, 1, coordV);
        return [coordU * halfWidth * shoulderTaper, yBottom + coordV * (yTop - yBottom), stationZ];
      },
      {
        closed: !0,
        caps: !0,
      },
    ),
    bodyPos = bodyGeo.attributes.position,
    bodyColors = new Float32Array(bodyPos.count * 3);
  for (let vertexIdx = 0; vertexIdx < bodyPos.count; vertexIdx++) {
    let px = bodyPos.getX(vertexIdx),
      py = bodyPos.getY(vertexIdx),
      pz = bodyPos.getZ(vertexIdx),
      grain = valueNoise3D(px * 2.6 + noiseSeed, py * 2.1, pz * 1.4),
      grainFine = valueNoise3D(px * 7.3, py * 6.1 + noiseSeed, pz * 5.7),
      lowerFade = smoothstepRange(0.9, 0.42, py),
      rustMix = clampValue(lowerFade * 0.42 + (grain - 0.5) * 0.55 + (grainFine - 0.5) * 0.2, 0, 1),
      topFade = smoothstepRange(1.1, 1.43, py) * 0.45,
      sunBleach = smoothstepRange(0.4, 1.4, pz) * 0.14,
      paintR = 0.56 * (1 - topFade) + 0.66 * topFade,
      paintG = 0.14 * (1 - topFade) + 0.2 * topFade,
      paintB = 0.14 * (1 - topFade) + 0.16 * topFade;
    ((bodyColors[vertexIdx * 3] = (paintR + sunBleach) * (1 - rustMix) + 0.32 * rustMix),
      (bodyColors[vertexIdx * 3 + 1] = paintG * (1 - rustMix) + 0.16 * rustMix),
      (bodyColors[vertexIdx * 3 + 2] = paintB * (1 - rustMix) + 0.09 * rustMix));
  }
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(bodyColors, 3));
  bodyGeo.computeVertexNormals();
  builder.add(paintMat, bodyGeo);
  let quadPanel = (p0, p1, p2, p3) => {
    let bufGeo = new THREE.BufferGeometry();
    return (
      bufGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p0, ...p2, ...p3], 3),
      ),
      bufGeo.computeVertexNormals(),
      bufGeo
    );
  };
  for (let sideSign of [-1, 1]) {
    let sx = sideSign * 0.838;
    (builder.add(
      glassMat,
      sideSign > 0
        ? quadPanel([sx, 1.03, 0.62], [sx, 1.03, 0.02], [sx, 1.35, 0.08], [sx, 1.35, 0.54])
        : quadPanel([sx, 1.03, 0.02], [sx, 1.03, 0.62], [sx, 1.35, 0.54], [sx, 1.35, 0.08]),
    ),
      builder.add(
        glassMat,
        sideSign > 0
          ? quadPanel([sx, 1.03, -0.04], [sx, 1.03, -0.62], [sx, 1.34, -0.56], [sx, 1.34, -0.04])
          : quadPanel([sx, 1.03, -0.62], [sx, 1.03, -0.04], [sx, 1.34, -0.04], [sx, 1.34, -0.56]),
      ));
  }
  (builder.add(
    glassMat,
    quadPanel([-0.66, 1.0, 1.06], [0.66, 1.0, 1.06], [0.6, 1.32, 0.7], [-0.6, 1.32, 0.7]),
  ),
    builder.add(
      glassMat,
      quadPanel([-0.62, 1.02, -1.06], [0.62, 1.02, -1.06], [0.6, 1.42, -0.64], [-0.6, 1.42, -0.64]),
    ));
  for (let grilleIdx = 0; grilleIdx < 5; grilleIdx++)
    builder.box(chromeMat, 0.84, 0.018, 0.03, 0, 0.665 + grilleIdx * 0.04, 2.145, {
      r: 0.004,
    });
  (builder.box(trimMat, 0.07, 0.05, 0.46, 0.795, 1.42, 0.62, {
    r: 0.014,
    rot: [-0.62, 0, 0],
  }),
    builder.box(trimMat, 0.07, 0.05, 0.46, -0.795, 1.42, 0.62, {
      r: 0.014,
      rot: [-0.62, 0, 0],
    }),
    builder.box(trimMat, 0.075, 0.4, 0.05, 0.8, 1.19, 0.02, {
      r: 0.012,
    }),
    builder.box(trimMat, 0.075, 0.4, 0.05, -0.8, 1.19, 0.02, {
      r: 0.012,
    }),
    builder.box(trimMat, 0.075, 0.4, 0.06, 0.79, 1.28, -0.62, {
      r: 0.012,
      rot: [0.5, 0, 0],
    }),
    builder.box(trimMat, 0.075, 0.4, 0.06, -0.79, 1.28, -0.62, {
      r: 0.012,
      rot: [0.5, 0, 0],
    }),
    builder.box(chromeMat, 0.02, 0.03, 3.0, 0.7, 1.465, -0.1, {
      r: 0.006,
    }),
    builder.box(chromeMat, 0.02, 0.03, 3.0, -0.7, 1.465, -0.1, {
      r: 0.006,
    }),
    builder.box(trimMat, 1.5, 0.09, 0.06, 0, 0.6, 2.16, {
      r: 0.012,
    }),
    builder.box(trimMat, 0.7, 0.055, 0.05, 0, 0.5, 2.17, {
      r: 0.01,
    }));
  for (let sideSign of [-1, 1])
    (builder.box(headlampMat, 0.28, 0.11, 0.05, sideSign * 0.55, 0.79, 2.135, {
      r: 0.012,
    }),
      builder.box(chromeMat, 0.12, 0.06, 0.04, sideSign * 0.74, 0.665, 2.13, {
        r: 0.008,
      }),
      builder.box(tailLampMat, 0.3, 0.13, 0.05, sideSign * 0.54, 0.8, -2.2, {
        r: 0.012,
      }),
      builder.box(trimMat, 0.006, 0.5, 0.014, sideSign * 0.856, 0.58, 0.6, {
        r: 0.002,
      }),
      builder.box(trimMat, 0.006, 0.5, 0.014, sideSign * 0.856, 0.58, -0.02, {
        r: 0.002,
      }),
      builder.box(trimMat, 0.006, 0.46, 0.014, sideSign * 0.854, 0.6, -0.64, {
        r: 0.002,
      }),
      builder.box(trimMat, 0.008, 0.018, 1.9, sideSign * 0.857, 0.9, 0.02, {
        r: 0.003,
      }),
      builder.box(chromeMat, 0.03, 0.04, 0.15, sideSign * 0.865, 0.87, 0.3, {
        r: 0.008,
      }),
      builder.box(chromeMat, 0.03, 0.04, 0.15, sideSign * 0.865, 0.87, -0.4, {
        r: 0.008,
      }),
      builder.box(trimMat, 0.07, 0.022, 0.022, sideSign * 0.875, 1.03, 0.62, {
        r: 0.004,
      }),
      builder.box(paintMat, 0.085, 0.1, 0.065, sideSign * 0.905, 1.03, 0.6, {
        r: 0.014,
      }));
  (builder.box(trimMat, 1.42, 0.15, 0.13, 0, 0.44, 2.17, {
    r: 0.02,
  }),
    builder.box(trimMat, 1.46, 0.16, 0.13, 0, 0.46, -2.22, {
      r: 0.02,
    }),
    builder.box(plateMat, 0.34, 0.11, 0.012, 0, 0.56, -2.28, {
      r: 0.003,
    }),
    builder.box(chromeMat, 0.42, 0.012, 0.016, 0.27, 1.01, 1.02, {
      r: 0.003,
      rot: [0, 0.25, 0],
    }),
    builder.box(chromeMat, 0.42, 0.012, 0.016, -0.27, 1.01, 1.02, {
      r: 0.003,
      rot: [0, -0.25, 0],
    }),
    builder.cyl(trimMat, 0.035, 0.035, 0.18, 0.44, 0.33, -2.24, {
      seg: 10,
      rot: [HALF_PI, 0, 0],
    }),
    builder.cyl(chromeMat, 0.055, 0.055, 0.022, 0, 0.8, 2.16, {
      seg: 14,
      rot: [HALF_PI, 0, 0],
    }),
    builder.box(rustMat, 1.36, 0.18, 3.5, 0, 0.31, 0, {
      r: 0.02,
    }),
    builder.cyl(trimMat, 0.007, 0.007, 0.34, -0.5, 1.5, -0.5, {
      seg: 6,
    }));
  let rimGeo = revolveProfileGeometry(
      [
        [0.0, 0.05],
        [0.17, 0.05],
        [0.185, 0.02],
        [0.185, -0.02],
        [0.17, -0.05],
        [0.0, -0.05],
      ],
      16,
    ),
    WHEELS = [
      [-0.72, -1.41],
      [0.72, -1.41],
      [-0.72, 1.42],
      [0.72, 1.42],
    ];
  for (let wheelEntry of WHEELS) {
    let axleX = wheelEntry[0],
      axleZ = wheelEntry[1],
      isFlat = axleX < 0 && axleZ > 0,
      wheelRadius = isFlat ? 0.27 : 0.32;
    // je() 直接改写入参并返回同一引用，每个轮子都要独立 clone，否则变换会累积
    (builder.add(
      tireMat,
      je(
        createTireProfileGeometry(wheelRadius, 0.2, 0.185, 18),
        axleX,
        wheelRadius,
        axleZ,
        [0, 0, HALF_PI],
      ),
    ),
      builder.add(chromeMat, je(rimGeo.clone(), axleX, wheelRadius, axleZ, [0, 0, HALF_PI])));
  }
  let sedanGroup = builder.group();
  sedanGroup.rotation.z = 0.012;
  return tagPropUserData(sedanGroup, 'abandoned_sedan', getPropSize3('abandoned_sedan'), [
    {
      min: [-0.92, 0, -2.3],
      max: [0.92, 1.45, 2.25],
      surface: 'metal',
    },
  ]);
}
