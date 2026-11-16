// assets/procedural/textures.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { createSeededRandom } from '../../audio/synthesis.js';

import { smoothstepClamp } from '../../core/math.js';

import { createCanvas } from '../../core/quality.js';

import { createValueNoise } from '../../core/random.js';

/**
 * 把高度图（RG 两字节编码，避免 8 位阶梯）做 Sobel 求梯度转成切线空间法线的片元着色器，uK 分别缩放 x/y 方向的凹凸强度
 */
export var SALTLINE_HEIGHT_TO_NORMAL_FRAG = `
precision highp float;
uniform sampler2D tH; uniform vec2 uK; uniform float uTexel; in vec2 vUv; out vec4 o;
float H(vec2 uv){ vec4 t = texture(tH, uv); return t.r + t.g / 255.0; }
void main(){
  vec2 e = vec2(uTexel, 0.0);
  float l = H(vUv - e.xy), r = H(vUv + e.xy), d = H(vUv - e.yx), u = H(vUv + e.yx);
  float ld = H(vUv - e.xx), rd = H(vUv + vec2(e.x, -e.x)), lu = H(vUv + vec2(-e.x, e.x)), ru = H(vUv + e.xx);
  float gx = (r - l) * 0.5 + (ru + rd - lu - ld) * 0.25, gy = (u - d) * 0.5 + (ru + lu - rd - ld) * 0.25;
  vec3 n = normalize(vec3(-gx * uK.x, -gy * uK.y, 1.0));
  o = vec4(n * 0.5 + 0.5, 1.0);
}`;

/**
 * 纹理拷贝片元着色器：uSq 打开时把 albedo 平方（转到线性空间）再写进 sRGB 目标，否则原样搬运 ORM 数据
 */
export var SALTLINE_TEX_COPY_FRAG = `
precision highp float;
uniform sampler2D tA; uniform float uSq; in vec2 vUv; out vec4 o;
void main(){ vec4 t = texture(tA, vUv); o = uSq > 0.5 ? vec4(t.rgb * t.rgb, t.a) : t; }`;

/**
 * 标题与铭牌主字用的窄体显示字体栈（Big Shoulders Display 优先，末位兜底 Impact/Arial），直接喂给 canvas ctx.font
 */
var FONT_STACK_DISPLAY =
  '"Big Shoulders Display", "Barlow Condensed", "Arial Narrow", Impact, "Helvetica Neue", Arial, sans-serif';

/**
 * 无衬线正文字体栈（Barlow Condensed 优先），用于铭牌小字与技术参数行
 */
var FONT_STACK_SANS = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

/**
 * 等宽字体栈（IBM Plex Mono 优先），用于 CSC 铭牌上要对齐的技术参数列
 */
var FONT_STACK_MONO = '"IBM Plex Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace';

/**
 * 贴花油墨色板（白/黑/黄/红/深藏青/橙六色的 RGB 数组）：危险标识、船公司 logo 与标牌配色全部取自这里，保证整场色调统一
 */
var INK_PALETTE = {
  white: [226, 223, 213],
  black: [24, 24, 26],
  yellow: [222, 172, 30],
  red: [168, 36, 28],
  navy: [24, 38, 58],
  orange: [206, 100, 30],
};

/**
 * 把 INK_PALETTE 的 [r,g,b] 数组加 alpha 拼成 canvas 用的 rgba() 字符串，省掉每处手写模板串
 */
var toRgba = (color, e = 1) => `rgba(${color[0]},${color[1]},${color[2]},${e})`;

/**
 * 不需要挖漏印桥接的字符集合（I/1/空格/标点等）：这些字形本来就没有闭环，硬挖反而把笔画切断
 */
var NO_BRIDGE_GLYPHS = new Set(['I', '1', ' ', '-', '.', '/', ':', ',', "'", '!', '\xB7']);

/**
 * FNV-1a 字符串哈希，把贴花名折叠成稳定种子，使程序化贴花在多次会话、多台机器上可复现
 */
function hashString(text) {
  let e = 2166136261;
  for (let t = 0; t < text.length; t++) ((e ^= text.charCodeAt(t)), (e = Math.imul(e, 16777619)));
  return e >>> 0;
}

/**
 * 在 2D 上下文里描出一个半径随机抖动的多边形路径（可调抖动幅度与顶点数），用于锈斑、掉漆碎片、油渍这类有机形状
 */
function traceBlobPath(ctx, centerX, centerY, radius, rnd, jitter = 0.35, vertexCount = 9) {
  ctx.beginPath();
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
    let angle = (vertexIndex / vertexCount) * Math.PI * 2,
      vertexRadius = radius * (1 - jitter + rnd() * jitter * 2),
      pointX = centerX + Math.cos(angle) * vertexRadius,
      pointY = centerY + Math.sin(angle) * vertexRadius;
    vertexIndex ? ctx.lineTo(pointX, pointY) : ctx.moveTo(pointX, pointY);
  }
  ctx.closePath();
}

/**
 * 对已画好的贴花做整体老化：destination-out 挖斑 + 定向划痕 + 细噪点 + 软暗斑，强度 0..1 决定老化程度，让每张标识都像风吹日晒过
 */
function applyCanvasDistress(ctx, width, height, amount, rnd) {
  if (amount <= 0) return;
  (ctx.save(), (ctx.globalCompositeOperation = 'destination-out'));
  let blobCount = Math.floor((amount * width * height) / 700);
  for (let iter = 0; iter < blobCount; iter++) {
    let blobRadius = Math.pow(rnd(), 3) * height * 0.09 + 0.6;
    ((ctx.globalAlpha = 0.45 + rnd() * 0.55),
      traceBlobPath(ctx, rnd() * width, rnd() * height, blobRadius, rnd, 0.5, 7),
      ctx.fill());
  }
  ctx.lineCap = 'round';
  for (let iter = 0; iter < amount * 16; iter++) {
    let blobRadius = rnd() * width,
      ptY = rnd() * height,
      angle = (rnd() - 0.5) * 0.7,
      streakLen = (0.1 + rnd() * 0.5) * width;
    ((ctx.globalAlpha = 0.5 + rnd() * 0.5),
      (ctx.lineWidth = 0.5 + rnd() * rnd() * 3),
      ctx.beginPath(),
      ctx.moveTo(blobRadius, ptY),
      ctx.lineTo(blobRadius + Math.cos(angle) * streakLen, ptY + Math.sin(angle) * streakLen),
      ctx.stroke());
  }
  ctx.globalAlpha = 0.8;
  for (let iter = 0; iter < (amount * width * height) / 60; iter++)
    ctx.fillRect(rnd() * width, rnd() * height, 1 + rnd(), 1 + rnd());
  for (let iter = 0; iter < amount * 6; iter++) {
    let blobRadius = rnd() * width,
      ptY = rnd() * height,
      angle = (0.1 + rnd() * 0.25) * height,
      streakLen = ctx.createRadialGradient(blobRadius, ptY, 0, blobRadius, ptY, angle);
    (streakLen.addColorStop(0, 'rgba(0,0,0,' + (0.25 + rnd() * 0.4) + ')'),
      streakLen.addColorStop(1, 'rgba(0,0,0,0)'),
      (ctx.globalAlpha = 1),
      (ctx.fillStyle = streakLen),
      ctx.fillRect(blobRadius - angle, ptY - angle, angle * 2, angle * 2));
  }
  ctx.restore();
}

/**
 * 按给定字距逐字累加 measureText 宽度，返回整串文字排版后的总宽，供自动缩放与居中计算
 */
function measureRunWidth(ctx, chars, size, font, weight, spacing) {
  ctx.font = `${weight} ${size}px ${font}`;
  let totalWidth = 0;
  for (let glyph of chars) totalWidth += ctx.measureText(glyph).width + spacing;
  return totalWidth - spacing;
}

/**
 * 逐字绘制带字距的钢印/丝印文字：可选在字中间挖空模拟漏印桥接，按 maxW/fitW 自动缩放，支持左/中/右对齐，返回实际绘制宽度
 */
