// render/effects/particles.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { TAU } from '../../audio/synthesis.js';

import { createValueNoise } from '../../core/random.js';

import { FX_SCRATCH_SIZE } from './effects.js';

/**
 * 圆角矩形（跑道形）三角扇面：四段四分之一圆弧拼出的平面片，用来做舷窗盖、圆形开孔的贴面而不是实体
 */
export function createRoundedRectFanGeometry(width, height, t = 5) {
  let arcPts = [],
    radius = Math.min(width, height) / 2,
    halfSpanX = width / 2 - radius,
    halfSpanY = height / 2 - radius;
  for (let quad = 0; quad < 4; quad++)
    for (let segIdx = 0; segIdx <= t; segIdx++) {
      let angle = ((quad + segIdx / t) * Math.PI) / 2;
      arcPts.push([
        Math.cos(angle) * radius + (quad === 0 || quad === 3 ? halfSpanX : -halfSpanX),
        Math.sin(angle) * radius + (quad < 2 ? halfSpanY : -halfSpanY),
      ]);
    }
  let positions = [],
    uvs = [];
  for (let quad = 0; quad < arcPts.length; quad++) {
    let segIdx = arcPts[quad],
      angle = arcPts[(quad + 1) % arcPts.length];
    (positions.push(0, 0, 0, segIdx[0], segIdx[1], 0, angle[0], angle[1], 0),
      uvs.push(
        0.5,
        0.5,
        segIdx[0] / width + 0.5,
        segIdx[1] / height + 0.5,
        angle[0] / width + 0.5,
        angle[1] / height + 0.5,
      ));
  }
  let fanGeo = new THREE.BufferGeometry();
  return (
    fanGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3)),
    fanGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2)),
    fanGeo.computeVertexNormals(),
    fanGeo
  );
}

/**
 * 弹着贴花图集的列数（4 列 × 2 行 = 8 格）
 */
var DECAL_ATLAS_COLS = 4;

/**
 * 弹着贴花图集的行数
 */
var DECAL_ATLAS_ROWS = 2;

/**
 * 贴花类型到图集格索引的映射表：金属 2 格、混凝土 2 格、木 1 格、焦痕 1 格、烟熏 1 格、玻璃 1 格，绘制图集与运行时取 uv 都以它为准
 */
export var DECAL_ATLAS_FRAMES = {
  bullet_metal: [0, 1],
  bullet_concrete: [2, 3],
  bullet_wood: [4],
  scorch: [5],
  soot: [6],
  bullet_glass: [7],
};

/**
 * 用 canvas 2D 程序化绘制弹孔图集：albedo（RGB 加透明度）、ORM 与由高度图差分求出的法线图，返回三张贴图与按格算 uv 矩形的函数
 */
