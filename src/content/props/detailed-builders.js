// content/props/detailed-builders.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  FACE_ROTATIONS,
  HALF_PI,
  boxGeometry,
  createCylinderBetween,
  createHollowPolygonExtrusion,
  createPlaneGeometryOffsetUV,
  createRibbonFromPolyline,
  createTorusGeometryWorldUV,
  cylinderGeometry,
  flipGeometryWinding,
  mapVertices,
  revolveProfileGeometry,
  tubeGeometry,
} from '../../assets/procedural/geometry.js';

import { clampValue } from '../../audio/audio.js';

import { buildPallet, resolvePaintColorAlias } from '../level/buildings.js';

import { buildPalletStack } from '../level/placement.js';

import { createCableReelDiscGeometries } from '../models/enemies.js';

import { createTireProfileGeometry } from './basic-builders.js';

import {
  PropAssembler,
  buildBarrel,
  recomputeSmoothNormals,
  roundedBoxGeometry,
  roundedBoxGeometryGrid,
} from './detail-geometry.js';

import { smoothstepRangeAlt } from './geometry.js';

import { buildCachedPropClone } from './registry.js';

import { PI_TWO, valueNoise3D } from '../../core/math.js';

/**
 * EUR 标准木托盘：三根纵梁 + 9 个垫块 + 上下板条 + 侧面 EUR 烙印，随机微位移制造手工感，broken 时缺一块板条
 */
export function addEuroPallet(
  builder,
  rand,
  { broken = !1, stamp: doStamp = !0, bevel: useBevel = !1 } = {},
) {
  let boxGeom = useBevel
      ? (amount, extent, depthArg) => roundedBoxGeometry(amount, extent, depthArg, 0.004)
      : (amount, extent, depthArg) => boxGeometry(amount, extent, depthArg),
    deckTint = () => {
      let u = rand.range(0.62, 1),
        h = rand.range(0.9, 1);
      return [u, u * (0.93 + 0.07 * h), u * (0.82 + 0.18 * h)];
    },
    jitter = (u = 0.003) => rand.range(-u, u);
  for (let [amount, extent] of [
    [-0.45, 0.1],
    [0, 0.145],
    [0.45, 0.1],
  ])
    builder.add(
      'wood_pallet',
      boxGeom(1.2, 0.022, extent),
      {
        p: [jitter(), 0.011, amount + jitter()],
        r: [0, jitter(0.006), 0],
      },
      deckTint(),
    );
  let blockOutline = (u, h, f = 0.012) => [
    [-u / 2 + f, -h / 2],
    [u / 2 - f, -h / 2],
    [u / 2, -h / 2 + f],
    [u / 2, h / 2 - f],
    [u / 2 - f, h / 2],
    [-u / 2 + f, h / 2],
    [-u / 2, h / 2 - f],
    [-u / 2, -h / 2 + f],
  ];
  for (let amount of [-0.5275, 0, 0.5275])
    for (let extent of [-0.45, 0, 0.45])
      builder.add(
        'wood_pallet',
        createHollowPolygonExtrusion(blockOutline(0.145, extent === 0 ? 0.145 : 0.1), 0.078, {
          caps: !1,
          soft: 0,
        }),
        {
          p: [amount + jitter(), 0.061, extent + jitter()],
          r: [-HALF_PI, jitter(0.03), 0],
        },
        deckTint().map((depthArg) => depthArg * 0.8),
      );
  for (let amount of [-0.5275, 0, 0.5275])
    builder.add(
      'wood_pallet',
      boxGeom(0.145, 0.022, 1),
      {
        p: [amount + jitter(), 0.111, jitter()],
        r: [0, jitter(0.006), 0],
      },
      deckTint(),
    );
  if (
    ([
      [-0.4275, 0.145],
      [-0.215, 0.1],
      [0, 0.145],
      [0.215, 0.1],
      [0.4275, 0.145],
    ].forEach(([amount, extent], depthArg) => {
      (broken && depthArg === 3) ||
        builder.add(
          'wood_pallet',
          boxGeom(1.2, 0.022, extent),
          {
            p: [jitter(), 0.133, amount + jitter(0.006)],
            r: [jitter(0.004), jitter(0.008), 0],
          },
          deckTint(),
        );
    }),
    doStamp)
  ) {
    let amount = builder.G.mats.label('EUR', {
      color: 'black',
      font: 'sans',
      distress: 0.6,
    });
    (builder.decal(amount, 0.085, {
      p: [-0.5275, 0.062, 0.5015],
    }),
      builder.decal(amount, 0.085, {
        p: [0.5275, 0.062, -0.5015],
        r: [0, PI_TWO, 0],
      }));
  }
}

/**
 * 板条木箱的通用构造：滑木 + 内衬箱体 + 四周板条（带缝隙与色差）+ 角部护铁 + FRAGILE/编号铭牌与箭头，木箱与其堆垛共用
 */