function drawStencilRun(ctx, chars, anchorX, anchorY, size, color, styleOpts = {}) {
  let fontStack =
      styleOpts.font === 'sans'
        ? FONT_STACK_SANS
        : styleOpts.font === 'mono'
          ? FONT_STACK_MONO
          : FONT_STACK_DISPLAY,
    fontWeight = styleOpts.weight || 700,
    letterSpacing = styleOpts.spacing !== void 0 ? styleOpts.spacing : size * 0.06,
    useBridges = styleOpts.font !== 'sans' && styleOpts.font !== 'mono' && styleOpts.bridges !== !1,
    runWidth = measureRunWidth(ctx, chars, size, fontStack, fontWeight, letterSpacing),
    fitScale =
      styleOpts.maxW && runWidth > styleOpts.maxW
        ? styleOpts.maxW / runWidth
        : styleOpts.fitW
          ? styleOpts.fitW / runWidth
          : 1,
    textCanvas = createCanvas(Math.ceil(runWidth * fitScale) + 8, Math.ceil(size * 1.4)),
    g2d = textCanvas.getContext('2d');
  ((g2d.font = `${fontWeight} ${size}px ${fontStack}`),
    (g2d.textBaseline = 'alphabetic'),
    (g2d.fillStyle = color),
    g2d.scale(fitScale, 1));
  let penX = 4 / fitScale,
    baselineY = size * 1.08;
  for (let glyph of chars) {
    let glyphWidth = g2d.measureText(glyph).width;
    (g2d.fillText(glyph, penX, baselineY),
      useBridges &&
        !NO_BRIDGE_GLYPHS.has(glyph) &&
        (g2d.save(),
        (g2d.globalCompositeOperation = 'destination-out'),
        g2d.fillRect(penX + glyphWidth * 0.5 - size * 0.032, 0, size * 0.064, size * 1.4),
        g2d.restore()),
      (penX += glyphWidth + letterSpacing));
  }
  let drawX =
    styleOpts.align === 'center'
      ? anchorX - (runWidth * fitScale) / 2
      : styleOpts.align === 'right'
        ? anchorX - runWidth * fitScale
        : anchorX;
  return (ctx.drawImage(textCanvas, drawX - 4, anchorY - baselineY), runWidth * fitScale);
}

/**
 * 创建贴花与标牌材质库：22 个 canvas 2D 程序化配方（危险标识 3 种、箭头、禁行、四个船公司 logo、BERTH 4、警示斜纹、污垢/锈流/油渍/渗漏斑、金属与混凝土弹孔、烧灼、裂纹、涂鸦、CSC 铭牌、数字条），按名字缓存 CanvasTexture 与 MeshStandardMaterial，并在字体加载完成后重绘文字类贴花
 */
