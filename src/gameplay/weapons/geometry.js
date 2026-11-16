// gameplay/weapons/geometry.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  buildPlateX,
  buildPlateZ,
  buildRoundedBox,
  buildRoundedTab,
  mergeGeometryParts,
  roundedRectOutline,
  roundedSlotOutline,
  tubeGeometry,
} from '../../assets/procedural/geometry.js';

import { im } from '../../misc.js';

/**
 * 按顶点攒 position/normal/uv/color 再一次性出 BufferGeometry 的曲面构造器，带四边面朝向自动纠正，用于船体这类必须逐面给色的曲面
 */
export var SurfaceBuilder = class {
  constructor() {
    ((this.p = []), (this.n = []), (this.u = []), (this.c = []));
  }
  v(e, t, n, s, o) {
    (this.p.push(e.x, e.y, e.z),
      this.n.push(t.x, t.y, t.z),
      this.u.push(n, s),
      this.c.push(o[0], o[1], o[2]));
  }
  quad(e, t, n, s) {
    let o = e[1].clone().sub(e[0]),
      r = e[3].clone().sub(e[0]),
      a = o.cross(r).dot(t[0]) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (let l of a) this.v(e[l], t[l], n[l][0], n[l][1], s[l]);
  }
  geo() {
    let e = new THREE.BufferGeometry();
    return (
      e.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)),
      e.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)),
      e.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)),
      e.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)),
      e
    );
  }
};

/**
 * 给几何体烘 vertex color：基色乘 ±10% 哈希噪声，再按掩码在倒角处叠高光磨损，是整套道具/武器不用贴图也有体积感的关键
 */
export function applyVertexShading(geometry, tint, wearAmount = 0, wearMaskFn = null) {
  let posAttr = geometry.attributes.position,
    nrmAttr = geometry.attributes.normal,
    vertCount = posAttr.count,
    colorArr = new Float32Array(vertCount * 3);
  for (let vertIdx = 0; vertIdx < vertCount; vertIdx++) {
    let posX = posAttr.getX(vertIdx),
      posY = posAttr.getY(vertIdx),
      posZ = posAttr.getZ(vertIdx),
      shadeFactor =
        0.9 + 0.2 * im(Math.round(posX * 70), Math.round(posY * 70), Math.round(posZ * 70));
    if (
      wearAmount > 0 &&
      wearMaskFn &&
      wearMaskFn(nrmAttr.getX(vertIdx), nrmAttr.getY(vertIdx), nrmAttr.getZ(vertIdx))
    ) {
      let wearHash = im(Math.round(posX * 300), Math.round(posY * 300), Math.round(posZ * 300));
      {
        let rimRamp = Math.max(0, wearHash - 0.84) / 0.16;
        shadeFactor *= 1 + wearAmount * 1.6 * rimRamp * rimRamp;
      }
    }
    ((colorArr[vertIdx * 3] = tint[0] * shadeFactor),
      (colorArr[vertIdx * 3 + 1] = tint[1] * shadeFactor),
      (colorArr[vertIdx * 3 + 2] = tint[2] * shadeFactor));
  }
  return (geometry.setAttribute('color', new THREE.BufferAttribute(colorArr, 3)), geometry);
}

/**
 * 把二维半径/轴向截面绕 Z 轴旋成回转体，逐段生成圆环与索引，可带中心偏移和自定义顶点色回调，枪管、弹匣、握把等圆柱件都走它
 */
export function buildLatheBody(
  profile,
  segments,
  tint,
  bumpStrength = 0,
  offsetU = 0,
  offsetV = 0,
  colorFn = null,
) {
  let posArr = [],
    normArr = [],
    colArr = [],
    idxArr = [],
    vertBase = 0;
  for (let profIdx = 0; profIdx < profile.length - 1; profIdx++) {
    let [radius0, axial0] = profile[profIdx],
      [radius1, axial1] = profile[profIdx + 1],
      dRadius = radius1 - radius0,
      dAxial = axial1 - axial0,
      segLen = Math.hypot(dRadius, dAxial);
    if (segLen < 1e-7) continue;
    let nrmAxial = dAxial / segLen,
      nrmRadial = -dRadius / segLen,
      isChamfer = Math.abs(nrmAxial) > 0.25 && Math.abs(nrmRadial) > 0.25;
    for (let segIdx = 0; segIdx <= segments; segIdx++) {
      let theta = (segIdx / segments) * Math.PI * 2,
        cosT = Math.cos(theta),
        sinT = Math.sin(theta);
      for (let endIdx = 0; endIdx < 2; endIdx++) {
        let radius = endIdx ? radius1 : radius0,
          axial = endIdx ? axial1 : axial0,
          posX = offsetU + radius * cosT,
          posY = offsetV + radius * sinT,
          posZ = -axial;
        (posArr.push(posX, posY, posZ), normArr.push(nrmAxial * cosT, nrmAxial * sinT, -nrmRadial));
        let shade = 0.9 + 0.2 * im(Math.round(axial * 150), Math.round(theta * 3), profIdx);
        if (isChamfer && bumpStrength > 0) {
          let knurlNoise = im(segIdx * 7.1, profIdx * 3.3, axial * 100);
          {
            let knurlMask = Math.max(0, knurlNoise - 0.84) / 0.16;
            shade *= 1 + bumpStrength * 1.6 * knurlMask * knurlMask;
          }
        }
        let baseColor = colorFn ? colorFn(radius, axial, tint) : tint;
        colArr.push(baseColor[0] * shade, baseColor[1] * shade, baseColor[2] * shade);
      }
    }
    for (let segIdx = 0; segIdx < segments; segIdx++) {
      let theta = vertBase + segIdx * 2,
        cosT = theta + 2,
        sinT = theta + 1,
        endIdx = theta + 3;
      idxArr.push(theta, sinT, cosT, cosT, sinT, endIdx);
    }
    vertBase += (segments + 1) * 2;
  }
  let latheGeo = new THREE.BufferGeometry();
  return (
    latheGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3)),
    latheGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3)),
    latheGeo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3)),
    latheGeo.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(new Float32Array((posArr.length / 3) * 2), 2),
    ),
    latheGeo.setIndex(idxArr),
    latheGeo
  );
}

