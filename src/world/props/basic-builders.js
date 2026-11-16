// world/props/basic-builders.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { clampValue, smoothstepRange } from '../../audio/audio.js';

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
} from '../../core/geometry.js';

import {
  PI_LATER,
  PI_RELAY,
  PI_TWO,
  lerpVec3,
  valueNoise2D,
  valueNoise3D,
} from '../../core/math.js';

import { createRoundedRectFanGeometry } from '../../effects/particles.js';

import { $a } from '../../misc.js';

import { CONTAINER_LOGO_DECALS, SIGN_DECAL_NAMES } from '../../render/materials/textures.js';

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
  for (let $ = 0; $ < dentCount; $++) {
    let ue = rand() < 0.5 ? 1 : -1,
      me = 0,
      ee = 0;
    do ((me = (rand() * 2 - 1) * (halfLen - 0.9)), ee++);
    while (ee < 8 && clearZones.some((B) => me > B[0] - 0.4 && me < B[1] + 0.4 && rand() < 0.9));
    dents.push({
      side: ue,
      x: ue * me,
      y: 0.45 + rand() * 1.3,
      r: 0.22 + rand() * 0.3,
      depth: 0.025 + rand() * 0.04,
    });
  }
  let rustStreaks = [],
    streakCount = Math.round((propW / 2.2) * (0.5 + wear) * (0.6 + rand()));
  for (let $ = 0; $ < streakCount * 2; $++)
    rustStreaks.push({
      side: $ % 2 ? 1 : -1,
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
  for (let $ of [-1, 1])
    for (let ue of [0, 1])
      for (let me of [-1, 1]) {
        let ee = $ * (halfLen - CORNER_BLOCK_LENGTH / 2),
          B = ue ? propH - CORNER_BLOCK_HEIGHT / 2 : CORNER_BLOCK_HEIGHT / 2,
          P = me * (halfWidth - CORNER_BLOCK_DEPTH / 2);
        (builder.box(
          CONTAINER_BODY_MATERIAL_KEY,
          CORNER_BLOCK_LENGTH,
          CORNER_BLOCK_HEIGHT,
          CORNER_BLOCK_DEPTH,
          ee,
          B,
          P,
          {
            r: 0.012,
          },
        ),
          builder.add(
            CONTAINER_BODY_MATERIAL_KEY,
            je(createRoundedRectFanGeometry(0.078, 0.052, 3), ee, B, me * (halfWidth + 0.0012), [
              0,
              me > 0 ? 0 : Math.PI,
              0,
            ]),
            holeColor,
          ),
          builder.add(
            CONTAINER_BODY_MATERIAL_KEY,
            je(createRoundedRectFanGeometry(0.064, 0.05, 3), $ * (halfLen + 0.0012), B, P, [
              0,
              ($ * Math.PI) / 2,
              0,
            ]),
            holeColor,
          ),
          ue &&
            builder.add(
              CONTAINER_BODY_MATERIAL_KEY,
              je(createRoundedRectFanGeometry(0.124, 0.064, 3), ee, propH + 0.0012, P, [
                -Math.PI / 2,
                0,
                0,
              ]),
              holeColor,
            ));
      }
  for (let $ of [-1, 1])
    (builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.085,
      propH - 2 * CORNER_BLOCK_HEIGHT + 0.01,
      0.15,
      -halfLen + 0.0465,
      propH / 2,
      $ * (halfWidth - 0.079),
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
        $ * (halfWidth - 0.032),
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
        $ * (halfWidth - 0.035),
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
        $ * (halfWidth - 0.029),
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
    for (let $ of [-1, 1])
      for (let ue of [-1.025, 1.025]) {
        (builder.add(
          CONTAINER_BODY_MATERIAL_KEY,
          je(createPlaneGeometry(0.36, 0.112), ue, 0.075, $ * (halfWidth - 0.0035), [
            0,
            $ > 0 ? 0 : Math.PI,
            0,
          ]),
          holeColor,
        ),
          builder.box(
            CONTAINER_BODY_MATERIAL_KEY,
            0.46,
            0.018,
            0.012,
            ue,
            0.142,
            $ * (halfWidth - 0.002),
            {
              r: 0.003,
            },
          ));
        for (let me of [-1, 1])
          builder.box(
            CONTAINER_BODY_MATERIAL_KEY,
            0.018,
            0.13,
            0.01,
            ue + me * 0.19,
            0.078,
            $ * (halfWidth - 0.003),
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
  for (let $ of [-1, 1]) {
    let ue = loftProfileSurface(
      rimStations,
      profileHeightSpan,
      (B, P, V) => [B, V, $ * (sideX + P - dentDepthFn(B, V, $))],
      {
        center: [0, propH / 2, 0],
      },
    );
    ue.computeVertexNormals();
    let me = ue.attributes.position,
      ee = new Float32Array(me.count * 3);
    for (let B = 0; B < me.count; B++) {
      let P = me.getX(B),
        V = me.getY(B),
        Y = me.getZ(B),
        L = paintColorFn(P, V, Y),
        Z = sideX - Math.abs(Y),
        J = smoothstepRange(0.008, 0.034, Z);
      L = [L[0] * (1 - 0.17 * J), L[1] * (1 - 0.18 * J), L[2] * (1 - 0.18 * J)];
      let oe = smoothstepRange(propH - 0.75, ribEndY, V);
      if (oe > 0) {
        for (let le of rustStreaks)
          if (le.side === $) {
            let R = Math.abs(P - le.x) / le.w;
            R < 1 &&
              (L = lerpVec3(
                L,
                [L[0] * rustColor[0], L[1] * rustColor[1], L[2] * rustColor[2]],
                oe * oe * le.k * (1 - R * R) * (0.45 + 0.55 * wear),
              ));
          }
      }
      let fe = dentDepthFn(P, V, $);
      (fe > 0.004 &&
        (L = lerpVec3(L, [L[0] * 0.66, L[1] * 0.46, L[2] * 0.36], Math.min(0.8, fe * 22))),
        (ee[B * 3] = L[0]),
        (ee[B * 3 + 1] = L[1]),
        (ee[B * 3 + 2] = L[2]));
    }
    (ue.setAttribute('color', new THREE.BufferAttribute(ee, 3)),
      builder.buckets.get(CONTAINER_BODY_MATERIAL_KEY).geos.push(ue));
  }
  for (let $ of [-1, 1])
    for (let ue of propW > 7 ? [-1, 1] : [1]) {
      let me = $ * ue * (halfLen - 0.62),
        ee = propH - 0.165,
        B = $ * (sideX - 0.004);
      builder.box(CONTAINER_BODY_MATERIAL_KEY, 0.24, 0.1, 0.03, me, ee, B, {
        r: 0.008,
      });
      for (let P = -1; P <= 1; P++)
        builder.add(
          CONTAINER_BODY_MATERIAL_KEY,
          je(createPlaneGeometry(0.18, 0.012), me, ee + P * 0.026, $ * (sideX + 0.0116), [
            0,
            $ > 0 ? 0 : Math.PI,
            0,
          ]),
          holeColor,
        );
    }
  {
    let $ = buildCorrugationStations(
        -halfWidth + 0.155,
        halfWidth - 0.155,
        ROOF_CORRUGATION.P,
        ROOF_CORRUGATION.d,
        ROOF_CORRUGATION.fo,
        ROOF_CORRUGATION.sl,
        -halfWidth + 0.155 + 0.03,
      ),
      ue = loftProfileSurface(
        $,
        [ribStartY, 1.25, ribEndY],
        (ee, B, P) => [-(halfLen - 0.014 + B), P, ee],
        {
          center: [0, propH / 2, 0],
        },
      ),
      me = -(halfLen - 0.014);
    builder.add(CONTAINER_BODY_MATERIAL_KEY, ue, (ee, B, P) => {
      let V = paintColorFn(ee, B, P),
        Y = smoothstepRange(0.008, 0.038, ee - me);
      return [V[0] * (1 - 0.17 * Y), V[1] * (1 - 0.18 * Y), V[2] * (1 - 0.18 * Y)];
    });
  }
  {
    let $ = buildCorrugationStations(
        -halfLen + 0.07,
        halfLen - 0.13,
        FRONT_CORRUGATION.P,
        FRONT_CORRUGATION.d,
        FRONT_CORRUGATION.fo,
        FRONT_CORRUGATION.sl,
        -halfLen + 0.1,
      ),
      ue = propH - 0.008,
      me = loftProfileSurface(
        $,
        propW > 7
          ? [-(halfWidth - 0.066), halfWidth - 0.066]
          : [-(halfWidth - 0.066), 0, halfWidth - 0.066],
        (ee, B, P) => [ee, ue + B + (Math.abs(P) < 0.01 ? 0.006 : 0), P],
        {
          center: [0, propH / 2, 0],
        },
      );
    builder.add(CONTAINER_BODY_MATERIAL_KEY, me, (ee, B, P) => {
      let V = 0.78 + 0.3 * valueNoise2D(ee * 0.8 + noiseSeed, P * 1.1),
        Y = smoothstepRange(0.004, 0.018, ue - B);
      return [V * (1 - 0.25 * Y), V * (1 - 0.3 * Y) * 0.97, V * (1 - 0.32 * Y) * 0.94];
    });
  }
  let doorsAreOpen = doorsOpen > 0.03,
    doorZoneTopY = 0.172;
  if (doorsAreOpen) {
    let $ = (ee, B, P) => {
        let Y =
          (0.16 +
            0.62 *
              smoothstepRange(-halfLen, halfLen, ee) *
              smoothstepRange(-halfLen, halfLen, ee)) *
          (0.8 + 0.2 * smoothstepRange(0.2, 1.4, B));
        return [Y, Y, Y];
      },
      ue = buildCorrugationStations(
        panelStart,
        panelEnd,
        SIDE_CORRUGATION.P,
        SIDE_CORRUGATION.d,
        SIDE_CORRUGATION.fo,
        SIDE_CORRUGATION.sl,
        panelStart + 0.02,
      );
    for (let ee of [-1, 1])
      builder.add(
        CONTAINER_BODY_MATERIAL_KEY,
        loftProfileSurface(
          ue,
          [doorZoneTopY, ribEndY - 0.02],
          (B, P, V) => [B, V, ee * (sideX + P - 0.004)],
          {
            center: [0, propH / 2, 0],
            inward: !0,
          },
        ),
        $,
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
      $,
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
        $,
      ));
    let me = createPlaneGeometryWorldUV(panelEnd - panelStart + 0.1, 2 * sideX - 0.02);
    (builder.add(
      woodMat,
      je(me, (panelStart + panelEnd) / 2 + 0.05, doorZoneTopY, 0, [-Math.PI / 2, 0, 0]),
      (ee) => {
        let B = 0.3 + 0.6 * smoothstepRange(-halfLen, halfLen, ee) ** 2;
        return [B, B * 0.97, B * 0.93];
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
  for (let $ of [1, -1]) {
    let ue = doorsOpen * ($ > 0 ? 1 : 0.88) * THREE.MathUtils.degToRad($ > 0 ? 112 : 100),
      me = $ * (halfWidth - 0.058);
    builder.push(composeTransformMatrix(doorStartX, 0, me, [0, -$ * ue, 0]));
    let ee = (k) => -$ * k,
      B = (doorFrameBottom + doorFrameTop) / 2;
    builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.034,
      doorFrameSpan,
      doorDepth - 0.006,
      0,
      B,
      ee(doorDepth / 2),
      {
        r: 0.008,
        col: paintFn,
      },
    );
    let P = type === 'container40hc' ? 7 : 6,
      V = doorFrameBottom + 0.085,
      Y = doorFrameTop - 0.085,
      L = (Y - V) / P,
      Z = 0.019,
      J = 0.031,
      oe = [];
    for (let k = 0; k < P; k++) {
      let ce = V + k * L;
      oe.push([ce, Z], [ce + 0.022, Z], [ce + 0.05, J], [ce + L - 0.05, J], [ce + L - 0.022, Z]);
    }
    (oe.push([Y, Z]),
      builder.add(
        CONTAINER_BODY_MATERIAL_KEY,
        loftProfileSurface(oe, [0.075, doorDepth - 0.085], (k, ce, ve) => [ce, k, ee(ve)], {
          center: [-1, B, ee(doorDepth / 2)],
        }),
        (k, ce, ve) => paintColorFn(k, ce, ve),
      ));
    let fe = (k) => V + (k + 0.5) * L,
      le = [0.05, 0.05, 0.05];
    (builder.box(
      CONTAINER_BODY_MATERIAL_KEY,
      0.022,
      doorFrameSpan + 0.012,
      0.018,
      0.004,
      B,
      ee(doorDepth + 0.001),
      {
        r: 0,
        col: le,
      },
    ),
      builder.box(
        CONTAINER_BODY_MATERIAL_KEY,
        0.022,
        0.016,
        doorDepth,
        0.004,
        doorFrameTop + 0.004,
        ee(doorDepth / 2),
        {
          r: 0,
          col: le,
        },
      ),
      builder.box(
        CONTAINER_BODY_MATERIAL_KEY,
        0.022,
        0.016,
        doorDepth,
        0.004,
        doorFrameBottom - 0.004,
        ee(doorDepth / 2),
        {
          r: 0,
          col: le,
        },
      ));
    let R = type === 'container40hc' ? 5 : 4;
    for (let k = 0; k < R; k++) {
      let ce = doorFrameBottom + 0.16 + (k * (doorFrameSpan - 0.32)) / (R - 1);
      (builder.box(CONTAINER_BODY_MATERIAL_KEY, 0.012, 0.062, 0.15, 0.021, ce, ee(0.085), {
        r: 0,
      }),
        builder.cyl(steelMat, 0.013, 0.013, 0.086, 0.026, ce, ee(-0.002), {
          seg: 6,
          open: !0,
        }));
    }
    for (let k of [0.31, 0.83]) {
      builder.cyl(steelMat, 0.0155, 0.0155, doorFrameSpan + 0.2, 0.052, B, ee(k), {
        seg: 7,
        open: !0,
      });
      for (let Te of [-1, 1])
        (builder.add(
          steelMat,
          je(
            boxGeometry(0.03, 0.045, 0.085),
            0.052 - 0.004,
            B + Te * (doorFrameSpan / 2 + 0.065),
            ee(k),
          ),
        ),
          builder.box(
            CONTAINER_BODY_MATERIAL_KEY,
            0.03,
            0.05,
            0.075,
            0.052 - 0.012,
            B + Te * (doorFrameSpan / 2 - 0.035),
            ee(k),
            {
              r: 0,
            },
          ));
      for (let Te of [
        doorFrameBottom + doorFrameSpan * 0.3,
        doorFrameBottom + doorFrameSpan * 0.72,
      ])
        builder.box(CONTAINER_BODY_MATERIAL_KEY, 0.026, 0.04, 0.07, 0.052 - 0.012, Te, ee(k), {
          r: 0,
        });
      let ve = 1.02 + (k > 0.5 ? 0 : 0.13),
        _e = k > 0.5 ? -1 : 1;
      (builder.box(steelMat, 0.02, 0.05, 0.05, 0.052 + 0.008, ve, ee(k), {
        r: 0,
      }),
        builder.box(steelMat, 0.011, 0.032, 0.36, 0.052 + 0.016, ve, ee(k + _e * 0.19), {
          r: 0.004,
        }),
        builder.box(
          CONTAINER_BODY_MATERIAL_KEY,
          0.03,
          0.07,
          0.05,
          0.052 - 0.008,
          ve,
          ee(k + _e * 0.33),
          {
            r: 0,
          },
        ),
        builder.box(steelMat, 0.012, 0.085, 0.012, 0.052 + 0.012, ve + 0.005, ee(k + _e * 0.33), {
          r: 0,
        }));
    }
    let I = 0.031 + 0.0025,
      se = [0, Math.PI / 2, 0],
      placeDecalOnDoor = (k, ce, ve, _e, Te) => {
        let Pe = ce * k.aspect;
        (Te && Pe > Te && ((ce *= Te / Pe), (Pe = Te)),
          builder.add(k.material, je(createPlaneGeometry(Pe, ce), I, ve, ee(_e), se), null, !0));
      };
    if ($ < 0) {
      (placeDecalOnDoor(
        getLabelMaterial(ctx, CONTAINER_OWNER_CODES[variant % CONTAINER_OWNER_CODES.length], {
          color: 'white',
          font: 'stencil',
          distress: 0.3,
        }),
        0.115,
        fe(P - 1),
        doorDepth / 2,
        doorDepth - 0.24,
      ),
        placeDecalOnDoor(
          getLabelMaterial(ctx, spec.type, {
            color: 'white',
            font: 'stencil',
            distress: 0.3,
          }),
          0.1,
          fe(P - 2),
          doorDepth / 2 + 0.2,
          0.4,
        ));
      let k = {
        color: 'white',
        font: 'sans',
        distress: 0.2,
      };
      (placeDecalOnDoor(
        getLabelMaterial(ctx, 'MAX GROSS ' + spec.gross + ' KG', k),
        0.052,
        fe(P - 3) + 0.062,
        doorDepth / 2 - 0.01,
        0.44,
      ),
        placeDecalOnDoor(
          getLabelMaterial(ctx, 'TARE ' + spec.tare + ' KG   NET ' + spec.net + ' KG', k),
          0.045,
          fe(P - 3),
          doorDepth / 2 - 0.01,
          0.44,
        ),
        placeDecalOnDoor(
          getLabelMaterial(ctx, 'CU.CAP. ' + spec.cu + ' CU.M', k),
          0.045,
          fe(P - 3) - 0.062,
          doorDepth / 2 - 0.01,
          0.44,
        ));
    } else
      (placeDecalOnDoor(
        getDecalMaterial(ctx, CONTAINER_LOGO_DECALS[variant % 4]),
        0.2,
        fe(P - 1),
        doorDepth / 2,
        doorDepth - 0.36,
      ),
        placeDecalOnDoor(
          getDecalMaterial(ctx, 'csc_plate'),
          0.17,
          fe(1),
          doorDepth / 2 + 0.05,
          0.36,
        ),
        type === 'container40hc' &&
          placeDecalOnDoor(
            getDecalMaterial(ctx, 'caution_stripes'),
            0.1,
            doorFrameTop - 0.04,
            doorDepth / 2,
            doorDepth - 0.1,
          ));
    if ((builder.pop(), doorsAreOpen))
      for (let k = 0; k < 3; k++) {
        let ce = (doorDepth * k) / 3,
          ve = (doorDepth * (k + 1)) / 3,
          _e = [doorStartX + Math.sin(ue) * ce, me - $ * Math.cos(ue) * ce],
          Te = [doorStartX + Math.sin(ue) * ve, me - $ * Math.cos(ue) * ve];
        colliders.push({
          min: [Math.min(_e[0], Te[0]) - 0.03, doorFrameBottom, Math.min(_e[1], Te[1]) - 0.03],
          max: [Math.max(_e[0], Te[0]) + 0.03, doorFrameTop, Math.max(_e[1], Te[1]) + 0.03],
          surface: 'metal',
        });
      }
  }
  for (let $ of [1, -1])
    for (let ue of [0.31, 0.83])
      for (let me of [-1, 1]) {
        let ee = $ * (halfWidth - 0.058) - $ * ue;
        builder.add(
          CONTAINER_BODY_MATERIAL_KEY,
          je(boxGeometry(0.035, 0.05, 0.11), halfLen - 0.03, me > 0 ? propH - 0.07 : 0.115, ee),
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
  for (let $ of [-1, 1]) {
    let ue = Math.min(propH * 0.4, 1.05),
      me = Math.min(ue * logoDecal.aspect, type === 'container20' ? 2.2 : 3.4);
    placeDoorDecal(
      logoDecal,
      $,
      type === 'container20' ? -0.75 : -halfLen * 0.42,
      propH * 0.52,
      me / logoDecal.aspect,
      me,
    );
    let ee = Math.min(0.14 * ownerLabel.aspect, 1.9);
    placeDoorDecal(ownerLabel, $, halfLen - 0.3 - ee / 2, propH - 0.32, 0.14, 1.9);
    let B = Math.min(0.11 * typeLabel.aspect, 0.6);
    placeDoorDecal(typeLabel, $, halfLen - 0.3 - B / 2, propH - 0.52, 0.11, 0.6);
    let P = Math.round((1 + rand() * 2) * (0.4 + wear) * (propW > 7 ? 1.6 : 1));
    for (let V = 0; V < P; V++) {
      let Y = getDecalMaterial(ctx, rand() < 0.6 ? 'rust_run' : 'grime_streak'),
        L = 0.5 + rand() * 0.7,
        Z = Math.min(0.5, Math.max(0.16, L * Y.aspect));
      placeDoorDecal(
        {
          material: Y.material,
          aspect: Z / L,
        },
        $,
        (rand() * 2 - 1) * (halfLen - 0.6),
        ribEndY - L / 2 - 0.005,
        L,
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
      cachedParts.colliders.map((d) => ({
        min: d.min.slice(),
        max: d.max.slice(),
        surface: d.surface,
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
  for (let stationX = -1.25; stationX <= 1.26; stationX += 0.25) stations.push(stationX);
  stations.push(1.47, 1.5);
  let dents = [];
  for (let stationX = 0; stationX < 7; stationX++)
    dents.push([(rand() * 2 - 1) * 1.5, rand() * 0.8, 0.08 + rand() * 0.14, rand() < 0.5 ? 1 : -1]);
  let shell = loftProfileSurface(
    profile,
    stations,
    (f, p, d) => {
      let v = Math.abs(d) > 1.49 ? 1 : 0;
      return [d, p - v * 0.022 * (p / 0.81), f * (1 - v * 0.09)];
    },
    {
      closed: !0,
      caps: !0,
    },
  );
  builder.add(concreteMat, shell, (f, p, d) => {
    let v =
        0.86 +
        0.2 * valueNoise2D(f * 1.3 + noiseOffset, p * 3 + d * 2) +
        0.08 * valueNoise2D(f * 7, p * 9 + noiseOffset),
      g = [v, v * 0.99, v * 0.97];
    g = lerpVec3(g, [v * 0.5, v * 0.48, v * 0.44], smoothstepRange(0.3, 0, p) * 0.8);
    let x =
      smoothstepRange(0.55, 0.8, valueNoise2D(f * 4.5 + noiseOffset, 3.3)) *
      smoothstepRange(0.25, 0.8, p);
    g = lerpVec3(g, [v * 0.62, v * 0.6, v * 0.56], x * 0.6);
    let y =
      smoothstepRange(0.6, 0.85, valueNoise2D(f * 2.1 + noiseOffset * 2, d * 3)) *
      smoothstepRange(0.2, 0.33, p) *
      smoothstepRange(0.62, 0.4, p);
    g = lerpVec3(g, [0.22, 0.22, 0.22], y * 0.65);
    for (let b of dents)
      if (Math.sign(d || 1) === b[3]) {
        let m = Math.hypot(f - b[0], p - b[1]) / b[2];
        m < 1 && (g = lerpVec3(g, [1.12, 1.1, 1.05], (1 - m) * 0.7));
      }
    return (
      Math.abs(f) > 1.4 &&
        (g = lerpVec3(g, [1.08, 1.06, 1.02], 0.4 * valueNoise2D(p * 9, d * 9 + noiseOffset))),
      g
    );
  });
  let fittingColor = [0.05, 0.05, 0.05];
  for (let stationX of [-1, 1])
    for (let profileH of [-0.85, 0.85])
      (builder.add(
        concreteMat,
        je(createPlaneGeometry(0.3, 0.058), profileH, 0.03, stationX * 0.3008, [
          0,
          stationX > 0 ? 0 : PI,
          0,
        ]),
        fittingColor,
      ),
        builder.box(concreteMat, 0.34, 0.012, 0.012, profileH, 0.064, stationX * 0.3, {
          r: 0.003,
          col: [0.7, 0.7, 0.68],
        }));
  for (let stationX of [-0.9, 0.9])
    builder.tube(
      builder.M('steel_rust'),
      [
        [stationX - 0.05, 0.8, 0],
        [stationX - 0.04, 0.85, 0],
        [stationX + 0.04, 0.85, 0],
        [stationX + 0.05, 0.8, 0],
      ],
      0.008,
      {
        seg: 5,
      },
    );
  if (opts.stripe) {
    let stationX = builder.M('hazard_stripes');
    builder.add(
      stationX,
      je(createPlaneGeometryWorldUV(2.9, 0.118), 0, 0.8125, 0, [-PI / 2, 0, 0]),
    );
    for (let profileH of [-1, 1])
      builder.add(
        stationX,
        je(createPlaneGeometryWorldUV(2.9, 0.2), 0, 0.68, profileH * 0.0905, [
          profileH > 0 ? -0.108 : 0.108,
          profileH > 0 ? 0 : PI,
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
  for (let stepX = 0; stepX < 8; stepX++) {
    let stepY = ((stepX + 0.5) * PI) / 4,
      offsetB = Math.cos(stepY) * 0.215,
      offsetM = Math.sin(stepY) * 0.215;
    (builder.cyl(steelMat, 0.014, 0.014, 0.1, offsetB, 0.38, offsetM, {
      seg: 6,
    }),
      builder.cyl(steelMat, 0.027, 0.027, 0.024, offsetB, 0.362, offsetM, {
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
  for (let [stepX, stepY, offsetB] of poleSections)
    builder.cyl(
      steelMat,
      poleRadiusAt(stepY) + offsetB,
      poleRadiusAt(stepX) + offsetB,
      stepY - stepX,
      0,
      (stepX + stepY) / 2,
      0,
      {
        seg: 8,
        flat: !0,
        open: !0,
        rot: [0, PI / 8, 0],
      },
    );
  for (let stepX = 0; stepX < 4; stepX++) {
    let stepY = (stepX * PI) / 2;
    builder.box(steelMat, 0.012, 0.2, 0.12, Math.cos(stepY) * 0.2, 0.45, -Math.sin(stepY) * 0.2, {
      r: 0,
      rot: [0, stepY + PI / 2, 0],
    });
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
  for (let stepX = 3.45; stepX < 12.9; stepX += 0.38, rungIndex++) {
    let stepY = rungIndex % 2 ? 1 : -1;
    builder.bar(
      steelMat,
      [0, stepX, stepY * poleRadiusAt(stepX) * 0.8],
      [0, stepX, stepY * (poleRadiusAt(stepX) + 0.15)],
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
  for (let stepX of [-0.55, 0.55])
    (addFloodlightHead(
      builder,
      steelMat,
      steelDarkMat,
      lensMat,
      0.22,
      crossbarY - 0.14,
      stepX,
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
        stepX,
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
  for (let stepX of [-0.55, 0.55])
    for (let stepY of [-1, 1])
      group.userData.lamps.push({
        pos: [stepY * 0.34, crossbarY - 0.22, stepX],
        dir: [stepY * 0.81, -0.58, 0],
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
    for (let xCoord of [0.2, 1.05, 1.9])
      builder.cyl(steelMat, 0.034, 0.034, 0.03, idx, xCoord, 0, {
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
    let xCoord = meshPos.getX(idx),
      yCoord = meshPos.getY(idx);
    (meshUv.setXY(idx, xCoord + 1.5, yCoord + 1),
      meshPos.setZ(
        idx,
        0.012 +
          0.02 *
            (valueNoise2D(xCoord * 1.3 + (fenceOpts.seed | 0), yCoord * 1.5) - 0.5) *
            (1 - Math.abs(xCoord) / 1.46),
      ));
  }
  (meshPlane.computeVertexNormals(), builder.add(meshMat, je(meshPlane, 0, 1.025, 0)));
  for (let idx = 0; idx < 3; idx++) {
    let xCoord = 0.3 + idx * 0.33,
      yCoord = 2.02 + xCoord * 0.36,
      shadeVal = leanDir * xCoord * 0.36;
    builder.bar(steelMat, [-1.5, yCoord, shadeVal], [1.5, yCoord, shadeVal], 0.0032, {
      seg: 4,
    });
    for (let barbX = -1.42 + (idx % 2) * 0.09; barbX < 1.45; barbX += 0.18)
      builder.add(
        steelMat,
        je(boxGeometry(0.004, 0.032, 0.004), barbX, yCoord, shadeVal, [
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
  for (let H of [-0.7, 0.7])
    builder.box(steelDarkMat, boothWidth + 0.06, 0.06, 0.1, 0, 0.03, H, {
      r: 0.01,
    });
  for (let H of [-1, 1])
    for (let O of [-1, 1])
      builder.box(
        wallMat,
        0.09,
        roofHeight - baseHeight,
        0.09,
        H * (halfWidth - 0.045),
        (roofHeight + baseHeight) / 2,
        O * (halfDepth - 0.045),
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
  for (let H of [-1, 1]) {
    let O = H * (halfWidth - 0.03);
    (builder.box(
      wallMat,
      0.05,
      sillHeight - baseHeight,
      boothDepth - 0.18,
      O,
      (sillHeight + baseHeight) / 2,
      0,
      {
        r: 0.006,
      },
    ),
      builder.box(wallMat, 0.075, 0.05, boothDepth - 0.18, O + H * 0.005, sillHeight + 0.01, 0, {
        r: 0.008,
      }),
      builder.box(
        glassMat,
        0.008,
        glassTopY - sillHeight - 0.03,
        boothDepth - 0.18,
        O,
        (sillHeight + glassTopY) / 2 + 0.01,
        0,
        {
          r: 0,
        },
      ),
      builder.box(wallMat, 0.05, glassTopY - sillHeight, 0.04, O, (sillHeight + glassTopY) / 2, 0, {
        r: 0.006,
      }),
      builder.box(
        wallMat,
        0.05,
        roofHeight - glassTopY,
        boothDepth - 0.18,
        O,
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
  for (let H of [-1, 1])
    builder.box(
      wallMat,
      0.07,
      glassTopY - sillHeight,
      0.04,
      windowCenterX + H * (windowWidth / 2 - 0.035),
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
  for (let H of [0.4, 1.75])
    builder.cyl(steelGalvMat, 0.012, 0.012, 0.1, doorRightX + 0.002, H, frontZ + 0.03, {
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
  for (let H of [-1, 1])
    builder.box(
      steelGalvMat,
      boothWidth + 0.36,
      0.06,
      0.08,
      0,
      roofHeight - 0.005,
      H * (halfDepth + 0.2 + 0.03),
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
  for (let H = -3; H <= 3; H++)
    builder.add(
      steelDarkMat,
      je(
        boxGeometry(0.006, 0.008, Math.sqrt(0.22 * 0.22 - (H * 0.06) ** 2) * 2),
        deskX - 0.154,
        0.62 + H * 0.06,
        -0.14,
      ),
    );
  builder.cyl(steelDarkMat, 0.05, 0.05, 0.012, deskX - 0.156, 0.62, -0.14, {
    seg: 8,
    rot: [0, 0, PI / 2],
  });
  for (let H of [-0.55, 0.05])
    builder.beam(steelDarkMat, [-halfWidth, 0.32, H], [deskX - 0.1, 0.34, H], 0.03, 0.03, {
      r: 0,
    });
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
  for (let H of [-0.85, 0.85])
    builder.box(steelDarkMat, 0.5, 0.64, 0.03, -halfWidth + 0.4, 0.44, H, {
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
  for (let H = 0; H < 5; H++) {
    let O = H * PI * 0.4;
    builder.beam(
      steelDarkMat,
      [-halfWidth + 1, 0.16, -0.2],
      [-halfWidth + 1 + Math.cos(O) * 0.26, 0.14, -0.2 + Math.sin(O) * 0.26],
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
  for (let offsetIdx of [-1, 1])
    builder.box(steelDarkMat, 0.62, 0.11, 0.012, 0.05, 0, offsetIdx * 0.175, {
      r: 0.004,
    });
  builder.box(steelDarkMat, 0.3, 0.16, 0.3, -0.33, -0.02, 0, {
    r: 0.02,
  });
  let armLength = 4.62,
    armStartX = 0.12,
    stripeCount = 9,
    stripeWidth = armLength / stripeCount;
  for (let offsetIdx = 0; offsetIdx < stripeCount; offsetIdx++)
    builder.box(
      offsetIdx % 2 ? whiteMat : redMat,
      stripeWidth + 0.001,
      0.1 - offsetIdx * 0.003,
      0.05,
      armStartX + stripeWidth * (offsetIdx + 0.5),
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
  for (let offsetIdx of [-1, 1])
    builder.box(yellowMat, 0.14, 0.14, 0.014, postX, 0.93, offsetIdx * 0.073, {
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
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    let stepTopY = (stepIndex + 1) * stepRise,
      stepX = startX + stepIndex * stepRun;
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
  for (let stepIndex of [-1, 1]) {
    (builder.beam(
      frameMat,
      [startX + 0.07, 0.13, stepIndex * 0.465],
      [endX + 0.04, 2.5, stepIndex * 0.465],
      0.24,
      0.014,
      {
        r: 0.004,
      },
    ),
      builder.box(steelGalvMat, 0.3, 0.012, 0.12, startX + 0.06, 0.006, stepIndex * 0.465, {
        r: 0,
      }));
    for (let stepTopY of [-0.08, 0.1])
      builder.cyl(
        steelGalvMat,
        0.012,
        0.012,
        0.02,
        startX + 0.06 + stepTopY,
        0.02,
        stepIndex * 0.5,
        {
          seg: 6,
        },
      );
  }
  let landingX = (stepCount + 1) * stepRise;
  (builder.box(treadMat, 0.64, 0.035, 0.96, endX + 0.3, landingX - 0.0175, 0, {
    r: 0.005,
  }),
    builder.box(railMat, 0.035, 0.038, 0.96, endX + 0.016, landingX - 0.0175, 0, {
      r: 0.006,
    }));
  for (let stepIndex of [-1, 1])
    builder.box(frameMat, 0.66, 0.16, 0.06, endX + 0.3, landingX - 0.115, stepIndex * 0.47, {
      r: 0.008,
    });
  (builder.box(frameMat, 0.06, 0.16, 0.96, 1.47, landingX - 0.115, 0, {
    r: 0.008,
  }),
    builder.box(frameMat, 0.06, 0.12, 0.9, endX + 0.02, landingX - 0.1, 0, {
      r: 0.008,
    }));
  for (let stepIndex of [-1, 1])
    (builder.box(
      frameMat,
      0.08,
      landingX - 0.19,
      0.08,
      1.44,
      (landingX - 0.19) / 2,
      stepIndex * 0.45,
      {
        r: 0.008,
      },
    ),
      builder.box(steelGalvMat, 0.18, 0.012, 0.18, 1.44, 0.006, stepIndex * 0.45, {
        r: 0,
      }),
      builder.beam(
        frameMat,
        [1.44, 1.5, stepIndex * 0.45],
        [endX + 0.1, landingX - 0.2, stepIndex * 0.45],
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
  for (let stepIndex of [-1, 1])
    colliders.push({
      min: [1.4, 0, stepIndex * 0.45 - 0.04],
      max: [1.48, landingX - 0.2, stepIndex * 0.45 + 0.04],
      surface: 'metal',
    });
  let heightAt = (g) => ((g - startX) / stepRun) * stepRise + stepRise;
  for (let stepIndex of [-1, 1]) {
    let stepTopY = stepIndex * 0.485,
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
          stepTopY - stepIndex * 0.012,
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
    (builder.box(frameMat, 0.6, 0.1, 0.008, endX + 0.3, landingX + 0.05, stepIndex * 0.476, {
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
  for (let sideSign of [-1, 1]) {
    for (let sideX of [-1, 1]) {
      (builder.box(
        uprightMat,
        0.09,
        rackHeight,
        0.07,
        sideSign * halfWidth,
        rackHeight / 2,
        sideX * halfDepth,
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
          sideSign * halfWidth,
          0.005,
          sideX * halfDepth,
          {
            r: 0,
          },
        ));
      for (let loadKind of [-0.05, 0.05])
        builder.cyl(
          steelGalvMat,
          0.01,
          0.01,
          0.02,
          sideSign * halfWidth + loadKind,
          0.016,
          sideX * halfDepth,
          {
            seg: 6,
          },
        );
      for (let loadKind = 0.12; loadKind < rackHeight - 0.05; loadKind += 0.1)
        for (let vertY of [-0.022, 0.022])
          builder.add(
            uprightMat,
            je(
              createPlaneGeometry(0.014, 0.034),
              sideSign * halfWidth + vertY,
              loadKind,
              sideX * (halfDepth + 0.0356),
              [0, sideX > 0 ? 0 : PI_LATER, 0],
            ),
            edgeColor,
          );
    }
    let beamHeights = [0.2, 1.1, 2, 2.9, 3.8];
    for (let sideX = 0; sideX < beamHeights.length; sideX++)
      (builder.box(
        uprightMat,
        0.03,
        0.03,
        2 * halfDepth - 0.07,
        sideSign * halfWidth,
        beamHeights[sideX],
        0,
        {
          r: 0,
        },
      ),
        sideX < beamHeights.length - 1 &&
          builder.beam(
            uprightMat,
            [
              sideSign * halfWidth,
              beamHeights[sideX],
              sideX % 2 ? halfDepth - 0.04 : -halfDepth + 0.04,
            ],
            [
              sideSign * halfWidth,
              beamHeights[sideX + 1],
              sideX % 2 ? -halfDepth + 0.04 : halfDepth - 0.04,
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
      sideSign * halfWidth,
      0.2,
      halfDepth + 0.06,
      {
        r: 0.006,
      },
    );
  }
  let beamYs = [1.45, 2.86];
  for (let sideSign of beamYs) {
    for (let beamHeights of [-1, 1]) {
      builder.box(
        beamMat,
        2 * halfWidth - 0.09,
        0.12,
        0.05,
        0,
        sideSign,
        beamHeights * (halfDepth + 0.01),
        {
          r: 0.008,
        },
      );
      for (let sideX of [-1, 1])
        builder.box(
          beamMat,
          0.012,
          0.2,
          0.065,
          sideX * (halfWidth - 0.051),
          sideSign - 0.02,
          beamHeights * (halfDepth + 0.005),
          {
            r: 0,
          },
        );
    }
    for (let beamHeights of [-0.85, 0, 0.85])
      builder.add(
        steelGalvMat,
        je(boxGeometry(0.04, 0.025, 2 * halfDepth), beamHeights, sideSign + 0.045, 0),
      );
    for (let beamHeights = -0.45; beamHeights <= 0.451; beamHeights += 0.1)
      builder.add(
        steelGalvMat,
        je(boxGeometry(2 * halfWidth - 0.1, 0.005, 0.005), 0, sideSign + 0.062, beamHeights),
      );
    for (let beamHeights = -1.2; beamHeights <= 1.201; beamHeights += 0.2)
      builder.add(
        steelGalvMat,
        je(boxGeometry(0.005, 0.005, 2 * halfDepth + 0.04), beamHeights, sideSign + 0.066, 0),
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
    [0, beamYs[0] + 0.068, beamYs[1] + 0.068].forEach((v, g) => {
      for (let x of [-1, 1]) {
        let y = loadKinds[Math.floor(rand() * loadKinds.length)];
        (g === 2 && y === 'drums' && (y = 'wrapped'),
          y !== 'none' &&
            addShelfLoad(
              builder,
              loadMats,
              y,
              x * 0.615 + (rand() - 0.5) * 0.03,
              v,
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
  for (let g of [-1, 1])
    builder.box(shellMat, 0.12, 2.3, 0.09, 0.19, 1.15, g * 1.105, {
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
  for (let g of [0.3, 0.9, 1.5, 2.1])
    for (let x of [-1, 1])
      builder.cyl(steelGalvMat, 0.014, 0.014, 0.012, 0.255, g, x * 1.105, {
        seg: 6,
        rot: [0, 0, PI_LATER / 2],
      });
  for (let g of [-0.8, -0.3, 0.3, 0.8])
    for (let x of [0.05, 2.255])
      builder.cyl(steelGalvMat, 0.014, 0.014, 0.012, 0.255, x, g, {
        seg: 6,
        rot: [0, 0, PI_LATER / 2],
      });
  for (let g of [-1, 1]) {
    let x = g * 0.53,
      y = 1.83;
    (builder.add(
      shellMat,
      je(createRoundedRectFanGeometry(0.66, 0.66, 6), frontX + 0.004, y, x, [0, PI_LATER / 2, 0]),
      darkColor,
    ),
      builder.cyl(shellMat, 0.335, 0.345, 0.1, frontX + 0.05, y, x, {
        seg: 20,
        open: !0,
        rot: [0, 0, PI_LATER / 2],
      }),
      builder.cyl(shellMat, 0.36, 0.36, 0.014, frontX + 0.006, y, x, {
        seg: 20,
        open: !0,
        rot: [0, 0, PI_LATER / 2],
      }));
    for (let b = 0; b < 3; b++)
      builder.add(
        steelDarkMat,
        je(boxGeometry(0.012, 0.6, 0.12), frontX + 0.04, y, x, [
          (b * PI_LATER) / 3 + g * 0.4,
          0.5,
          0,
        ]),
      );
    builder.cyl(steelDarkMat, 0.07, 0.07, 0.06, frontX + 0.05, y, x, {
      seg: 10,
      rot: [0, 0, PI_LATER / 2],
    });
    for (let b = 0; b < 8; b++) {
      let radialBarAngle = (b * PI_LATER) / 4;
      builder.add(
        steelGalvMat,
        je(boxGeometry(0.005, 0.66, 0.005), frontX + 0.098, y, x, [radialBarAngle, 0, 0]),
      );
    }
    for (let b of [0.12, 0.22, 0.32])
      builder.cyl(steelGalvMat, b, b, 0.006, frontX + 0.1, y, x, {
        seg: 20,
        open: !0,
        rot: [0, 0, PI_LATER / 2],
      });
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
  for (let g of [-1, 1]) {
    builder.add(
      shellMat,
      je(createPlaneGeometry(0.98, 0.44), frontX + 0.004, 1.16, g * 0.53, [0, PI_LATER / 2, 0]),
      darkColor,
    );
    for (let x = 0; x < 9; x++)
      builder.box(shellMat, 0.06, 0.006, 0.98, frontX + 0.035, 0.965 + x * 0.049, g * 0.53, {
        r: 0,
        rot: [0, 0, -0.75],
      });
    builder.box(shellMat, 0.05, 0.46, 0.03, frontX + 0.03, 1.16, g * 0.53, {
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
  for (let g of [-1, 1]) {
    let x = createSphereGeometry(0.15, 14, 6);
    (x.scale(1, 1, 0.45), builder.add(steelDarkMat, je(x, frontX + 0.1, 0.36, -0.58 + g * 0.23)));
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
  for (let g = 0; g < 4; g++)
    for (let x = 0; x < 2; x++)
      builder.box(
        steelDarkMat,
        0.008,
        0.03,
        0.03,
        frontX + 0.122,
        0.5 - x * 0.045,
        controlPanelZ - 0.04 - g * 0.045,
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
    doorBuilder.defCol.set(cabinetMat, (le, R, I) => {
      let se = 0.9 + 0.14 * valueNoise2D(le * 4 + noiseOffset, R * 3);
      return [se, se, se];
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
  for (let le of [-1, 1])
    for (let R of [-1, 1])
      (builder.cyl(steelGalvMat, 0.016, 0.016, 0.03, le * 0.44, 0.185, R * 0.36, {
        seg: 6,
      }),
        builder.box(steelGalvMat, 0.1, 0.012, 0.1, le * 0.44, 0.166, R * 0.36, {
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
  for (let le of [-1, 1])
    builder.box(
      cabinetMat,
      panelThickness,
      cabinetHeight,
      0.6,
      le * (0.5 - panelThickness / 2),
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
  for (let le of [-1, 1])
    builder.tube(
      steelGalvMat,
      [
        [le * 0.4 - 0.04, cabinetTop + 0.05, 0.2],
        [le * 0.4 - 0.03, cabinetTop + 0.1, 0.2],
        [le * 0.4 + 0.03, cabinetTop + 0.1, 0.2],
        [le * 0.4 + 0.04, cabinetTop + 0.05, 0.2],
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
  for (let le = 0; le < 5; le++) {
    let R = 0.42 + le * 0.22;
    (builder.box(steelDarkMat, 0.42, 0.17, 0.4, -0.25, R, -0.05, {
      r: 0.008,
    }),
      builder.box(aluMat, 0.4, 0.02, 0.012, -0.25, R + 0.06, 0.152, {
        r: 0,
      }));
    for (let I = 0; I < 4; I++)
      ledBuilder.add(
        emissiveOpts,
        je(createPlaneGeometry(0.012, 0.012), -0.41 + I * 0.035, R - 0.04, 0.1512),
      );
    for (let I = 0; I < 3; I++)
      builder.add(
        steelDarkMat,
        je(createRoundedRectFanGeometry(0.03, 0.022, 2), -0.2 + I * 0.06, R - 0.03, 0.1512),
        darkColor,
      );
  }
  let cableMats = [rubberMat, rubberMat, rubberMat];
  for (let le = 0; le < 4; le++)
    builder.tube(
      cableMats[le % 3],
      [
        [-0.2 + (le % 3) * 0.06, 0.39 + le * 0.22, 0.15],
        [-0.14 + (le % 3) * 0.05, 0.36 + le * 0.22, 0.24],
        [-0.07, 0.55 + le * 0.22, 0.22],
        [-0.2 + ((le + 1) % 3) * 0.06, 0.61 + le * 0.22, 0.15],
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
  for (let le of [doorCenterY + 0.36, doorCenterY - 0.4])
    doorBuilder.add(
      cabinetMat,
      je(createPlaneGeometry(doorWidth - 0.14, 0.3), doorWidth / 2, le, -0.0125, [0, PI_RELAY, 0]),
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
  for (let le of [-1, 1]) {
    builder.box(aluMat, 0.012, 0.98, 0.5, le * 0.506, 1.06, 0, {
      r: 0.003,
    });
    for (let R = -6; R <= 6; R++)
      builder.add(aluMat, je(boxGeometry(0.06, 0.94, 0.007), le * 0.54, 1.06, R * 0.038));
    builder.box(cabinetMat, 0.075, 0.03, 0.52, le * 0.54, 1.56, 0, {
      r: 0.006,
    });
  }
  for (let le = 0; le < 3; le++) {
    let R = -0.17 + le * 0.17,
      I = 0.44 - le * 0.02,
      se = 0.86 + le * 0.07;
    (builder.tube(
      rubberMat,
      [
        [0.5, I, R],
        [0.6, I, R],
        [0.72 + le * 0.04, I - 0.06, R],
        [se - 0.02, 0.16, R + 0.02],
        [se, -0.03, R + 0.02],
      ],
      0.04,
      {
        seg: 8,
        tension: 0.4,
      },
    ),
      builder.cyl(steelGalvMat, 0.055, 0.055, 0.05, 0.515, I, R, {
        seg: 8,
        flat: !0,
        rot: [0, 0, PI_RELAY / 2],
      }),
      builder.cyl(steelGalvMat, 0.06, 0.066, 0.03, se, 0.015, R + 0.02, {
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
    mastFeet = [0, 1, 2].map((le) => [
      beaconX + Math.cos(le * 2.094 + 0.52) * 0.085,
      beaconY + Math.sin(le * 2.094 + 0.52) * 0.085,
    ]);
  builder.box(steelGalvMat, 0.24, 0.012, 0.24, beaconX, rackTopY + 0.006, beaconY, {
    r: 0,
  });
  for (let le = 0; le < 3; le++) {
    let R = mastFeet[le],
      I = mastFeet[(le + 1) % 3];
    builder.bar(steelGalvMat, [R[0], rackTopY, R[1]], [R[0], mastTopY, R[1]], 0.011, {
      seg: 6,
    });
    let se = 5,
      ae = (mastTopY - rackTopY) / se;
    for (let k = 0; k < se; k++)
      (builder.bar(
        steelGalvMat,
        [R[0], rackTopY + k * ae, R[1]],
        [I[0], rackTopY + (k + 1) * ae, I[1]],
        0.005,
        {
          seg: 4,
        },
      ),
        builder.bar(
          steelGalvMat,
          [R[0], rackTopY + (k + 1) * ae, R[1]],
          [I[0], rackTopY + (k + 1) * ae, I[1]],
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
  for (let le of [0.5, 2.6, 4.7])
    antennaBuilder.bar(
      aluMat,
      [Math.cos(le) * 0.2, 0.3 + Math.sin(le) * 0.2, 0.09],
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
  for (let le = 1; le < 6; le++)
    builder.add(
      steelDarkMat,
      je(
        boxGeometry(0.008, 0.05, 0.006),
        -0.42 + le * 0.14,
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
  for (let le of [-1, 1])
    (builder.box(steelDarkMat, 0.03, 1.2, 0.03, le * 0.5, 0.86, cabinetFrontZ, {
      r: 0.008,
      rot: [0, PI_RELAY / 4, 0],
    }),
      ledBuilder.add(
        emissiveOpts,
        je(createPlaneGeometry(0.014, 1.14), le * 0.5, 0.86, cabinetFrontZ + 0.0215, [
          0,
          (le * PI_RELAY) / 4,
          0,
        ]).translate(le * 0.0152, 0, 0),
      ),
      ledBuilder.add(
        emissiveOpts,
        je(createPlaneGeometry(0.014, 0.9), le * 0.5715, 1.06, 0.262, [0, (le * PI_RELAY) / 2, 0]),
      ));
  for (let le of [-1, 1])
    (builder.box(steelDarkMat, 0.03, 0.06, 0.46, le * 0.587, cabinetTop - 0.01, 0, {
      r: 0.008,
    }),
      ledBuilder.add(
        emissiveOpts,
        je(createPlaneGeometry(0.4, 0.032), le * 0.6025, cabinetTop - 0.01, 0, [
          0,
          (le * PI_RELAY) / 2,
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
  for (let le of doorChildren)
    (le.position.set(doorOffset[0], doorOffset[1], doorOffset[2]),
      (le.userData.noMerge = !0),
      dynamicGroup.add(le));
  let ledChildren = antennaBuilder.group().children.slice();
  for (let le of ledChildren)
    (le.position.set(beaconPos[0], beaconPos[1], beaconPos[2]),
      (le.userData.noMerge = !0),
      dynamicGroup.add(le));
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
    (userData.setState = (le) => {
      (le !== 'live' && le !== 'cutting' && le !== 'cut') ||
        (le !== state &&
          ((state = le),
          (userData.state = le),
          le === 'cut' && ((cutElapsed = 0), (gateTarget = 1.32), (gateVelocity = 2.5)),
          le === 'live' && (gateTarget = 0)));
    }),
    (userData.update = (le) => {
      ((le = Math.min(le || 0, 0.1)), (elapsed += le));
      let R = 0,
        I = RELAY_COLOR_LIVE,
        se = 0.7;
      if (state === 'live') R = 5.5 + 3 * Math.sin(elapsed * 2.2);
      else if (state === 'cutting') {
        let ae = Math.sin(elapsed * 2 * PI_RELAY * 5.5) > 0;
        ((R = ae ? 9 : 0.5),
          (I = ae ? RELAY_COLOR_CUTTING : RELAY_COLOR_LIVE),
          (se = 2.6 + Math.sin(elapsed * 9) * 1.5));
      } else if (((cutElapsed += le), (I = RELAY_COLOR_CUT), (se = 0), cutElapsed < 0.3)) R = 9;
      else if (cutElapsed < 2.6) {
        let ae = 1 - (cutElapsed - 0.3) / 2.3;
        R =
          7 * ae * ae * (Math.sin(cutElapsed * 37) * Math.sin(cutElapsed * 13.3) > -0.2 ? 1 : 0.08);
      } else R = 0;
      if (
        ((userData.level = R),
        setEmissive(tempColor.copy(I), R),
        (spinSpeed += (se - spinSpeed) * Math.min(1, le * (state === 'cut' ? 1.6 : 3))),
        Math.abs(spinSpeed) > 0.001)
      )
        for (let ae of ledChildren) ae.rotateY(spinSpeed * le);
      if (Math.abs(gateTarget - gateAngle) > 1e-4 || Math.abs(gateVelocity) > 0.001) {
        gateVelocity += (-(gateAngle - gateTarget) * 30 - gateVelocity * 3.2) * le;
        let ae = gateAngle + gateVelocity * le;
        (ae < 0 && ((ae = 0), (gateVelocity = Math.abs(gateVelocity) * 0.3)),
          ae > 1.9 && ((ae = 1.9), (gateVelocity = -Math.abs(gateVelocity) * 0.4)));
        let k = ae - gateAngle;
        gateAngle = ae;
        for (let ce of doorChildren) ce.rotateY(-k);
      }
    }),
    nodeOpts.state === 'cut')
  ) {
    userData.setState('cut');
    for (let le = 0; le < 80; le++) userData.update(0.05);
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
    mapVertices(bagGeo, (l) => {
      let c = l.x / (width / 2),
        u = l.z / (depth / 2),
        h = l.y / (height / 2),
        f = 1 - 0.22 * Math.pow(Math.abs(c), 2.5);
      ((l.z *= f * (h < 0 ? 1.05 : 1)),
        (l.y = (l.y + height / 2) * (1 - 0.3 * Math.pow(Math.abs(c), 3)) - height / 2),
        h > 0 && (l.y += 0.016 * Math.cos(HALF_PI * c) * Math.cos(HALF_PI * u)),
        (l.y -= sag * 0.018 * Math.abs(c) * Math.abs(c) * (h > -0.9 ? 1 : 0) + skew * l.x * 0.3));
      let p = valueNoise3D(l.x * 9 + noiseOff, l.y * 9, l.z * 9 + noiseOff) - 0.5;
      ((l.x += p * 0.014), (l.z += p * 0.016), h > -0.9 && (l.y += p * 0.014));
    }),
    recomputeSmoothNormals(bagGeo)
  );
}