export function createDecalLibrary(app, maxAnisoLevel = 4) {
  let cache = new Map(),
    fontRefreshers = [],
    bytes = 0;
  function makeDecalMaterial(v, g = {}) {
    let x = new THREE.CanvasTexture(v);
    ((x.colorSpace = THREE.SRGBColorSpace),
      (x.anisotropy = maxAnisoLevel),
      (x.generateMipmaps = !0),
      (x.minFilter = THREE.LinearMipmapLinearFilter),
      (bytes += v.width * v.height * 4 * 1.34));
    let y = new THREE.MeshStandardMaterial({
      map: x,
      transparent: !0,
      depthWrite: !1,
      polygonOffset: !0,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      roughness: g.rough !== void 0 ? g.rough : 0.7,
      metalness: g.metal || 0,
      opacity: g.opacity !== void 0 ? g.opacity : 1,
    });
    return (
      (y.name = 'decal'),
      g.doubleSide && (y.side = THREE.DoubleSide),
      {
        material: y,
        aspect: v.width / v.height,
        texture: x,
      }
    );
  }
  function buildCanvasDecal(v, g, x, y, b = {}) {
    let m = createCanvas(g, x),
      A = m.getContext('2d'),
      _ = () => {
        (A.setTransform(1, 0, 0, 1, 0, 0),
          A.clearRect(0, 0, g, x),
          (A.globalAlpha = 1),
          (A.globalCompositeOperation = 'source-over'),
          b.bleed && ((A.fillStyle = toRgba(b.bleed, 0.012)), A.fillRect(0, 0, g, x)),
          y(A, g, x, createSeededRandom(hashString(v) + 17)));
      };
    _();
    let M = makeDecalMaterial(m, b);
    return (
      b.text &&
        fontRefreshers.push(() => {
          (_(), (M.texture.needsUpdate = !0));
        }),
      M
    );
  }
  function drawHazardTriangle(v, g, x, y) {
    ((v.lineJoin = 'round'),
      v.beginPath(),
      v.moveTo(g / 2, x * 0.12),
      v.lineTo(g * 0.9, x * 0.84),
      v.lineTo(g * 0.1, x * 0.84),
      v.closePath(),
      (v.lineWidth = g * 0.11),
      (v.strokeStyle = toRgba(INK_PALETTE.black)),
      v.stroke(),
      (v.fillStyle = y),
      v.fill(),
      (v.lineWidth = g * 0.035),
      (v.strokeStyle = toRgba(INK_PALETTE.black)),
      v.stroke());
  }
  function drawLogoLockup(v, g, x, y, b, m, A, _) {
    v.fillStyle = v.strokeStyle = toRgba(y);
    let M = x;
    (v.save(),
      v.translate(M * 0.5, M * 0.5),
      b(v, M * 0.38, toRgba(_ || y)),
      v.restore(),
      drawStencilRun(v, m, M * 1, x * 0.6, x * 0.42, toRgba(y), {
        weight: 900,
        bridges: !1,
        maxW: g - M * 1.05,
        spacing: x * 0.012,
      }),
      (v.fillStyle = toRgba(_ || y)),
      v.fillRect(M * 1, x * 0.67, g - M * 1.12, x * 0.022),
      drawStencilRun(v, A, M * 1, x * 0.84, x * 0.115, toRgba(y), {
        font: 'sans',
        weight: 600,
        spacing: x * 0.035,
        maxW: g - M * 1.1,
      }));
  }
  let DECAL_RECIPES = {
      hazard_flammable: () =>
        buildCanvasDecal(
          'hazard_flammable',
          256,
          256,
          (drawCtx, canvasW, canvasH, distressSeed) => {
            (drawCtx.save(),
              drawCtx.translate(canvasW / 2, canvasH / 2),
              drawCtx.rotate(Math.PI / 4),
              (drawCtx.fillStyle = toRgba(INK_PALETTE.red)),
              drawCtx.fillRect(-86, -86, 172, 172),
              (drawCtx.strokeStyle = toRgba(INK_PALETTE.white)),
              (drawCtx.lineWidth = 5),
              drawCtx.strokeRect(-76, -76, 152, 152),
              drawCtx.restore(),
              drawCtx.save(),
              drawCtx.translate(canvasW / 2, canvasH / 2 - 8),
              (drawCtx.fillStyle = toRgba(INK_PALETTE.white)),
              drawCtx.beginPath(),
              drawCtx.moveTo(2, -64),
              drawCtx.bezierCurveTo(34, -28, 40, 6, 24, 28),
              drawCtx.bezierCurveTo(12, 44, -12, 44, -24, 28),
              drawCtx.bezierCurveTo(-40, 6, -20, -12, -15, -34),
              drawCtx.bezierCurveTo(-6, -28, 0, -44, 2, -64),
              drawCtx.fill(),
              (drawCtx.fillStyle = toRgba(INK_PALETTE.red)),
              drawCtx.beginPath(),
              drawCtx.moveTo(1, -10),
              drawCtx.bezierCurveTo(15, 6, 15, 24, 0, 31),
              drawCtx.bezierCurveTo(-15, 24, -13, 8, 1, -10),
              drawCtx.fill(),
              (drawCtx.fillStyle = toRgba(INK_PALETTE.white)),
              drawCtx.fillRect(-34, 50, 68, 6),
              drawCtx.restore(),
              drawStencilRun(
                drawCtx,
                '3',
                canvasW / 2,
                canvasH * 0.9,
                34,
                toRgba(INK_PALETTE.white),
                {
                  align: 'center',
                  weight: 900,
                  bridges: !1,
                },
              ),
              applyCanvasDistress(drawCtx, canvasW, canvasH, 0.3, distressSeed));
          },
          {
            bleed: INK_PALETTE.red,
            text: !0,
          },
        ),
      hazard_voltage: () =>
        buildCanvasDecal(
          'hazard_voltage',
          256,
          256,
          (canvas2d, texW, texH, rnd) => {
            (drawHazardTriangle(canvas2d, texW, texH, toRgba(INK_PALETTE.yellow)),
              (canvas2d.fillStyle = toRgba(INK_PALETTE.black)),
              canvas2d.save(),
              canvas2d.translate(texW / 2, texH * 0.56),
              canvas2d.beginPath(),
              [
                [12, -58],
                [-24, 4],
                [-3, 4],
                [-16, 50],
                [26, -14],
                [5, -14],
                [22, -58],
              ].forEach((boltPt, ptIdx) =>
                ptIdx
                  ? canvas2d.lineTo(boltPt[0], boltPt[1])
                  : canvas2d.moveTo(boltPt[0], boltPt[1]),
              ),
              canvas2d.closePath(),
              canvas2d.fill(),
              canvas2d.restore(),
              applyCanvasDistress(canvas2d, texW, texH, 0.3, rnd));
          },
          {
            bleed: INK_PALETTE.yellow,
          },
        ),
      hazard_general: () =>
        buildCanvasDecal(
          'hazard_general',
          256,
          256,
          (drawCtx, canvasW, canvasH, rnd) => {
            (drawHazardTriangle(drawCtx, canvasW, canvasH, toRgba(INK_PALETTE.yellow)),
              (drawCtx.fillStyle = toRgba(INK_PALETTE.black)),
              drawCtx.beginPath(),
              drawCtx.moveTo(canvasW / 2 - 13, canvasH * 0.34),
              drawCtx.lineTo(canvasW / 2 + 13, canvasH * 0.34),
              drawCtx.lineTo(canvasW / 2 + 7, canvasH * 0.62),
              drawCtx.lineTo(canvasW / 2 - 7, canvasH * 0.62),
              drawCtx.closePath(),
              drawCtx.fill(),
              drawCtx.beginPath(),
              drawCtx.arc(canvasW / 2, canvasH * 0.715, 11, 0, 7),
              drawCtx.fill(),
              applyCanvasDistress(drawCtx, canvasW, canvasH, 0.3, rnd));
          },
          {
            bleed: INK_PALETTE.yellow,
          },
        ),
      arrow: () =>
        buildCanvasDecal(
          'arrow',
          384,
          192,
          (drawCtx, canvasW, canvasH, randFn) => {
            ((drawCtx.fillStyle = toRgba(INK_PALETTE.white)),
              drawCtx.beginPath(),
              [
                [20, 68],
                [226, 68],
                [226, 22],
                [364, 96],
                [226, 170],
                [226, 124],
                [20, 124],
              ].forEach((arrowPt, ptIdx) =>
                ptIdx
                  ? drawCtx.lineTo(arrowPt[0], arrowPt[1])
                  : drawCtx.moveTo(arrowPt[0], arrowPt[1]),
              ),
              drawCtx.closePath(),
              drawCtx.fill(),
              (drawCtx.globalCompositeOperation = 'destination-out'),
              drawCtx.fillRect(118, 0, 9, canvasH),
              drawCtx.fillRect(232, 0, 7, canvasH),
              (drawCtx.globalCompositeOperation = 'source-over'),
              applyCanvasDistress(drawCtx, canvasW, canvasH, 0.5, randFn));
          },
          {
            bleed: INK_PALETTE.white,
          },
        ),
      no_entry: () =>
        buildCanvasDecal(
          'no_entry',
          256,
          256,
          (v, g, x, y) => {
            ((v.fillStyle = toRgba(INK_PALETTE.white)),
              v.beginPath(),
              v.arc(128, 128, 112, 0, 7),
              v.fill(),
              (v.fillStyle = toRgba(INK_PALETTE.red)),
              v.beginPath(),
              v.arc(128, 128, 102, 0, 7),
              v.fill(),
              (v.fillStyle = toRgba(INK_PALETTE.white)),
              v.fillRect(52, 106, 152, 44),
              applyCanvasDistress(v, g, x, 0.3, y));
          },
          {
            bleed: INK_PALETTE.red,
          },
        ),
      logo_a: () =>
        buildCanvasDecal(
          'logo_a',
          640,
          192,
          (drawCtx, canvasW, canvasH, distressSeed) => {
            (drawLogoLockup(
              drawCtx,
              canvasW,
              canvasH,
              INK_PALETTE.white,
              (logoCtx, logoRadius, logoAux) => {
                ((logoCtx.lineWidth = logoRadius * 0.13),
                  logoCtx.beginPath(),
                  logoCtx.arc(0, 0, logoRadius * 0.92, 0.25 * Math.PI, 1.75 * Math.PI),
                  logoCtx.stroke(),
                  logoCtx.beginPath(),
                  logoCtx.moveTo(0, -logoRadius * 1.08),
                  logoCtx.lineTo(logoRadius * 0.26, 0),
                  logoCtx.lineTo(0, logoRadius * 0.62),
                  logoCtx.lineTo(-logoRadius * 0.26, 0),
                  logoCtx.closePath(),
                  logoCtx.fill(),
                  logoCtx.beginPath(),
                  logoCtx.moveTo(logoRadius * 0.5, 0),
                  logoCtx.lineTo(logoRadius * 1.12, -logoRadius * 0.1),
                  logoCtx.lineTo(logoRadius * 1.12, logoRadius * 0.1),
                  logoCtx.closePath(),
                  logoCtx.fill());
              },
              'NORDKAP LINE',
              'ARCTIC  \xB7  ATLANTIC  \xB7  FEEDER',
            ),
              applyCanvasDistress(drawCtx, canvasW, canvasH, 0.35, distressSeed));
          },
          {
            bleed: INK_PALETTE.white,
            text: !0,
          },
        ),
      logo_b: () =>
        buildCanvasDecal(
          'logo_b',
          640,
          192,
          (g2d, canvasW, canvasH, rand) => {
            (drawLogoLockup(
              g2d,
              canvasW,
              canvasH,
              INK_PALETTE.white,
              (markCtx, markScale, markColor) => {
                markCtx.fillStyle = markColor;
                for (let waveIndex = 0; waveIndex < 2; waveIndex++) {
                  let waveY = -markScale * 0.35 + waveIndex * markScale * 0.55,
                    waveAmp = markScale * (0.3 - waveIndex * 0.06);
                  (markCtx.beginPath(),
                    markCtx.moveTo(-markScale * 1.05, waveY - markScale * 0.25),
                    markCtx.quadraticCurveTo(
                      -markScale * 0.3,
                      waveY - markScale * 0.2,
                      0,
                      waveY + markScale * 0.35,
                    ),
                    markCtx.quadraticCurveTo(
                      markScale * 0.3,
                      waveY - markScale * 0.2,
                      markScale * 1.05,
                      waveY - markScale * 0.25,
                    ),
                    markCtx.quadraticCurveTo(
                      markScale * 0.35,
                      waveY + waveAmp * 0.2,
                      0,
                      waveY + markScale * 0.35 + waveAmp,
                    ),
                    markCtx.quadraticCurveTo(
                      -markScale * 0.35,
                      waveY + waveAmp * 0.2,
                      -markScale * 1.05,
                      waveY - markScale * 0.25,
                    ),
                    markCtx.fill());
                }
              },
              'TERN OCEANIC',
              'CONTAINER SERVICES',
              INK_PALETTE.orange,
            ),
              applyCanvasDistress(g2d, canvasW, canvasH, 0.35, rand));
          },
          {
            bleed: INK_PALETTE.white,
            text: !0,
          },
        ),
      logo_c: () =>
        buildCanvasDecal(
          'logo_c',
          640,
          192,
          (decalId, canvasW, canvasH, drawFn) => {
            (drawLogoLockup(
              decalId,
              canvasW,
              canvasH,
              INK_PALETTE.navy,
              (markCtx, markSize, markOpts) => {
                (markCtx.beginPath(),
                  markCtx.arc(0, markSize * 0.25, markSize * 0.55, Math.PI, 0),
                  markCtx.closePath(),
                  markCtx.fill(),
                  (markCtx.lineWidth = markSize * 0.1),
                  (markCtx.lineCap = 'butt'));
                for (let spokeIdx = 0; spokeIdx < 7; spokeIdx++) {
                  let spokeAngle = Math.PI + ((spokeIdx + 0.5) / 7) * Math.PI;
                  (markCtx.beginPath(),
                    markCtx.moveTo(
                      Math.cos(spokeAngle) * markSize * 0.7,
                      markSize * 0.25 + Math.sin(spokeAngle) * markSize * 0.7,
                    ),
                    markCtx.lineTo(
                      Math.cos(spokeAngle) * markSize * 1.05,
                      markSize * 0.25 + Math.sin(spokeAngle) * markSize * 1.05,
                    ),
                    markCtx.stroke());
                }
                (markCtx.fillRect(
                  -markSize * 1.05,
                  markSize * 0.42,
                  markSize * 2.1,
                  markSize * 0.13,
                ),
                  markCtx.fillRect(
                    -markSize * 0.8,
                    markSize * 0.68,
                    markSize * 1.6,
                    markSize * 0.1,
                  ));
              },
              'AUREL PACIFIC',
              'DEEP SEA  \xB7  REEFER  \xB7  BULK',
            ),
              applyCanvasDistress(decalId, canvasW, canvasH, 0.35, drawFn));
          },
          {
            bleed: INK_PALETTE.navy,
            text: !0,
          },
        ),
      logo_d: () =>
        buildCanvasDecal(
          'logo_d',
          640,
          192,
          (c2d, canvasW, canvasH, distressSeed) => {
            (drawLogoLockup(
              c2d,
              canvasW,
              canvasH,
              INK_PALETTE.white,
              (markCtx, markHalfSize, accentColor) => {
                (markCtx.fillRect(
                  -markHalfSize,
                  -markHalfSize,
                  markHalfSize * 0.5,
                  markHalfSize * 2,
                ),
                  markCtx.fillRect(
                    markHalfSize * 0.5,
                    -markHalfSize,
                    markHalfSize * 0.5,
                    markHalfSize * 2,
                  ),
                  markCtx.fillRect(
                    -markHalfSize,
                    -markHalfSize * 0.2,
                    markHalfSize * 2,
                    markHalfSize * 0.4,
                  ),
                  (markCtx.fillStyle = accentColor),
                  markCtx.fillRect(
                    -markHalfSize * 0.32,
                    -markHalfSize,
                    markHalfSize * 0.64,
                    markHalfSize * 0.5,
                  ),
                  markCtx.fillRect(
                    -markHalfSize * 0.32,
                    markHalfSize * 0.5,
                    markHalfSize * 0.64,
                    markHalfSize * 0.5,
                  ));
              },
              'HOLMGARD',
              'INTERMODAL  FREIGHT',
              INK_PALETTE.yellow,
            ),
              applyCanvasDistress(c2d, canvasW, canvasH, 0.35, distressSeed));
          },
          {
            bleed: INK_PALETTE.white,
            text: !0,
          },
        ),
      berth4: () =>
        buildCanvasDecal(
          'berth4',
          640,
          224,
          (c2d, canvasW, canvasH, distressSeed) => {
            ((c2d.strokeStyle = toRgba(INK_PALETTE.yellow)),
              (c2d.lineWidth = 12),
              c2d.strokeRect(14, 14, canvasW - 28, canvasH - 28),
              (c2d.globalCompositeOperation = 'destination-out'));
            for (let cutX of [canvasW * 0.25, canvasW * 0.75])
              c2d.fillRect(cutX - 6, 0, 12, canvasH);
            ((c2d.globalCompositeOperation = 'source-over'),
              drawStencilRun(
                c2d,
                'BERTH 4',
                canvasW / 2,
                canvasH * 0.76,
                canvasH * 0.66,
                toRgba(INK_PALETTE.yellow),
                {
                  align: 'center',
                  weight: 900,
                  maxW: canvasW - 80,
                },
              ),
              applyCanvasDistress(c2d, canvasW, canvasH, 0.55, distressSeed));
          },
          {
            bleed: INK_PALETTE.yellow,
            text: !0,
          },
        ),
      caution_stripes: () =>
        buildCanvasDecal(
          'caution_stripes',
          512,
          128,
          (g2d, canvasW, canvasH, rng) => {
            ((g2d.fillStyle = toRgba(INK_PALETTE.black)),
              g2d.fillRect(0, 8, canvasW, canvasH - 16),
              g2d.save(),
              g2d.beginPath(),
              g2d.rect(0, 8, canvasW, canvasH - 16),
              g2d.clip(),
              (g2d.fillStyle = toRgba(INK_PALETTE.yellow)));
            for (let stripeX = -canvasH; stripeX < canvasW + canvasH; stripeX += 64)
              (g2d.beginPath(),
                g2d.moveTo(stripeX, canvasH),
                g2d.lineTo(stripeX + 32, canvasH),
                g2d.lineTo(stripeX + 32 + canvasH, 0),
                g2d.lineTo(stripeX + canvasH, 0),
                g2d.closePath(),
                g2d.fill());
            (g2d.restore(), applyCanvasDistress(g2d, canvasW, canvasH, 0.5, rng));
          },
          {
            bleed: INK_PALETTE.black,
          },
        ),
      grime_streak: () =>
        buildCanvasDecal(
          'grime_streak',
          128,
          256,
          (g2d, canvasW, canvasH, rand) => {
            for (let streakIndex = 0; streakIndex < 46; streakIndex++) {
              let streakX = canvasW * (0.12 + 0.76 * (rand() * 0.5 + rand() * 0.5)),
                streakLen = canvasH * (0.25 + rand() * 0.7),
                streakWidth = 1.5 + rand() * rand() * 12,
                alphaMax = 0.05 + rand() * 0.16,
                streakGrad = g2d.createLinearGradient(0, 0, 0, streakLen);
              (streakGrad.addColorStop(0, `rgba(26,23,19,${alphaMax})`),
                streakGrad.addColorStop(0.15, `rgba(26,23,19,${alphaMax * 1.3})`),
                streakGrad.addColorStop(1, 'rgba(26,23,19,0)'),
                (g2d.fillStyle = streakGrad),
                g2d.fillRect(
                  streakX - streakWidth / 2 + (rand() - 0.5) * 2,
                  0,
                  streakWidth,
                  streakLen,
                ));
            }
          },
          {
            rough: 0.85,
            bleed: [26, 23, 19],
          },
        ),
      rust_run: () =>
        buildCanvasDecal(
          'rust_run',
          128,
          256,
          (g2d, canvasW, canvasH, rand) => {
            for (let streakIndex = 0; streakIndex < 40; streakIndex++) {
              let streakX = canvasW * (0.2 + 0.6 * (rand() * 0.5 + rand() * 0.5)),
                streakLen = canvasH * (0.2 + rand() * 0.75),
                streakWidth = 1.2 + rand() * rand() * 9,
                alphaMax = 0.08 + rand() * 0.22,
                rustColor = rand() < 0.5 ? '118,52,18' : '150,78,26',
                streakGrad = g2d.createLinearGradient(0, 8, 0, streakLen);
              (streakGrad.addColorStop(0, `rgba(${rustColor},${alphaMax * 1.4})`),
                streakGrad.addColorStop(0.3, `rgba(${rustColor},${alphaMax})`),
                streakGrad.addColorStop(1, `rgba(${rustColor},0)`),
                (g2d.fillStyle = streakGrad),
                g2d.fillRect(streakX - streakWidth / 2, 8, streakWidth, streakLen));
            }
            for (let streakIndex = 0; streakIndex < 9; streakIndex++)
              ((g2d.fillStyle = `rgba(${rand() < 0.5 ? '70,30,14' : '104,44,16'},${0.5 + rand() * 0.4})`),
                traceBlobPath(
                  g2d,
                  canvasW * (0.3 + rand() * 0.4),
                  6 + rand() * 12,
                  3 + rand() * 8,
                  rand,
                  0.5,
                  7,
                ),
                g2d.fill());
          },
          {
            rough: 0.9,
            bleed: [118, 52, 18],
          },
        ),
      oil_stain: () =>
        buildCanvasDecal(
          'oil_stain',
          256,
          256,
          (canvas2d, texW, texH, rnd) => {
            for (let blobIdx = 0; blobIdx < 26; blobIdx++) {
              let angle = rnd() * 7,
                radius = Math.pow(rnd(), 1.5) * texW * 0.26,
                cx = texW / 2 + Math.cos(angle) * radius,
                cy = texH / 2 + Math.sin(angle) * radius * 0.8,
                blobR = texW * (0.06 + rnd() * 0.16),
                grad = canvas2d.createRadialGradient(cx, cy, blobR * 0.2, cx, cy, blobR);
              (grad.addColorStop(0, `rgba(10,10,11,${0.35 + rnd() * 0.3})`),
                grad.addColorStop(0.75, 'rgba(12,11,10,0.22)'),
                grad.addColorStop(1, 'rgba(12,11,10,0)'),
                (canvas2d.fillStyle = grad),
                canvas2d.fillRect(cx - blobR, cy - blobR, blobR * 2, blobR * 2));
            }
            for (let blobIdx = 0; blobIdx < 30; blobIdx++) {
              canvas2d.fillStyle = `rgba(10,10,11,${0.3 + rnd() * 0.4})`;
              let angle = rnd() * 7,
                radius = texW * (0.25 + rnd() * 0.2);
              (canvas2d.beginPath(),
                canvas2d.arc(
                  texW / 2 + Math.cos(angle) * radius,
                  texH / 2 + Math.sin(angle) * radius,
                  1 + rnd() * 4,
                  0,
                  7,
                ),
                canvas2d.fill());
            }
          },
          {
            rough: 0.12,
            bleed: [10, 10, 11],
          },
        ),
      leak_stain: () =>
        buildCanvasDecal(
          'leak_stain',
          192,
          256,
          (drawCtx, canvasW, canvasH, rnd) => {
            for (let blobIndex = 0; blobIndex < 18; blobIndex++) {
              let centerX = canvasW * (0.3 + rnd() * 0.4),
                centerY = canvasH * (0.12 + rnd() * 0.2),
                blobRadius = canvasW * (0.1 + rnd() * 0.2),
                gradient = drawCtx.createRadialGradient(
                  centerX,
                  centerY,
                  blobRadius * 0.5,
                  centerX,
                  centerY,
                  blobRadius,
                );
              (gradient.addColorStop(0, 'rgba(150,146,130,0.0)'),
                gradient.addColorStop(0.8, `rgba(168,162,140,${0.18 + rnd() * 0.2})`),
                gradient.addColorStop(1, 'rgba(168,162,140,0)'),
                (drawCtx.fillStyle = gradient),
                drawCtx.fillRect(
                  centerX - blobRadius,
                  centerY - blobRadius,
                  blobRadius * 2,
                  blobRadius * 2,
                ));
            }
            for (let blobIndex = 0; blobIndex < 22; blobIndex++) {
              let centerX = canvasW * (0.25 + 0.5 * rnd()),
                centerY = canvasH * (0.3 + rnd() * 0.6),
                blobRadius = 2 + rnd() * 9,
                gradient = 0.08 + rnd() * 0.16,
                stainColorStr = rnd() < 0.6 ? '160,154,132' : '60,66,52',
                dripGradient = drawCtx.createLinearGradient(
                  0,
                  canvasH * 0.2,
                  0,
                  canvasH * 0.2 + centerY,
                );
              (dripGradient.addColorStop(0, `rgba(${stainColorStr},${gradient})`),
                dripGradient.addColorStop(1, `rgba(${stainColorStr},0)`),
                (drawCtx.fillStyle = dripGradient),
                drawCtx.fillRect(centerX, canvasH * 0.2, blobRadius, centerY));
            }
          },
          {
            rough: 0.8,
            bleed: [160, 154, 132],
          },
        ),
      bullet_metal: () =>
        buildCanvasDecal(
          'bullet_metal',
          128,
          128,
          (drawCtx, canvasW, canvasH, rnd) => {
            ((drawCtx.fillStyle = 'rgba(96,52,40,0.9)'),
              traceBlobPath(drawCtx, 64, 64, 30, rnd, 0.4, 11),
              drawCtx.fill(),
              (drawCtx.fillStyle = 'rgba(150,152,156,0.95)'),
              traceBlobPath(drawCtx, 64, 64, 22, rnd, 0.3, 12),
              drawCtx.fill(),
              (drawCtx.strokeStyle = 'rgba(205,207,210,0.9)'),
              (drawCtx.lineWidth = 1));
            for (let rayIndex = 0; rayIndex < 14; rayIndex++) {
              let angle = rnd() * 7;
              (drawCtx.beginPath(),
                drawCtx.moveTo(64 + Math.cos(angle) * 9, 64 + Math.sin(angle) * 9),
                drawCtx.lineTo(
                  64 + Math.cos(angle) * (16 + rnd() * 10),
                  64 + Math.sin(angle) * (16 + rnd() * 10),
                ),
                drawCtx.stroke());
            }
            let coreGradient = drawCtx.createRadialGradient(64, 64, 2, 64, 64, 12);
            (coreGradient.addColorStop(0, 'rgba(4,4,5,1)'),
              coreGradient.addColorStop(0.75, 'rgba(10,10,12,1)'),
              coreGradient.addColorStop(1, 'rgba(70,72,76,0.9)'),
              (drawCtx.fillStyle = coreGradient),
              traceBlobPath(drawCtx, 64, 64, 12, rnd, 0.15, 12),
              drawCtx.fill(),
              (drawCtx.strokeStyle = 'rgba(230,232,235,0.85)'),
              (drawCtx.lineWidth = 1.5),
              drawCtx.beginPath(),
              drawCtx.arc(64, 64, 12.5, 3.6, 5.6),
              drawCtx.stroke());
          },
          {
            rough: 0.4,
            metal: 0.8,
            bleed: [96, 52, 40],
          },
        ),
      bullet_concrete: () =>
        buildCanvasDecal(
          'bullet_concrete',
          128,
          128,
          (drawCtx, canvasW, canvasH, randFn) => {
            let sprayGrad = drawCtx.createRadialGradient(64, 64, 20, 64, 64, 60);
            (sprayGrad.addColorStop(0, 'rgba(176,172,162,0.5)'),
              sprayGrad.addColorStop(1, 'rgba(176,172,162,0)'),
              (drawCtx.fillStyle = sprayGrad),
              drawCtx.fillRect(0, 0, canvasW, canvasH),
              (drawCtx.fillStyle = 'rgba(168,164,154,0.95)'),
              traceBlobPath(drawCtx, 64, 64, 32, randFn, 0.35, 13),
              drawCtx.fill(),
              (drawCtx.fillStyle = 'rgba(120,116,108,0.95)'),
              traceBlobPath(drawCtx, 65, 66, 20, randFn, 0.35, 11),
              drawCtx.fill(),
              (drawCtx.strokeStyle = 'rgba(40,38,36,0.8)'),
              (drawCtx.lineWidth = 1));
            for (let crackIdx = 0; crackIdx < 6; crackIdx++) {
              let startAngle = randFn() * 7,
                crackX = 64 + Math.cos(startAngle) * 14,
                crackY = 64 + Math.sin(startAngle) * 14;
              (drawCtx.beginPath(), drawCtx.moveTo(crackX, crackY));
              for (let segIdx = 0; segIdx < 5; segIdx++)
                ((startAngle += (randFn() - 0.5) * 0.9),
                  (crackX += Math.cos(startAngle) * 8),
                  (crackY += Math.sin(startAngle) * 8),
                  drawCtx.lineTo(crackX, crackY));
              drawCtx.stroke();
            }
            let holeGrad = drawCtx.createRadialGradient(64, 64, 1, 64, 64, 11);
            (holeGrad.addColorStop(0, 'rgba(18,17,16,1)'),
              holeGrad.addColorStop(1, 'rgba(60,58,54,0.95)'),
              (drawCtx.fillStyle = holeGrad),
              traceBlobPath(drawCtx, 64, 64, 10, randFn, 0.3, 9),
              drawCtx.fill());
            for (let crackIdx = 0; crackIdx < 40; crackIdx++) {
              drawCtx.fillStyle = `rgba(${randFn() < 0.5 ? '90,86,80' : '190,186,176'},0.8)`;
              let startAngle = randFn() * 7,
                crackX = 10 + randFn() * 24;
              drawCtx.fillRect(
                64 + Math.cos(startAngle) * crackX,
                64 + Math.sin(startAngle) * crackX,
                1 + randFn() * 2,
                1 + randFn() * 2,
              );
            }
          },
          {
            rough: 0.95,
            bleed: [168, 164, 154],
          },
        ),
      scorch: () =>
        buildCanvasDecal(
          'scorch',
          256,
          256,
          (drawCtx, canvasW, canvasH, randFn) => {
            for (let blobIdx = 0; blobIdx < 40; blobIdx++) {
              let blobAngle = randFn() * 7,
                blobRadius = Math.pow(randFn(), 1.2) * canvasW * 0.3,
                blobX = canvasW / 2 + Math.cos(blobAngle) * blobRadius,
                blobY = canvasH / 2 + Math.sin(blobAngle) * blobRadius,
                blobSize =
                  canvasW * (0.07 + randFn() * 0.15) * (1.2 - blobRadius / (canvasW * 0.4)),
                blobGrad = drawCtx.createRadialGradient(
                  blobX,
                  blobY,
                  0,
                  blobX,
                  blobY,
                  Math.max(4, blobSize),
                );
              (blobGrad.addColorStop(0, `rgba(8,7,6,${0.3 + randFn() * 0.3})`),
                blobGrad.addColorStop(1, 'rgba(8,7,6,0)'),
                (drawCtx.fillStyle = blobGrad),
                drawCtx.fillRect(0, 0, canvasW, canvasH));
            }
            drawCtx.strokeStyle = 'rgba(8,7,6,0.25)';
            for (let blobIdx = 0; blobIdx < 50; blobIdx++) {
              let blobAngle = randFn() * 7,
                blobRadius = canvasW * 0.1,
                blobX = canvasW * (0.25 + randFn() * 0.22);
              ((drawCtx.lineWidth = 1 + randFn() * 3),
                drawCtx.beginPath(),
                drawCtx.moveTo(
                  canvasW / 2 + Math.cos(blobAngle) * blobRadius,
                  canvasH / 2 + Math.sin(blobAngle) * blobRadius,
                ),
                drawCtx.lineTo(
                  canvasW / 2 + Math.cos(blobAngle) * blobX,
                  canvasH / 2 + Math.sin(blobAngle) * blobX,
                ),
                drawCtx.stroke());
            }
          },
          {
            rough: 0.95,
            bleed: [8, 7, 6],
          },
        ),
      crack: () =>
        buildCanvasDecal(
          'crack',
          256,
          256,
          (canvas2d, texW, texH, rnd) => {
            ((canvas2d.lineCap = 'round'), (canvas2d.lineJoin = 'round'));
            let drawCrack = (startX, startY, angle, length, strokeW, branchDepth) => {
              ((canvas2d.strokeStyle = `rgba(20,19,18,${0.6 + 0.35 * Math.min(1, strokeW / 2.5)})`),
                (canvas2d.lineWidth = strokeW),
                canvas2d.beginPath(),
                canvas2d.moveTo(startX, startY));
              let segCount = Math.floor(length / 9);
              for (let segIdx = 0; segIdx < segCount; segIdx++)
                ((angle += (rnd() - 0.5) * 0.8),
                  (startX += Math.cos(angle) * 9),
                  (startY += Math.sin(angle) * 9),
                  canvas2d.lineTo(startX, startY),
                  branchDepth > 0 &&
                    rnd() < 0.22 &&
                    (canvas2d.stroke(),
                    drawCrack(
                      startX,
                      startY,
                      angle + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.7),
                      length * (0.3 + rnd() * 0.3),
                      strokeW * 0.6,
                      branchDepth - 1,
                    ),
                    (canvas2d.strokeStyle = `rgba(20,19,18,${0.6 + 0.35 * Math.min(1, strokeW / 2.5)})`),
                    (canvas2d.lineWidth = strokeW),
                    canvas2d.beginPath(),
                    canvas2d.moveTo(startX, startY)));
              canvas2d.stroke();
            };
            (drawCrack(texW * 0.5, texH * 0.5, rnd() * 7, texW * 0.42, 2.6, 3),
              drawCrack(texW * 0.5, texH * 0.5, rnd() * 7 + 2, texW * 0.4, 2.2, 3),
              drawCrack(texW * 0.5, texH * 0.5, rnd() * 7 + 4, texW * 0.36, 1.8, 2));
          },
          {
            rough: 0.95,
            bleed: [20, 19, 18],
          },
        ),
      graffiti_tag: () =>
        buildCanvasDecal(
          'graffiti_tag',
          384,
          256,
          (g2d, canvasW, canvasH, rng) => {
            ((g2d.lineCap = 'round'), (g2d.lineJoin = 'round'));
            let strokePath = (angle, length, strokeW) => {
                ((g2d.strokeStyle = strokeW),
                  (g2d.lineWidth = length),
                  g2d.beginPath(),
                  g2d.moveTo(angle[0][0], angle[0][1]));
                for (let branchDepth = 1; branchDepth < angle.length - 1; branchDepth += 2)
                  g2d.quadraticCurveTo(
                    angle[branchDepth][0],
                    angle[branchDepth][1],
                    angle[branchDepth + 1][0],
                    angle[branchDepth + 1][1],
                  );
                g2d.stroke();
              },
              inkColor = 'rgba(206,214,208,0.92)',
              tagStrokes = [
                [
                  [40, 60],
                  [36, 130],
                  [48, 200],
                  [70, 150],
                  [44, 128],
                  [80, 110],
                  [104, 70],
                ],
                [
                  [104, 70],
                  [76, 140],
                  [108, 190],
                  [150, 200],
                  [150, 110],
                  [140, 60],
                  [112, 84],
                ],
                [
                  [168, 196],
                  [172, 120],
                  [186, 62],
                  [200, 110],
                  [226, 92],
                  [214, 150],
                  [236, 196],
                ],
                [
                  [250, 76],
                  [300, 60],
                  [318, 66],
                  [282, 110],
                  [262, 178],
                  [300, 200],
                  [334, 176],
                ],
              ];
            for (let pts of tagStrokes)
              (strokePath(pts, 12, 'rgba(206,214,208,0.25)'), strokePath(pts, 7, inkColor));
            (strokePath(
              [
                [30, 222],
                [180, 236],
                [352, 206],
              ],
              5,
              inkColor,
            ),
              strokePath(
                [
                  [330, 40],
                  [344, 30],
                  [356, 44],
                ],
                5,
                inkColor,
              ));
            for (let pts = 0; pts < 7; pts++) {
              let lineW = 50 + rng() * 290,
                strokeCol = 150 + rng() * 50,
                segIdx = 12 + rng() * 46,
                dripGrad = g2d.createLinearGradient(0, strokeCol, 0, strokeCol + segIdx);
              (dripGrad.addColorStop(0, inkColor),
                dripGrad.addColorStop(1, 'rgba(206,214,208,0)'),
                (g2d.fillStyle = dripGrad),
                g2d.fillRect(lineW, strokeCol, 2 + rng() * 2, segIdx));
            }
            for (let pts = 0; pts < 260; pts++)
              ((g2d.fillStyle = `rgba(206,214,208,${rng() * 0.5})`),
                g2d.fillRect(30 + rng() * 330, 40 + rng() * 190, 1.2, 1.2));
            applyCanvasDistress(g2d, canvasW, canvasH, 0.25, rng);
          },
          {
            rough: 0.6,
            bleed: [206, 214, 208],
          },
        ),
      csc_plate: () =>
        buildCanvasDecal(
          'csc_plate',
          288,
          200,
          (canvas2d, plateW, plateH, rnd) => {
            let plateGrad = canvas2d.createLinearGradient(0, 0, plateW, plateH);
            (plateGrad.addColorStop(0, 'rgb(150,152,150)'),
              plateGrad.addColorStop(0.5, 'rgb(176,178,176)'),
              plateGrad.addColorStop(1, 'rgb(138,140,138)'),
              (canvas2d.fillStyle = plateGrad),
              canvas2d.beginPath(),
              canvas2d.roundRect
                ? canvas2d.roundRect(3, 3, plateW - 6, plateH - 6, 8)
                : canvas2d.rect(3, 3, plateW - 6, plateH - 6),
              canvas2d.fill(),
              (canvas2d.strokeStyle = 'rgba(40,42,44,0.8)'),
              (canvas2d.lineWidth = 2),
              canvas2d.strokeRect(11, 11, plateW - 22, plateH - 22));
            for (let [boltX, boltY] of [
              [20, 20],
              [plateW - 20, 20],
              [20, plateH - 20],
              [plateW - 20, plateH - 20],
            ])
              ((canvas2d.fillStyle = 'rgb(96,98,98)'),
                canvas2d.beginPath(),
                canvas2d.arc(boltX, boltY, 5, 0, 7),
                canvas2d.fill(),
                (canvas2d.fillStyle = 'rgba(230,232,232,0.7)'),
                canvas2d.beginPath(),
                canvas2d.arc(boltX - 1.2, boltY - 1.2, 2, 0, 7),
                canvas2d.fill());
            let inkColor = 'rgba(28,30,32,0.92)';
            (drawStencilRun(canvas2d, 'SAFETY APPROVAL PLATE', plateW / 2, 46, 19, inkColor, {
              font: 'sans',
              weight: 600,
              align: 'center',
              spacing: 1.5,
              maxW: plateW - 60,
            }),
              [
                'APPROVAL REF   SL/PA-4207/19',
                'DATE MANUFACTURED   03/2019',
                'IDENT NO   SLTU 402719 6',
                'MAX GROSS   30 480 KG',
                'STACKING LOAD   192 000 KG',
                'RACKING TEST   150 KN',
                'NEXT EXAM   09/2027',
              ].forEach((boltX, boltY) => {
                (drawStencilRun(canvas2d, boltX, 30, 70 + boltY * 16.5, 11, inkColor, {
                  font: 'mono',
                  weight: 500,
                  spacing: 0,
                  maxW: plateW - 60,
                }),
                  (canvas2d.fillStyle = 'rgba(28,30,32,0.35)'),
                  canvas2d.fillRect(30, 73 + boltY * 16.5, plateW - 60, 1));
              }),
              (canvas2d.fillStyle = 'rgba(60,40,24,0.25)'));
            for (let boltX = 0; boltX < 30; boltX++)
              (traceBlobPath(canvas2d, rnd() * plateW, rnd() * plateH, 2 + rnd() * 9, rnd, 0.5, 7),
                canvas2d.fill());
          },
          {
            rough: 0.45,
            metal: 0.75,
            text: !0,
          },
        ),
      numbers_0_9: () =>
        buildCanvasDecal(
          'numbers_0_9',
          640,
          128,
          (v, g, x, y) => {
            for (let b = 0; b < 10; b++)
              drawStencilRun(
                v,
                String(b),
                b * 64 + 32,
                x * 0.86,
                x * 0.92,
                toRgba(INK_PALETTE.white),
                {
                  align: 'center',
                  weight: 900,
                  maxW: 54,
                },
              );
            applyCanvasDistress(v, g, x, 0.3, y);
          },
          {
            bleed: INK_PALETTE.white,
            text: !0,
          },
        ),
    },
    decalNames = Object.keys(DECAL_RECIPES),
    warnedNames = new Set();
  function getDecal(v) {
    let g = cache.get('d:' + v);
    if (g) return g;
    let x = DECAL_RECIPES[v];
    if (!x)
      (warnedNames.has(v) || (warnedNames.add(v), console.warn(`[mats] unknown decal "${v}"`)),
        (g = getDecal('grime_streak')));
    else {
      let y = x();
      ((g = {
        material: y.material,
        aspect: y.aspect,
      }),
        (g.material.name = 'decal_' + v));
    }
    return (cache.set('d:' + v, g), g);
  }
  function getDigit(v) {
    let g = 'n:' + v,
      idxA = cache.get(g);
    if (idxA) return idxA;
    let idxB = getDecal('numbers_0_9').material,
      idxC = idxB.map.clone();
    (idxC.repeat.set(0.1, 1),
      idxC.offset.set((Math.abs(v | 0) % 10) / 10, 0),
      (idxC.needsUpdate = !0));
    let ax = idxB.clone();
    return (
      (ax.map = idxC),
      fontRefreshers.push(() => {
        idxC.needsUpdate = !0;
      }),
      (idxA = {
        material: ax,
        aspect: 0.5,
      }),
      cache.set(g, idxA),
      idxA
    );
  }
  function getLabel(v, g = {}) {
    v = String(v === void 0 ? '' : v).toUpperCase() || ' ';
    let x = INK_PALETTE[g.color] ? g.color : 'white',
      y = g.font === 'sans' ? 'sans' : 'stencil',
      b = g.distress !== void 0 ? +g.distress : 0.35,
      m = `l:${v}|${x}|${y}|${b}`,
      A = cache.get(m);
    if (A) return A;
    let _ = 128,
      M = 100,
      E = createCanvas(4, 4).getContext('2d'),
      w = y === 'sans' ? FONT_STACK_SANS : FONT_STACK_DISPLAY,
      S = y === 'sans' ? 600 : 700,
      z = M * 0.06,
      H = measureRunWidth(E, v, M, w, S, z),
      O = Math.min(1, 2e3 / (H + 32)),
      q = Math.max(48, Math.ceil((H + 32) * O)),
      U = Math.ceil(_ * O),
      T = buildCanvasDecal(
        m,
        q,
        U,
        (D, C, G, j) => {
          (D.save(),
            D.scale(O, O),
            drawStencilRun(D, v, 16, _ * 0.84, M, toRgba(INK_PALETTE[x]), {
              font: y,
              weight: S,
              spacing: z,
              fitW: H,
            }),
            D.restore(),
            applyCanvasDistress(D, C, G, b, j));
        },
        {
          bleed: INK_PALETTE[x],
          text: !0,
          rough: 0.65,
        },
      );
    return (
      (A = {
        material: T.material,
        aspect: T.aspect,
      }),
      (A.material.name = 'label'),
      cache.set(m, A),
      A
    );
  }
  try {
    if (typeof document < 'u' && document.fonts && document.fonts.load) {
      let canvas2dContext = 0,
        canvasWidth = () => {
          canvas2dContext = 0;
          for (let x of fontRefreshers)
            try {
              x();
            } catch {}
        };
      for (let canvasHeight of [
        '700 20px "Big Shoulders Display"',
        '900 20px "Big Shoulders Display"',
        '600 20px "Barlow Condensed"',
        '500 20px "IBM Plex Mono"',
      ])
        document.fonts.load(canvasHeight).then(
          (decalRand) => {
            decalRand &&
              decalRand.length &&
              !canvas2dContext &&
              (canvas2dContext = setTimeout(canvasWidth, 120));
          },
          () => {},
        );
    }
  } catch {}
  return {
    decal: getDecal,
    label: getLabel,
    number: getDigit,
    names: decalNames,
    bytes: () => bytes,
  };
}

