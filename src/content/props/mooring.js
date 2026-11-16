// content/props/mooring.js — 从 basic-builders.js 按职责拆出（原单文件 5000+ 行，注释与命名沿用还原产物）。

import { PartBuilder, createLatheGeometryFromProfile, createSphereGeometry, je, tagPropUserData } from '../../assets/procedural/geometry.js';
import { smoothstepRange } from '../../audio/audio.js';
import { PI } from '../level/placement.js';
import { getPropSize3 } from './registry.js';
import { valueNoise2D } from '../../core/math.js';

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
