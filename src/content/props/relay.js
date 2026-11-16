// content/props/relay.js — 从 basic-builders.js 按职责拆出（原单文件 5000+ 行，注释与命名沿用还原产物）。

import * as THREE from 'three';
import { PartBuilder, boxGeometry, composeTransformMatrix, createLatheGeometryFromProfile, createPlaneGeometry, createSphereGeometry, cylinderGeometry, je, mergeGeometryParts, tagPropUserData } from '../../assets/procedural/geometry.js';
import { smoothstepRange } from '../../audio/audio.js';
import { getDecalMaterial, getLabelMaterial } from '../backdrop/cranes.js';
import { PROP_SIZES } from './registry.js';
import { PI_RELAY, valueNoise2D } from '../../core/math.js';
import { createRoundedRectFanGeometry } from '../../render/effects/particles.js';

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
