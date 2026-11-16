// render/materials/textures.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

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
          (v, g, x, y) => {
            (v.save(),
              v.translate(g / 2, x / 2),
              v.rotate(Math.PI / 4),
              (v.fillStyle = toRgba(INK_PALETTE.red)),
              v.fillRect(-86, -86, 172, 172),
              (v.strokeStyle = toRgba(INK_PALETTE.white)),
              (v.lineWidth = 5),
              v.strokeRect(-76, -76, 152, 152),
              v.restore(),
              v.save(),
              v.translate(g / 2, x / 2 - 8),
              (v.fillStyle = toRgba(INK_PALETTE.white)),
              v.beginPath(),
              v.moveTo(2, -64),
              v.bezierCurveTo(34, -28, 40, 6, 24, 28),
              v.bezierCurveTo(12, 44, -12, 44, -24, 28),
              v.bezierCurveTo(-40, 6, -20, -12, -15, -34),
              v.bezierCurveTo(-6, -28, 0, -44, 2, -64),
              v.fill(),
              (v.fillStyle = toRgba(INK_PALETTE.red)),
              v.beginPath(),
              v.moveTo(1, -10),
              v.bezierCurveTo(15, 6, 15, 24, 0, 31),
              v.bezierCurveTo(-15, 24, -13, 8, 1, -10),
              v.fill(),
              (v.fillStyle = toRgba(INK_PALETTE.white)),
              v.fillRect(-34, 50, 68, 6),
              v.restore(),
              drawStencilRun(v, '3', g / 2, x * 0.9, 34, toRgba(INK_PALETTE.white), {
                align: 'center',
                weight: 900,
                bridges: !1,
              }),
              applyCanvasDistress(v, g, x, 0.3, y));
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
          (v, g, x, y) => {
            (drawHazardTriangle(v, g, x, toRgba(INK_PALETTE.yellow)),
              (v.fillStyle = toRgba(INK_PALETTE.black)),
              v.save(),
              v.translate(g / 2, x * 0.56),
              v.beginPath(),
              [
                [12, -58],
                [-24, 4],
                [-3, 4],
                [-16, 50],
                [26, -14],
                [5, -14],
                [22, -58],
              ].forEach((b, m) => (m ? v.lineTo(b[0], b[1]) : v.moveTo(b[0], b[1]))),
              v.closePath(),
              v.fill(),
              v.restore(),
              applyCanvasDistress(v, g, x, 0.3, y));
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
          (v, g, x, y) => {
            (drawHazardTriangle(v, g, x, toRgba(INK_PALETTE.yellow)),
              (v.fillStyle = toRgba(INK_PALETTE.black)),
              v.beginPath(),
              v.moveTo(g / 2 - 13, x * 0.34),
              v.lineTo(g / 2 + 13, x * 0.34),
              v.lineTo(g / 2 + 7, x * 0.62),
              v.lineTo(g / 2 - 7, x * 0.62),
              v.closePath(),
              v.fill(),
              v.beginPath(),
              v.arc(g / 2, x * 0.715, 11, 0, 7),
              v.fill(),
              applyCanvasDistress(v, g, x, 0.3, y));
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
          (v, g, x, y) => {
            ((v.fillStyle = toRgba(INK_PALETTE.white)),
              v.beginPath(),
              [
                [20, 68],
                [226, 68],
                [226, 22],
                [364, 96],
                [226, 170],
                [226, 124],
                [20, 124],
              ].forEach((b, m) => (m ? v.lineTo(b[0], b[1]) : v.moveTo(b[0], b[1]))),
              v.closePath(),
              v.fill(),
              (v.globalCompositeOperation = 'destination-out'),
              v.fillRect(118, 0, 9, x),
              v.fillRect(232, 0, 7, x),
              (v.globalCompositeOperation = 'source-over'),
              applyCanvasDistress(v, g, x, 0.5, y));
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
          (v, g, x, y) => {
            (drawLogoLockup(
              v,
              g,
              x,
              INK_PALETTE.white,
              (b, m, A) => {
                ((b.lineWidth = m * 0.13),
                  b.beginPath(),
                  b.arc(0, 0, m * 0.92, 0.25 * Math.PI, 1.75 * Math.PI),
                  b.stroke(),
                  b.beginPath(),
                  b.moveTo(0, -m * 1.08),
                  b.lineTo(m * 0.26, 0),
                  b.lineTo(0, m * 0.62),
                  b.lineTo(-m * 0.26, 0),
                  b.closePath(),
                  b.fill(),
                  b.beginPath(),
                  b.moveTo(m * 0.5, 0),
                  b.lineTo(m * 1.12, -m * 0.1),
                  b.lineTo(m * 1.12, m * 0.1),
                  b.closePath(),
                  b.fill());
              },
              'NORDKAP LINE',
              'ARCTIC  \xB7  ATLANTIC  \xB7  FEEDER',
            ),
              applyCanvasDistress(v, g, x, 0.35, y));
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
          (v, g, x, y) => {
            (drawLogoLockup(
              v,
              g,
              x,
              INK_PALETTE.white,
              (b, m, A) => {
                b.fillStyle = A;
                for (let _ = 0; _ < 2; _++) {
                  let M = -m * 0.35 + _ * m * 0.55,
                    E = m * (0.3 - _ * 0.06);
                  (b.beginPath(),
                    b.moveTo(-m * 1.05, M - m * 0.25),
                    b.quadraticCurveTo(-m * 0.3, M - m * 0.2, 0, M + m * 0.35),
                    b.quadraticCurveTo(m * 0.3, M - m * 0.2, m * 1.05, M - m * 0.25),
                    b.quadraticCurveTo(m * 0.35, M + E * 0.2, 0, M + m * 0.35 + E),
                    b.quadraticCurveTo(-m * 0.35, M + E * 0.2, -m * 1.05, M - m * 0.25),
                    b.fill());
                }
              },
              'TERN OCEANIC',
              'CONTAINER SERVICES',
              INK_PALETTE.orange,
            ),
              applyCanvasDistress(v, g, x, 0.35, y));
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
          (v, g, x, y) => {
            (drawLogoLockup(
              v,
              g,
              x,
              INK_PALETTE.navy,
              (b, m, A) => {
                (b.beginPath(),
                  b.arc(0, m * 0.25, m * 0.55, Math.PI, 0),
                  b.closePath(),
                  b.fill(),
                  (b.lineWidth = m * 0.1),
                  (b.lineCap = 'butt'));
                for (let _ = 0; _ < 7; _++) {
                  let M = Math.PI + ((_ + 0.5) / 7) * Math.PI;
                  (b.beginPath(),
                    b.moveTo(Math.cos(M) * m * 0.7, m * 0.25 + Math.sin(M) * m * 0.7),
                    b.lineTo(Math.cos(M) * m * 1.05, m * 0.25 + Math.sin(M) * m * 1.05),
                    b.stroke());
                }
                (b.fillRect(-m * 1.05, m * 0.42, m * 2.1, m * 0.13),
                  b.fillRect(-m * 0.8, m * 0.68, m * 1.6, m * 0.1));
              },
              'AUREL PACIFIC',
              'DEEP SEA  \xB7  REEFER  \xB7  BULK',
            ),
              applyCanvasDistress(v, g, x, 0.35, y));
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
          (v, g, x, y) => {
            (drawLogoLockup(
              v,
              g,
              x,
              INK_PALETTE.white,
              (b, m, A) => {
                (b.fillRect(-m, -m, m * 0.5, m * 2),
                  b.fillRect(m * 0.5, -m, m * 0.5, m * 2),
                  b.fillRect(-m, -m * 0.2, m * 2, m * 0.4),
                  (b.fillStyle = A),
                  b.fillRect(-m * 0.32, -m, m * 0.64, m * 0.5),
                  b.fillRect(-m * 0.32, m * 0.5, m * 0.64, m * 0.5));
              },
              'HOLMGARD',
              'INTERMODAL  FREIGHT',
              INK_PALETTE.yellow,
            ),
              applyCanvasDistress(v, g, x, 0.35, y));
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
          (v, g, x, y) => {
            ((v.strokeStyle = toRgba(INK_PALETTE.yellow)),
              (v.lineWidth = 12),
              v.strokeRect(14, 14, g - 28, x - 28),
              (v.globalCompositeOperation = 'destination-out'));
            for (let b of [g * 0.25, g * 0.75]) v.fillRect(b - 6, 0, 12, x);
            ((v.globalCompositeOperation = 'source-over'),
              drawStencilRun(v, 'BERTH 4', g / 2, x * 0.76, x * 0.66, toRgba(INK_PALETTE.yellow), {
                align: 'center',
                weight: 900,
                maxW: g - 80,
              }),
              applyCanvasDistress(v, g, x, 0.55, y));
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
          (v, g, x, y) => {
            ((v.fillStyle = toRgba(INK_PALETTE.black)),
              v.fillRect(0, 8, g, x - 16),
              v.save(),
              v.beginPath(),
              v.rect(0, 8, g, x - 16),
              v.clip(),
              (v.fillStyle = toRgba(INK_PALETTE.yellow)));
            for (let b = -x; b < g + x; b += 64)
              (v.beginPath(),
                v.moveTo(b, x),
                v.lineTo(b + 32, x),
                v.lineTo(b + 32 + x, 0),
                v.lineTo(b + x, 0),
                v.closePath(),
                v.fill());
            (v.restore(), applyCanvasDistress(v, g, x, 0.5, y));
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
          (v, g, x, y) => {
            for (let b = 0; b < 46; b++) {
              let m = g * (0.12 + 0.76 * (y() * 0.5 + y() * 0.5)),
                A = x * (0.25 + y() * 0.7),
                _ = 1.5 + y() * y() * 12,
                M = 0.05 + y() * 0.16,
                E = v.createLinearGradient(0, 0, 0, A);
              (E.addColorStop(0, `rgba(26,23,19,${M})`),
                E.addColorStop(0.15, `rgba(26,23,19,${M * 1.3})`),
                E.addColorStop(1, 'rgba(26,23,19,0)'),
                (v.fillStyle = E),
                v.fillRect(m - _ / 2 + (y() - 0.5) * 2, 0, _, A));
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
          (v, g, x, y) => {
            for (let b = 0; b < 40; b++) {
              let m = g * (0.2 + 0.6 * (y() * 0.5 + y() * 0.5)),
                A = x * (0.2 + y() * 0.75),
                _ = 1.2 + y() * y() * 9,
                M = 0.08 + y() * 0.22,
                E = y() < 0.5 ? '118,52,18' : '150,78,26',
                w = v.createLinearGradient(0, 8, 0, A);
              (w.addColorStop(0, `rgba(${E},${M * 1.4})`),
                w.addColorStop(0.3, `rgba(${E},${M})`),
                w.addColorStop(1, `rgba(${E},0)`),
                (v.fillStyle = w),
                v.fillRect(m - _ / 2, 8, _, A));
            }
            for (let b = 0; b < 9; b++)
              ((v.fillStyle = `rgba(${y() < 0.5 ? '70,30,14' : '104,44,16'},${0.5 + y() * 0.4})`),
                traceBlobPath(v, g * (0.3 + y() * 0.4), 6 + y() * 12, 3 + y() * 8, y, 0.5, 7),
                v.fill());
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
          (v, g, x, y) => {
            for (let b = 0; b < 26; b++) {
              let m = y() * 7,
                A = Math.pow(y(), 1.5) * g * 0.26,
                _ = g / 2 + Math.cos(m) * A,
                M = x / 2 + Math.sin(m) * A * 0.8,
                E = g * (0.06 + y() * 0.16),
                w = v.createRadialGradient(_, M, E * 0.2, _, M, E);
              (w.addColorStop(0, `rgba(10,10,11,${0.35 + y() * 0.3})`),
                w.addColorStop(0.75, 'rgba(12,11,10,0.22)'),
                w.addColorStop(1, 'rgba(12,11,10,0)'),
                (v.fillStyle = w),
                v.fillRect(_ - E, M - E, E * 2, E * 2));
            }
            for (let b = 0; b < 30; b++) {
              v.fillStyle = `rgba(10,10,11,${0.3 + y() * 0.4})`;
              let m = y() * 7,
                A = g * (0.25 + y() * 0.2);
              (v.beginPath(),
                v.arc(g / 2 + Math.cos(m) * A, x / 2 + Math.sin(m) * A, 1 + y() * 4, 0, 7),
                v.fill());
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
          (v, g, x, y) => {
            for (let b = 0; b < 18; b++) {
              let m = g * (0.3 + y() * 0.4),
                A = x * (0.12 + y() * 0.2),
                _ = g * (0.1 + y() * 0.2),
                M = v.createRadialGradient(m, A, _ * 0.5, m, A, _);
              (M.addColorStop(0, 'rgba(150,146,130,0.0)'),
                M.addColorStop(0.8, `rgba(168,162,140,${0.18 + y() * 0.2})`),
                M.addColorStop(1, 'rgba(168,162,140,0)'),
                (v.fillStyle = M),
                v.fillRect(m - _, A - _, _ * 2, _ * 2));
            }
            for (let b = 0; b < 22; b++) {
              let m = g * (0.25 + 0.5 * y()),
                A = x * (0.3 + y() * 0.6),
                _ = 2 + y() * 9,
                M = 0.08 + y() * 0.16,
                E = y() < 0.6 ? '160,154,132' : '60,66,52',
                w = v.createLinearGradient(0, x * 0.2, 0, x * 0.2 + A);
              (w.addColorStop(0, `rgba(${E},${M})`),
                w.addColorStop(1, `rgba(${E},0)`),
                (v.fillStyle = w),
                v.fillRect(m, x * 0.2, _, A));
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
          (v, g, x, y) => {
            ((v.fillStyle = 'rgba(96,52,40,0.9)'),
              traceBlobPath(v, 64, 64, 30, y, 0.4, 11),
              v.fill(),
              (v.fillStyle = 'rgba(150,152,156,0.95)'),
              traceBlobPath(v, 64, 64, 22, y, 0.3, 12),
              v.fill(),
              (v.strokeStyle = 'rgba(205,207,210,0.9)'),
              (v.lineWidth = 1));
            for (let m = 0; m < 14; m++) {
              let A = y() * 7;
              (v.beginPath(),
                v.moveTo(64 + Math.cos(A) * 9, 64 + Math.sin(A) * 9),
                v.lineTo(64 + Math.cos(A) * (16 + y() * 10), 64 + Math.sin(A) * (16 + y() * 10)),
                v.stroke());
            }
            let b = v.createRadialGradient(64, 64, 2, 64, 64, 12);
            (b.addColorStop(0, 'rgba(4,4,5,1)'),
              b.addColorStop(0.75, 'rgba(10,10,12,1)'),
              b.addColorStop(1, 'rgba(70,72,76,0.9)'),
              (v.fillStyle = b),
              traceBlobPath(v, 64, 64, 12, y, 0.15, 12),
              v.fill(),
              (v.strokeStyle = 'rgba(230,232,235,0.85)'),
              (v.lineWidth = 1.5),
              v.beginPath(),
              v.arc(64, 64, 12.5, 3.6, 5.6),
              v.stroke());
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
          (v, g, x, y) => {
            let b = v.createRadialGradient(64, 64, 20, 64, 64, 60);
            (b.addColorStop(0, 'rgba(176,172,162,0.5)'),
              b.addColorStop(1, 'rgba(176,172,162,0)'),
              (v.fillStyle = b),
              v.fillRect(0, 0, g, x),
              (v.fillStyle = 'rgba(168,164,154,0.95)'),
              traceBlobPath(v, 64, 64, 32, y, 0.35, 13),
              v.fill(),
              (v.fillStyle = 'rgba(120,116,108,0.95)'),
              traceBlobPath(v, 65, 66, 20, y, 0.35, 11),
              v.fill(),
              (v.strokeStyle = 'rgba(40,38,36,0.8)'),
              (v.lineWidth = 1));
            for (let A = 0; A < 6; A++) {
              let _ = y() * 7,
                M = 64 + Math.cos(_) * 14,
                E = 64 + Math.sin(_) * 14;
              (v.beginPath(), v.moveTo(M, E));
              for (let w = 0; w < 5; w++)
                ((_ += (y() - 0.5) * 0.9),
                  (M += Math.cos(_) * 8),
                  (E += Math.sin(_) * 8),
                  v.lineTo(M, E));
              v.stroke();
            }
            let m = v.createRadialGradient(64, 64, 1, 64, 64, 11);
            (m.addColorStop(0, 'rgba(18,17,16,1)'),
              m.addColorStop(1, 'rgba(60,58,54,0.95)'),
              (v.fillStyle = m),
              traceBlobPath(v, 64, 64, 10, y, 0.3, 9),
              v.fill());
            for (let A = 0; A < 40; A++) {
              v.fillStyle = `rgba(${y() < 0.5 ? '90,86,80' : '190,186,176'},0.8)`;
              let _ = y() * 7,
                M = 10 + y() * 24;
              v.fillRect(64 + Math.cos(_) * M, 64 + Math.sin(_) * M, 1 + y() * 2, 1 + y() * 2);
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
          (v, g, x, y) => {
            for (let b = 0; b < 40; b++) {
              let m = y() * 7,
                A = Math.pow(y(), 1.2) * g * 0.3,
                _ = g / 2 + Math.cos(m) * A,
                M = x / 2 + Math.sin(m) * A,
                E = g * (0.07 + y() * 0.15) * (1.2 - A / (g * 0.4)),
                w = v.createRadialGradient(_, M, 0, _, M, Math.max(4, E));
              (w.addColorStop(0, `rgba(8,7,6,${0.3 + y() * 0.3})`),
                w.addColorStop(1, 'rgba(8,7,6,0)'),
                (v.fillStyle = w),
                v.fillRect(0, 0, g, x));
            }
            v.strokeStyle = 'rgba(8,7,6,0.25)';
            for (let b = 0; b < 50; b++) {
              let m = y() * 7,
                A = g * 0.1,
                _ = g * (0.25 + y() * 0.22);
              ((v.lineWidth = 1 + y() * 3),
                v.beginPath(),
                v.moveTo(g / 2 + Math.cos(m) * A, x / 2 + Math.sin(m) * A),
                v.lineTo(g / 2 + Math.cos(m) * _, x / 2 + Math.sin(m) * _),
                v.stroke());
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
          (v, g, x, y) => {
            ((v.lineCap = 'round'), (v.lineJoin = 'round'));
            let b = (startX, startY, angle, length, strokeW, branchDepth) => {
              ((v.strokeStyle = `rgba(20,19,18,${0.6 + 0.35 * Math.min(1, strokeW / 2.5)})`),
                (v.lineWidth = strokeW),
                v.beginPath(),
                v.moveTo(startX, startY));
              let segCount = Math.floor(length / 9);
              for (let segIdx = 0; segIdx < segCount; segIdx++)
                ((angle += (y() - 0.5) * 0.8),
                  (startX += Math.cos(angle) * 9),
                  (startY += Math.sin(angle) * 9),
                  v.lineTo(startX, startY),
                  branchDepth > 0 &&
                    y() < 0.22 &&
                    (v.stroke(),
                    b(
                      startX,
                      startY,
                      angle + (y() < 0.5 ? 1 : -1) * (0.5 + y() * 0.7),
                      length * (0.3 + y() * 0.3),
                      strokeW * 0.6,
                      branchDepth - 1,
                    ),
                    (v.strokeStyle = `rgba(20,19,18,${0.6 + 0.35 * Math.min(1, strokeW / 2.5)})`),
                    (v.lineWidth = strokeW),
                    v.beginPath(),
                    v.moveTo(startX, startY)));
              v.stroke();
            };
            (b(g * 0.5, x * 0.5, y() * 7, g * 0.42, 2.6, 3),
              b(g * 0.5, x * 0.5, y() * 7 + 2, g * 0.4, 2.2, 3),
              b(g * 0.5, x * 0.5, y() * 7 + 4, g * 0.36, 1.8, 2));
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
          (v, g, x, y) => {
            ((v.lineCap = 'round'), (v.lineJoin = 'round'));
            let b = (angle, length, strokeW) => {
                ((v.strokeStyle = strokeW),
                  (v.lineWidth = length),
                  v.beginPath(),
                  v.moveTo(angle[0][0], angle[0][1]));
                for (let branchDepth = 1; branchDepth < angle.length - 1; branchDepth += 2)
                  v.quadraticCurveTo(
                    angle[branchDepth][0],
                    angle[branchDepth][1],
                    angle[branchDepth + 1][0],
                    angle[branchDepth + 1][1],
                  );
                v.stroke();
              },
              m = 'rgba(206,214,208,0.92)',
              A = [
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
            for (let _ of A) (b(_, 12, 'rgba(206,214,208,0.25)'), b(_, 7, m));
            (b(
              [
                [30, 222],
                [180, 236],
                [352, 206],
              ],
              5,
              m,
            ),
              b(
                [
                  [330, 40],
                  [344, 30],
                  [356, 44],
                ],
                5,
                m,
              ));
            for (let _ = 0; _ < 7; _++) {
              let M = 50 + y() * 290,
                E = 150 + y() * 50,
                w = 12 + y() * 46,
                S = v.createLinearGradient(0, E, 0, E + w);
              (S.addColorStop(0, m),
                S.addColorStop(1, 'rgba(206,214,208,0)'),
                (v.fillStyle = S),
                v.fillRect(M, E, 2 + y() * 2, w));
            }
            for (let _ = 0; _ < 260; _++)
              ((v.fillStyle = `rgba(206,214,208,${y() * 0.5})`),
                v.fillRect(30 + y() * 330, 40 + y() * 190, 1.2, 1.2));
            applyCanvasDistress(v, g, x, 0.25, y);
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
          (v, g, x, y) => {
            let b = v.createLinearGradient(0, 0, g, x);
            (b.addColorStop(0, 'rgb(150,152,150)'),
              b.addColorStop(0.5, 'rgb(176,178,176)'),
              b.addColorStop(1, 'rgb(138,140,138)'),
              (v.fillStyle = b),
              v.beginPath(),
              v.roundRect ? v.roundRect(3, 3, g - 6, x - 6, 8) : v.rect(3, 3, g - 6, x - 6),
              v.fill(),
              (v.strokeStyle = 'rgba(40,42,44,0.8)'),
              (v.lineWidth = 2),
              v.strokeRect(11, 11, g - 22, x - 22));
            for (let [_, M] of [
              [20, 20],
              [g - 20, 20],
              [20, x - 20],
              [g - 20, x - 20],
            ])
              ((v.fillStyle = 'rgb(96,98,98)'),
                v.beginPath(),
                v.arc(_, M, 5, 0, 7),
                v.fill(),
                (v.fillStyle = 'rgba(230,232,232,0.7)'),
                v.beginPath(),
                v.arc(_ - 1.2, M - 1.2, 2, 0, 7),
                v.fill());
            let m = 'rgba(28,30,32,0.92)';
            (drawStencilRun(v, 'SAFETY APPROVAL PLATE', g / 2, 46, 19, m, {
              font: 'sans',
              weight: 600,
              align: 'center',
              spacing: 1.5,
              maxW: g - 60,
            }),
              [
                'APPROVAL REF   SL/PA-4207/19',
                'DATE MANUFACTURED   03/2019',
                'IDENT NO   SLTU 402719 6',
                'MAX GROSS   30 480 KG',
                'STACKING LOAD   192 000 KG',
                'RACKING TEST   150 KN',
                'NEXT EXAM   09/2027',
              ].forEach((_, M) => {
                (drawStencilRun(v, _, 30, 70 + M * 16.5, 11, m, {
                  font: 'mono',
                  weight: 500,
                  spacing: 0,
                  maxW: g - 60,
                }),
                  (v.fillStyle = 'rgba(28,30,32,0.35)'),
                  v.fillRect(30, 73 + M * 16.5, g - 60, 1));
              }),
              (v.fillStyle = 'rgba(60,40,24,0.25)'));
            for (let _ = 0; _ < 30; _++)
              (traceBlobPath(v, y() * g, y() * x, 2 + y() * 9, y, 0.5, 7), v.fill());
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
      let v = 0,
        g = () => {
          v = 0;
          for (let x of fontRefreshers)
            try {
              x();
            } catch {}
        };
      for (let colorKey of [
        '700 20px "Big Shoulders Display"',
        '900 20px "Big Shoulders Display"',
        '600 20px "Barlow Condensed"',
        '500 20px "IBM Plex Mono"',
      ])
        document.fonts.load(colorKey).then(
          (y) => {
            y && y.length && !v && (v = setTimeout(g, 120));
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
      let a = 7 + Math.floor(noise.rnd() * 4),
        l = [];
      for (let c = 0; c < a; c++)
        l.push({
          a: (c / a + (noise.rnd() - 0.5) * 0.12) * Math.PI * 2,
          l: 0.35 + noise.rnd() * 0.6,
          w: 0.018 + noise.rnd() * 0.05,
          g: 0.5 + noise.rnd() * 0.5,
        });
      return l;
    });
  for (let rayCount = 0; rayCount < 8; rayCount++) {
    let rayList = rayCount % SPARK_ATLAS_COLS,
      rayIndex = Math.floor(rayCount / SPARK_ATLAS_COLS);
    for (let cellRow = 0; cellRow < cellSize; cellRow++)
      for (let cellCol = 0; cellCol < cellSize; cellCol++) {
        let coordU = ((cellCol + 0.5) / cellSize) * 2 - 1,
          coordV = ((cellRow + 0.5) / cellSize) * 2 - 1,
          dist = Math.sqrt(coordU * coordU + coordV * coordV),
          falloff = 1 - smoothstepClamp(0.86, 0.99, Math.max(Math.abs(coordU), Math.abs(coordV))),
          value = 0;
        if (rayCount === SPARK_CELL_FLASH) {
          let shapeVal = Math.max(0, 1 - dist);
          value = shapeVal * shapeVal * shapeVal * 0.75 + Math.exp(-dist * dist * 22) * 0.5;
        } else if (rayCount === SPARK_CELL_STREAK) {
          let shapeVal = Math.pow(Math.max(0, 1 - coordU * coordU), 1.5);
          value = Math.exp(-(coordV * coordV) / (0.42 * 0.42)) * shapeVal;
        } else if (rayCount === SPARK_CELL_BURST_A || rayCount === SPARK_CELL_BURST_B) {
          let shapeVal = raySets[rayCount - SPARK_CELL_BURST_A],
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
            value * (0.7 + 0.6 * noise.fbm(coordU * 5 + rayCount * 9, coordV * 5, 3)) +
            Math.exp(-dist * dist * 70) * 1.2 +
            Math.max(0, 1 - dist * 2.2) * 0.06;
        } else if (rayCount === SPARK_CELL_RING) {
          let shapeVal = Math.atan2(coordV, coordU),
            shapeAux =
              0.78 +
              (noise.noise(Math.cos(shapeVal) * 2 + 5, Math.sin(shapeVal) * 2 + 5) - 0.5) * 0.04;
          value =
            Math.exp(-((dist - shapeAux) * (dist - shapeAux)) / (0.03 * 0.03)) *
              (0.6 + 0.4 * noise.noise(Math.cos(shapeVal) * 5 + 9, Math.sin(shapeVal) * 5 + 9)) +
            0.05 * smoothstepClamp(0.2, 0.78, dist) * (1 - smoothstepClamp(0.78, 0.8, dist));
        } else if (rayCount === SPARK_CELL_PUFF) {
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
        } else if (rayCount === SPARK_CELL_DISC) value = 1 - smoothstepClamp(0.3, 0.62, dist);
        else if (rayCount === SPARK_CELL_SPIKE) {
          let shapeVal = coordU * 0.5 + 0.5,
            shapeAux = 0.22 + 0.3 * shapeVal,
            auxA = Math.exp(-(coordV * coordV) / (shapeAux * shapeAux)) * Math.pow(shapeVal, 1.8),
            auxB = (coordU - 0.8) / 0.16;
          (coordU > 0.8 && (auxA *= Math.max(0, 1 - auxB * auxB)), (value = auxA * 1.15));
        }
        value *= falloff;
        let pixelValue = Math.max(0, Math.min(255, value * 255)),
          dataIndex = ((rayIndex * cellSize + cellRow) * width + rayList * cellSize + cellCol) * 4;
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