/**
 * PAC-9 Longshore 步枪的关键装配尺寸表（枪口/抛壳口/瞄具高度/镜片焦距/弹匣位/枪机行程/导轨顶/握把与护木位置），几何生成与动画都以它为唯一基准
 */
export var PAC9_DIMENSIONS = {
  name: 'PAC-9 Longshore',
  muzzle: [0, 0, -0.531],
  eject: [0.023, 0.004, -0.028],
  sightY: 0.069,
  lensF: 0.0285,
  window: [
    [-0.016, 0.057],
    [0.016, 0.057],
    [0.016, 0.0772],
    [0.0122, 0.081],
    [-0.0122, 0.081],
    [-0.016, 0.0772],
  ],
  magPos: [0, -0.02, -0.0665],
  boltTravel: 0.062,
  railTop: 0.0435,
  grip: [0, -0.1, 0.073],
  handguard: [0, 0, -0.255],
  handguardR: 0.021,
  handlePos: [-0.026, 0.007, -0.078],
  squeeze: 0.86,
};

/**
 * 用轮廓+回转体从零手搓整把 PAC-9：机匣、护木、导轨齿、弹匣（带弯曲偏移）、枪机、扳机组、瞄具罩与镜片，按材质分成 ano/gun/poly/plain/bolt/mag/round 七组几何返回
 */