function addWoodCrateBody(
  builder,
  width,
  height,
  depth,
  {
    detail: withDetail = !0,
    label: labelText = 'FRAGILE',
    code: crateCode = 'B4-117',
    skids: withSkids = !0,
  } = {},
) {
  let rand = builder.rng,
    ctx = builder.G,
    wallThickness = 0.022,
    battenWidth = 0.07,
    skidHeight = withSkids ? 0.07 : 0,
    bodyHeight = height - skidHeight,
    bodyMidY = skidHeight + bodyHeight / 2,
    tintFn = (z = 1) => {
      let H = rand.range(0.7, 1) * z;
      return [H, H * rand.range(0.92, 1), H * rand.range(0.82, 0.95)];
    },
    boxGeom = withDetail
      ? (sidePosition, rowY, faceKey) => roundedBoxGeometry(sidePosition, rowY, faceKey, 0.004)
      : (sidePosition, rowY, faceKey) => boxGeometry(sidePosition, rowY, faceKey);
  if (withSkids)
    for (let sidePosition of [-(width / 2 - 0.13), 0, width / 2 - 0.13])
      builder.add(
        'wood_pallet',
        roundedBoxGeometry(0.09, skidHeight, depth - 0.02, 0.006),
        {
          p: [sidePosition, skidHeight / 2, 0],
        },
        tintFn(0.6),
      );
  builder.add(
    'wood_dark',
    boxGeometry(
      width - 2 * wallThickness - 0.012,
      bodyHeight - wallThickness - 0.012,
      depth - 2 * wallThickness - 0.012,
    ),
    {
      p: [0, skidHeight + (bodyHeight - wallThickness - 0.012) / 2 + 0.002, 0],
    },
    0.25,
  );
  let rowCount = Math.max(3, Math.round(bodyHeight / 0.125)),
    rowHeight = bodyHeight / rowCount;
  for (let sidePosition = 0; sidePosition < rowCount; sidePosition++) {
    let rowY = skidHeight + rowHeight * (sidePosition + 0.5);
    for (let [faceKey, faceSpan, faceOffset] of [
      ['pz', width, depth / 2 - wallThickness],
      ['nz', width, depth / 2 - wallThickness],
      ['px', depth, width / 2 - wallThickness],
      ['nx', depth, width / 2 - wallThickness],
    ]) {
      let panelOffset = faceOffset - rand.range(0, 0.004),
        panelPos =
          faceKey === 'pz'
            ? [0, rowY, panelOffset]
            : faceKey === 'nz'
              ? [0, rowY, -panelOffset]
              : faceKey === 'px'
                ? [panelOffset, rowY, 0]
                : [-panelOffset, rowY, 0];
      builder.add(
        'wood_pallet',
        createPlaneGeometryOffsetUV(faceSpan - 0.03, rowHeight - 0.005, rand() * 3, rand() * 3),
        {
          p: panelPos,
          r: FACE_ROTATIONS[faceKey],
        },
        tintFn(),
      );
    }
  }
  let colCount = Math.max(3, Math.round(depth / 0.13)),
    colWidth = (depth - 0.02) / colCount;
  for (let sidePosition = 0; sidePosition < colCount; sidePosition++)
    builder.add(
      'wood_pallet',
      createPlaneGeometryOffsetUV(width - 0.03, colWidth - 0.005, rand() * 3, rand() * 3),
      {
        p: [
          0,
          height - wallThickness - rand.range(0, 0.003),
          -depth / 2 + 0.01 + colWidth * (sidePosition + 0.5),
        ],
        r: [-HALF_PI, 0, 0],
      },
      tintFn(),
    );
  let braceAngle = Math.atan2(bodyHeight - 2 * battenWidth, width - 2 * battenWidth),
    braceLength = Math.hypot(width - 2 * battenWidth, bodyHeight - 2 * battenWidth);
  for (let sidePosition of [1, -1]) {
    let rowY = sidePosition * (depth / 2 - wallThickness / 2);
    (builder.add(
      'wood_pallet',
      boxGeom(width, battenWidth, wallThickness),
      {
        p: [0, skidHeight + battenWidth / 2, rowY],
      },
      tintFn(0.85),
    ),
      builder.add(
        'wood_pallet',
        boxGeom(width, battenWidth, wallThickness),
        {
          p: [0, height - battenWidth / 2, rowY],
        },
        tintFn(0.85),
      ));
    for (let faceOffset of [1, -1])
      builder.add(
        'wood_pallet',
        boxGeom(battenWidth, bodyHeight - 2 * battenWidth, wallThickness),
        {
          p: [faceOffset * (width / 2 - battenWidth / 2), bodyMidY, rowY],
        },
        tintFn(0.85),
      );
    withDetail &&
      builder.add(
        'wood_pallet',
        roundedBoxGeometry(braceLength, battenWidth * 0.85, wallThickness * 0.8, 0.004),
        {
          p: [0, bodyMidY, sidePosition * (depth / 2 - wallThickness * 0.6)],
          r: [0, 0, sidePosition * braceAngle],
        },
        tintFn(0.8),
      );
    let faceKey = sidePosition * (width / 2 - wallThickness / 2),
      faceSpan = depth - 2 * wallThickness;
    for (let faceOffset of [1, -1])
      builder.add(
        'wood_pallet',
        boxGeom(wallThickness, bodyHeight, battenWidth),
        {
          p: [faceKey, bodyMidY, faceOffset * (faceSpan / 2 - battenWidth / 2)],
        },
        tintFn(0.85),
      );
    (builder.add(
      'wood_pallet',
      boxGeom(wallThickness, battenWidth, faceSpan - 2 * battenWidth),
      {
        p: [faceKey, skidHeight + battenWidth / 2, 0],
      },
      tintFn(0.85),
    ),
      builder.add(
        'wood_pallet',
        boxGeom(wallThickness, battenWidth, faceSpan - 2 * battenWidth),
        {
          p: [faceKey, height - battenWidth / 2, 0],
        },
        tintFn(0.85),
      ),
      builder.add(
        'wood_pallet',
        boxGeom(width, wallThickness, battenWidth),
        {
          p: [0, height - wallThickness / 2, sidePosition * (depth / 2 - battenWidth / 2)],
        },
        tintFn(0.85),
      ),
      builder.add(
        'wood_pallet',
        boxGeom(battenWidth, wallThickness, depth - 2 * battenWidth),
        {
          p: [sidePosition * (width / 2 - battenWidth / 2), height - wallThickness / 2, 0],
        },
        tintFn(0.85),
      ));
  }
  withDetail &&
    builder.add(
      'wood_pallet',
      roundedBoxGeometry(battenWidth, wallThickness, depth - 2 * battenWidth, 0.004),
      {
        p: [0, height - wallThickness / 2, 0],
      },
      tintFn(0.85),
    );
  let plateSize = 0.085,
    plateTint = () => {
      let z = rand.range(0.55, 0.9);
      return [z, z * 0.9, z * 0.8];
    };
  for (let sidePosition of [1, -1])
    for (let rowY of [1, -1])
      for (let faceKey of withDetail ? [1, 0] : [1]) {
        let faceSpan = faceKey ? height - plateSize / 2 : skidHeight + plateSize / 2,
          faceOffset = plateTint();
        (builder.add(
          'steel_galv',
          boxGeometry(plateSize, plateSize, 0.003),
          {
            p: [sidePosition * (width / 2 - plateSize / 2), faceSpan, rowY * (depth / 2 + 0.0015)],
          },
          faceOffset,
        ),
          builder.add(
            'steel_galv',
            boxGeometry(0.003, plateSize, plateSize),
            {
              p: [
                sidePosition * (width / 2 + 0.0015),
                faceSpan,
                rowY * (depth / 2 - plateSize / 2),
              ],
            },
            faceOffset,
          ),
          faceKey &&
            builder.add(
              'steel_galv',
              boxGeometry(plateSize, 0.003, plateSize),
              {
                p: [
                  sidePosition * (width / 2 - plateSize / 2),
                  height + 0.0015,
                  rowY * (depth / 2 - plateSize / 2),
                ],
              },
              faceOffset,
            ));
      }
  let frontZ = depth / 2 - wallThickness + 0.003,
    labelHeight = Math.min(0.11, bodyHeight * 0.15);
  (labelText &&
    (builder.label(
      labelText,
      {
        color: 'black',
        font: 'stencil',
        distress: 0.25,
      },
      width * 0.4,
      labelHeight,
      {
        p: [-width * 0.2, height - battenWidth - labelHeight * 0.95, frontZ],
      },
    ),
    builder.label(
      labelText,
      {
        color: 'black',
        font: 'stencil',
        distress: 0.25,
      },
      width * 0.4,
      labelHeight,
      {
        p: [width * 0.2, height - battenWidth - labelHeight * 0.95, -frontZ],
        r: [0, PI_TWO, 0],
      },
    ),
    builder.decal(ctx.mats.decal('arrow'), Math.min(0.14, bodyHeight * 0.2), {
      p: [width * 0.27, skidHeight + battenWidth + bodyHeight * 0.16, frontZ],
      r: [0, 0, HALF_PI],
    })),
    crateCode &&
      builder.label(
        crateCode,
        {
          color: 'black',
          font: 'stencil',
          distress: 0.3,
        },
        depth * 0.5,
        labelHeight * 0.9,
        {
          p: [width / 2 - wallThickness + 0.003, bodyMidY + bodyHeight * 0.12, 0],
          r: FACE_ROTATIONS.px,
        },
      ),
    withDetail &&
      builder.decal(ctx.mats.decal('logo_b'), Math.min(0.2, bodyHeight * 0.25), {
        p: [-(width / 2 - wallThickness + 0.003), bodyMidY - bodyHeight * 0.05, 0],
        r: FACE_ROTATIONS.nx,
      }));
}

/**
 * 单只出口板条木箱，按 seed 轮换警示语与批次编号
 */
function buildCrateWood(ctx, opts) {
  let crateAsm = new PropAssembler(ctx, 'crate_wood', opts.seed || 0);
  return (
    addWoodCrateBody(crateAsm, 1.1, 1, 0.9, {
      label:
        opts.label === void 0
          ? ['FRAGILE', 'THIS SIDE UP', 'KEEP DRY', 'MACHINE PARTS'][crateAsm.seed % 4]
          : opts.label,
      code: opts.code || 'B4-' + [117, 204, 318][crateAsm.seed % 3],
    }),
    crateAsm.finish()
  );
}