/**
 * 4 个箱主 logo 贴花名，配给箱体非门侧那面
 */
export var CONTAINER_LOGO_DECALS = ['logo_a', 'logo_b', 'logo_c', 'logo_d'];

/**
 * 6 个可贴在标志牌上的警示图标贴花名（危险/禁入/高压/泊位/箭头/易燃），作为随机取用的白名单
 */
export var SIGN_DECAL_NAMES = [
  'hazard_general',
  'no_entry',
  'hazard_voltage',
  'berth4',
  'arrow',
  'hazard_flammable',
];

/**
 * 铭牌图集每张贴图四周保留的像素边距，防止 mipmap 采样时相邻铭牌互相串色
 */
export var LABEL_ATLAS_GUTTER = 4;

/**
 * 烟雾翻页图集的列数（4 列 × 2 行 = 8 帧），纹理生成与 billboard 取帧共用
 */
export var SMOKE_ATLAS_COLS = 4;

/**
 * 烟雾翻页图集的行数
 */
export var SMOKE_ATLAS_ROWS = 2;

/**
 * 程序化生成 4×2 烟雾翻页图集：RG 存翻页法线、B 存遮蔽、A 存密度，并由高度图差分推法线，供受光烟雾/蒸汽 billboard 使用
 */
export function createSmokeFlipbook(texSize = 128) {
  let width = texSize * SMOKE_ATLAS_COLS,
    height = texSize * SMOKE_ATLAS_ROWS,
    data = new Uint8Array(width * height * 4),
    noise = createValueNoise(9173),
    heightMap = new Float32Array(texSize * texSize),
    densityMap = new Float32Array(texSize * texSize),
    occlusionMap = new Float32Array(texSize * texSize);
  for (let cell = 0; cell < SMOKE_ATLAS_COLS * SMOKE_ATLAS_ROWS; cell++) {
    let cellCol = cell % SMOKE_ATLAS_COLS,
      cellRow = Math.floor(cell / SMOKE_ATLAS_COLS),
      seedX = cell * 13.37 + 3.1,
      seedY = cell * 7.77 + 1.3;
    for (let pixRow = 0; pixRow < texSize; pixRow++)
      for (let pixCol = 0; pixCol < texSize; pixCol++) {
        let uCoord = ((pixCol + 0.5) / texSize) * 2 - 1,
          vCoord = ((pixRow + 0.5) / texSize) * 2 - 1,
          edgeMask = 1 - smoothstepClamp(0.78, 0.98, Math.max(Math.abs(uCoord), Math.abs(vCoord))),
          densityVal,
          occlVal,
          heightVal;
        if (cell === 6) {
          let mixVal = vCoord * 0.5 + 0.5,
            radiusFrac = 0.16 + 0.5 * mixVal * mixVal,
            warpNoise = (noise.fbm(uCoord * 2 + seedX, mixVal * 2 + seedY, 3) - 0.5) * 0.25,
            smokeShape =
              1 -
              smoothstepClamp(radiusFrac * 0.3, radiusFrac, Math.abs(uCoord + warpNoise * mixVal)),
            detailNoise = noise.fbm(uCoord * 9 + seedX, mixVal * 2.2 + seedY, 4),
            topFade =
              1 -
              smoothstepClamp(
                0.55,
                0.95,
                mixVal - (noise.noise(uCoord * 6 + seedX, 3.3) - 0.5) * 0.35,
              ),
            baseFade = smoothstepClamp(0, 0.12, mixVal);
          ((densityVal =
            smokeShape *
            topFade *
            baseFade *
            smoothstepClamp(0.22, 0.7, detailNoise + 0.25 * (1 - mixVal))),
            (occlVal = smokeShape * topFade),
            (heightVal = densityVal * 0.5));
        } else {
          let mixVal = cell === 7,
            radiusFrac = mixVal ? 0.3 : 0.6,
            warpNoise =
              (noise.fbm(uCoord * 1.4 + seedX, vCoord * 1.4 + seedY, 3) - 0.5) * radiusFrac,
            smokeShape =
              (noise.fbm(uCoord * 1.4 + seedY + 5.2, vCoord * 1.4 + seedX + 1.7, 3) - 0.5) *
              radiusFrac,
            detailNoise = uCoord + warpNoise,
            topFade = vCoord + smokeShape,
            baseFade = Math.sqrt(detailNoise * detailNoise + topFade * topFade),
            radialWarp =
              (noise.fbm(detailNoise * 2.2 + seedX, topFade * 2.2 + seedY, 3) - 0.5) * 0.6,
            blobMask = 1 - smoothstepClamp(0, mixVal ? 0.84 : 0.8, baseFade + radialWarp),
            detailFbm = noise.fbm(detailNoise * 4.2 + seedX * 2, topFade * 4.2 + seedY * 2, 5),
            densityRaw = blobMask * (mixVal ? 0.8 + 0.7 * detailFbm : 0.25 + 1.5 * detailFbm);
          ((densityVal = smoothstepClamp(mixVal ? 0.02 : 0.06, mixVal ? 0.7 : 0.95, densityRaw)),
            (occlVal = blobMask),
            (heightVal =
              blobMask * 0.55 +
              blobMask *
                noise.fbm(detailNoise * 3.1 + seedX * 3, topFade * 3.1 + seedY * 3, 3) *
                0.9));
        }
        let pixIdx = pixRow * texSize + pixCol;
        ((densityMap[pixIdx] = densityVal * edgeMask),
          (occlusionMap[pixIdx] = occlVal),
          (heightMap[pixIdx] = heightVal * edgeMask));
      }
    for (let pixRow = 0; pixRow < texSize; pixRow++)
      for (let pixCol = 0; pixCol < texSize; pixCol++) {
        let uCoord = Math.max(0, pixCol - 2),
          vCoord = Math.min(texSize - 1, pixCol + 2),
          edgeMask = Math.max(0, pixRow - 2),
          densityVal = Math.min(texSize - 1, pixRow + 2),
          occlVal =
            ((heightMap[pixRow * texSize + vCoord] - heightMap[pixRow * texSize + uCoord]) *
              texSize) /
            8,
          heightVal =
            ((heightMap[densityVal * texSize + pixCol] - heightMap[edgeMask * texSize + pixCol]) *
              texSize) /
            8,
          pixIdx = 0.55,
          mixVal = -occlVal * pixIdx,
          radiusFrac = -heightVal * pixIdx,
          warpNoise = 1 / Math.sqrt(mixVal * mixVal + radiusFrac * radiusFrac + 1);
        ((mixVal *= warpNoise), (radiusFrac *= warpNoise));
        let smokeShape = ((cellRow * texSize + pixRow) * width + cellCol * texSize + pixCol) * 4,
          detailNoise = pixRow * texSize + pixCol;
        ((data[smokeShape] = Math.round((mixVal * 0.5 + 0.5) * 255)),
          (data[smokeShape + 1] = Math.round((radiusFrac * 0.5 + 0.5) * 255)),
          (data[smokeShape + 2] = Math.min(255, occlusionMap[detailNoise] * 255)),
          (data[smokeShape + 3] = Math.min(255, densityMap[detailNoise] * 255)));
      }
  }
  let texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  return (
    (texture.magFilter = THREE.LinearFilter),
    (texture.minFilter = THREE.LinearMipmapLinearFilter),
    (texture.generateMipmaps = !0),
    (texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping),
    (texture.colorSpace = THREE.NoColorSpace),
    (texture.needsUpdate = !0),
    texture
  );
}