export function buildPac9Geometry() {
  let anoColor = [1, 1, 1],
    gunColor = [1, 1, 1],
    steelBright = [5.5, 5.5, 5.7],
    darkColor = [0.4, 0.4, 0.42],
    polyColor = [1, 1, 1],
    rubberColor = [0.022, 0.022, 0.023],
    anoParts = [],
    gunParts = [],
    polyParts = [],
    boltParts = [],
    magParts = [],
    roundParts = [],
    plainParts = [],
    bevelHigh = 9,
    bevelLow = 5,
    wearPoly = 0.6,
    rearPlateProfile = [
      [-0.1, -0.02],
      [0.1, -0.02],
      [0.1, 0.027],
      [0.093, 0.034],
      [-0.088, 0.034],
      [-0.1, 0.024],
    ];
  (anoParts.push(
    buildPlateX(rearPlateProfile, 0, 0.0205, 0.0014, anoColor, bevelHigh, [
      roundedRectOutline(-0.012, -0.01, 0.06, 0.012, 0.003),
    ]),
  ),
    anoParts.push(
      buildPlateX(rearPlateProfile, -0.0205, 0, 0.0014, anoColor, bevelHigh, [
        roundedSlotOutline(0.032, 0.007, 0.112, 0.0075, 4),
      ]),
    ),
    gunParts.push(buildRoundedBox(0.004, 0.036, 0.19, 5e-4, -0.0135, 0.006, 0, darkColor)),
    gunParts.push(buildRoundedBox(0.004, 0.012, 0.19, 5e-4, 0.0145, 0.022, 0, darkColor)),
    gunParts.push(buildRoundedBox(0.004, 0.008, 0.19, 5e-4, 0.0145, -0.014, 0, darkColor)),
    gunParts.push(
      buildLatheBody(
        [
          [0, 0.058],
          [0.0128, 0.058],
          [0.0128, 0.099],
          [0, 0.099],
        ],
        16,
        [0.8, 0.8, 0.82],
      ),
    ),
    anoParts.push(
      buildRoundedBox(
        0.009,
        0.02,
        0.018,
        0.003,
        0.0225,
        0.004,
        -0.026,
        anoColor,
        bevelHigh,
        [0, -0.35, 0],
      ),
    ),
    anoParts.push(
      buildLatheBody(
        [
          [0, -0.086],
          [0.0062, -0.086],
          [0.0072, -0.084],
          [0.0072, -0.06],
          [0.0045, -0.057],
          [0, -0.057],
        ],
        12,
        anoColor,
        bevelHigh,
        0.0215,
        0.012,
      ),
    ),
    gunParts.push(
      buildLatheBody(
        [
          [0, -0.094],
          [0.0048, -0.094],
          [0.0055, -0.092],
          [0.0055, -0.086],
          [0, -0.086],
        ],
        12,
        steelBright,
        0,
        0.0215,
        0.012,
      ),
    ),
    anoParts.push(
      buildRoundedBox(0.004, 0.012, 0.05, 0.0015, -0.0212, -0.006, -0.055, anoColor, bevelHigh),
    ),
    anoParts.push(
      buildRoundedBox(0.004, 0.006, 0.15, 0.0015, -0.0212, 0.0215, 0.012, anoColor, bevelHigh),
    ),
    anoParts.push(
      buildRoundedBox(0.003, 0.01, 0.03, 0.001, 0.0212, 0.022, 0.075, anoColor, bevelHigh),
    ),
    anoParts.push(
      buildPlateZ(
        [
          [-0.0078, 0.0335],
          [0.0078, 0.0335],
          [0.0106, 0.0402],
          [-0.0106, 0.0402],
        ],
        -0.096,
        0.397,
        5e-4,
        anoColor,
        0,
      ),
    ));
  let railToothProfile = [
    [-0.0102, 0.0398],
    [0.0102, 0.0398],
    [0.0106, 0.0408],
    [0.0084, 0.0435],
    [-0.0084, 0.0435],
    [-0.0106, 0.0408],
  ];
  for (let partIndex = 0; partIndex < 49; partIndex++) {
    let slotZ = -0.094 + partIndex * 0.01;
    anoParts.push(buildPlateZ(railToothProfile, slotZ, slotZ + 0.0048, 8e-4, anoColor, bevelHigh));
  }
  let magOutline = [
    [-0.1, -0.021],
    [0.099, -0.021],
    [0.101, -0.03],
    [0.098, -0.088],
    [0.036, -0.082],
    [0.031, -0.058],
    [-0.03, -0.058],
    [-0.04, -0.066],
    [-0.078, -0.055],
    [-0.1, -0.044],
  ];
  (polyParts.push(buildPlateX(magOutline, -0.019, 0.019, 0.0014, polyColor, wearPoly)),
    polyParts.push(
      buildRoundedBox(
        0.043,
        0.01,
        0.066,
        0.002,
        0,
        -0.0835,
        0.0668,
        polyColor,
        wearPoly,
        [-0.095, 0, 0],
      ),
    ),
    polyParts.push(
      buildRoundedBox(0.0405, 0.052, 0.005, 8e-4, 0, -0.052, 0.0975, polyColor, wearPoly),
    ),
    polyParts.push(
      buildRoundedBox(0.0405, 0.04, 0.005, 8e-4, 0, -0.048, 0.0345, polyColor, wearPoly),
    ),
    gunParts.push(buildRoundedTab(0.0038, 0.0396, 0, -0.031, -0.086, steelBright, 12)),
    gunParts.push(buildRoundedTab(0.0038, 0.0396, 0, -0.029, 0.087, steelBright, 12)),
    gunParts.push(buildRoundedTab(0.0022, 0.0392, 0, -0.04, -0.012, steelBright, 8)),
    gunParts.push(buildRoundedTab(0.0022, 0.0392, 0, -0.032, -0.032, steelBright, 8)));
  for (let partIndex of [-1, 1])
    (gunParts.push(
      buildRoundedTab(0.0068, 0.004, partIndex * 0.0205, -0.036, -0.048, gunColor, 14, bevelLow),
    ),
      gunParts.push(
        buildRoundedBox(
          0.004,
          0.006,
          0.024,
          0.0015,
          partIndex * 0.0228,
          -0.036,
          -0.036,
          gunColor,
          bevelLow,
          [0.5, 0, 0],
        ),
      ));
  gunParts.push(
    buildRoundedBox(0.0045, 0.024, 0.013, 0.0015, -0.0212, -0.03, 0.022, gunColor, bevelLow),
  );
  for (let partIndex = 0; partIndex < 4; partIndex++)
    gunParts.push(
      buildRoundedBox(
        0.0012,
        0.002,
        0.012,
        5e-4,
        -0.0238,
        -0.021 - partIndex * 0.0045,
        0.022,
        gunColor,
        bevelLow,
      ),
    );
  (gunParts.push(buildRoundedTab(0.0058, 0.005, 0.0205, -0.042, 0.016, gunColor, 12, bevelLow)),
    polyParts.push(
      buildRoundedBox(0.004, 0.004, 0.026, 8e-4, 0.0205, -0.051, 0.016, polyColor, wearPoly),
    ),
    polyParts.push(
      buildRoundedBox(0.004, 0.02, 0.004, 8e-4, 0.0205, -0.043, 0.027, polyColor, wearPoly),
    ),
    polyParts.push(
      buildPlateX(
        [
          [0.033, -0.056],
          [0.033, -0.093],
          [0.024, -0.1005],
          [-0.031, -0.1005],
          [-0.041, -0.09],
          [-0.041, -0.06],
        ],
        -0.0085,
        0.0085,
        8e-4,
        polyColor,
        wearPoly,
        [
          [
            [0.028, -0.059],
            [0.028, -0.091],
            [0.022, -0.096],
            [-0.029, -0.096],
            [-0.036, -0.088],
            [-0.036, -0.061],
          ],
        ],
      ),
    ),
    gunParts.push(
      buildPlateX(
        [
          [-0.006, -0.057],
          [0.004, -0.057],
          [0.003, -0.069],
          [0.0065, -0.079],
          [0.01, -0.086],
          [0.0065, -0.088],
          [0.001, -0.081],
          [-0.004, -0.07],
        ],
        -0.0032,
        0.0032,
        8e-4,
        steelBright,
        0,
      ),
    ),
    polyParts.push(
      buildPlateX(
        [
          [-0.038, -0.05],
          [-0.045, -0.074],
          [-0.049, -0.086],
          [-0.049, -0.1],
          [-0.054, -0.112],
          [-0.057, -0.13],
          [-0.064, -0.158],
          [-0.11, -0.152],
          [-0.102, -0.112],
          [-0.096, -0.082],
          [-0.095, -0.064],
          [-0.103, -0.046],
          [-0.08, -0.044],
        ],
        -0.0165,
        0.0165,
        0.005,
        polyColor,
        wearPoly,
      ),
    ));
  for (let partIndex = 0; partIndex < 9; partIndex++) {
    let slotZ = -0.078 - partIndex * 0.0082,
      slotIndex = -0.073 + (slotZ + 0.078) * 0.26;
    polyParts.push(
      buildRoundedBox(
        0.0345,
        0.0028,
        0.03,
        0.001,
        0,
        slotZ,
        slotIndex,
        polyColor,
        wearPoly,
        [-0.25, 0, 0],
      ),
    );
  }
  for (let partIndex = 0; partIndex < 7; partIndex++) {
    let slotZ = -0.078 - partIndex * 0.01,
      slotIndex = -0.098 + (slotZ + 0.078) * 0.14;
    polyParts.push(
      buildRoundedBox(
        0.022,
        0.0045,
        0.006,
        0.0015,
        0,
        slotZ,
        slotIndex,
        polyColor,
        wearPoly,
        [-0.14, 0, 0],
      ),
    );
  }
  (polyParts.push(
    buildRoundedBox(
      0.035,
      0.006,
      0.05,
      0.002,
      0,
      -0.157,
      -0.087,
      polyColor,
      wearPoly,
      [0.13, 0, 0],
    ),
  ),
    gunParts.push(buildRoundedTab(0.003, 0.034, 0, -0.15, -0.085, steelBright, 8)));
  let handguardR = PAC9_DIMENSIONS.handguardR,
    guardHalfHeight = 0.00885,
    guardInset = 0.0028,
    guardZ0 = 0.101,
    guardZ1 = 0.398,
    guardRect = [
      [guardZ0, -guardHalfHeight],
      [guardZ1, -guardHalfHeight],
      [guardZ1, guardHalfHeight],
      [guardZ0, guardHalfHeight],
    ];
  for (let partIndex = 0; partIndex < 8; partIndex++) {
    let slotZ = [];
    if (partIndex === 0 || partIndex === 4 || partIndex === 6)
      for (let profilePoint = 0; profilePoint < 6; profilePoint++)
        slotZ.push(roundedSlotOutline(0.13 + profilePoint * 0.047, 0, 0.032, 0.007, 4));
    else if (partIndex !== 2)
      for (let profilePoint = 0; profilePoint < 10; profilePoint++) {
        let guardSlotZ = 0.124 + profilePoint * 0.027;
        (partIndex === 3 && guardSlotZ > 0.3) ||
          slotZ.push(roundedSlotOutline(guardSlotZ, 0, 0.013, 0.0052, 3));
      }
    let slotIndex = buildPlateX(
      guardRect,
      handguardR - guardInset,
      handguardR,
      9e-4,
      anoColor,
      bevelHigh,
      slotZ,
    );
    (slotIndex.rotateZ((partIndex * Math.PI) / 4), anoParts.push(slotIndex));
    let ringAngle = ((partIndex + 0.5) * Math.PI) / 4;
    anoParts.push(
      buildLatheBody(
        [
          [0, guardZ0],
          [0.003, guardZ0],
          [0.003, guardZ1],
          [0, guardZ1],
        ],
        8,
        anoColor,
        0,
        Math.cos(ringAngle) * 0.0197,
        Math.sin(ringAngle) * 0.0197,
      ),
    );
  }
  (anoParts.push(
    buildPlateZ(
      [
        [-0.0088, 0.02],
        [0.0088, 0.02],
        [0.0106, 0.029],
        [0.0082, 0.0338],
        [-0.0082, 0.0338],
        [-0.0106, 0.029],
      ],
      0.1012,
      0.3978,
      0.0012,
      anoColor,
      bevelHigh,
    ),
  ),
    anoParts.push(
      buildLatheBody(
        [
          [0.016, 0.096],
          [0.0238, 0.096],
          [0.0243, 0.0966],
          [0.0243, 0.106],
          [0.0232, 0.1075],
          [0.016, 0.1075],
        ],
        24,
        anoColor,
        bevelHigh,
      ),
    ),
    anoParts.push(
      buildLatheBody(
        [
          [0.018, 0.3985],
          [0.0224, 0.3985],
          [0.0224, 0.4003],
          [0.0218, 0.401],
          [0.018, 0.401],
          [0.018, 0.3985],
        ],
        8,
        anoColor,
        bevelHigh,
      ),
    ));
  for (let partIndex of [-1, 1])
    for (let slotZ of [0.112, 0.126])
      gunParts.push(
        buildRoundedTab(0.0024, 0.0024, partIndex * 0.0212, -0.004, slotZ, steelBright, 10),
      );
  for (let partIndex of [0.115, 0.215, 0.3, 0.385])
    for (let slotZ of [-1, 1])
      gunParts.push(
        buildLatheBody(
          [
            [0, -8e-4],
            [0.0017, -8e-4],
            [0.002, -4e-4],
            [0.002, 6e-4],
            [0, 6e-4],
          ],
          8,
          steelBright,
          0,
          0,
          0,
        )
          .rotateX(Math.PI / 2)
          .translate(slotZ * 0.0098, 0.0312, -partIndex),
      );
  {
    let slotZ = [
      buildPlateZ(
        [
          [-0.0078, 0.0206],
          [0.0078, 0.0206],
          [0.0106, 0.0242],
          [-0.0106, 0.0242],
        ],
        0.318,
        0.396,
        5e-4,
        anoColor,
        0,
      ),
    ];
    for (let slotIndex = 0; slotIndex < 8; slotIndex++) {
      let ringAngle = 0.319 + slotIndex * 0.01;
      slotZ.push(
        buildPlateZ(
          railToothProfile.map((profilePoint) => [profilePoint[0], profilePoint[1] - 0.016]),
          ringAngle,
          ringAngle + 0.0048,
          5e-4,
          anoColor,
          bevelHigh,
        ),
      );
    }
    for (let slotIndex of slotZ) (slotIndex.rotateZ(Math.PI / 4), anoParts.push(slotIndex));
  }
  {
    let partIndex = [];
    for (let slotZ = 0; slotZ < 4; slotZ++) {
      let slotIndex = 0.352 + slotZ * 0.01;
      partIndex.push(
        buildPlateZ(
          railToothProfile.map((ringAngle) => [ringAngle[0], ringAngle[1] - 0.016]),
          slotIndex,
          slotIndex + 0.0048,
          5e-4,
          anoColor,
          bevelHigh,
        ),
      );
    }
    partIndex.push(
      buildPlateZ(
        [
          [-0.0078, 0.0206],
          [0.0078, 0.0206],
          [0.0106, 0.0242],
          [-0.0106, 0.0242],
        ],
        0.35,
        0.392,
        5e-4,
        anoColor,
        0,
      ),
    );
    for (let slotZ of partIndex) (slotZ.rotateZ(Math.PI), anoParts.push(slotZ));
  }
  (polyParts.push(
    buildPlateX(
      [
        [0.35, -0.026],
        [0.392, -0.026],
        [0.388, -0.036],
        [0.372, -0.05],
        [0.362, -0.05],
        [0.354, -0.036],
      ],
      -0.011,
      0.011,
      0.003,
      polyColor,
      wearPoly,
    ),
  ),
    polyParts.push(
      buildPlateX(
        [
          [0.2395, -0.0215],
          [0.2725, -0.0215],
          [0.2725, -0.03],
          [0.27, -0.092],
          [0.2665, -0.0965],
          [0.2455, -0.0975],
          [0.242, -0.093],
          [0.2395, -0.03],
        ],
        -0.014,
        0.014,
        0.0045,
        polyColor,
        wearPoly,
      ),
    ));
  for (let partIndex = 0; partIndex < 6; partIndex++)
    polyParts.push(
      buildRoundedBox(
        0.0292,
        0.0022,
        0.0315,
        8e-4,
        0,
        -0.04 - partIndex * 0.0085,
        0.256 - partIndex * 3e-4,
        polyColor,
        wearPoly,
      ),
    );
  (polyParts.push(
    buildRoundedBox(0.03, 0.005, 0.04, 0.0015, 0, -0.024, 0.256, polyColor, wearPoly),
  ),
    gunParts.push(buildRoundedTab(0.003, 0.031, 0, -0.025, 0.256, steelBright, 10)),
    gunParts.push(
      buildLatheBody(
        [
          [0.0115, 0.095],
          [0.0115, 0.15],
          [0.0095, 0.153],
          [0.0095, 0.285],
          [0.009, 0.288],
          [0.009, 0.322],
          [0.0086, 0.326],
          [0.0086, 0.435],
          [0.0092, 0.437],
          [0.0092, 0.453],
          [0.0075, 0.455],
          [0.0075, 0.461],
        ],
        20,
        gunColor,
        bevelLow,
      ),
    ),
    gunParts.push(
      buildLatheBody(
        [
          [0.0092, 0.286],
          [0.0135, 0.286],
          [0.0142, 0.2875],
          [0.0142, 0.3165],
          [0.0135, 0.318],
          [0.0092, 0.318],
        ],
        16,
        gunColor,
        bevelLow,
      ),
    ),
    gunParts.push(buildRoundedBox(0.014, 0.009, 0.03, 0.002, 0, 0.0145, 0.302, gunColor, bevelLow)),
    gunParts.push(
      buildLatheBody(
        [
          [0, 0.1],
          [0.0026, 0.1],
          [0.0026, 0.3],
          [0, 0.3],
        ],
        8,
        steelBright,
        0,
        0,
        0.0172,
      ),
    ),
    gunParts.push(buildRoundedTab(0.002, 0.0145, 0, 0.012, 0.308, steelBright, 6)),
    gunParts.push(
      buildLatheBody(
        [
          [0.0075, 0.459],
          [0.0108, 0.459],
          [0.0116, 0.4605],
          [0.0116, 0.477],
          [0.011, 0.478],
          [0.0052, 0.478],
        ],
        20,
        gunColor,
        bevelLow,
      ),
    ),
    gunParts.push(
      buildLatheBody(
        [
          [0.0052, 0.477],
          [0.0052, 0.517],
        ],
        12,
        darkColor,
      ),
    ));
  for (let partIndex of [0.4865, 0.4965, 0.5065])
    gunParts.push(
      buildLatheBody(
        [
          [0.0052, partIndex - 0.0019],
          [0.011, partIndex - 0.0019],
          [0.0116, partIndex - 0.0012],
          [0.0116, partIndex + 0.0012],
          [0.011, partIndex + 0.0019],
          [0.0052, partIndex + 0.0019],
        ],
        20,
        gunColor,
        bevelLow,
      ),
    );
  gunParts.push(
    buildLatheBody(
      [
        [0.0052, 0.5145],
        [0.011, 0.5145],
        [0.0116, 0.5155],
        [0.0116, 0.527],
        [0.0102, 0.5305],
        [0.0048, 0.5305],
        [0.0036, 0.526],
        [0.0036, 0.495],
      ],
      20,
      gunColor,
      bevelLow,
      0,
      0,
      (partIndex, slotZ, slotIndex) => (partIndex < 0.0047 ? [0.25, 0.25, 0.25] : slotIndex),
    ),
  );
  for (let partIndex of [-1, 1])
    gunParts.push(
      buildRoundedBox(
        0.0125,
        0.0042,
        0.042,
        0.0012,
        0,
        partIndex * 0.0096,
        0.496,
        gunColor,
        bevelLow,
      ),
    );
  for (let partIndex = 0; partIndex < 3; partIndex++)
    gunParts.push(buildRoundedTab(0.0016, 0.0236, 0, 0, 0.4675 + partIndex * 0.0035, darkColor, 6));
  (anoParts.push(
    buildLatheBody(
      [
        [0, -0.292],
        [0.0142, -0.292],
        [0.0148, -0.2905],
        [0.0148, -0.1],
      ],
      20,
      anoColor,
      bevelHigh,
    ),
  ),
    anoParts.push(
      buildLatheBody(
        [
          [0.0148, -0.122],
          [0.0185, -0.122],
          [0.0195, -0.1205],
          [0.0195, -0.1115],
          [0.0185, -0.11],
          [0.0148, -0.11],
        ],
        12,
        anoColor,
        bevelHigh * 1.5,
      ),
    ));
  {
    let partIndex = [
        [-0.019, -0.024],
        [0.019, -0.024],
        [0.021, -0.018],
        [0.021, 0.018],
        [0.016, 0.024],
        [-0.016, 0.024],
        [-0.021, 0.018],
        [-0.021, 0.006],
        [-0.036, 0.004],
        [-0.04, -0.002],
        [-0.04, -0.014],
        [-0.034, -0.02],
        [-0.021, -0.02],
      ],
      slotZ = [
        [-0.025, -0.014],
        [-0.025, -0.002],
        [-0.033, -5e-4],
        [-0.036, -0.004],
        [-0.036, -0.012],
        [-0.032, -0.016],
      ];
    gunParts.push(
      buildPlateZ(partIndex, -0.1095, -0.1045, 8e-4, [1.6, 1.6, 1.65], bevelLow, [slotZ]),
    );
  }
  (polyParts.push(
    buildPlateX(
      [
        [-0.146, 0.024],
        [-0.3, 0.024],
        [-0.331, 0.014],
        [-0.334, -0.086],
        [-0.318, -0.101],
        [-0.29, -0.096],
        [-0.232, -0.04],
        [-0.146, -0.024],
      ],
      -0.019,
      0.019,
      0.004,
      polyColor,
      wearPoly,
      [
        [
          [-0.262, -0.036],
          [-0.306, -0.036],
          [-0.306, -0.074],
          [-0.292, -0.074],
        ],
      ],
    ),
  ),
    polyParts.push(
      buildRoundedBox(0.033, 0.016, 0.118, 0.006, 0, 0.031, -0.232, polyColor, wearPoly),
    ));
  for (let partIndex of [-0.196, -0.268])
    gunParts.push(buildRoundedTab(0.0032, 0.035, 0, 0.03, partIndex, steelBright, 8));
  (polyParts.push(
    buildRoundedBox(0.012, 0.012, 0.04, 0.003, 0, -0.033, -0.19, polyColor, wearPoly, [0.2, 0, 0]),
  ),
    plainParts.push(buildRoundedBox(0.037, 0.12, 0.011, 0.004, 0, -0.04, -0.3395, rubberColor, 0)));
  for (let partIndex = 0; partIndex < 9; partIndex++)
    plainParts.push(
      buildRoundedBox(
        0.031,
        0.004,
        0.003,
        0.001,
        0,
        0.004 - partIndex * 0.011,
        -0.3455,
        rubberColor,
        0,
      ),
    );
  for (let partIndex of [-1, 1])
    gunParts.push(
      buildRoundedTab(0.0065, 0.003, partIndex * 0.0195, -0.06, -0.318, steelBright, 12),
    );
  let sightY = PAC9_DIMENSIONS.sightY,
    sightWindow = PAC9_DIMENSIONS.window,
    glassTint = [0.012, 0.012, 0.013];
  (anoParts.push(buildRoundedBox(0.03, 0.0092, 0.04, 0.0016, 0, 0.048, 0.021, anoColor, bevelHigh)),
    anoParts.push(
      buildRoundedBox(0.0045, 0.0085, 0.034, 0.001, -0.0162, 0.0452, 0.021, anoColor, bevelHigh),
    ));
  for (let partIndex of [0.009, 0.033])
    (gunParts.push(buildRoundedTab(0.004, 0.0042, -0.02, 0.0452, partIndex, steelBright, 6)),
      gunParts.push(buildRoundedTab(0.003, 0.0022, 0.016, 0.0452, partIndex, steelBright, 10)));
  let hoodOuter = [
    [-0.0192, 0.0525],
    [0.0192, 0.0525],
    [0.0192, 0.0788],
    [0.0138, 0.0842],
    [-0.0138, 0.0842],
    [-0.0192, 0.0788],
  ];
  (anoParts.push(buildPlateZ(hoodOuter, 0.008, 0.034, 0.001, anoColor, bevelHigh, [sightWindow])),
    plainParts.push(
      buildPlateZ(
        sightWindow.map((partIndex) => [
          partIndex[0] * 1.004,
          (partIndex[1] - sightY) * 1.004 + sightY,
        ]),
        0.0078,
        0.0342,
        0,
        glassTint,
        0,
        [
          sightWindow.map((partIndex) => [
            partIndex[0] * 0.982,
            (partIndex[1] - sightY) * 0.982 + sightY,
          ]),
        ],
      ),
    ));
  let hoodInner = [
    [-0.0204, 0.06],
    [-0.0204, 0.0792],
    [-0.0143, 0.0854],
    [0.0143, 0.0854],
    [0.0204, 0.0792],
    [0.0204, 0.06],
    [0.0193, 0.06],
    [0.0193, 0.0788],
    [0.0138, 0.0843],
    [-0.0138, 0.0843],
    [-0.0193, 0.0788],
    [-0.0193, 0.06],
  ];
  (anoParts.push(buildPlateZ(hoodInner, 0.029, 0.038, 3e-4, anoColor, bevelHigh)),
    gunParts.push(
      buildLatheBody(
        [
          [0, -0.006],
          [0.0052, -0.006],
          [0.0058, -0.0054],
          [0.0058, 0.0036],
          [0.0052, 0.0042],
          [0, 0.0042],
        ],
        14,
        gunColor,
        bevelLow,
        0,
        0,
      )
        .rotateY(Math.PI / 2)
        .translate(0.0222, 0.0625, -0.021),
    ));
  for (let partIndex of [0.0165, 0.0245])
    plainParts.push(
      buildRoundedBox(0.0022, 0.0055, 0.0055, 9e-4, -0.0196, 0.064, partIndex, rubberColor, 0),
    );
  for (let partIndex of [0.012, 0.03])
    for (let slotZ of [-1, 1])
      gunParts.push(
        buildRoundedTab(0.0016, 0.0012, slotZ * 0.0195, 0.0555, partIndex, steelBright, 8),
      );
  plainParts.push(buildRoundedBox(0.009, 0.0026, 0.006, 6e-4, 0, 0.058, 0.0115, glassTint));
  for (let [partIndex, slotZ] of [
    [0.0128, 0.0548],
    [-0.0128, 0.0548],
  ])
    gunParts.push(
      buildLatheBody(
        [
          [0, -6e-4],
          [0.0019, -6e-4],
          [0.0022, -2e-4],
          [0.0022, 7e-4],
          [0, 7e-4],
        ],
        10,
        steelBright,
        0,
        partIndex,
        slotZ,
      )
        .translate(0, 0, -0.008 + 1e-4)
        .rotateY(0),
    );
  (gunParts.push(
    buildLatheBody(
      [
        [0, -0.001],
        [0.0026, -0.001],
        [0.003, -5e-4],
        [0.003, 0.0012],
        [0, 0.0012],
      ],
      12,
      steelBright,
      0,
      0,
      0,
    )
      .rotateX(Math.PI / 2)
      .translate(0.009, 0.0842, -0.014),
  ),
    plainParts.push(buildRoundedBox(0.0012, 2e-4, 0.0044, 5e-5, 0.009, 0.0855, 0.014, glassTint)),
    plainParts.push(
      buildPlateZ(sightWindow, 0.0304, 0.0318, 0, glassTint, 0, [
        sightWindow.map((partIndex) => [
          partIndex[0] * 0.955,
          (partIndex[1] - sightY) * 0.955 + sightY,
        ]),
      ]),
    ));
  for (let [partIndex, slotZ] of [
    [-0.03, 1],
    [0.372, -1],
  ])
    (gunParts.push(
      buildRoundedBox(0.021, 0.0075, 0.03, 0.0015, 0, 0.0472, partIndex, gunColor, bevelLow),
    ),
      gunParts.push(
        buildRoundedBox(
          0.0125,
          0.004,
          0.036,
          0.001,
          0,
          0.0527,
          partIndex + slotZ * 0.004,
          gunColor,
          bevelLow,
        ),
      ),
      gunParts.push(
        buildRoundedTab(0.0028, 0.024, 0, 0.0505, partIndex - slotZ * 0.013, gunColor, 8),
      ),
      gunParts.push(
        buildRoundedBox(
          0.004,
          0.006,
          0.006,
          0.001,
          slotZ * 0.0125,
          0.0475,
          partIndex,
          gunColor,
          bevelLow,
        ),
      ),
      gunParts.push(
        buildRoundedTab(0.0042, 0.0045, -0.0125, 0.0475, partIndex + 0.006, steelBright, 8),
      ));
  (gunParts.push(
    buildLatheBody(
      [
        [0.0016, -0.0012],
        [0.0034, -0.0012],
        [0.0038, -8e-4],
        [0.0038, 8e-4],
        [0.0034, 0.0012],
        [0.0016, 0.0012],
        [0.0016, -0.0012],
      ],
      12,
      gunColor,
      bevelLow,
      0,
      0,
    )
      .rotateX(Math.PI / 2)
      .translate(0, 0.0553, 0.016),
  ),
    gunParts.push(buildRoundedTab(0.0048, 0.005, 0.015, 0.049, -0.036, gunColor, 12, bevelLow)));
  for (let partIndex = 0; partIndex < 6; partIndex++)
    gunParts.push(
      buildRoundedBox(
        0.0044,
        0.001,
        0.001,
        3e-4,
        0.015,
        0.049 + Math.sin(partIndex * 1.047) * 0.0046,
        -0.036 + Math.cos(partIndex * 1.047) * 0.0046,
        gunColor,
        bevelLow,
      ),
    );
  (anoParts.push(
    buildRoundedBox(0.016, 0.005, 0.02, 0.0012, 0, 0.0355, -0.098, anoColor, bevelHigh),
  ),
    gunParts.push(
      buildRoundedBox(0.01, 0.003, 0.008, 8e-4, 0, 0.0392, -0.0985, gunColor, bevelLow),
    ));
  for (let partIndex = 0; partIndex < 4; partIndex++)
    gunParts.push(
      buildRoundedBox(
        0.0092,
        8e-4,
        0.001,
        3e-4,
        0,
        0.0409,
        -0.0958 - partIndex * 0.0018,
        gunColor,
        bevelLow,
      ),
    );
  let triggerHalfY0 = -0.0267,
    triggerHalfY1 = 0.0267;
  (gunParts.push(
    buildLatheBody(
      [
        [0, 0.308],
        [0.0095, 0.308],
        [0.0108, 0.3095],
        [0.0108, 0.322],
        [0.0118, 0.323],
        [0.0118, 0.378],
        [0.0128, 0.38],
        [0.0142, 0.382],
        [0.0142, 0.404],
        [0.0136, 0.406],
        [0.0142, 0.408],
        [0.0142, 0.412],
        [0.0128, 0.4135],
        [0.0118, 0.4135],
        [0.0112, 0.409],
      ],
      18,
      gunColor,
      bevelLow,
      triggerHalfY0,
      triggerHalfY1,
    ),
  ),
    gunParts.push(
      buildLatheBody(
        [
          [0.0112, 0.409],
          [0, 0.409],
        ],
        18,
        [0.35, 0.4, 0.45],
        0,
        triggerHalfY0,
        triggerHalfY1,
      ),
    ));
  for (let partIndex = 0; partIndex < 5; partIndex++)
    gunParts.push(
      buildLatheBody(
        [
          [0.0118, 0.33 + partIndex * 0.008],
          [0.0124, 0.3305 + partIndex * 0.008],
          [0.0124, 0.3335 + partIndex * 0.008],
          [0.0118, 0.334 + partIndex * 0.008],
        ],
        18,
        gunColor,
        bevelLow,
        triggerHalfY0,
        triggerHalfY1,
      ),
    );
  {
    let partIndex = buildRoundedBox(0.02, 0.008, 0.04, 0.0012, 0, 0.028, 0.352, gunColor, bevelLow);
    (partIndex.rotateZ(Math.PI / 4), gunParts.push(partIndex));
  }
  {
    let partIndex = buildRoundedTab(0.004, 0.006, 0.0135, 0.028, 0.352, steelBright, 8);
    (partIndex.rotateZ(Math.PI / 4), gunParts.push(partIndex));
  }
  plainParts.push(buildRoundedBox(0.0185, 0.0065, 0.07, 0.0025, 0, 0.0468, 0.214, rubberColor, 0));
  for (let partIndex = 0; partIndex < 6; partIndex++)
    plainParts.push(
      buildRoundedBox(
        0.014,
        0.0012,
        0.004,
        5e-4,
        0,
        0.0503,
        0.192 + partIndex * 0.009,
        rubberColor,
        0,
      ),
    );
  let triggerTube = tubeGeometry(
    [
      [triggerHalfY0, triggerHalfY1, -0.308],
      [triggerHalfY0 - 0.001, triggerHalfY1 + 0.002, -0.296],
      [-0.0265, 0.0235, -0.284],
      [-0.0255, 0.0215, -0.272],
      [-0.0235, 0.027, -0.262],
      [-0.016, 0.04, -0.256],
      [-0.007, 0.0465, -0.252],
      [-0.002, 0.047, -0.247],
    ],
    0.0018,
    6,
  );
  (applyVertexShading(triggerTube, rubberColor, 0), plainParts.push(triggerTube));
  for (let partIndex of [
    [-0.0262, 0.0228, 0.28],
    [-0.0242, 0.0255, 0.265],
  ]) {
    let slotZ = buildRoundedBox(0.0065, 0.0026, 0.0035, 8e-4, 0, 0, 0, [0.03, 0.03, 0.03], 0);
    (slotZ.rotateZ(Math.PI / 4),
      slotZ.translate(partIndex[0], partIndex[1], -partIndex[2]),
      plainParts.push(slotZ));
  }
  boltParts.push(
    buildLatheBody(
      [
        [0, -0.058],
        [0.0118, -0.058],
        [0.0124, -0.057],
        [0.0124, -0.01],
        [0.0116, -0.008],
        [0.0116, -0.002],
        [0.0124, 0],
        [0.0124, 0.046],
        [0.0105, 0.048],
        [0.0105, 0.056],
        [0.0062, 0.056],
        [0.0062, 0.06],
        [0, 0.06],
      ],
      16,
      [7, 7, 7.2],
      0,
      0,
      0.001,
    ),
  );
  for (let partIndex = 0; partIndex < 5; partIndex++)
    boltParts.push(
      buildRoundedBox(
        0.0015,
        0.008,
        0.003,
        5e-4,
        0.0122,
        0.001,
        0.01 + partIndex * 0.007,
        [1.2, 1.2, 1.2],
        0,
      ),
    );
  boltParts.push(
    buildRoundedBox(0.012, 0.0055, 0.014, 0.0015, -0.0165, 0.007, 0.078, gunColor, bevelLow),
  );
  {
    let partIndex = buildLatheBody(
      [
        [0, -0.009],
        [0.0045, -0.009],
        [0.0056, -0.0078],
        [0.0056, -0.003],
        [0.0048, -0.002],
        [0.0048, 0.002],
        [0.0056, 0.003],
        [0.0056, 0.0078],
        [0.0045, 0.009],
        [0, 0.009],
      ],
      12,
      gunColor,
      bevelLow,
    );
    (partIndex.rotateY(Math.PI / 2),
      partIndex.translate(-0.031, 0.007, -0.078),
      boltParts.push(partIndex));
  }
  let magOffset = (F) => 1.5 * Math.pow(Math.max(0, F - 0.07), 2),
    magSlope = (F) => 3 * Math.max(0, F - 0.07),
    magTint = [1, 1, 1],
    magProfile = [],
    magDepth = 0.212,
    magSegments = 12;
  for (let partIndex = 0; partIndex <= magSegments; partIndex++) {
    let slotZ = -0.004 + ((magDepth + 0.004) * partIndex) / magSegments;
    magProfile.push([magOffset(slotZ) + 0.0298, -slotZ]);
  }
  for (let partIndex = magSegments; partIndex >= 0; partIndex--) {
    let slotZ = -0.004 + ((magDepth + 0.004) * partIndex) / magSegments;
    magProfile.push([magOffset(slotZ) - 0.0298, -slotZ]);
  }
  magParts.push(buildPlateX(magProfile, -0.0113, 0.0113, 0.002, magTint, 0.25));
  for (let partIndex = 0; partIndex < 8; partIndex++) {
    let slotZ = 0.082 + partIndex * 0.0155;
    magParts.push(
      buildRoundedBox(0.0246, 0.0058, 0.05, 0.0016, 0, -slotZ, magOffset(slotZ), magTint, 0.3, [
        Math.atan(magSlope(slotZ)),
        0,
        0,
      ]),
    );
  }
  for (let partIndex = 0; partIndex < 10; partIndex++) {
    let slotZ = 0.078 + partIndex * 0.013;
    magParts.push(
      buildRoundedBox(
        0.012,
        0.011,
        0.004,
        0.001,
        0,
        -slotZ,
        magOffset(slotZ) + 0.0302,
        magTint,
        0.3,
        [Math.atan(magSlope(slotZ)), 0, 0],
      ),
    );
  }
  (magParts.push(
    buildRoundedBox(
      0.027,
      0.009,
      0.068,
      0.003,
      0,
      -magDepth - 0.003,
      magOffset(magDepth) + 0.001,
      magTint,
      0.3,
      [Math.atan(magSlope(magDepth)), 0, 0],
    ),
  ),
    magParts.push(
      buildRoundedBox(
        0.01,
        0.004,
        0.012,
        0.001,
        0,
        -magDepth - 0.008,
        magOffset(magDepth) - 0.01,
        [0.6, 0.6, 0.6],
        0,
        [Math.atan(magSlope(magDepth)), 0, 0],
      ),
    ),
    magParts.push(buildRoundedBox(0.003, 0.006, 0.04, 0.001, -0.0085, 0.0045, 0.004, magTint, 0.3)),
    magParts.push(buildRoundedBox(0.003, 0.006, 0.04, 0.001, 0.0085, 0.0045, 0.004, magTint, 0.3)));
  let brassTint = [1.25, 0.72, 0.5];
  (roundParts.push(
    buildLatheBody(
      [
        [0, -0.02],
        [0.004, -0.02],
        [0.0047, -0.019],
        [0.0047, 0.01],
        [0.0034, 0.014],
        [0.0034, 0.018],
      ],
      12,
      [1, 1, 1],
      0,
      0.002,
      0.0062,
    ),
  ),
    roundParts.push(
      buildLatheBody(
        [
          [0.003, 0.018],
          [0.0029, 0.024],
          [0.0022, 0.03],
          [0.001, 0.0345],
          [0, 0.0352],
        ],
        12,
        brassTint,
        0,
        0.002,
        0.0062,
      ),
    ),
    roundParts.push(
      buildLatheBody(
        [
          [0, -0.02],
          [0.004, -0.02],
          [0.0047, -0.019],
          [0.0047, 0.01],
        ],
        10,
        [0.8, 0.8, 0.8],
        0,
        -0.003,
        5e-4,
      ),
    ));
  let parts = {
    ano: mergeGeometryParts(anoParts),
    gun: mergeGeometryParts(gunParts),
    poly: mergeGeometryParts(polyParts),
    plain: mergeGeometryParts(plainParts),
    bolt: mergeGeometryParts(boltParts),
    mag: mergeGeometryParts(magParts),
    round: mergeGeometryParts(roundParts),
  };
  for (let partIndex of ['ano', 'gun', 'poly', 'plain', 'bolt']) {
    let slotZ = parts[partIndex].attributes.position;
    for (let slotIndex = 0; slotIndex < slotZ.count; slotIndex++)
      slotZ.getZ(slotIndex) > -0.1002 &&
        slotZ.getY(slotIndex) < 0.0341 &&
        slotZ.setX(slotIndex, slotZ.getX(slotIndex) * PAC9_DIMENSIONS.squeeze);
  }
  for (let partIndex in parts) parts[partIndex].computeBoundingSphere();
  return parts;
}

/**
 * 弹匣容量（30 发），同时作为初始弹量与 magSize
 */
export var PAC9_MAG_SIZE = 30;

/**
 * 单发基础伤害（26），弱点倍率另由战斗模块乘上
 */
export var PAC9_DAMAGE = 26;