/**
 * 三层木箱堆垛：两只大箱错位叠放 + 顶端小箱，外侧用两条橙色打包带沿箱体轮廓缠绕
 */
function buildCrateStack(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'crate_stack', opts.seed || 0),
    rand = assembler.rng;
  addWoodCrateBody(assembler, 1.2, 0.95, 1, {
    label: 'HEAVY',
    code: 'SLT 04' + (assembler.seed % 2),
  });
  let upperCrate = {
    x: rand.range(-0.1, 0.02),
    z: rand.range(-0.05, 0.05),
    th: (rand() < 0.5 ? -1 : 1) * rand.range(0.1, 0.16),
    L: 0.86,
    W: 0.72,
  };
  (assembler.push({
    p: [upperCrate.x, 0.95, upperCrate.z],
    r: [0, upperCrate.th, 0],
  }),
    addWoodCrateBody(assembler, upperCrate.L, 0.6, upperCrate.W, {
      detail: !1,
      skids: !1,
      label: 'FRAGILE',
      code: 'B4-204',
    }),
    assembler.pop());
  let topCrate = {
    x: upperCrate.x + rand.range(-0.05, 0.05),
    z: upperCrate.z + rand.range(-0.04, 0.04),
    th: rand.range(-0.12, 0.12),
  };
  (assembler.push({
    p: [topCrate.x, 1.55, topCrate.z],
    r: [0, topCrate.th, 0],
  }),
    addWoodCrateBody(assembler, 0.55, 0.35, 0.45, {
      detail: !1,
      skids: !1,
      label: '',
      code: '',
    }),
    assembler.pop());
  let bandZAt = (a, l, c, u, h) => {
    let f = (a - l.x - h * u * Math.sin(c)) / Math.cos(c);
    return l.z - f * Math.sin(c) + h * u * Math.cos(c);
  };
  for (let bandX of [-0.2, 0.17]) {
    let bandPts = [],
      bandPathAt = (h) => [
        [bandX, 0.09, h * 0.506],
        [bandX, 0.956, h * 0.506],
        [bandX, 1.556, bandZAt(bandX, upperCrate, upperCrate.th, upperCrate.W / 2, h) + h * 0.006],
        [bandX, 1.906, bandZAt(bandX, topCrate, topCrate.th, 0.225, h) + h * 0.006],
      ];
    (bandPts.push(...bandPathAt(1), ...bandPathAt(-1).reverse()),
      assembler.add(
        'paint_orange',
        createRibbonFromPolyline(bandPts, [0.02, 0, 0]),
        null,
        [1, 0.8, 0.5],
      ),
      assembler.add(
        'steel_worn',
        roundedBoxGeometry(0.06, 0.09, 0.025, 0.006),
        {
          p: [bandX, 0.62, 0.5 + 0.016],
        },
        0.8,
      ),
      assembler.add(
        'steel_dark',
        createCylinderBetween(
          [bandX - 0.035, 0.66, 0.53],
          [bandX + 0.035, 0.66, 0.53],
          0.008,
          6,
          !0,
        ),
        null,
        0.8,
      ));
  }
  return assembler.finish();
}

/**
 * 1000L IBC 吨桶：镀锌托盘/笼架、半透明塑料内胆（带液面高度与鼓胀）、红色桶盖与提手、侧面危险品与 IBC 1000 L 铭牌
 */
