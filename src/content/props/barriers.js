// content/props/barriers.js — 从 basic-builders.js 按职责拆出（原单文件 5000+ 行，注释与命名沿用还原产物）。

import * as THREE from 'three';
import { PartBuilder, boxGeometry, composeTransformMatrix, createPlaneGeometry, createPlaneGeometryWorldUV, cylinderGeometry, je, loftProfileSurface, tagPropUserData } from '../../assets/procedural/geometry.js';
import { smoothstepRange } from '../../audio/audio.js';
import { getDecalMaterial, getLabelMaterial } from '../backdrop/cranes.js';
import { PI } from '../level/placement.js';
import { getPropSize3 } from './registry.js';
import { lerpVec3, valueNoise2D } from '../../core/math.js';
import { $a } from '../../misc.js';
import { createRoundedRectFanGeometry } from '../../assets/procedural/geometry.js';

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
