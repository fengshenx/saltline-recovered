// content/props/storage.js — 从 basic-builders.js 按职责拆出（原单文件 5000+ 行，注释与命名沿用还原产物）。

import { PartBuilder, boxGeometry, composeTransformMatrix, createPlaneGeometry, createSphereGeometry, je, tagPropUserData } from '../../assets/procedural/geometry.js';
import { smoothstepRange } from '../../audio/audio.js';
import { getDecalMaterial, getLabelMaterial } from '../backdrop/cranes.js';
import { getPropSize3Later } from './registry.js';
import { PI_LATER, valueNoise2D } from '../../core/math.js';
import { $a } from '../../misc.js';
import { createRoundedRectFanGeometry } from '../../assets/procedural/geometry.js';

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