function buildIbcTote(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'ibc_tote', opts.seed || 0),
    rand = assembler.rng,
    tintFn = () => rand.range(0.75, 1);
  for (let bladderVertex of [-0.44, 0, 0.44])
    assembler.add(
      'steel_galv',
      boxGeometry(1.2, 0.028, 0.1),
      {
        p: [0, 0.014, bladderVertex],
      },
      tintFn(),
    );
  for (let bladderVertex of [-0.54, 0, 0.54])
    for (let faceNormX of [-0.44, 0, 0.44])
      assembler.add(
        'steel_galv',
        roundedBoxGeometry(0.12, 0.074, 0.1, 0.008),
        {
          p: [bladderVertex, 0.065, faceNormX],
        },
        tintFn() * 0.85,
      );
  for (let bladderVertex of [-0.48, 0.48])
    assembler.add(
      'steel_galv',
      roundedBoxGeometry(1.2, 0.03, 0.04, 0.006),
      {
        p: [0, 0.115, bladderVertex],
      },
      tintFn(),
    );
  for (let bladderVertex of [-0.58, 0.58])
    assembler.add(
      'steel_galv',
      roundedBoxGeometry(0.04, 0.03, 0.92, 0.006),
      {
        p: [bladderVertex, 0.115, 0],
      },
      tintFn(),
    );
  assembler.add(
    'steel_galv',
    boxGeometry(1.12, 0.012, 0.92),
    {
      p: [0, 0.124, 0],
    },
    0.6,
  );
  let palletWidth = 1.1,
    bladderHeight = 0.95,
    bladderDepth = 0.9,
    bladderY = 0.13 + bladderHeight / 2,
    bladderGeo = roundedBoxGeometryGrid(palletWidth, bladderHeight, bladderDepth, 0.07, 8, 6, 8);
  (mapVertices(bladderGeo, (bladderVertex) => {
    let faceNormX = bladderVertex.x / (palletWidth / 2),
      faceNormY = bladderVertex.y / (bladderHeight / 2),
      faceNormZ = bladderVertex.z / (bladderDepth / 2),
      xFaceBulge = Math.cos(HALF_PI * faceNormY) * Math.cos(HALF_PI * faceNormZ),
      topFaceBulge = Math.cos(HALF_PI * faceNormX) * Math.cos(HALF_PI * faceNormZ),
      zFaceBulge = Math.cos(HALF_PI * faceNormX) * Math.cos(HALF_PI * faceNormY);
    (Math.abs(faceNormX) > 0.9 &&
      (bladderVertex.x +=
        Math.sign(faceNormX) *
        (0.016 * xFaceBulge +
          0.004 * Math.abs(Math.sin((bladderVertex.y * PI_TWO) / 0.22)) * xFaceBulge)),
      Math.abs(faceNormZ) > 0.9 &&
        (bladderVertex.z +=
          Math.sign(faceNormZ) *
          (0.016 * zFaceBulge +
            0.004 * Math.abs(Math.sin((bladderVertex.y * PI_TWO) / 0.22)) * zFaceBulge)),
      faceNormY > 0.9 &&
        (bladderVertex.y +=
          0.012 * topFaceBulge -
          0.01 * Math.max(0, 1 - Math.hypot(bladderVertex.x, bladderVertex.z) / 0.3)));
  }),
    recomputeSmoothNormals(bladderGeo));
  let fillLevel = 0.13 + bladderHeight * rand.range(0.45, 0.8),
    noiseOffset = assembler.seed * 1.3,
    bladderMat = assembler.mat('plastic_grey', {
      color: 14278096,
    });
  (assembler.add(
    bladderMat,
    bladderGeo,
    {
      p: [0, bladderY, 0],
    },
    (bladderVertex, faceNormX, faceNormY) => {
      let faceNormZ = smoothstepRangeAlt(
          fillLevel - 0.03,
          fillLevel + 0.03,
          faceNormX + 0.02 * valueNoise3D(bladderVertex * 3 + noiseOffset, faceNormY * 3),
        ),
        xFaceBulge =
          0.9 + 0.1 * valueNoise3D(bladderVertex * 6, faceNormX * 6 + noiseOffset, faceNormY * 6);
      return [
        xFaceBulge * (0.52 + 0.48 * faceNormZ),
        xFaceBulge * (0.6 + 0.4 * faceNormZ),
        xFaceBulge * (0.66 + 0.34 * faceNormZ),
      ];
    },
  ),
    assembler.add(
      bladderMat,
      cylinderGeometry(0.12, 0.125, 0.03, 14),
      {
        p: [0, 0.13 + bladderHeight + 0.005, 0],
      },
      0.9,
    ),
    assembler.add(
      'plastic_red',
      revolveProfileGeometry(
        [
          [0.105, 0],
          [0.105, 0.042],
          [0.105, 0.042],
          [0.09, 0.05],
          [0, 0.05],
        ],
        14,
      ),
      {
        p: [0, 0.13 + bladderHeight + 0.015, 0],
      },
      0.9,
    ));
  for (let bladderVertex = 0; bladderVertex < 8; bladderVertex++) {
    let faceNormX = (bladderVertex * PI_TWO) / 4;
    assembler.add(
      'plastic_red',
      boxGeometry(0.012, 0.04, 0.02),
      {
        p: [Math.cos(faceNormX) * 0.108, 0.13 + bladderHeight + 0.036, Math.sin(faceNormX) * 0.108],
        r: [0, -faceNormX, 0],
      },
      0.8,
    );
  }
  let cageHalfX = 0.575,
    cageHalfZ = 0.475,
    cageBottomY = 0.13,
    cageTopY = 1.1,
    barRadius = 0.011;
  for (let bladderVertex of [0.2, 0.42, 0.64, 0.86, cageTopY]) {
    let faceNormX = bladderVertex === cageTopY ? 0.014 : barRadius;
    for (let faceNormY of [1, -1])
      (assembler.add(
        'steel_galv',
        createCylinderBetween(
          [-cageHalfX, bladderVertex, faceNormY * cageHalfZ],
          [cageHalfX, bladderVertex, faceNormY * cageHalfZ],
          faceNormX,
          5,
        ),
        null,
        tintFn(),
      ),
        assembler.add(
          'steel_galv',
          createCylinderBetween(
            [faceNormY * cageHalfX, bladderVertex, -cageHalfZ],
            [faceNormY * cageHalfX, bladderVertex, cageHalfZ],
            faceNormX,
            5,
          ),
          null,
          tintFn(),
        ));
  }
  for (let bladderVertex of [1, -1]) {
    for (let faceNormX = -0.46; faceNormX <= 0.461; faceNormX += 0.184)
      assembler.add(
        'steel_galv',
        createCylinderBetween(
          [faceNormX, cageBottomY, bladderVertex * (cageHalfZ - 0.012)],
          [faceNormX, cageTopY, bladderVertex * (cageHalfZ - 0.012)],
          barRadius,
          5,
        ),
        null,
        tintFn(),
      );
    for (let faceNormX = -0.36; faceNormX <= 0.361; faceNormX += 0.18)
      assembler.add(
        'steel_galv',
        createCylinderBetween(
          [bladderVertex * (cageHalfX - 0.012), cageBottomY, faceNormX],
          [bladderVertex * (cageHalfX - 0.012), cageTopY, faceNormX],
          barRadius,
          5,
        ),
        null,
        tintFn(),
      );
    assembler.add(
      'steel_galv',
      createCylinderBetween(
        [bladderVertex * 0.28, cageTopY + 0.01, -cageHalfZ],
        [bladderVertex * 0.28, cageTopY + 0.01, cageHalfZ],
        0.013,
        5,
      ),
      null,
      tintFn(),
    );
  }
  return (
    assembler.add(
      'aluminium',
      roundedBoxGeometry(0.42, 0.3, 0.004, 0.0015),
      {
        p: [-0.1, 0.72, cageHalfZ + 0.014],
      },
      0.85,
    ),
    assembler.label(
      'IBC 1000 L',
      {
        color: 'black',
        font: 'sans',
        distress: 0.2,
      },
      0.36,
      0.06,
      {
        p: [-0.1, 0.8, cageHalfZ + 0.0175],
      },
    ),
    assembler.decal(
      ctx.mats.decal(['hazard_flammable', 'hazard_general'][assembler.seed % 2]),
      0.15,
      {
        p: [-0.19, 0.67, cageHalfZ + 0.0175],
      },
    ),
    assembler.decal(ctx.mats.decal('numbers_0_9'), 0.2, {
      p: [0, 0.66, cageHalfZ + 0.0175],
    }),
    assembler.decal(ctx.mats.decal('leak_stain'), 0.3, {
      p: [cageHalfX + 0.004, 0.3, 0.02],
      r: FACE_ROTATIONS.px,
    }),
    assembler.add(
      'polymer_black',
      createCylinderBetween([0.52, 0.2, 0], [0.575, 0.2, 0], 0.05, 10, !0),
      null,
      1,
    ),
    assembler.add(
      'plastic_red',
      createCylinderBetween([0.575, 0.2, 0], [0.598, 0.2, 0], 0.045, 10, !0),
      null,
      0.9,
    ),
    assembler.add(
      'plastic_red',
      roundedBoxGeometry(0.02, 0.022, 0.13, 0.005),
      {
        p: [0.55, 0.262, 0.02],
        r: [0, 0.4, 0],
      },
      0.9,
    ),
    assembler.add('polymer_black', cylinderGeometry(0.012, 0.012, 0.03, 6), {
      p: [0.55, 0.245, 0],
    }),
    assembler.finish()
  );
}

/**
 * 电缆盘：双面木侧板 + 内筒 + 缠绕的橡胶电缆（带外露线头）+ 地脚垫木与规格铭牌
 */
