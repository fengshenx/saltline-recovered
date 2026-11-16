// content/ground/geometry.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { MARKING_BOUNDS } from './ground.js';

/**
 * 把停机坪地面标线按世界坐标烘焙成一张画布贴图（车道线、SLOW/10 限速椭圆、BERTH 4 泊位号、KEEP CLEAR 斜纹区、400 段泊位排号、蓝色刹车痕与滴漏痕），供湿滑地面材质做磨损剥落混合
 */
export function createApronMarkingsTexture(size, anisotropy = 1) {
  let canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  let ctx = canvas.getContext('2d');
  ((ctx.fillStyle = '#000'), ctx.fillRect(0, 0, size, size));
  let scaleX = size / MARKING_BOUNDS.w,
    scaleY = size / MARKING_BOUNDS.h;
  (ctx.setTransform(scaleX, 0, 0, scaleY, -MARKING_BOUNDS.x0 * scaleX, -MARKING_BOUNDS.z0 * scaleY),
    (ctx.globalCompositeOperation = 'lighter'));
  let paintRed = '#ff0000',
    paintGreen = '#00ff00',
    font = '"Big Shoulders Display", "Barlow Condensed", Impact, "Arial Narrow", sans-serif',
    seedState = 90210,
    rand = () => {
      ((seedState |= 0), (seedState = (seedState + 1831565813) | 0));
      let A = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
      return (
        (A = (A + Math.imul(A ^ (A >>> 7), 61 | A)) ^ A),
        ((A ^ (A >>> 14)) >>> 0) / 4294967296
      );
    },
    drawLine = (A, _, M, E, w, S, z) => {
      ((ctx.strokeStyle = S),
        (ctx.lineWidth = w),
        (ctx.lineCap = 'butt'),
        ctx.setLineDash(z || []),
        ctx.beginPath(),
        ctx.moveTo(A, _),
        ctx.lineTo(M, E),
        ctx.stroke(),
        ctx.setLineDash([]));
    },
    strokeBox = (A, _, M, E, w, S) => {
      ((ctx.strokeStyle = S),
        (ctx.lineWidth = w),
        ctx.setLineDash([]),
        ctx.strokeRect(A, _, M - A, E - _));
    },
    fillBox = (ay, az, e1x, e1y, e1z) => {
      ((ctx.fillStyle = e1z), ctx.fillRect(ay, az, e1x - ay, e1y - az));
    },
    drawLabel = (A, _, M, E, w, S) => {
      (ctx.save(),
        ctx.translate(_, M),
        ctx.rotate(w),
        ctx.scale(E / 100, E / 100),
        (ctx.font = `900 100px ${font}`),
        (ctx.textAlign = 'left'),
        (ctx.textBaseline = 'middle'),
        (ctx.fillStyle = S));
      let H = -ctx.measureText(A).width / 2;
      (ctx.fillText(A, H, 0),
        (ctx.globalCompositeOperation = 'source-over'),
        (ctx.fillStyle = '#000'));
      for (let O of A) {
        let q = ctx.measureText(O).width;
        (' I1'.includes(O) || ctx.fillRect(H + q * 0.36, -60, 4.5, 120), (H += q));
      }
      ((ctx.globalCompositeOperation = 'lighter'), ctx.restore());
    },
    hatchZone = (cornerIndex, _, M, E, w, S = 1.1, z = 0.14) => {
      (ctx.save(), ctx.beginPath(), ctx.rect(cornerIndex, _, M - cornerIndex, E - _), ctx.clip());
      let H = M - cornerIndex + (E - _);
      for (let O = 0; O < H; O += S)
        drawLine(cornerIndex + O, _, cornerIndex + O - (E - _), E, z, w);
      (ctx.restore(), strokeBox(cornerIndex, _, M, E, 0.15, w));
    },
    drawArrow = (A, _, M, E) => {
      (ctx.save(),
        ctx.translate(A, _),
        ctx.scale(M, 1),
        (ctx.fillStyle = E),
        ctx.beginPath(),
        ctx.moveTo(-1.6, -0.14),
        ctx.lineTo(0.5, -0.14),
        ctx.lineTo(0.5, -0.5),
        ctx.lineTo(1.7, 0),
        ctx.lineTo(0.5, 0.5),
        ctx.lineTo(0.5, 0.14),
        ctx.lineTo(-1.6, 0.14),
        ctx.closePath(),
        ctx.fill(),
        ctx.restore());
    };
  (drawLine(-25.6, 3.6, 16.2, 3.6, 0.15, paintRed),
    drawLine(-25.6, 8.4, -5.6, 8.4, 0.15, paintRed),
    drawLine(10.4, 8.4, 16.2, 8.4, 0.15, paintRed),
    drawLine(-24, 6, -3, 6, 0.12, paintGreen, [3, 4.5]),
    drawLine(6, 6, 15.5, 6, 0.12, paintGreen, [3, 4.5]),
    drawLine(-23, 14, 16.2, 14, 0.15, paintRed),
    drawLine(-23, 18.6, 16.2, 18.6, 0.15, paintRed),
    drawLine(-23, 16.3, 15.5, 16.3, 0.1, paintGreen, [2, 6]),
    drawLine(-23, -3.6, 16.2, -3.6, 0.12, paintRed),
    drawLine(-23, 0.56, 16.2, 0.56, 0.12, paintRed),
    drawLine(-23, 24.2, 16.2, 24.2, 0.12, paintRed),
    drawLine(-37.5, 2.6, -26.4, 2.6, 0.15, paintGreen),
    drawLine(-37.5, 9.2, -26.4, 9.2, 0.15, paintGreen),
    drawArrow(-14, 4.7, 1, paintGreen),
    drawArrow(13, 7.3, -1, paintGreen),
    drawArrow(-16, 15.2, 1, paintGreen),
    drawArrow(2, 17.5, -1, paintGreen),
    fillBox(-26.2, 3.6, -25.75, 8.4, paintGreen));
  for (let x0 = 2.75; x0 < 9; x0 += 1) fillBox(-31.2, x0, -28.2, x0 + 0.5, paintGreen);
  (drawLabel('SLOW', -21.4, 6, 1.7, Math.PI / 2, paintGreen),
    drawLabel('10', -19, 6, 1.8, Math.PI / 2, paintGreen),
    (ctx.strokeStyle = paintGreen),
    (ctx.lineWidth = 0.14),
    ctx.beginPath(),
    ctx.ellipse(-19, 6, 1.35, 1.8, 0, 0, Math.PI * 2),
    ctx.stroke(),
    drawLine(-30.4, 2.6, -30.4, -10.2, 0.12, paintGreen),
    drawLine(-29, 2.6, -29, -8.8, 0.12, paintGreen),
    drawLine(-30.4, -10.2, -7, -10.2, 0.12, paintGreen),
    drawLine(-29, -8.8, -7, -8.8, 0.12, paintGreen));
  for (let x0 = -28; x0 < -7.5; x0 += 2.2) drawLine(x0, -10.2, x0 + 0.9, -8.8, 0.1, paintGreen);
  for (let x0 = -7.5; x0 < 2; x0 += 2.2) drawLine(-30.4, x0, -29, x0 + 0.9, 0.1, paintGreen);
  let bayGaps = [
      [-22.5, -10.3],
      [-5.3, 6.9],
      [10.5, 16.6],
    ],
    drawBayRow = (A, _, M, E, w, S) => {
      bayGaps.forEach((z, H) => {
        if (S && H === 1) return;
        let O = H === 2 ? 1 : 2,
          q = _ - A > 4 ? 2 : 1;
        for (let U = 0; U < O; U++)
          for (let T = 0; T < q; T++) {
            let D = z[0] + ((z[1] - z[0]) * U) / O,
              C = z[0] + ((z[1] - z[0]) * (U + 1)) / O,
              G = A + ((_ - A) * T) / q,
              j = A + ((_ - A) * (T + 1)) / q;
            strokeBox(D - 0.12, G - 0.12, C + 0.12, j + 0.12, 0.1, paintGreen);
          }
        drawLabel(M + (H + 1), (z[0] + z[1]) / 2, E, 0.85, w, paintRed);
      });
    };
  (drawBayRow(-6.34, -3.9, 'D0', -2.9, Math.PI, !1),
    drawBayRow(0.86, 3.3, 'C0', -0.15, 0, !1),
    drawBayRow(8.7, 13.64, 'B0', 14.75, Math.PI, !0),
    drawBayRow(18.9, 23.84, 'A0', 17.85, 0, !1));
  for (let x0 of [-10.3, -5.3, 6.9, 10.5])
    drawLine(
      x0 + (x0 === -10.3 || x0 === 6.9 ? 0.35 : -0.35),
      -6.3,
      x0 + (x0 === -10.3 || x0 === 6.9 ? 0.35 : -0.35),
      23.8,
      0.1,
      paintRed,
      [1.5, 1.5],
    );
  (hatchZone(-6.6, -10.9, -0.4, -8.9, paintRed, 0.9, 0.12),
    hatchZone(12.2, -22.6, 16.2, -16.4, paintRed),
    hatchZone(-0.9, 5.4, 3.9, 9.9, paintRed, 0.95, 0.13),
    drawLabel('KEEP CLEAR', 1.5, 10.6, 0.62, 0, paintRed),
    hatchZone(19.8, -4.2, 27.2, 4.2, paintRed, 1.2, 0.16),
    drawLabel('KEEP CLEAR', 17.4, -19.5, 0.8, Math.PI / 2, paintRed),
    drawLine(16.9, -29.5, 16.9, 27.5, 0.15, paintRed),
    drawLine(17.7, -29.5, 17.7, 27.5, 0.1, paintRed, [1, 1]),
    drawLine(19.3, -29.5, 19.3, 27.5, 0.1, paintRed, [1, 1]),
    drawLine(27.7, -29.5, 27.7, 27.5, 0.1, paintRed, [1, 1]),
    drawLabel('BERTH 4', 23.5, 21.6, 1.9, 0, paintGreen),
    drawLabel('BERTH 4', 23.5, -7.7, 1.7, Math.PI, paintGreen));
  for (let x0 = -27; x0 < 27; x0 += 9)
    drawLabel(
      String(400 + Math.round((x0 + 27) / 9) * 5),
      26.9,
      x0 + 2,
      0.5,
      Math.PI / 2,
      paintGreen,
    );
  ctx.lineCap = 'round';
  let drawSkid = (startY, angle, length, strokeW, branchDepth, segCount) => {
    for (let segIdx of [-0.95, 0.95])
      for (let H of [-0.16, 0.16])
        ((ctx.strokeStyle = `rgba(0,0,255,${segCount})`),
          (ctx.lineWidth = 0.26),
          ctx.beginPath(),
          ctx.moveTo(startY, angle + segIdx + H),
          ctx.quadraticCurveTo(
            (startY + length) / 2,
            (angle + strokeW) / 2 + branchDepth + segIdx + H,
            length,
            strokeW + segIdx + H,
          ),
          ctx.stroke());
  };
  for (let x0 = 0; x0 < 46; x0++) {
    let y0 = rand() < 0.68 ? 6 : 16.3,
      M = y0 + (rand() - 0.5) * 2.6,
      E = -36 + rand() * 40,
      lineWidth = 8 + rand() * 26;
    drawSkid(
      E,
      M,
      Math.min(E + lineWidth, 28),
      M + (rand() - 0.5) * 1.6,
      (rand() - 0.5) * 1.4,
      0.1 + rand() * 0.22,
    );
  }
  for (let x0 = 0; x0 < 12; x0++) {
    let y0 = rand() < 0.5 ? 6 : 16.3,
      M = rand() < 0.5 ? -1 : 1,
      E = 0.12 + rand() * 0.2;
    ((ctx.strokeStyle = `rgba(0,0,255,${E})`),
      (ctx.lineWidth = 0.3),
      ctx.beginPath(),
      ctx.moveTo(10 + rand() * 4, y0 + (rand() - 0.5) * 2),
      ctx.quadraticCurveTo(21 + rand() * 3, y0, 22 + rand() * 4, y0 + M * (8 + rand() * 10)),
      ctx.stroke());
  }
  for (let x0 = 0; x0 < 60; x0++) {
    let y0 = -34 + rand() * 62,
      M = -8 + rand() * 34,
      E = 0.6 + rand() * 2.5,
      lineWidth = (rand() - 0.5) * 0.5;
    ((ctx.strokeStyle = `rgba(0,0,255,${0.15 + rand() * 0.3})`),
      (ctx.lineWidth = 0.12 + rand() * 0.2),
      ctx.beginPath(),
      ctx.moveTo(y0, M),
      ctx.lineTo(y0 + Math.cos(lineWidth) * E, M + Math.sin(lineWidth) * E),
      ctx.stroke());
  }
  let texture = new THREE.CanvasTexture(canvas);
  return (
    (texture.flipY = !1),
    (texture.colorSpace = THREE.NoColorSpace),
    (texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping),
    (texture.minFilter = THREE.LinearMipmapLinearFilter),
    (texture.magFilter = THREE.LinearFilter),
    (texture.generateMipmaps = !0),
    (texture.anisotropy = anisotropy),
    (texture.needsUpdate = !0),
    texture
  );
}