/**
 * 火花/光斑图集的列数（4 列 × 2 行 = 8 格）
 */
export var SPARK_ATLAS_COLS = 4;

/**
 * 火花/光斑图集的行数
 */
export var SPARK_ATLAS_ROWS = 2;

/**
 * 火花图集格 0：软径向闪光，最亮的爆点核心
 */
export var SPARK_CELL_FLASH = 0;

/**
 * 火花图集格 1：沿 x 拉长的光带，用于火花拖尾与曳光断片
 */
export var SPARK_CELL_STREAK = 1;

/**
 * 火花图集格 2：带放射状叶瓣的爆闪（随机叶数与角度变体 A）
 */
export var SPARK_CELL_BURST_A = 2;

/**
 * 火花图集格 3：带放射状叶瓣的爆闪（变体 B），与 A 交替使用避免重复感
 */
var SPARK_CELL_BURST_B = 3;

/**
 * 火花图集格 4：一圈细环，用于冲击波与水花外环
 */
export var SPARK_CELL_RING = 4;

/**
 * 火花图集格 5：被噪声侵蚀的软团，用作尘土与碎屑云
 */
export var SPARK_CELL_PUFF = 5;

/**
 * 火花图集格 6：纯软圆盘，最廉价的光斑
 */
export var SPARK_CELL_DISC = 6;