function buildCableReel(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'cable_reel', opts.seed || 0),
    rand = assembler.rng,
    discRadius = 0.65,
    centerY = discRadius,
    halfWidth = 0.4,
    flangeThickness = 0.045,
    tintFn = (y = 1) => {
      let b = rand.range(0.7, 1) * y;
      return [b, b * rand.range(0.93, 1), b * rand.range(0.85, 0.97)];
    },
    tilt = rand.range(-0.5, 0.5);
  assembler.push({
    p: [0, centerY, 0],
    r: [0, 0, tilt],
  });
  for (let tintScale of [1, -1]) {
    for (let baseTone of createCableReelDiscGeometries(discRadius - 0.004, 9, rand))
      assembler.add(
        'wood_dark',
        baseTone,
        {
          p: [0, 0, tintScale * (halfWidth + rand.range(0, 0.003))],
          r: [0, tintScale > 0 ? 0 : PI_TWO, 0],
        },
        tintFn(),
      );
    for (let baseTone of createCableReelDiscGeometries(discRadius - 0.004, 9, rand))
      assembler.add(
        'wood_dark',
        baseTone,
        {
          p: [0, 0, tintScale * (halfWidth - flangeThickness)],
          r: [0, tintScale > 0 ? PI_TWO : 0, HALF_PI],
        },
        tintFn(0.8),
      );
    (assembler.add(
      'wood_dark',
      cylinderGeometry(discRadius, discRadius, flangeThickness, 24, !0),
      {
        p: [0, 0, tintScale * (halfWidth - flangeThickness / 2)],
        r: [HALF_PI, 0, 0],
      },
      tintFn(0.75),
    ),
      assembler.add(
        'steel_dark',
        cylinderGeometry(0.105, 0.105, 0.008, 12),
        {
          p: [0, 0, tintScale * (halfWidth + 0.006)],
          r: [HALF_PI, 0, 0],
        },
        0.9,
      ),
      assembler.add(
        'polymer_black',
        cylinderGeometry(0.04, 0.04, 0.004, 10),
        {
          p: [0, 0, tintScale * (halfWidth + 0.0105)],
          r: [HALF_PI, 0, 0],
        },
        0.3,
      ));
    for (let baseTone = 0; baseTone < 6; baseTone++) {
      let noiseCoord = (baseTone * PI_TWO) / 3 + 0.3;
      assembler.add(
        'steel_galv',
        cylinderGeometry(0.017, 0.017, 0.014, 6),
        {
          p: [
            Math.cos(noiseCoord) * 0.3,
            Math.sin(noiseCoord) * 0.3,
            tintScale * (halfWidth + 0.006),
          ],
          r: [HALF_PI, 0, 0],
        },
        rand.range(0.5, 0.9),
      );
    }
    (assembler.label(
      tintScale > 0 ? 'NYY-J 4x95 mm2  500 m' : 'SALTLINE TERMINAL',
      {
        color: 'white',
        font: 'stencil',
        distress: 0.45,
      },
      0.7,
      0.085,
      {
        p: [0, 0.4, tintScale * (halfWidth + 0.006)],
        r: [0, tintScale > 0 ? 0 : PI_TWO, 0],
      },
    ),
      tintScale > 0 &&
        assembler.decal(ctx.mats.decal('arrow'), 0.2, {
          p: [0.36, -0.2, halfWidth + 0.006],
          r: [0, 0, -1.2],
        }));
  }
  let spokeCount = 16,
    innerRadius = halfWidth - flangeThickness,
    spokeStep = (2 * innerRadius) / spokeCount,
    cableRadius = 0.47,
    cableProfile = [];
  for (let tintScale = 0; tintScale <= spokeCount; tintScale++)
    (cableProfile.push([cableRadius - 0.017, -innerRadius + tintScale * spokeStep]),
      tintScale < spokeCount &&
        cableProfile.push([cableRadius, -innerRadius + (tintScale + 0.5) * spokeStep]));
  let noiseSeed = assembler.seed * 0.7;
  (assembler.add(
    'rubber',
    revolveProfileGeometry(cableProfile, 20),
    {
      r: [HALF_PI, 0, 0],
    },
    (tintScale, baseTone, noiseCoord) =>
      0.7 + 0.5 * valueNoise3D(Math.atan2(baseTone, tintScale) * 2 + noiseSeed, noiseCoord * 30),
  ),
    assembler.pop());
  let cableZ = 0.2,
    cablePath = [];
  for (let tintScale = 1.9; tintScale >= -0.25; tintScale -= 0.36)
    cablePath.push([
      Math.cos(tintScale) * (cableRadius + 0.012),
      centerY + Math.sin(tintScale) * (cableRadius + 0.012),
      cableZ + (1.9 - tintScale) * 0.02,
    ]);
  (cablePath.push(
    [0.53, 0.3, cableZ + 0.05],
    [0.56, 0.08, cableZ + 0.06],
    [0.5, 0.024, cableZ + 0.02],
    [0.3, 0.022, cableZ - 0.1],
    [0.05, 0.022, cableZ - 0.02],
    [-0.2, 0.022, cableZ + 0.06],
    [-0.38, 0.022, cableZ - 0.05],
  ),
    assembler.add('rubber', tubeGeometry(cablePath, 0.02, 6, !1, 0.5), null, 0.9),
    assembler.add(
      'brass',
      createCylinderBetween(
        [-0.38, 0.022, cableZ - 0.05],
        [-0.41, 0.022, cableZ - 0.07],
        0.014,
        6,
        !0,
      ),
      null,
      0.9,
    ));
  for (let tintScale of [halfWidth - flangeThickness / 2, -(halfWidth - flangeThickness / 2)])
    (assembler.add(
      'wood_pallet',
      createHollowPolygonExtrusion(
        [
          [0.14, 0],
          [0.37, 0],
          [0.37, 0.1],
        ],
        0.1,
        {
          soft: 0,
        },
      ),
      {
        p: [0, 0, tintScale],
      },
      tintFn(0.8),
    ),
      assembler.add(
        'wood_pallet',
        createHollowPolygonExtrusion(
          [
            [-0.37, 0],
            [-0.14, 0],
            [-0.37, 0.1],
          ],
          0.1,
          {
            soft: 0,
          },
        ),
        {
          p: [0, 0, tintScale],
        },
        tintFn(0.8),
      ));
  return assembler.finish();
}

/**
 * 叠放轮胎（1..5 只）：每只随机转动，胎面用噪声做深浅，落地接触区压暗
 */
function buildTireStack(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'tire_stack', opts.seed || 0),
    rand = assembler.rng,
    tireCount = clampValue(opts.count | 0 || 4, 1, 5);
  for (let tireIndex = 0; tireIndex < tireCount; tireIndex++) {
    let tireGeo = createTireProfileGeometry(0.39, 0.25, 0.215, tireCount > 4 ? 16 : 20),
      tireTransform = {
        p: [
          tireIndex ? rand.range(-0.022, 0.022) : 0,
          tireIndex * 0.25 - (tireIndex ? 0.004 : 0),
          tireIndex ? rand.range(-0.022, 0.022) : 0,
        ],
        r: [0, rand() * 6, 0],
      },
      shade = rand.range(0.75, 1),
      noiseOffset = tireIndex * 3.1;
    assembler.add('tire', tireGeo, tireTransform, (vertexX, vertexY, vertexZ) => {
      let radialDist = Math.hypot(vertexX - tireTransform.p[0], vertexZ - tireTransform.p[2]);
      return (
        shade *
        (radialDist < 0.23
          ? 0.5
          : 0.8 +
            0.2 * valueNoise3D(Math.atan2(vertexZ, vertexX) * 3 + noiseOffset, radialDist * 30))
      );
    });
  }
  return assembler.finish({
    size: [0.8, tireCount * 0.25, 0.8],
  });
}

/**
 * 20L 军用油桶：圆角桶体 + 三条提手 + 侧面 X 形加强筋 + 注油口，带易燃标志贴花
 */
