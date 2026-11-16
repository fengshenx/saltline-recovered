// content/props/fixtures.js — 从 basic-builders.js 按职责拆出（原单文件 5000+ 行，注释与命名沿用还原产物）。

import { PartBuilder, boxGeometry, composeTransformMatrix, createPlaneGeometry, createSphereGeometry, je, tagPropUserData } from '../../assets/procedural/geometry.js';
import { SIGN_DECAL_NAMES } from '../../assets/procedural/textures.js';
import { smoothstepRange } from '../../audio/audio.js';
import { getDecalMaterial, getLabelMaterial } from '../backdrop/cranes.js';
import { PI } from '../level/placement.js';
import { getPropSize3 } from './registry.js';
import { valueNoise2D } from '../../core/math.js';
import { $a } from '../../misc.js';

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