/**
 * 火花图集格 7：带圆顶的锥形光刺，用于枪口焰与火花锥
 */
export var SPARK_CELL_SPIKE = 7;

/**
 * 程序化生成 4×2 火花/光斑图集（闪光、光带、两种爆闪、环、尘团、圆盘、光刺），灰度值写入 RGB，供加色 billboard 取帧
 */
export function createSparkFlipbook(cellSize = 128) {
  let width = cellSize * SPARK_ATLAS_COLS,
    height = cellSize * SPARK_ATLAS_ROWS,
    data = new Uint8Array(width * height * 4),
    noise = createValueNoise(4441),
    raySets = [0, 1].map(() => {
      let spokeCount = 7 + Math.floor(noise.rnd() * 4),
        spokeList = [];
      for (let spokeIndex = 0; spokeIndex < spokeCount; spokeIndex++)
        spokeList.push({
          a: (spokeIndex / spokeCount + (noise.rnd() - 0.5) * 0.12) * Math.PI * 2,
          l: 0.35 + noise.rnd() * 0.6,
          w: 0.018 + noise.rnd() * 0.05,
          g: 0.5 + noise.rnd() * 0.5,
        });
      return spokeList;
    });
  for (let spokeCount = 0; spokeCount < 8; spokeCount++) {
    let spokeList = spokeCount % SPARK_ATLAS_COLS,
      spokeIndex = Math.floor(spokeCount / SPARK_ATLAS_COLS);
    for (let cellRow = 0; cellRow < cellSize; cellRow++)
      for (let cellCol = 0; cellCol < cellSize; cellCol++) {
        let coordU = ((cellCol + 0.5) / cellSize) * 2 - 1,
          coordV = ((cellRow + 0.5) / cellSize) * 2 - 1,
          dist = Math.sqrt(coordU * coordU + coordV * coordV),
          falloff = 1 - smoothstepClamp(0.86, 0.99, Math.max(Math.abs(coordU), Math.abs(coordV))),
          value = 0;
        if (spokeCount === SPARK_CELL_FLASH) {
          let shapeVal = Math.max(0, 1 - dist);
          value = shapeVal * shapeVal * shapeVal * 0.75 + Math.exp(-dist * dist * 22) * 0.5;
        } else if (spokeCount === SPARK_CELL_STREAK) {
          let shapeVal = Math.pow(Math.max(0, 1 - coordU * coordU), 1.5);
          value = Math.exp(-(coordV * coordV) / (0.42 * 0.42)) * shapeVal;
        } else if (spokeCount === SPARK_CELL_BURST_A || spokeCount === SPARK_CELL_BURST_B) {
          let shapeVal = raySets[spokeCount - SPARK_CELL_BURST_A],
            shapeAux = Math.atan2(coordV, coordU);
          for (let auxA of shapeVal) {
            let auxB = Math.abs(shapeAux - auxA.a) % (Math.PI * 2);
            auxB > Math.PI && (auxB = Math.PI * 2 - auxB);
            let auxC = Math.sin(Math.min(auxB, 1.5)) * dist;
            auxB < 1.5 &&
              (value +=
                auxA.g *
                Math.exp(-(auxC * auxC) / (auxA.w * auxA.w * (0.4 + dist))) *
                Math.pow(Math.max(0, 1 - dist / auxA.l), 1.4));
          }
          value =
            value * (0.7 + 0.6 * noise.fbm(coordU * 5 + spokeCount * 9, coordV * 5, 3)) +
            Math.exp(-dist * dist * 70) * 1.2 +
            Math.max(0, 1 - dist * 2.2) * 0.06;
        } else if (spokeCount === SPARK_CELL_RING) {
          let shapeVal = Math.atan2(coordV, coordU),
            shapeAux =
              0.78 +
              (noise.noise(Math.cos(shapeVal) * 2 + 5, Math.sin(shapeVal) * 2 + 5) - 0.5) * 0.04;
          value =
            Math.exp(-((dist - shapeAux) * (dist - shapeAux)) / (0.03 * 0.03)) *
              (0.6 + 0.4 * noise.noise(Math.cos(shapeVal) * 5 + 9, Math.sin(shapeVal) * 5 + 9)) +
            0.05 * smoothstepClamp(0.2, 0.78, dist) * (1 - smoothstepClamp(0.78, 0.8, dist));
        } else if (spokeCount === SPARK_CELL_PUFF) {
          let shapeVal = (noise.fbm(coordU * 1.6 + 3.3, coordV * 1.6 + 8.1, 3) - 0.5) * 0.5,
            shapeAux = (noise.fbm(coordU * 1.6 + 7.7, coordV * 1.6 + 2.2, 3) - 0.5) * 0.5,
            auxA = coordU + shapeVal,
            auxB = coordV + shapeAux,
            auxC = Math.sqrt(auxA * auxA + auxB * auxB),
            puffFalloff = 1 - smoothstepClamp(0, 0.84, auxC),
            puffNoise = noise.fbm(auxA * 4 + 1.1, auxB * 4 + 6.6, 5);
          value =
            smoothstepClamp(0.04, 0.9, puffFalloff * (0.3 + 1.4 * puffNoise)) *
            (0.45 + 0.75 * puffFalloff);
        } else if (spokeCount === SPARK_CELL_DISC) value = 1 - smoothstepClamp(0.3, 0.62, dist);
        else if (spokeCount === SPARK_CELL_SPIKE) {
          let shapeVal = coordU * 0.5 + 0.5,
            shapeAux = 0.22 + 0.3 * shapeVal,
            auxA = Math.exp(-(coordV * coordV) / (shapeAux * shapeAux)) * Math.pow(shapeVal, 1.8),
            auxB = (coordU - 0.8) / 0.16;
          (coordU > 0.8 && (auxA *= Math.max(0, 1 - auxB * auxB)), (value = auxA * 1.15));
        }
        value *= falloff;
        let pixelValue = Math.max(0, Math.min(255, value * 255)),
          dataIndex =
            ((spokeIndex * cellSize + cellRow) * width + spokeList * cellSize + cellCol) * 4;
        ((data[dataIndex] = data[dataIndex + 1] = data[dataIndex + 2] = pixelValue),
          (data[dataIndex + 3] = 255));
      }
  }
  let texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  return (
    (texture.magFilter = THREE.LinearFilter),
    (texture.minFilter = THREE.LinearMipmapLinearFilter),
    (texture.generateMipmaps = !0),
    (texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping),
    (texture.colorSpace = THREE.NoColorSpace),
    (texture.needsUpdate = !0),
    texture
  );
}