function buildJerryCan(ctx, opts, variant) {
  let rand = new PropAssembler(ctx, 'jerry_can', variant),
    [bodyMat, bodyTint] = resolvePaintColorAlias(opts.color, 'olive'),
    bodyGeo = roundedBoxGeometryGrid(0.336, 0.36, 0.156, 0.022, 3, 3, 3, 'bottom'),
    shoulderTaper = (x, y) => (y > 0.3 && x > 0.04 ? y - (x - 0.04) * 0.5 : y);
  (mapVertices(bodyGeo, (vert) => {
    ((vert.y = shoulderTaper(vert.x, vert.y)),
      Math.abs(vert.z) > 0.07 &&
        Math.abs(vert.x) < 0.14 &&
        vert.y > 0.04 &&
        vert.y < 0.3 &&
        (vert.z *= 1.02));
  }),
    bodyGeo.computeVertexNormals(),
    rand.add(bodyMat, bodyGeo, null, bodyTint),
    rand.add(
      bodyMat,
      createHollowPolygonExtrusion(
        [
          [-0.172, 0],
          [0.172, 0],
          [0.172, 0.297],
          [0.045, 0.364],
          [-0.172, 0.364],
        ],
        0.007,
        {
          soft: 0,
        },
      ),
      null,
      typeof bodyTint == 'number' ? 0.8 : bodyTint.map((vert) => vert * 0.8),
    ));
  let handleLen = 0.24,
    handleH = 0.2,
    gripX = -0.025,
    gripY = 0.165,
    diagLen = Math.hypot(handleLen, handleH) - 0.02,
    diagAngle = Math.atan2(handleH, handleLen);
  for (let vert of [1, -1]) {
    let sideOffset = vert * 0.079;
    for (let barSign of [1, -1])
      rand.add(
        bodyMat,
        roundedBoxGeometry(handleLen, 0.016, 0.007, 0.003),
        {
          p: [gripX, gripY + (barSign * handleH) / 2, sideOffset],
        },
        bodyTint,
      );
    for (let barSign of [1, -1])
      rand.add(
        bodyMat,
        roundedBoxGeometry(0.016, handleH, 0.007, 0.003),
        {
          p: [gripX + (barSign * handleLen) / 2, gripY, sideOffset],
        },
        bodyTint,
      );
    for (let barSign of [1, -1])
      rand.add(
        bodyMat,
        roundedBoxGeometry(diagLen, 0.018, 0.008, 0.003),
        {
          p: [gripX, gripY, sideOffset],
          r: [0, 0, barSign * diagAngle],
        },
        bodyTint,
      );
  }
  for (let vert of [-0.042, 0, 0.042])
    rand.add(
      bodyMat,
      tubeGeometry(
        [
          [-0.135, 0.35, vert],
          [-0.125, 0.42, vert],
          [-0.09, 0.44, vert],
          [-0.02, 0.44, vert],
          [0.01, 0.42, vert],
          [0.02, 0.35, vert],
        ],
        0.0105,
        5,
        !1,
        0.5,
      ),
      null,
      bodyTint,
    );
  let spoutStart = [0.1, 0.33, 0],
    spoutDir = [0.42, 0.9, 0],
    spoutPoint = (x) => [spoutStart[0] + spoutDir[0] * x, spoutStart[1] + spoutDir[1] * x, 0];
  return (
    rand.add(
      bodyMat,
      createCylinderBetween(spoutPoint(-0.02), spoutPoint(0.07), 0.03, 8, !0),
      null,
      bodyTint,
    ),
    rand.add(
      'steel_dark',
      createCylinderBetween(spoutPoint(0.07), spoutPoint(0.1), 0.036, 8, !0),
      null,
      0.9,
    ),
    rand.add(
      'steel_galv',
      roundedBoxGeometry(0.07, 0.008, 0.02, 0.002),
      {
        p: spoutPoint(0.108),
        r: [0, 0, -0.44],
      },
      0.8,
    ),
    rand.decal(ctx.mats.decal('hazard_flammable'), 0.055, {
      p: [0.125, 0.25, 0.0795],
    }),
    rand.decal(ctx.mats.decal('hazard_flammable'), 0.055, {
      p: [-0.125, 0.25, -0.0795],
      r: [0, PI_TWO, 0],
    }),
    rand.finish()
  );
}

/**
 * 交通锥：黑色橡胶底座 + 收分锥体，红白反光带用不同材质分段实现；lying 参数把锥放倒并换碰撞盒尺寸
 */
function buildTrafficCone(ctx, opts, variant) {
  let rand = new PropAssembler(ctx, 'traffic_cone', variant),
    rng = rand.rng,
    noiseOffset = variant * 4.1;
  opts.lying &&
    (rand.push({
      p: [-0.34, 0.18, 0],
      r: [0, rng() * 6, 0],
    }),
    rand.push({
      r: [0, 0, -HALF_PI + 0.16],
    }));
  let radiusAt = (h) => 0.128 + ((0.031 - 0.128) * (h - 0.05)) / (0.685 - 0.05);
  rand.add('rubber', roundedBoxGeometry(0.36, 0.03, 0.36, 0.008, 'bottom'), null, 0.9);
  let tintFn = (h, f, p) => {
      let d = valueNoise3D(Math.atan2(p, h) * 3 + noiseOffset, f * 14);
      return d > 0.68 ? 0.45 : 0.85 + 0.15 * d;
    },
    coneSegment = (h, f, p = [], d = []) =>
      revolveProfileGeometry([...p, [radiusAt(h), h], [radiusAt(f), f], ...d], 16),
    redMat = rand.mat('plastic_red', {
      color: 12734234,
    }),
    greyMat = rand.mat('plastic_grey', {
      color: 13224386,
    });
  return (
    rand.add(
      redMat,
      coneSegment(0.05, 0.36, [
        [0.165, 0.03],
        [0.15, 0.04],
        [0.136, 0.05],
      ]),
      null,
      tintFn,
    ),
    rand.add(
      greyMat,
      coneSegment(0.36, 0.5),
      null,
      (segFromY, segToY, extraPoints) => 0.85 * tintFn(segFromY, segToY, extraPoints),
    ),
    rand.add(redMat, coneSegment(0.5, 0.56), null, tintFn),
    rand.add(
      greyMat,
      coneSegment(0.56, 0.61),
      null,
      (segFromY, segToY, extraPoints) => 0.85 * tintFn(segFromY, segToY, extraPoints),
    ),
    rand.add(
      redMat,
      coneSegment(
        0.61,
        0.685,
        [],
        [
          [0.028, 0.696],
          [0.018, 0.7],
          [0.018, 0.7],
          [0, 0.7],
        ],
      ),
      null,
      tintFn,
    ),
    opts.lying && (rand.pop(), rand.pop()),
    rand.finish(
      opts.lying
        ? {
            size: [0.72, 0.36, 0.36],
          }
        : {},
    )
  );
}

/**
 * 三只工业气瓶立在有防滑板与护栏的支架里：瓶身/肩部/瓶阀分别配色，随机气种铭牌与瓶体环箍，配链条与减压阀
 */