export function createDecalAtlas(cellSize = 256) {
  let width = cellSize * DECAL_ATLAS_COLS,
    height = cellSize * DECAL_ATLAS_ROWS,
    albedoCanvas = document.createElement('canvas');
  ((albedoCanvas.width = width), (albedoCanvas.height = height));
  let ormCanvas = document.createElement('canvas');
  ((ormCanvas.width = width), (ormCanvas.height = height));
  let normalCanvas = document.createElement('canvas');
  ((normalCanvas.width = width), (normalCanvas.height = height));
  let albedoCtx = albedoCanvas.getContext('2d'),
    ormCtx = ormCanvas.getContext('2d'),
    normalCtx = normalCanvas.getContext('2d', {
      willReadFrequently: !0,
    });
  ((normalCtx.fillStyle = 'rgb(128,128,128)'), normalCtx.fillRect(0, 0, width, height));
  let drawRadial = (_, M) => {
      let E = normalCtx.createRadialGradient(0, 0, 0, 0, 0, M);
      for (let [w, S] of _) E.addColorStop(w, `rgb(${S},${S},${S})`);
      ((normalCtx.fillStyle = E),
        normalCtx.beginPath(),
        normalCtx.arc(0, 0, M, 0, Math.PI * 2),
        normalCtx.fill());
    },
    rand = createValueNoise(77123).rnd;
  ((ormCtx.fillStyle = 'rgb(0,235,0)'), ormCtx.fillRect(0, 0, width, height));
  let TAU = Math.PI * 2,
    blobPath = (az, e1x, e1y, e1z = 22, e2x = 1) => {
      az.beginPath();
      for (let e2y = 0; e2y < e1z; e2y++) {
        let e2z = (e2y / e1z) * TAU,
          crossX = e1x * (1 + (rand() - 0.5) * e1y),
          crossY = Math.cos(e2z) * crossX,
          crossZ = Math.sin(e2z) * crossX * e2x;
        e2y ? az.lineTo(crossY, crossZ) : az.moveTo(crossY, crossZ);
      }
      az.closePath();
    },
    drawCrack = (_, M, E, w, S, z, H) => {
      _.beginPath();
      let O = E,
        q = M;
      _.moveTo(Math.cos(q) * O, Math.sin(q) * O);
      let U = 5 + Math.floor(rand() * 4);
      for (let T = 1; T <= U; T++)
        ((O = E + ((w - E) * T) / U),
          (q += (rand() - 0.5) * S),
          _.lineTo(Math.cos(q) * O, Math.sin(q) * O));
      ((_.strokeStyle = H),
        (_.lineWidth = z),
        (_.lineCap = 'round'),
        (_.lineJoin = 'round'),
        _.stroke());
    },
    drawCell = (_, M) => {
      let E = ((_ % DECAL_ATLAS_COLS) + 0.5) * cellSize,
        w = (Math.floor(_ / DECAL_ATLAS_COLS) + 0.5) * cellSize,
        S = cellSize / 2;
      for (let z of [albedoCtx, ormCtx, normalCtx])
        (z.save(),
          z.beginPath(),
          z.rect(E - S, w - S, cellSize, cellSize),
          z.clip(),
          z.translate(E, w));
      (M(S), albedoCtx.restore(), ormCtx.restore(), normalCtx.restore());
    },
    radialGradient = (_, M, E, w) => {
      let S = _.createRadialGradient(0, 0, M, 0, 0, E);
      for (let [z, H] of w) S.addColorStop(z, H);
      return S;
    };
  for (let _ of DECAL_ATLAS_FRAMES.bullet_metal)
    drawCell(_, (M) => {
      ((albedoCtx.fillStyle = radialGradient(albedoCtx, M * 0.1, M * 0.6, [
        [0, 'rgba(14,13,12,0.4)'],
        [0.5, 'rgba(18,17,16,0.14)'],
        [1, 'rgba(20,20,20,0)'],
      ])),
        albedoCtx.fillRect(-M, -M, 2 * M, 2 * M));
      let E = 6 + Math.floor(rand() * 5);
      for (let T = 0; T < E; T++) {
        let D = rand() * TAU;
        drawCrack(
          albedoCtx,
          D,
          M * 0.2,
          M * (0.38 + rand() * 0.45),
          0.3,
          0.8 + rand() * 1,
          'rgba(8,8,8,0.55)',
        );
      }
      let w = M * (0.24 + rand() * 0.08),
        S = 0.7 + rand() * 0.5,
        z = rand() * TAU,
        H = (centerX, centerY, radius, rotation, jitter, segmentCount) => {
          for (let targetCtx of [albedoCtx, ormCtx])
            (targetCtx.save(), targetCtx.translate(centerX, centerY), targetCtx.rotate(rotation));
          let segmentScale = [];
          for (let targetCtx = 0; targetCtx < segmentCount; targetCtx++)
            segmentScale.push(1 + (rand() - 0.5) * jitter);
          let tracePolygon = (F, X) => {
            F.beginPath();
            for (let ne = 0; ne < segmentCount; ne++) {
              let re = (ne / segmentCount) * TAU,
                $ = radius * segmentScale[ne] * X,
                ue = Math.cos(re) * $,
                me = Math.sin(re) * $ * S;
              ne ? F.lineTo(ue, me) : F.moveTo(ue, me);
            }
            F.closePath();
          };
          (tracePolygon(albedoCtx, 1),
            (albedoCtx.lineJoin = 'miter'),
            (albedoCtx.strokeStyle = 'rgba(92,54,36,0.95)'),
            (albedoCtx.lineWidth = Math.max(1.5, radius * 0.14)),
            albedoCtx.stroke());
          let toneBase = 150 + Math.floor(rand() * 50);
          (tracePolygon(albedoCtx, 1),
            (albedoCtx.fillStyle = radialGradient(albedoCtx, 0, radius * 1.2, [
              [0, `rgb(${toneBase - 30},${toneBase - 26},${toneBase - 20})`],
              [0.7, `rgb(${toneBase + 30},${toneBase + 33},${toneBase + 36})`],
              [1, `rgb(${toneBase},${toneBase + 3},${toneBase + 6})`],
            ])),
            albedoCtx.fill(),
            tracePolygon(ormCtx, 1),
            (ormCtx.fillStyle = 'rgb(0,85,255)'),
            ormCtx.fill(),
            albedoCtx.restore(),
            ormCtx.restore());
        };
      H(0, 0, w, z, 0.75, 11);
      let O = 2 + Math.floor(rand() * 4);
      for (let T = 0; T < O; T++) {
        let D = rand() * TAU,
          C = w * (1 + rand() * 0.7);
        H(Math.cos(D) * C, Math.sin(D) * C, w * (0.15 + rand() * 0.3), rand() * TAU, 0.8, 7);
      }
      for (let T = 0; T < 9; T++) {
        let D = rand() * TAU,
          C = w * 0.3,
          G = w * (0.6 + rand() * 0.3);
        (albedoCtx.beginPath(),
          albedoCtx.moveTo(Math.cos(D) * C, Math.sin(D) * C),
          albedoCtx.lineTo(Math.cos(D + 0.1) * G, Math.sin(D + 0.1) * G),
          (albedoCtx.strokeStyle = rand() < 0.5 ? 'rgba(245,246,248,0.7)' : 'rgba(70,72,76,0.5)'),
          (albedoCtx.lineWidth = 0.8),
          albedoCtx.stroke());
      }
      let q = M * (0.1 + rand() * 0.025),
        U = 8 + Math.floor(rand() * 5);
      for (let T = 0; T < U; T++) {
        if (rand() < 0.15) continue;
        let D = ((T + (rand() - 0.5) * 0.6) / U) * TAU,
          C = q * (1.25 + rand() * 0.9),
          G = 0.16 + rand() * 0.16,
          j = 205 + Math.floor(rand() * 50);
        (albedoCtx.beginPath(),
          albedoCtx.moveTo(Math.cos(D - G) * q * 0.9, Math.sin(D - G) * q * 0.9),
          albedoCtx.lineTo(Math.cos(D) * C, Math.sin(D) * C),
          albedoCtx.lineTo(Math.cos(D + G) * q * 0.9, Math.sin(D + G) * q * 0.9),
          albedoCtx.closePath(),
          (albedoCtx.fillStyle = `rgb(${j},${j},${Math.min(255, j + 4)})`),
          albedoCtx.fill(),
          (albedoCtx.strokeStyle = 'rgba(40,40,42,0.6)'),
          (albedoCtx.lineWidth = 0.7),
          albedoCtx.stroke());
      }
      (ormCtx.beginPath(),
        ormCtx.arc(0, 0, q * 1.8, 0, TAU),
        (ormCtx.fillStyle = 'rgb(0,60,255)'),
        ormCtx.fill(),
        blobPath(albedoCtx, q, 0.3, 11),
        (albedoCtx.fillStyle = radialGradient(albedoCtx, 0, q, [
          [0, '#000000'],
          [0.8, '#040404'],
          [1, '#141414'],
        ])),
        albedoCtx.fill(),
        drawRadial(
          [
            [0, 0],
            [0.26, 10],
            [0.36, 240],
            [0.5, 200],
            [0.62, 100],
            [1, 128],
          ],
          q * 3.4,
        ),
        blobPath(ormCtx, q, 0.1, 11),
        (ormCtx.fillStyle = 'rgb(0,250,0)'),
        ormCtx.fill());
    });
  for (let _ of DECAL_ATLAS_FRAMES.bullet_concrete)
    drawCell(_, (M) => {
      ((albedoCtx.fillStyle = radialGradient(albedoCtx, M * 0.2, M * 0.9, [
        [0, 'rgba(186,180,168,0.22)'],
        [0.6, 'rgba(180,175,165,0.07)'],
        [1, 'rgba(170,165,155,0)'],
      ])),
        albedoCtx.fillRect(-M, -M, 2 * M, 2 * M));
      let E = 4 + Math.floor(rand() * 4);
      for (let O = 0; O < E; O++) {
        let q = rand() * TAU,
          U = M * (0.5 + rand() * 0.42);
        (drawCrack(albedoCtx, q, M * 0.25, U, 0.35, 1.3 + rand() * 1.3, 'rgba(20,19,18,0.75)'),
          rand() < 0.5 &&
            drawCrack(
              albedoCtx,
              q + (rand() - 0.5) * 0.6,
              U * 0.7,
              U * 1.05,
              0.6,
              0.9,
              'rgba(20,19,18,0.5)',
            ));
      }
      let w = M * (0.33 + rand() * 0.09),
        S = 12,
        z = [];
      for (let O = 0; O < S; O++) z.push(1 + (rand() - 0.5) * 0.6);
      let H = (O, q, U, centerX) => {
        O.beginPath();
        for (let centerY = 0; centerY < S; centerY++) {
          let radius = (centerY / S) * TAU,
            rotation = w * z[centerY] * q;
          centerY
            ? O.lineTo(Math.cos(radius) * rotation + U, Math.sin(radius) * rotation + centerX)
            : O.moveTo(Math.cos(radius) * rotation + U, Math.sin(radius) * rotation + centerX);
        }
        O.closePath();
      };
      (H(albedoCtx, 1.05, 1.5, 1.5),
        (albedoCtx.fillStyle = 'rgba(22,21,20,0.8)'),
        albedoCtx.fill(),
        H(albedoCtx, 1, 0, 0),
        (albedoCtx.fillStyle = radialGradient(albedoCtx, w * 0.1, w * 1.1, [
          [0, '#35332f'],
          [0.4, '#6f6b63'],
          [0.8, '#8f8b82'],
          [1, '#9a968c'],
        ])),
        albedoCtx.fill(),
        H(albedoCtx, 0.97, -1, -1),
        (albedoCtx.strokeStyle = 'rgba(206,201,190,0.55)'),
        (albedoCtx.lineWidth = 1.2),
        albedoCtx.stroke());
      for (let O = 0; O < 6; O++) {
        let q = rand() * TAU;
        drawCrack(albedoCtx, q, w * 0.2, w * 0.9, 0.5, 1, 'rgba(28,27,25,0.5)');
      }
      for (let O = 0; O < 60; O++) {
        let q = rand() * TAU,
          U = Math.sqrt(rand()) * w * 0.85;
        ((albedoCtx.fillStyle = rand() < 0.55 ? 'rgba(36,34,32,0.6)' : 'rgba(196,191,180,0.6)'),
          albedoCtx.beginPath(),
          albedoCtx.arc(Math.cos(q) * U, Math.sin(q) * U, 0.7 + rand() * 2, 0, TAU),
          albedoCtx.fill());
      }
      (blobPath(albedoCtx, w * 0.3, 0.45, 9),
        (albedoCtx.fillStyle = radialGradient(albedoCtx, 0, w * 0.33, [
          [0, '#060606'],
          [0.7, '#161514'],
          [1, '#2c2a27'],
        ])),
        albedoCtx.fill(),
        drawRadial(
          [
            [0, 0],
            [0.24, 20],
            [0.3, 70],
            [0.8, 112],
            [0.88, 150],
            [1, 128],
          ],
          w * 1.15,
        ));
      for (let O = 0; O < 22; O++) {
        let q = rand() * TAU,
          U = w * (1.15 + rand() * 1.3);
        ((albedoCtx.fillStyle = rand() < 0.5 ? 'rgba(190,185,175,0.45)' : 'rgba(30,29,27,0.45)'),
          albedoCtx.beginPath(),
          albedoCtx.arc(Math.cos(q) * U, Math.sin(q) * U, 0.6 + rand() * 1.6, 0, TAU),
          albedoCtx.fill());
      }
    });
  for (let _ of DECAL_ATLAS_FRAMES.bullet_wood)
    drawCell(_, (M) => {
      (blobPath(albedoCtx, M * 0.27, 0.7, 11, 1.45),
        (albedoCtx.fillStyle = 'rgba(206,182,140,0.85)'),
        albedoCtx.fill());
      for (let E = 0; E < 46; E++) {
        let w = (rand() - 0.5) * M * 0.62,
          S = M * (0.25 + rand() * 0.6) * (1 - Math.abs(w) / (M * 0.4)),
          z = (rand() - 0.5) * M * 0.2;
        (albedoCtx.beginPath(),
          albedoCtx.moveTo(w, z - S),
          albedoCtx.lineTo(w + (rand() - 0.5) * 5, z + S),
          (albedoCtx.strokeStyle = rand() < 0.5 ? 'rgba(236,216,172,0.85)' : 'rgba(88,62,38,0.7)'),
          (albedoCtx.lineWidth = 0.8 + rand() * 2.2),
          albedoCtx.stroke());
      }
      (blobPath(albedoCtx, M * 0.1, 0.5, 9, 1.1),
        (albedoCtx.fillStyle = radialGradient(albedoCtx, 0, M * 0.12, [
          [0, '#050403'],
          [0.8, '#140f0a'],
          [1, '#3a2a1a'],
        ])),
        albedoCtx.fill(),
        drawRadial(
          [
            [0, 0],
            [0.5, 30],
            [0.8, 140],
            [1, 128],
          ],
          M * 0.17,
        ));
    });
  for (let _ of DECAL_ATLAS_FRAMES.scorch)
    drawCell(_, (M) => {
      ((albedoCtx.fillStyle = radialGradient(albedoCtx, 0, M * 0.98, [
        [0, 'rgba(6,5,5,0.92)'],
        [0.3, 'rgba(10,9,8,0.85)'],
        [0.55, 'rgba(22,18,15,0.5)'],
        [0.8, 'rgba(30,24,20,0.16)'],
        [1, 'rgba(30,24,20,0)'],
      ])),
        albedoCtx.fillRect(-M, -M, 2 * M, 2 * M));
      for (let E = 0; E < 90; E++) {
        let w = rand() * TAU,
          S = M * (0.1 + rand() * 0.3),
          z = M * (0.5 + rand() * 0.46);
        (albedoCtx.beginPath(),
          albedoCtx.moveTo(Math.cos(w - 0.03) * S, Math.sin(w - 0.03) * S),
          albedoCtx.lineTo(Math.cos(w) * z, Math.sin(w) * z),
          albedoCtx.lineTo(Math.cos(w + 0.03) * S, Math.sin(w + 0.03) * S),
          albedoCtx.closePath(),
          (albedoCtx.fillStyle = `rgba(8,7,6,${0.12 + rand() * 0.3})`),
          albedoCtx.fill());
      }
      for (let E = 0; E < 60; E++) {
        let w = rand() * TAU,
          S = M * (0.15 + rand() * 0.6);
        ((albedoCtx.fillStyle = rand() < 0.3 ? 'rgba(150,140,128,0.25)' : 'rgba(0,0,0,0.4)'),
          albedoCtx.beginPath(),
          albedoCtx.arc(Math.cos(w) * S, Math.sin(w) * S, 1 + rand() * 4, 0, TAU),
          albedoCtx.fill());
      }
    });
  for (let _ of DECAL_ATLAS_FRAMES.soot)
    drawCell(_, (M) => {
      for (let E = 0; E < 14; E++) {
        let w = rand() * TAU,
          S = rand() * M * 0.3,
          z = M * (0.15 + rand() * 0.3),
          H = Math.cos(w) * S,
          O = Math.sin(w) * S,
          q = albedoCtx.createRadialGradient(H, O, 0, H, O, z);
        (q.addColorStop(0, 'rgba(8,8,8,0.4)'),
          q.addColorStop(1, 'rgba(8,8,8,0)'),
          (albedoCtx.fillStyle = q),
          albedoCtx.fillRect(-M, -M, 2 * M, 2 * M));
      }
      (blobPath(albedoCtx, M * 0.1, 0.4, 12),
        (albedoCtx.fillStyle = 'rgba(0,0,0,0.9)'),
        albedoCtx.fill());
    });
  for (let _ of DECAL_ATLAS_FRAMES.bullet_glass)
    drawCell(_, (M) => {
      ((albedoCtx.fillStyle = radialGradient(albedoCtx, 0, M * 0.5, [
        [0, 'rgba(235,240,242,0.55)'],
        [1, 'rgba(235,240,242,0)'],
      ])),
        albedoCtx.fillRect(-M, -M, 2 * M, 2 * M));
      for (let E = 0; E < 13; E++) {
        let w = ((E + rand() * 0.6) / 13) * TAU;
        drawCrack(
          albedoCtx,
          w,
          M * 0.07,
          M * (0.5 + rand() * 0.45),
          0.12,
          0.9 + rand(),
          'rgba(240,246,248,0.85)',
        );
      }
      for (let E = 0; E < 3; E++) {
        let w = M * (0.2 + E * 0.17 + rand() * 0.05);
        for (let S = 0; S < 9; S++) {
          if (rand() < 0.45) continue;
          let z = (S / 9) * TAU;
          (albedoCtx.beginPath(),
            albedoCtx.arc(0, 0, w, z, z + 0.5),
            (albedoCtx.strokeStyle = 'rgba(240,246,248,0.6)'),
            (albedoCtx.lineWidth = 1),
            albedoCtx.stroke());
        }
      }
      (blobPath(albedoCtx, M * 0.07, 0.3, 10), (albedoCtx.fillStyle = '#060606'), albedoCtx.fill());
    });
  let mapTexture = new THREE.CanvasTexture(albedoCanvas);
  ((mapTexture.colorSpace = THREE.SRGBColorSpace), (mapTexture.anisotropy = 4));
  let ormTexture = new THREE.CanvasTexture(ormCanvas);
  ormTexture.colorSpace = THREE.NoColorSpace;
  let uvPad = 2 / cellSize,
    uvRect = (_) => {
      let M = _ % DECAL_ATLAS_COLS,
        E = Math.floor(_ / DECAL_ATLAS_COLS);
      return [
        (M + uvPad) / DECAL_ATLAS_COLS,
        1 - (E + 1 - uvPad) / DECAL_ATLAS_ROWS,
        (M + 1 - uvPad) / DECAL_ATLAS_COLS,
        1 - (E + uvPad) / DECAL_ATLAS_ROWS,
      ];
    },
    normalTexture = null;
  try {
    let _ = normalCtx.getImageData(0, 0, width, height),
      M = _.data;
    if (M && M.length === width * height * 4) {
      let E = normalCtx.createImageData(width, height),
        w = E.data,
        S = 5 / 255;
      for (let z = 0; z < height; z++) {
        let H = Math.max(0, z - 1) * width,
          O = Math.min(height - 1, z + 1) * width;
        for (let q = 0; q < width; q++) {
          let U = Math.max(0, q - 1),
            T = Math.min(width - 1, q + 1),
            D = (M[(z * width + T) * 4] - M[(z * width + U) * 4]) * S,
            C = (M[(O + q) * 4] - M[(H + q) * 4]) * S,
            G = 1 / Math.sqrt(D * D + C * C + 1),
            j = (z * width + q) * 4;
          ((w[j] = (-D * G * 0.5 + 0.5) * 255),
            (w[j + 1] = (C * G * 0.5 + 0.5) * 255),
            (w[j + 2] = (G * 0.5 + 0.5) * 255),
            (w[j + 3] = 255));
        }
      }
      (normalCtx.putImageData(E, 0, 0),
        (normalTexture = new THREE.CanvasTexture(normalCanvas)),
        (normalTexture.colorSpace = THREE.NoColorSpace));
    }
  } catch {
    normalTexture = null;
  }
  return {
    map: mapTexture,
    orm: ormTexture,
    nrm: normalTexture,
    uv: uvRect,
  };
}