/**
 * 枪身铭文图集的矩形分区表（18 项）：型号、厂标、口径序号、警示语、保险/单发/连发标记、枪架号、瞄具与手电标、6 组距离刻度
 */
export var PAC9_MARK_REGIONS = {
  model: [8, 8, 330, 84],
  maker: [8, 100, 560, 40],
  cal: [8, 146, 560, 40],
  prop: [8, 192, 700, 40],
  safe: [8, 240, 90, 34],
  semi: [110, 240, 90, 34],
  auto: [212, 240, 90, 34],
  rack: [8, 290, 300, 110],
  warn: [330, 290, 420, 110],
  optic: [580, 8, 300, 60],
  light: [580, 76, 300, 60],
  dots: [320, 240, 60, 34],
  r2: [8, 420, 56, 40],
  r4: [72, 420, 56, 40],
  r6: [136, 420, 56, 40],
  r8: [200, 420, 56, 40],
  r10: [264, 420, 56, 40],
  r12: [328, 420, 56, 40],
};

/**
 * 铭文图集画布宽度（1024），createMarkingsMesh 用它把矩形换算成 UV
 */
export var MARK_ATLAS_WIDTH = 1024;

/**
 * 铭文图集画布高度（512）
 */
export var MARK_ATLAS_HEIGHT = 512;