function buildGasCylinders(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'gas_cylinders', opts.seed || 0),
    rand = assembler.rng,
    segments = 12,
    tintFn = () => rand.range(0.6, 0.9);
  assembler.add('diamond_plate', roundedBoxGeometry(0.9, 0.016, 0.5, 0.004, 'bottom'), null, 0.8);
  for (let profilePos of [-0.43, 0.43])
    (assembler.add(
      'steel_dark',
      roundedBoxGeometry(0.04, 1.14, 0.04, 0.005),
      {
        p: [profilePos, 0.585, -0.225],
      },
      tintFn(),
    ),
      assembler.add(
        'steel_dark',
        roundedBoxGeometry(0.036, 0.036, 0.43, 0.005),
        {
          p: [profilePos, 1.06, -0.01],
        },
        tintFn(),
      ),
      assembler.add(
        'steel_dark',
        roundedBoxGeometry(0.036, 0.036, 0.43, 0.005),
        {
          p: [profilePos, 0.3, -0.01],
        },
        tintFn(),
      ),
      assembler.add(
        'steel_dark',
        roundedBoxGeometry(0.036, 0.32, 0.036, 0.005),
        {
          p: [profilePos, 0.16, 0.19],
        },
        tintFn(),
      ),
      assembler.add(
        'steel_galv',
        createTorusGeometryWorldUV(0.016, 0.004, 4, 8),
        {
          p: [profilePos - Math.sign(profilePos) * 0, 1.06, 0.215],
          r: [0, HALF_PI, 0],
        },
        0.8,
      ));
  for (let profilePos of [0.45, 1.06])
    assembler.add(
      'steel_dark',
      roundedBoxGeometry(0.9, 0.04, 0.036, 0.005),
      {
        p: [0, profilePos, -0.225],
      },
      tintFn(),
    );
  (assembler.add(
    'paint_yellow',
    roundedBoxGeometry(0.3, 0.2, 0.004, 0.001),
    {
      p: [0, 0.76, -0.245],
    },
    0.9,
  ),
    assembler.decal(ctx.mats.decal('hazard_flammable'), 0.15, {
      p: [0, 0.76, -0.2475],
      r: [0, PI_TWO, 0],
    }));
  let bodyColors = [
      ['paint_red', 1],
      ['paint_white', 1],
      ['paint_blue', 1],
      ['paint_yellow', 1],
      ['paint_grey', 0.5],
    ],
    shoulderColors = [
      ['paint_grey', 0.75],
      ['paint_grey', 0.55],
      ['paint_red', [0.55, 0.4, 0.4]],
      ['paint_blue', 0.8],
    ];
  for (let profilePos = 0; profilePos < 3; profilePos++) {
    let capHeight = (profilePos - 1) * 0.272,
      bottleOffsetIdx = 1 - rand.range(0, 0.05),
      relOffset = 0.115,
      bottleTopY = bodyColors[(assembler.seed + profilePos * 2) % bodyColors.length],
      valveHeight = shoulderColors[(assembler.seed + profilePos) % shoulderColors.length],
      noiseSeed = profilePos * 5.3 + assembler.seed,
      spinOffset = rand() * 6;
    (assembler.push({
      p: [capHeight, 0.016, 0.015 + rand.range(-0.01, 0.01)],
      r: [0, spinOffset, 0],
      s: [1, bottleOffsetIdx, 1],
    }),
      assembler.add(
        valveHeight[0],
        revolveProfileGeometry(
          [
            [0, 0.012],
            [0.095, 0.012],
            [0.095, 0.012],
            [0.1, 0],
            [0.111, 0],
            [relOffset, 0.008],
            [relOffset, 0.4],
            [relOffset, 0.8],
            [relOffset, 1.22],
          ],
          segments,
        ),
        null,
        (revolveCoordX, revolveCoordY, revolveCoordZ) => {
          let stripeNoise = valueNoise3D(
              Math.atan2(revolveCoordZ, revolveCoordX) * 3 + noiseSeed,
              revolveCoordY * 5,
            ),
            damageScale = stripeNoise > 0.7 ? 0.55 : 1,
            shoulderTint =
              typeof valveHeight[1] == 'number'
                ? [valveHeight[1], valveHeight[1], valveHeight[1]]
                : valveHeight[1];
          return [
            shoulderTint[0] * damageScale,
            shoulderTint[1] * damageScale * (stripeNoise > 0.7 ? 0.85 : 1),
            shoulderTint[2] * damageScale * (stripeNoise > 0.7 ? 0.7 : 1),
          ];
        },
      ),
      assembler.add(
        bottleTopY[0],
        revolveProfileGeometry(
          [
            [relOffset, 1.22],
            [0.111, 1.285],
            [0.098, 1.34],
            [0.075, 1.385],
            [0.052, 1.41],
            [0.04, 1.42],
          ],
          segments,
        ),
        null,
        bottleTopY[1],
      ),
      assembler.add(
        'steel_dark',
        revolveProfileGeometry(
          [
            [0.04, 1.42],
            [0.057, 1.42],
            [0.057, 1.42],
            [0.057, 1.448],
            [0.057, 1.448],
            [0.05, 1.452],
            [0.053, 1.53],
            [0.046, 1.565],
            [0.026, 1.585],
            [0, 1.588],
          ],
          segments,
        ),
        null,
        0.8,
      ));
    for (let revolveCoordX of [0, PI_TWO])
      assembler.add(
        'polymer_black',
        cylinderGeometry(0.016, 0.016, 0.004, 6),
        {
          p: [Math.cos(revolveCoordX) * 0.052, 1.5, Math.sin(revolveCoordX) * 0.052],
          r: [0, -revolveCoordX, HALF_PI],
        },
        0.2,
      );
    (profilePos !== 1 &&
      assembler.cdecal(
        ctx.mats.decal(profilePos ? 'hazard_general' : 'hazard_flammable'),
        relOffset + 0.0015,
        0.1,
        {
          p: [0, 1.08, 0],
          r: [0, rand.range(-0.5, 0.5) - spinOffset, 0],
        },
      ),
      assembler.cdecal(
        ctx.mats.label(
          ['ACETYLENE', 'OXYGEN', 'ARGON', 'PROPANE'][(assembler.seed + profilePos) % 4],
          {
            color: 'white',
            font: 'stencil',
            distress: 0.4,
          },
        ),
        relOffset + 0.0015,
        0.2,
        {
          p: [0, 0.86, 0],
          r: [0, rand.range(-0.4, 0.4) - spinOffset, 0],
        },
      ),
      assembler.pop());
  }
  let barCount = 19,
    capHeightAt = (u) => {
      let h = 0.215;
      for (let f = -1; f <= 1; f++) {
        let p = u - f * 0.272;
        Math.abs(p) < 0.115 && (h = Math.max(h, 0.015 + Math.sqrt(0.123 * 0.123 - p * p) + 0));
      }
      return Math.max(h, 0.1);
    };
  for (let profilePos = 0; profilePos < barCount; profilePos++) {
    let capHeight = profilePos / (barCount - 1),
      bottleOffsetIdx = -0.425 + 0.85 * capHeight,
      relOffset =
        Math.max(
          capHeightAt(bottleOffsetIdx),
          capHeightAt(bottleOffsetIdx - 0.03),
          capHeightAt(bottleOffsetIdx + 0.03),
        ) + 0.004,
      bottleTopY = 1.05 - 0.035 * Math.sin(PI_TWO * ((capHeight * 3) % 1)) - 0.01;
    assembler.add(
      'steel_galv',
      createTorusGeometryWorldUV(0.017, 0.0045, 3, 6),
      {
        p: [bottleOffsetIdx, bottleTopY, relOffset],
        r: [profilePos % 2 ? HALF_PI : 0.15, 0, 0],
        s: [1.35, 1, 1],
      },
      rand.range(0.6, 0.95),
    );
  }
  return assembler.finish();
}

/**
 * 钢管堆：木枕木上三层（4+3+2）错位排布的锈蚀钢管，两端开口带内壁，两端装钢挡架，附 API 5L 规格铭牌
 */
