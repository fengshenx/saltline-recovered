// render/effects/decal-atlas.js — 从 render/effects/particles.js 按职责拆出（贴花图集与 GPU 粒子批本是两件事）。

import { createValueNoise } from '../../core/random.js';
import { TAU } from '../../audio/synthesis.js';
import * as THREE from 'three';

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
  for (let frameSlot of DECAL_ATLAS_FRAMES.bullet_metal)
    drawCell(frameSlot, (cellExtent) => {
      ((albedoCtx.fillStyle = radialGradient(albedoCtx, cellExtent * 0.1, cellExtent * 0.6, [
        [0, 'rgba(14,13,12,0.4)'],
        [0.5, 'rgba(18,17,16,0.14)'],
        [1, 'rgba(20,20,20,0)'],
      ])),
        albedoCtx.fillRect(-cellExtent, -cellExtent, 2 * cellExtent, 2 * cellExtent));
      let outerRadius = 6 + Math.floor(rand() * 5);
      for (let crackIndex = 0; crackIndex < outerRadius; crackIndex++) {
        let crackAngle = rand() * TAU;
        drawCrack(
          albedoCtx,
          crackAngle,
          cellExtent * 0.2,
          cellExtent * (0.38 + rand() * 0.45),
          0.3,
          0.8 + rand() * 1,
          'rgba(8,8,8,0.55)',
        );
      }
      let cellCenterY = cellExtent * (0.24 + rand() * 0.08),
        cellHalfSize = 0.7 + rand() * 0.5,
        rotationAngle = rand() * TAU,
        polygonBlotch = (centerX, centerY, radius, rotation, jitter, segmentCount) => {
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
                me = Math.sin(re) * $ * cellHalfSize;
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
      polygonBlotch(0, 0, cellCenterY, rotationAngle, 0.75, 11);
      let blotchCount = 2 + Math.floor(rand() * 4);
      for (let crackIndex = 0; crackIndex < blotchCount; crackIndex++) {
        let crackAngle = rand() * TAU,
          offsetRadius = cellCenterY * (1 + rand() * 0.7);
        polygonBlotch(
          Math.cos(crackAngle) * offsetRadius,
          Math.sin(crackAngle) * offsetRadius,
          cellCenterY * (0.15 + rand() * 0.3),
          rand() * TAU,
          0.8,
          7,
        );
      }
      for (let crackIndex = 0; crackIndex < 9; crackIndex++) {
        let crackAngle = rand() * TAU,
          offsetRadius = cellCenterY * 0.3,
          endRadius = cellCenterY * (0.6 + rand() * 0.3);
        (albedoCtx.beginPath(),
          albedoCtx.moveTo(
            Math.cos(crackAngle) * offsetRadius,
            Math.sin(crackAngle) * offsetRadius,
          ),
          albedoCtx.lineTo(
            Math.cos(crackAngle + 0.1) * endRadius,
            Math.sin(crackAngle + 0.1) * endRadius,
          ),
          (albedoCtx.strokeStyle = rand() < 0.5 ? 'rgba(245,246,248,0.7)' : 'rgba(70,72,76,0.5)'),
          (albedoCtx.lineWidth = 0.8),
          albedoCtx.stroke());
      }
      let pitRadius = cellExtent * (0.1 + rand() * 0.025),
        crackSegments = 8 + Math.floor(rand() * 5);
      for (let crackIndex = 0; crackIndex < crackSegments; crackIndex++) {
        if (rand() < 0.15) continue;
        let crackAngle = ((crackIndex + (rand() - 0.5) * 0.6) / crackSegments) * TAU,
          offsetRadius = pitRadius * (1.25 + rand() * 0.9),
          endRadius = 0.16 + rand() * 0.16,
          flakeBrightness = 205 + Math.floor(rand() * 50);
        (albedoCtx.beginPath(),
          albedoCtx.moveTo(
            Math.cos(crackAngle - endRadius) * pitRadius * 0.9,
            Math.sin(crackAngle - endRadius) * pitRadius * 0.9,
          ),
          albedoCtx.lineTo(
            Math.cos(crackAngle) * offsetRadius,
            Math.sin(crackAngle) * offsetRadius,
          ),
          albedoCtx.lineTo(
            Math.cos(crackAngle + endRadius) * pitRadius * 0.9,
            Math.sin(crackAngle + endRadius) * pitRadius * 0.9,
          ),
          albedoCtx.closePath(),
          (albedoCtx.fillStyle = `rgb(${flakeBrightness},${flakeBrightness},${Math.min(255, flakeBrightness + 4)})`),
          albedoCtx.fill(),
          (albedoCtx.strokeStyle = 'rgba(40,40,42,0.6)'),
          (albedoCtx.lineWidth = 0.7),
          albedoCtx.stroke());
      }
      (ormCtx.beginPath(),
        ormCtx.arc(0, 0, pitRadius * 1.8, 0, TAU),
        (ormCtx.fillStyle = 'rgb(0,60,255)'),
        ormCtx.fill(),
        blobPath(albedoCtx, pitRadius, 0.3, 11),
        (albedoCtx.fillStyle = radialGradient(albedoCtx, 0, pitRadius, [
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
          pitRadius * 3.4,
        ),
        blobPath(ormCtx, pitRadius, 0.1, 11),
        (ormCtx.fillStyle = 'rgb(0,250,0)'),
        ormCtx.fill());
    });
  for (let frameSlot of DECAL_ATLAS_FRAMES.bullet_concrete)
    drawCell(frameSlot, (cellExtent) => {
      ((albedoCtx.fillStyle = radialGradient(albedoCtx, cellExtent * 0.2, cellExtent * 0.9, [
        [0, 'rgba(186,180,168,0.22)'],
        [0.6, 'rgba(180,175,165,0.07)'],
        [1, 'rgba(170,165,155,0)'],
      ])),
        albedoCtx.fillRect(-cellExtent, -cellExtent, 2 * cellExtent, 2 * cellExtent));
      let outerRadius = 4 + Math.floor(rand() * 4);
      for (let blotchCount = 0; blotchCount < outerRadius; blotchCount++) {
        let pitRadius = rand() * TAU,
          crackSegments = cellExtent * (0.5 + rand() * 0.42);
        (drawCrack(
          albedoCtx,
          pitRadius,
          cellExtent * 0.25,
          crackSegments,
          0.35,
          1.3 + rand() * 1.3,
          'rgba(20,19,18,0.75)',
        ),
          rand() < 0.5 &&
            drawCrack(
              albedoCtx,
              pitRadius + (rand() - 0.5) * 0.6,
              crackSegments * 0.7,
              crackSegments * 1.05,
              0.6,
              0.9,
              'rgba(20,19,18,0.5)',
            ));
      }
      let cellCenterY = cellExtent * (0.33 + rand() * 0.09),
        cellHalfSize = 12,
        rotationAngle = [];
      for (let blotchCount = 0; blotchCount < cellHalfSize; blotchCount++)
        rotationAngle.push(1 + (rand() - 0.5) * 0.6);
      let polygonBlotch = (O, q, U, centerX) => {
        O.beginPath();
        for (let centerY = 0; centerY < cellHalfSize; centerY++) {
          let radius = (centerY / cellHalfSize) * TAU,
            rotation = cellCenterY * rotationAngle[centerY] * q;
          centerY
            ? O.lineTo(Math.cos(radius) * rotation + U, Math.sin(radius) * rotation + centerX)
            : O.moveTo(Math.cos(radius) * rotation + U, Math.sin(radius) * rotation + centerX);
        }
        O.closePath();
      };
      (polygonBlotch(albedoCtx, 1.05, 1.5, 1.5),
        (albedoCtx.fillStyle = 'rgba(22,21,20,0.8)'),
        albedoCtx.fill(),
        polygonBlotch(albedoCtx, 1, 0, 0),
        (albedoCtx.fillStyle = radialGradient(albedoCtx, cellCenterY * 0.1, cellCenterY * 1.1, [
          [0, '#35332f'],
          [0.4, '#6f6b63'],
          [0.8, '#8f8b82'],
          [1, '#9a968c'],
        ])),
        albedoCtx.fill(),
        polygonBlotch(albedoCtx, 0.97, -1, -1),
        (albedoCtx.strokeStyle = 'rgba(206,201,190,0.55)'),
        (albedoCtx.lineWidth = 1.2),
        albedoCtx.stroke());
      for (let blotchCount = 0; blotchCount < 6; blotchCount++) {
        let pitRadius = rand() * TAU;
        drawCrack(
          albedoCtx,
          pitRadius,
          cellCenterY * 0.2,
          cellCenterY * 0.9,
          0.5,
          1,
          'rgba(28,27,25,0.5)',
        );
      }
      for (let blotchCount = 0; blotchCount < 60; blotchCount++) {
        let pitRadius = rand() * TAU,
          crackSegments = Math.sqrt(rand()) * cellCenterY * 0.85;
        ((albedoCtx.fillStyle = rand() < 0.55 ? 'rgba(36,34,32,0.6)' : 'rgba(196,191,180,0.6)'),
          albedoCtx.beginPath(),
          albedoCtx.arc(
            Math.cos(pitRadius) * crackSegments,
            Math.sin(pitRadius) * crackSegments,
            0.7 + rand() * 2,
            0,
            TAU,
          ),
          albedoCtx.fill());
      }
      (blobPath(albedoCtx, cellCenterY * 0.3, 0.45, 9),
        (albedoCtx.fillStyle = radialGradient(albedoCtx, 0, cellCenterY * 0.33, [
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
          cellCenterY * 1.15,
        ));
      for (let blotchCount = 0; blotchCount < 22; blotchCount++) {
        let pitRadius = rand() * TAU,
          crackSegments = cellCenterY * (1.15 + rand() * 1.3);
        ((albedoCtx.fillStyle = rand() < 0.5 ? 'rgba(190,185,175,0.45)' : 'rgba(30,29,27,0.45)'),
          albedoCtx.beginPath(),
          albedoCtx.arc(
            Math.cos(pitRadius) * crackSegments,
            Math.sin(pitRadius) * crackSegments,
            0.6 + rand() * 1.6,
            0,
            TAU,
          ),
          albedoCtx.fill());
      }
    });
  for (let frameSlot of DECAL_ATLAS_FRAMES.bullet_wood)
    drawCell(frameSlot, (cellExtent) => {
      (blobPath(albedoCtx, cellExtent * 0.27, 0.7, 11, 1.45),
        (albedoCtx.fillStyle = 'rgba(206,182,140,0.85)'),
        albedoCtx.fill());
      for (let outerRadius = 0; outerRadius < 46; outerRadius++) {
        let cellCenterY = (rand() - 0.5) * cellExtent * 0.62,
          cellHalfSize =
            cellExtent * (0.25 + rand() * 0.6) * (1 - Math.abs(cellCenterY) / (cellExtent * 0.4)),
          rotationAngle = (rand() - 0.5) * cellExtent * 0.2;
        (albedoCtx.beginPath(),
          albedoCtx.moveTo(cellCenterY, rotationAngle - cellHalfSize),
          albedoCtx.lineTo(cellCenterY + (rand() - 0.5) * 5, rotationAngle + cellHalfSize),
          (albedoCtx.strokeStyle = rand() < 0.5 ? 'rgba(236,216,172,0.85)' : 'rgba(88,62,38,0.7)'),
          (albedoCtx.lineWidth = 0.8 + rand() * 2.2),
          albedoCtx.stroke());
      }
      (blobPath(albedoCtx, cellExtent * 0.1, 0.5, 9, 1.1),
        (albedoCtx.fillStyle = radialGradient(albedoCtx, 0, cellExtent * 0.12, [
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
          cellExtent * 0.17,
        ));
    });
  for (let frameSlot of DECAL_ATLAS_FRAMES.scorch)
    drawCell(frameSlot, (cellExtent) => {
      ((albedoCtx.fillStyle = radialGradient(albedoCtx, 0, cellExtent * 0.98, [
        [0, 'rgba(6,5,5,0.92)'],
        [0.3, 'rgba(10,9,8,0.85)'],
        [0.55, 'rgba(22,18,15,0.5)'],
        [0.8, 'rgba(30,24,20,0.16)'],
        [1, 'rgba(30,24,20,0)'],
      ])),
        albedoCtx.fillRect(-cellExtent, -cellExtent, 2 * cellExtent, 2 * cellExtent));
      for (let outerRadius = 0; outerRadius < 90; outerRadius++) {
        let cellCenterY = rand() * TAU,
          cellHalfSize = cellExtent * (0.1 + rand() * 0.3),
          rotationAngle = cellExtent * (0.5 + rand() * 0.46);
        (albedoCtx.beginPath(),
          albedoCtx.moveTo(
            Math.cos(cellCenterY - 0.03) * cellHalfSize,
            Math.sin(cellCenterY - 0.03) * cellHalfSize,
          ),
          albedoCtx.lineTo(
            Math.cos(cellCenterY) * rotationAngle,
            Math.sin(cellCenterY) * rotationAngle,
          ),
          albedoCtx.lineTo(
            Math.cos(cellCenterY + 0.03) * cellHalfSize,
            Math.sin(cellCenterY + 0.03) * cellHalfSize,
          ),
          albedoCtx.closePath(),
          (albedoCtx.fillStyle = `rgba(8,7,6,${0.12 + rand() * 0.3})`),
          albedoCtx.fill());
      }
      for (let outerRadius = 0; outerRadius < 60; outerRadius++) {
        let cellCenterY = rand() * TAU,
          cellHalfSize = cellExtent * (0.15 + rand() * 0.6);
        ((albedoCtx.fillStyle = rand() < 0.3 ? 'rgba(150,140,128,0.25)' : 'rgba(0,0,0,0.4)'),
          albedoCtx.beginPath(),
          albedoCtx.arc(
            Math.cos(cellCenterY) * cellHalfSize,
            Math.sin(cellCenterY) * cellHalfSize,
            1 + rand() * 4,
            0,
            TAU,
          ),
          albedoCtx.fill());
      }
    });
  for (let frameSlot of DECAL_ATLAS_FRAMES.soot)
    drawCell(frameSlot, (cellExtent) => {
      for (let outerRadius = 0; outerRadius < 14; outerRadius++) {
        let cellCenterY = rand() * TAU,
          cellHalfSize = rand() * cellExtent * 0.3,
          rotationAngle = cellExtent * (0.15 + rand() * 0.3),
          polygonBlotch = Math.cos(cellCenterY) * cellHalfSize,
          blotchCount = Math.sin(cellCenterY) * cellHalfSize,
          pitRadius = albedoCtx.createRadialGradient(
            polygonBlotch,
            blotchCount,
            0,
            polygonBlotch,
            blotchCount,
            rotationAngle,
          );
        (pitRadius.addColorStop(0, 'rgba(8,8,8,0.4)'),
          pitRadius.addColorStop(1, 'rgba(8,8,8,0)'),
          (albedoCtx.fillStyle = pitRadius),
          albedoCtx.fillRect(-cellExtent, -cellExtent, 2 * cellExtent, 2 * cellExtent));
      }
      (blobPath(albedoCtx, cellExtent * 0.1, 0.4, 12),
        (albedoCtx.fillStyle = 'rgba(0,0,0,0.9)'),
        albedoCtx.fill());
    });
  for (let frameSlot of DECAL_ATLAS_FRAMES.bullet_glass)
    drawCell(frameSlot, (cellExtent) => {
      ((albedoCtx.fillStyle = radialGradient(albedoCtx, 0, cellExtent * 0.5, [
        [0, 'rgba(235,240,242,0.55)'],
        [1, 'rgba(235,240,242,0)'],
      ])),
        albedoCtx.fillRect(-cellExtent, -cellExtent, 2 * cellExtent, 2 * cellExtent));
      for (let outerRadius = 0; outerRadius < 13; outerRadius++) {
        let cellCenterY = ((outerRadius + rand() * 0.6) / 13) * TAU;
        drawCrack(
          albedoCtx,
          cellCenterY,
          cellExtent * 0.07,
          cellExtent * (0.5 + rand() * 0.45),
          0.12,
          0.9 + rand(),
          'rgba(240,246,248,0.85)',
        );
      }
      for (let outerRadius = 0; outerRadius < 3; outerRadius++) {
        let cellCenterY = cellExtent * (0.2 + outerRadius * 0.17 + rand() * 0.05);
        for (let cellHalfSize = 0; cellHalfSize < 9; cellHalfSize++) {
          if (rand() < 0.45) continue;
          let rotationAngle = (cellHalfSize / 9) * TAU;
          (albedoCtx.beginPath(),
            albedoCtx.arc(0, 0, cellCenterY, rotationAngle, rotationAngle + 0.5),
            (albedoCtx.strokeStyle = 'rgba(240,246,248,0.6)'),
            (albedoCtx.lineWidth = 1),
            albedoCtx.stroke());
        }
      }
      (blobPath(albedoCtx, cellExtent * 0.07, 0.3, 10),
        (albedoCtx.fillStyle = '#060606'),
        albedoCtx.fill());
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
    let frameSlot = normalCtx.getImageData(0, 0, width, height),
      cellExtent = frameSlot.data;
    if (cellExtent && cellExtent.length === width * height * 4) {
      let outerRadius = normalCtx.createImageData(width, height),
        cellCenterY = outerRadius.data,
        cellHalfSize = 5 / 255;
      for (let rotationAngle = 0; rotationAngle < height; rotationAngle++) {
        let polygonBlotch = Math.max(0, rotationAngle - 1) * width,
          blotchCount = Math.min(height - 1, rotationAngle + 1) * width;
        for (let pitRadius = 0; pitRadius < width; pitRadius++) {
          let crackSegments = Math.max(0, pitRadius - 1),
            crackIndex = Math.min(width - 1, pitRadius + 1),
            crackAngle =
              (cellExtent[(rotationAngle * width + crackIndex) * 4] -
                cellExtent[(rotationAngle * width + crackSegments) * 4]) *
              cellHalfSize,
            offsetRadius =
              (cellExtent[(blotchCount + pitRadius) * 4] -
                cellExtent[(polygonBlotch + pitRadius) * 4]) *
              cellHalfSize,
            endRadius = 1 / Math.sqrt(crackAngle * crackAngle + offsetRadius * offsetRadius + 1),
            flakeBrightness = (rotationAngle * width + pitRadius) * 4;
          ((cellCenterY[flakeBrightness] = (-crackAngle * endRadius * 0.5 + 0.5) * 255),
            (cellCenterY[flakeBrightness + 1] = (offsetRadius * endRadius * 0.5 + 0.5) * 255),
            (cellCenterY[flakeBrightness + 2] = (endRadius * 0.5 + 0.5) * 255),
            (cellCenterY[flakeBrightness + 3] = 255));
        }
      }
      (normalCtx.putImageData(outerRadius, 0, 0),
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