/**
 * 特效 billboard 顶点着色器：支持面向相机、速度拉伸、贴面三种模式，图集取帧，并按距离维持最小屏幕宽度以免远处火花消失
 */
var FX_BILLBOARD_VERT = `
attribute vec4 aPos;    // xyz centre, w size (m)
attribute vec4 aAxis;   // mode 1: stretch axis (length = streak length); mode 2: plane normal; w = roll (rad)
attribute vec4 aCol;    // rgb (HDR), a
attribute vec4 aMisc;   // x atlas frame, y mode (0 billboard, 1 velocity-stretched, 2 surface-aligned), z age 0..1, w sun visibility
uniform vec2 uAtlas;
uniform float uPx;      // world size of one pixel at distance 1
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vOff;
varying vec3 vToCam;
varying vec3 vInfo;     // view z, age, shade
varying float vSoftD;
varying vec3 vT;
varying vec3 vB;
void main() {
  vec2 c = position.xy;
  vec3 center = aPos.xyz; float size = aPos.w; float mode = aMisc.y;
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 toCam = cameraPosition - center; float dist = length(toCam); toCam /= max(dist, 1e-4);
  float sn = sin(aAxis.w), cs = cos(aAxis.w);
  vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  vec3 off; float comp = 1.0;
  if (mode < 0.5) {
    off = (camR * rc.x + camU * rc.y) * size;
    vT = camR * cs + camU * sn; vB = camU * cs - camR * sn;
  } else if (mode < 1.5) {
    float len = length(aAxis.xyz); vec3 d = aAxis.xyz / max(len, 1e-5);
    vec3 side = cross(d, toCam); float sl = length(side); side = sl > 1e-3 ? side / sl : camR;
    float w = max(size, dist * uPx * 1.4); comp = size / w;
    if (aMisc.w > 1.5) w = min(w, dist * uPx * aMisc.w);       // additive only: cap on-screen width (tracers near the lens)
    off = d * (c.x * max(len, w)) + side * (c.y * w);
    vT = d; vB = side;
  } else {
    vec3 n = normalize(aAxis.xyz);
    vec3 t = normalize(abs(n.y) > 0.9 ? cross(n, vec3(1.0, 0.0, 0.0)) : cross(vec3(0.0, 1.0, 0.0), n));
    vec3 b = cross(n, t);
    off = (t * rc.x + b * rc.y) * size;
    vT = t * cs + b * sn; vB = b * cs - t * sn;
  }
  vec4 mv = viewMatrix * vec4(center + off, 1.0);
  gl_Position = projectionMatrix * mv;
  float f = floor(aMisc.x + 0.5);
  float col = mod(f, uAtlas.x), row = floor(f / uAtlas.x);
  vUv = (vec2(col, row) + c + 0.5) / uAtlas;
  vCol = vec4(aCol.rgb * comp, aCol.a);
  vOff = off / max(size, 1e-4);
  vToCam = toCam;
  vInfo = vec3(mv.z, aMisc.z, aMisc.w);
  vSoftD = clamp(size * 0.4, 0.04, 0.7);
}`;