function buildPipeStack(ctx, opts) {
  let assembler = new PropAssembler(ctx, 'pipe_stack', opts.seed || 0),
    rand = assembler.rng,
    pipeRadius = 0.1365,
    wallThickness = 0.012,
    skidHeight = 0.08,
    segments = 14,
    tintFn = (h = 1) => {
      let f = rand.range(0.6, 0.95) * h;
      return [f, f * 0.95, f * 0.86];
    };
  for (let offsetX of [-2.2, 0, 2.2]) {
    assembler.add(
      'wood_dark',
      roundedBoxGeometry(0.11, skidHeight, 1.2, 0.008),
      {
        p: [offsetX + rand.range(-0.1, 0.1), skidHeight / 2, 0],
        r: [0, rand.range(-0.03, 0.03), 0],
      },
      tintFn(),
    );
    for (let rowIdx of [1, -1])
      assembler.add(
        'wood_pallet',
        createHollowPolygonExtrusion(
          rowIdx > 0
            ? [
                [0, 0],
                [0.158, 0],
                [0.158, 0.1],
              ]
            : [
                [-0.158, 0],
                [0, 0],
                [-0.158, 0.1],
              ],
          0.1,
          {
            soft: 0,
          },
        ),
        {
          p: [offsetX, skidHeight, rowIdx * 0.44],
          r: [0, -HALF_PI, 0],
        },
        tintFn(0.9),
      );
  }
  let layerCounts = [4, 3, 2],
    rowOffset = 2 * pipeRadius * Math.sin(PI_TWO / 3);
  layerCounts.forEach((offsetX, rowIdx) => {
    for (let pipeIdx = 0; pipeIdx < offsetX; pipeIdx++) {
      let lateralOffset = (pipeIdx - (offsetX - 1) / 2) * 2 * pipeRadius,
        rowY = skidHeight + pipeRadius + rowIdx * rowOffset,
        pipeLength = rand.range(5.78, 5.92),
        xOffset = rand.range(-3, 3 - pipeLength) * 0.999 + 0,
        centerX = Math.max(-3, Math.min(3 - pipeLength, xOffset)) + pipeLength / 2,
        pipeMat = rand() < 0.7 ? 'steel_rust' : 'steel_dark',
        noiseSeed = rand() * 50,
        tintAmplitude = rand.range(0.75, 1),
        pipeGeo = new THREE.CylinderGeometry(pipeRadius, pipeRadius, pipeLength, segments, 4, !0);
      {
        let uvAttr = pipeGeo.attributes.uv,
          posAttr = pipeGeo.attributes.position;
        for (let vertIdx = 0; vertIdx < uvAttr.count; vertIdx++)
          uvAttr.setXY(
            vertIdx,
            uvAttr.getX(vertIdx) * 2 * PI_TWO * pipeRadius,
            posAttr.getY(vertIdx),
          );
      }
      let placeTf = {
        p: [centerX, rowY, lateralOffset],
        r: [rand() * 6, 0, HALF_PI],
      };
      assembler.add(
        pipeMat,
        pipeGeo,
        placeTf,
        (uvAttr, posAttr, vertIdx) =>
          tintAmplitude *
          (0.75 + 0.35 * valueNoise3D(uvAttr * 1.3 + noiseSeed, vertIdx * 9, posAttr * 9)),
      );
      let linerGeo = flipGeometryWinding(
        cylinderGeometry(
          pipeRadius - wallThickness,
          pipeRadius - wallThickness,
          pipeLength - 0.002,
          segments,
          !0,
        ),
      );
      assembler.add(
        'steel_rust',
        linerGeo,
        placeTf,
        (uvAttr) =>
          0.16 +
          0.5 *
            smoothstepRangeAlt(
              pipeLength / 2 + Math.abs(centerX) - 0.9,
              pipeLength / 2 + Math.abs(centerX) + 0.2,
              Math.abs(uvAttr - centerX) + Math.abs(centerX),
            ),
      );
      for (let uvAttr of [1, -1])
        assembler.add(
          pipeMat,
          revolveProfileGeometry(
            uvAttr > 0
              ? [
                  [pipeRadius, 0],
                  [pipeRadius - wallThickness, 0],
                ]
              : [
                  [pipeRadius - wallThickness, 0],
                  [pipeRadius, 0],
                ],
            segments,
          ),
          {
            p: [centerX + (uvAttr * pipeLength) / 2, rowY, lateralOffset],
            r: [0, 0, -HALF_PI],
          },
          tintAmplitude * 1.1,
        );
    }
  });
  for (let offsetX of [-1.35, 1.5]) {
    let pipeIdx = 2 * pipeRadius,
      lateralOffset = skidHeight + pipeRadius + 2 * rowOffset + pipeRadius + 0.004,
      rowY = [],
      pipeLength = [
        [-(1.5 * pipeIdx + pipeRadius + 0.004), skidHeight + pipeRadius],
        [
          -(0.5 * pipeIdx + pipeRadius * 0.5 + 0.004),
          skidHeight + pipeRadius + 2 * rowOffset + pipeRadius * 0.87,
        ],
        [-0.5 * pipeIdx, lateralOffset],
        [0.5 * pipeIdx, lateralOffset],
        [
          0.5 * pipeIdx + pipeRadius * 0.5 + 0.004,
          skidHeight + pipeRadius + 2 * rowOffset + pipeRadius * 0.87,
        ],
        [1.5 * pipeIdx + pipeRadius + 0.004, skidHeight + pipeRadius],
        [1.5 * pipeIdx, skidHeight - 0.004],
        [-1.5 * pipeIdx, skidHeight - 0.004],
        [-(1.5 * pipeIdx + pipeRadius + 0.004), skidHeight + pipeRadius],
      ];
    for (let xOffset of pipeLength) rowY.push([offsetX, xOffset[1], xOffset[0]]);
    (assembler.add('steel_dark', createRibbonFromPolyline(rowY, [0.016, 0, 0]), null, 0.7),
      assembler.add(
        'steel_galv',
        roundedBoxGeometry(0.04, 0.012, 0.05, 0.003),
        {
          p: [offsetX, lateralOffset + 0.005, 0.03],
        },
        0.8,
      ));
  }
  return (
    assembler.cdecal(
      ctx.mats.label('API 5L X52  273.1 x 12.5  HEAT 40719', {
        color: 'white',
        font: 'stencil',
        distress: 0.5,
      }),
      pipeRadius + 0.002,
      0.2,
      {
        p: [0.9, skidHeight + pipeRadius + 2 * rowOffset, pipeRadius],
        r: [-HALF_PI + 0.9, 0, HALF_PI],
      },
      1.6,
    ),
    assembler.finish()
  );
}

/**
 * 把油桶/托盘/木箱/吨桶/线缆盘/轮胎/油桶/锥/气瓶/钢管这批用 PropAssembler 写的道具登记进注册表，可重复变体的按参数拼 key 走缓存
 */
export function registerDetailedProps(register) {
  (register('barrel', (propCtx, propOpts = {}) => {
    let variantSeed = Math.abs(propOpts.seed | 0) % 4;
    return buildCachedPropClone(
      `barrel|${propOpts.color}|${!!propOpts.lying}|${!!propOpts.open}|${variantSeed}`,
      () => buildBarrel(propCtx, propOpts, variantSeed),
    );
  }),
    register('pallet', (propCtx, propOpts = {}) => {
      let variantSeed = Math.abs(propOpts.seed | 0) % 4;
      return buildCachedPropClone(`pallet|${!!propOpts.broken}|${variantSeed}`, () =>
        buildPallet(propCtx, propOpts, variantSeed),
      );
    }),
    register('pallet_stack', (propCtx, propOpts = {}) => buildPalletStack(propCtx, propOpts)),
    register('crate_wood', (propCtx, propOpts = {}) => buildCrateWood(propCtx, propOpts)),
    register('crate_stack', (propCtx, propOpts = {}) => buildCrateStack(propCtx, propOpts)),
    register('ibc_tote', (propCtx, propOpts = {}) => buildIbcTote(propCtx, propOpts)),
    register('cable_reel', (propCtx, propOpts = {}) => buildCableReel(propCtx, propOpts)),
    register('tire_stack', (propCtx, propOpts = {}) => buildTireStack(propCtx, propOpts)),
    register('jerry_can', (propCtx, propOpts = {}) => {
      let variantSeed = Math.abs(propOpts.seed | 0) % 2;
      return buildCachedPropClone(`jerry|${propOpts.color}|${variantSeed}`, () =>
        buildJerryCan(propCtx, propOpts, variantSeed),
      );
    }),
    register('traffic_cone', (propCtx, propOpts = {}) => {
      let variantSeed = Math.abs(propOpts.seed | 0) % 3;
      return buildCachedPropClone(`cone|${!!propOpts.lying}|${variantSeed}`, () =>
        buildTrafficCone(propCtx, propOpts, variantSeed),
      );
    }),
    register('gas_cylinders', (propCtx, propOpts = {}) => buildGasCylinders(propCtx, propOpts)),
    register('pipe_stack', (propCtx, propOpts = {}) => buildPipeStack(propCtx, propOpts)));
}
