// content/props/containers.js — 从 basic-builders.js 按职责拆出（原单文件 5000+ 行，注释与命名沿用还原产物）。

import * as THREE from 'three';
import { PartBuilder, boxGeometry, buildCorrugationStations, buildPartsGroup, composeTransformMatrix, createPlaneGeometry, createPlaneGeometryWorldUV, je, loftProfileSurface, tagPropUserData } from '../../assets/procedural/geometry.js';
import { CONTAINER_LOGO_DECALS } from '../../assets/procedural/textures.js';
import { smoothstepRange } from '../../audio/audio.js';
import { getDecalMaterial, getLabelMaterial } from '../backdrop/cranes.js';
import { CONTAINER_PAINT_COLORS, PI } from '../level/placement.js';
import { CONTAINER_BODY_MATERIAL_KEY, CONTAINER_PARTS_CACHE, CONTAINER_VARIANT_COUNT, CONTAINER_WIDTH, CORNER_BLOCK_DEPTH, CORNER_BLOCK_HEIGHT, CORNER_BLOCK_LENGTH, FRONT_CORRUGATION, ROOF_CORRUGATION, SIDE_CORRUGATION } from './cargo-builders.js';
import { CONTAINER_OWNER_CODES, CONTAINER_SPECS } from './geometry.js';
import { PROP_SIZES } from './registry.js';
import { lerpVec3, valueNoise2D } from '../../core/math.js';
import { $a } from '../../misc.js';
import { createRoundedRectFanGeometry } from '../../assets/procedural/geometry.js';

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