/**
 * 特效片元共用部分：用深度纹理做软相交淡出，让烟与贴花贴地时不出现硬切边
 */
var FX_SOFT_FRAG = `
uniform sampler2D uTex;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform vec2 uNearFar;
uniform float uSoft;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vOff;
varying vec3 vToCam;
varying vec3 vInfo;
varying float vSoftD;
varying vec3 vT;
varying vec3 vB;
float softFade() {
  float s = 1.0;
  if (uSoft > 0.5) {
    float d = texture2D(uDepth, gl_FragCoord.xy / uRes).x;
    float zs = (uNearFar.x * uNearFar.y) / ((uNearFar.y - uNearFar.x) * d - uNearFar.y);
    s = clamp((vInfo.x - zs) / vSoftD, 0.0, 1.0);
  }
  return s;
}`;

/**
 * 受光特效片元：球面法线叠加翻页法线求光、前向散射、薄边透光，并带一条 alpha 混合的火焰分支（热核 / 橙皮 / 下方烟炱）
 */
var FX_LIT_FRAG =
  FX_SOFT_FRAG +
  `
uniform vec3 uSun, uSunDir, uAmbLo, uAmbHi;
void main() {
  vec4 t = texture2D(uTex, vUv);
  float er = vInfo.y * 0.45;                                  // wisps erode as the puff ages
  float a = smoothstep(er, er + (vInfo.z > 1.5 ? 0.38 : 0.6), t.a) * vCol.a;   // fire lobes: denser body, crisper edge
  a *= softFade() * smoothstep(0.2, 0.9, -vInfo.x);           // soft intersection + fade right at the lens
  if (a < 0.004) discard;
  vec3 V = normalize(vToCam);
  vec3 q = vOff * 2.0; float r2 = min(dot(q, q), 1.0);
  vec3 Ns = q + V * (sqrt(1.0 - r2) * 0.9 + 0.05);            // overall sphere normal
  vec2 tn = t.rg * 2.0 - 1.0;                                 // billow normal from the flipbook
  vec3 Nb = vT * tn.x + vB * tn.y + V * sqrt(max(1.0 - dot(tn, tn), 0.0));
  vec3 N = normalize(Ns * 0.55 + Nb);
  float wrap = clamp((dot(N, uSunDir) + 0.45) / 1.45, 0.0, 1.0);
  float back = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 5.0);   // looking into the sun: forward scatter through thin edges
  float thin = 1.0 - t.b * smoothstep(0.0, 0.5, a);
  float hot = step(1.5, vInfo.z), shade = vInfo.z - 2.0 * hot;      // aMisc.w >= 2: emissive fire lobe (colour = emission)
  vec3 sun = uSun * (wrap * wrap * 0.85 + back * (0.15 + 1.3 * thin)) * shade;
  vec3 amb = mix(uAmbLo, uAmbHi, N.y * 0.5 + 0.5) * (1.0 - 0.35 * t.b);
  vec3 col = vCol.rgb * (amb + sun);
  if (hot > 0.5) {
    // alpha-blended fire: hot dense cores, dim orange skin, soot underneath. Because it is NOT additive, overlapping lobes
    // keep their shape and smoke in front can occlude them.
    float lump = clamp(dot(tn, vec2(0.6, 0.8)) * 0.6 + 0.5, 0.0, 1.0);
    float core = t.b * t.b * smoothstep(0.15, 0.9, t.a);
    vec3 fire = vCol.rgb * (0.10 + 1.7 * core) * (0.45 + 1.1 * lump);
    col = vec3(0.045, 0.042, 0.04) * (amb + sun) + fire;
  }
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;                         // premultiply after the (possibly no-op) output transform
}`;

