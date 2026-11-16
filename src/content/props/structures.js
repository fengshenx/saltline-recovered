// content/props/structures.js — 从 basic-builders.js 按职责拆出（原单文件 5000+ 行，注释与命名沿用还原产物）。

import { PartBuilder, boxGeometry, createSphereGeometry, je, tagPropUserData } from '../../assets/procedural/geometry.js';
import { getPropSize3Later } from './registry.js';

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