/**
 * 加色特效片元：单通道强度乘颜色，最省的路径，用于火花与曳光
 */
var FX_ADD_FRAG =
  FX_SOFT_FRAG +
  `
void main() {
  float t = texture2D(uTex, vUv).r;
  float k = t * vCol.a * softFade();
  if (k < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb * k, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * 创建实例化 billboard 批次：aPos/aAxis/aCol/aMisc 四条实例流，受光与加色两种材质，深度软相交与像素尺寸按相机自动更新，供粒子、曳光、火焰统一提交
 */
export function createFxBatch(
  game,
  capacity,
  {
    lit: litFlag,
    tex: atlasTex,
    cols: atlasCols,
    rows: atlasRows,
    renderOrder: meshOrder,
    sun: sunLight,
    sunDir: sunDirection,
    ambLo: ambLow,
    ambHi: ambHigh,
  },
) {
  let geometry = new THREE.InstancedBufferGeometry();
  (geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3,
    ),
  ),
    geometry.setIndex([0, 1, 2, 0, 2, 3]));
  let addInstanceAttribute = (S) => {
      let z = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      return (z.setUsage(THREE.DynamicDrawUsage), geometry.setAttribute(S, z), z);
    },
    posAttr = addInstanceAttribute('aPos'),
    axisAttr = addInstanceAttribute('aAxis'),
    colorAttr = addInstanceAttribute('aCol'),
    miscAttr = addInstanceAttribute('aMisc');
  geometry.instanceCount = 0;
  let uniforms = {
    uTex: {
      value: atlasTex,
    },
    uAtlas: {
      value: new THREE.Vector2(atlasCols, atlasRows),
    },
    uPx: {
      value: 0.001,
    },
    uDepth: {
      value: null,
    },
    uRes: {
      value: new THREE.Vector2(1, 1),
    },
    uNearFar: {
      value: new THREE.Vector2(0.08, 900),
    },
    uSoft: {
      value: 0,
    },
  };
  litFlag &&
    Object.assign(uniforms, {
      uSun: {
        value: sunLight,
      },
      uSunDir: {
        value: sunDirection,
      },
      uAmbLo: {
        value: ambLow,
      },
      uAmbHi: {
        value: ambHigh,
      },
    });
  let material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: FX_BILLBOARD_VERT,
    fragmentShader: litFlag ? FX_LIT_FRAG : FX_ADD_FRAG,
    transparent: !0,
    depthWrite: !1,
    depthTest: !0,
    side: THREE.DoubleSide,
    fog: !1,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: litFlag ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  material.name = litFlag ? 'fx_lit' : 'fx_add';
  let mesh = new THREE.Mesh(geometry, material);
  ((mesh.frustumCulled = !1),
    (mesh.renderOrder = meshOrder),
    (mesh.castShadow = !1),
    (mesh.receiveShadow = !1),
    (mesh.matrixAutoUpdate = !1),
    (mesh.name = material.name),
    (mesh.onBeforeRender = (S, z, H) => {
      let O = S.getRenderTarget(),
        q;
      O ? (q = O.height) : (S.getDrawingBufferSize(FX_SCRATCH_SIZE), (q = FX_SCRATCH_SIZE.y));
      let U = H.projectionMatrix.elements;
      uniforms.uPx.value = 2 / (Math.max(U[5], 0.001) * Math.max(q, 1));
      let T = game.render,
        D = T && T.depthTexture;
      D && D.image && H === game.camera && T.depthTextureIsLive !== !0 && game.params.fxsoft !== '0'
        ? ((uniforms.uDepth.value = D),
          (uniforms.uSoft.value = 1),
          T.resolution && T.resolution.x > 0
            ? uniforms.uRes.value.set(T.resolution.x, T.resolution.y)
            : uniforms.uRes.value.set(D.image.width || 1, D.image.height || 1),
          uniforms.uNearFar.value.set(H.near, H.far))
        : ((uniforms.uDepth.value = null), (uniforms.uSoft.value = 0));
    }));
  let posArray = posAttr.array,
    axisArray = axisAttr.array,
    colorArray = colorAttr.array,
    miscArray = miscAttr.array,
    batch = {
      mesh: mesh,
      cap: capacity,
      n: 0,
      P: posArray,
      A: axisArray,
      C: colorArray,
      M: miscArray,
      begin() {
        batch.n = 0;
      },
      push(S, z, H, O, q, U, T, D, C, G, j, N, Q, K, ie, F) {
        let X = batch.n;
        if (X >= capacity) return !1;
        let ne = X * 4;
        return (
          (posArray[ne] = S),
          (posArray[ne + 1] = z),
          (posArray[ne + 2] = H),
          (posArray[ne + 3] = O),
          (axisArray[ne] = q),
          (axisArray[ne + 1] = U),
          (axisArray[ne + 2] = T),
          (axisArray[ne + 3] = D),
          (colorArray[ne] = C),
          (colorArray[ne + 1] = G),
          (colorArray[ne + 2] = j),
          (colorArray[ne + 3] = N),
          (miscArray[ne] = Q),
          (miscArray[ne + 1] = K),
          (miscArray[ne + 2] = ie),
          (miscArray[ne + 3] = F),
          (batch.n = X + 1),
          !0
        );
      },
      end: null,
    },
    attributes = [posAttr, axisAttr, colorAttr, miscAttr];
  return (
    (batch.end = () => {
      let S = batch.n;
      if (((geometry.instanceCount = S), (mesh.visible = S > 0), !!S))
        for (let z = 0; z < 4; z++) {
          let H = attributes[z];
          (H.clearUpdateRanges(), H.addUpdateRange(0, S * 4), (H.needsUpdate = !0));
        }
    }),
    batch
  );
}

/**
 * 曳光池所有并行数组的字段名清单，交换删除时按此列表整体搬移，避免漏搬某个字段
 */
export var TRACER_FIELD_NAMES = [
  'fx',
  'fy',
  'fz',
  'dx',
  'dy',
  'dz',
  'dist',
  'speed',
  'trav',
  'len',
  'width',
  'r',
  'g',
  'b',
];

/**
 * 各类贴花的基准世界尺寸（米）：金属 0.25、混凝土 0.34、木 0.24、焦痕 2.4、烟熏 0.3、玻璃 0.3，运行时再乘随机抖动与调用方缩放
 */
export var DECAL_SIZES = {
  bullet_metal: 0.25,
  bullet_concrete: 0.34,
  bullet_wood: 0.24,
  scorch: 2.4,
  soot: 0.3,
  bullet_glass: 0.3,
};

/**
 * 贴花池满时按写入顺序把最旧的 14 枚循环淡出，代价极低且看不出是新贴花挤掉了旧的
 */
export var DECAL_EVICT_FADE_COUNT = 14;
