// render/shaders/post/output.js — 从 render/postprocessing.js 拆出的后处理着色器常量；纯 GLSL 字符串，跨文件引用靠 src/.manifest.json 的 order 保证求值顺序。

import { GLSL_RAW_DEPTH_NEAR_EPS, SALTLINE_EXPOSURE_GLSL, SALTLINE_POST_COMMON } from './common.js';
import { SALTLINE_NOISE_GLSL } from '../../sky.js';

/**
 * 相机运动模糊：用当前与上一帧 viewProj 求屏幕速度，沿速度方向 9 tap 采样并按深度剔除天空，速度归一上限防止快速转身糊成一片
 */
export var SALTLINE_MOTIONBLUR_FRAG = `${SALTLINE_POST_COMMON}
uniform sampler2D tColor, tDepth; uniform mat4 uInvViewProj, uPrevViewProj; uniform float uShutter; uniform vec2 uRes;
void main(){
  vec4 c0 = texture2D(tColor, vUv);
  float d = texture2D(tDepth, vUv).r;
  if (d < ${GLSL_RAW_DEPTH_NEAR_EPS}) { gl_FragColor = c0; return; }
  vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); wp /= wp.w;
  vec4 pc = uPrevViewProj * wp;
  vec2 puv = pc.xy / max(pc.w, 1e-4) * 0.5 + 0.5;
  vec2 vel = (vUv - puv) * uShutter;
  float len = length(vel);
  if (pc.w <= 0.0 || len * uRes.y < 0.75) { gl_FragColor = c0; return; }
  vel *= min(1.0, 0.018 / len);
  float j = ign(gl_FragCoord.xy) - 0.5;
  vec3 acc = c0.rgb; float ws = 1.0;
  for (int i = 0; i < 9; i++) {
    vec2 uv = vUv + vel * ((float(i) + 0.5 + j) / 9.0 - 0.5);
    float w = texture2D(tDepth, uv).r < ${GLSL_RAW_DEPTH_NEAR_EPS} ? 0.0 : 1.0;
    acc += texture2D(tColor, uv).rgb * w; ws += w;
  }
  gl_FragColor = vec4(acc / ws, 1.0);
}`;

/**
 * 1×1 眼睛适应：7×5 中心加权对数亮度平均 + 时间指数趋近，同时用 12 点 Vogel 采样太阳位置深度算出太阳可见度（R 存亮度、G 存可见度），带 NaN/首帧看门狗
 */
export var SALTLINE_ADAPT_FRAG = `${SALTLINE_POST_COMMON}
uniform sampler2D tPrev, tLum, tDepth; uniform vec2 uSunUv; uniform float uSunOn, uRate, uVisRate, uAspect;
void main(){
  float ls = 0.0, ws = 0.0;
  for (int y = 0; y < 5; y++) for (int x = 0; x < 7; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(7.0, 5.0);
    vec2 c = uv - 0.5;
    float w = 1.0 - 0.75 * smoothstep(0.1, 0.55, length(c));       // centre-weighted metering
    float l = luma(texture2D(tLum, uv).rgb);
    ls += log(max(l, 1e-4)) * w; ws += w;
  }
  float avg = clamp(exp(ls / ws), 0.002, 40.0);
  float vis = 0.0;
  for (int i = 0; i < 12; i++) {
    float r = sqrt((float(i) + 0.5) / 12.0) * 0.011; float th = float(i) * 2.39996323;
    vec2 uv = uSunUv + vec2(cos(th) / uAspect, sin(th)) * r;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) vis += 1.0;
    else vis += step(0.99999, texture2D(tDepth, uv).r);
  }
  vis = vis / 12.0 * uSunOn;
  vec4 prev = texture2D(tPrev, vec2(0.5));
  float a = mix(prev.r, avg, uRate);
  if (!(a > 0.0) || a > 1e4) a = avg;                                 // NaN / first-frame guard
  float v = mix(prev.g, vis, uVisRate);
  if (!(v >= 0.0)) v = vis;
  gl_FragColor = vec4(a, v, 0.0, 1.0);
}`;

/**
 * 程序化镜头污渍图：70 个哈希散布的斑块 + fbm 污痕 + 竖直雨痕，边缘加强后一次性烘成 512×288 纹理给泛光做调制，省掉一张美术贴图
 */
export var SALTLINE_LENS_DIRT_FRAG = `${SALTLINE_POST_COMMON}
${SALTLINE_NOISE_GLSL}
uniform float uAspect;
void main(){
  vec2 p = vUv * vec2(uAspect, 1.0);
  float acc = 0.0;
  for (int i = 0; i < 70; i++) {
    float fi = float(i);
    vec2 c = vec2(hash12(vec2(fi, 1.7)), hash12(vec2(fi, 9.2))) * vec2(uAspect, 1.0);
    float sz = mix(0.012, 0.085, pow(hash12(vec2(fi, 4.4)), 3.0));
    float r = length(p - c) / sz;
    float disc = smoothstep(1.0, 0.86, r) * (0.35 + 0.65 * smoothstep(0.35, 0.98, r));
    acc += disc * mix(0.15, 0.7, hash12(vec2(fi, 6.1)));
  }
  float smudge = fbm5(vUv * vec2(5.0, 9.0) + 3.0) * fbm3(vUv * 2.3 + 9.0);
  float streaks = pow(n2(vec2(vUv.x * 90.0, vUv.y * 2.0)), 4.0) * 0.25;
  float v = acc * 0.55 + smudge * 0.9 + streaks;
  v *= 0.45 + 0.9 * smoothstep(0.15, 0.75, length(vUv - 0.5));
  gl_FragColor = vec4(vec3(v) * vec3(1.0, 0.96, 0.9), 1.0);
}`;

/**
 * 最终成像 pass：径向色散、ADS 边缘虚化、泛光/污渍/光条叠加、程序化太阳光晕与鬼影（按可见度做遮挡测试）、ACES→AgX 混合的胶片曲线，随后是分离色调、S 曲线、受击/低血/暗角与淡出
 */
export var SALTLINE_GRADE_FRAG = `${SALTLINE_POST_COMMON}
uniform sampler2D tScene, tBloom, tBlur, tStreak, tDirt;
${SALTLINE_EXPOSURE_GLSL}
uniform vec3 uSunCol;
uniform vec2 uSunUv;
uniform float uTime, uAspect, uBloom, uDirt, uStreak, uFlare, uCA, uVignette;
uniform float uDamage, uLowHealth, uAds, uFlash, uFade, uSaturation, uSunOn, uThunder, uAgxMix;

// ---- AgX (Filament/Blender fit, as in three.js) ----
const mat3 SL_REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 SL_SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
vec3 slAgxContrast(vec3 x){ vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 slAgx(vec3 color){
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393, maxEv = 4.026069;
  color = inset * (SL_SRGB_TO_REC2020 * color);
  color = clamp((log2(max(color, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = slAgxContrast(color);
  // "punchy"-style look: a little more contrast and chroma than the base AgX rendering
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(max(color, vec3(0.0)), vec3(LOOK_POWER));
  color = l + (color - l) * LOOK_SAT;
  color = outset * color;
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(SL_REC2020_TO_SRGB * color, 0.0, 1.0);
}
vec3 slRRTODT(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 slAces(vec3 c){
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(outM * slRRTODT(inM * (c * 1.3)), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

vec3 flare(vec2 uv, vec2 sun, float vis){
  vec2 asp = vec2(uAspect, 1.0);
  vec2 p = (uv - 0.5) * asp, s = (sun - 0.5) * asp;
  vec2 dv = p - s; float r = length(dv);
  vec3 c = vec3(0.0);
  // veiling glare + a few soft diffraction spikes
  float ang = atan(dv.y, dv.x);
  float spikes = pow(abs(cos(ang * 3.0 + 0.4)), 24.0) + 0.6 * pow(abs(cos(ang * 4.0 - 1.1)), 40.0);
  c += uSunCol * (0.020 / (r * r * 9.0 + 0.010) + 0.10 * exp(-r * 3.2));
  c += uSunCol * spikes * 0.30 * exp(-r * 5.5);
  // ghosts along the sun -> centre axis
  vec3 g = vec3(0.0);
  float k0 = length(p + s * 0.38);  g += vec3(0.30, 0.75, 0.55) * smoothstep(0.085, 0.06, k0) * 0.050;
  float k1 = length(p + s * 0.82);  g += vec3(0.85, 0.45, 0.25) * smoothstep(0.045, 0.030, k1) * 0.075;
  float k2 = length(p + s * 1.35);  g += vec3(0.35, 0.50, 0.95) * smoothstep(0.17, 0.12, k2) * (0.4 + 0.6 * smoothstep(0.05, 0.16, k2)) * 0.040;
  float k3 = length(p - s * 0.45);  g += vec3(0.80, 0.70, 0.35) * smoothstep(0.030, 0.018, k3) * 0.060;
  // halo ring opposite the sun
  float hr = length(p + s * 0.15);
  g += vec3(0.45, 0.55, 0.85) * exp(-pow((hr - 0.52) * 16.0, 2.0)) * 0.035 * smoothstep(0.1, 0.5, length(s));
  c += g * uSunCol * 2.4;
  return c * vis;
}

void main(){
  vec2 c = vUv - 0.5;
  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0)) / (0.25 * (uAspect * uAspect + 1.0));   // 0 centre .. 1 corner
  vec4 ad = texture2D(tAdapt, vec2(0.5));
  // radial chromatic aberration (tiny; grows a little when hurt)
  vec2 off = c * r2 * (uCA + uDamage * 0.006);
  vec3 col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
  // ADS: soften the periphery
  vec3 soft = texture2D(tBlur, vUv).rgb;
  col = mix(col, soft, uAds * 0.75 * smoothstep(0.22, 0.85, r2));
  // bloom (energy conserving mix), lens dirt, anamorphic streak
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  vec3 dirt = texture2D(tDirt, vUv).rgb;
  col = mix(col, bloom, uBloom);
  col += bloom * dirt * uDirt;
  col += texture2D(tStreak, vUv).rgb * vec3(0.45, 0.62, 1.0) * uStreak;
  // sun glare + flare (occlusion-tested)
  float vis = ad.g * uSunOn;
  if (vis > 0.002) { vec3 fl = flare(vUv, uSunUv, vis) * uFlare; col += fl * (1.0 + dirt * 1.5); }
  // exposure: manual * eye adaptation
  col *= slExposure();
  col += vec3(1.0, 0.97, 0.9) * uFlash * 2.5;
  // filmic curve: ACES (Hill fit) for punch and burning oranges, pulled toward AgX so highlights roll off to white
  col = mix(slAces(col), slAgx(col), uAgxMix);

  // ---- grade (display-linear) ----
  float l = luma(col);
  // split tone: teal shadows, warm highlights
  vec3 sh = vec3(0.80, 1.01, 1.13), hi = vec3(1.07, 1.0, 0.90);
  col *= mix(sh, hi, smoothstep(0.03, 0.55, l));
  // gentle S-curve
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
  // lifted, slightly teal blacks
  col = col * 0.988 + vec3(0.006, 0.0085, 0.011);
  // saturation (gameplay driven)
  float sat = uSaturation * (1.0 - 0.65 * uLowHealth) * (1.0 - 0.5 * uDamage);
  l = luma(col);
  col = mix(vec3(l), col, sat);
  // vignette: base + low health + ADS tightening
  float vig = uVignette + uLowHealth * 0.55 + uAds * 0.22;
  float vr = smoothstep(0.15 - uAds * 0.08, 1.05, r2);
  col *= 1.0 - vig * vr * vr * (3.0 - 2.0 * vr) ;
  // damage: red-edged pulse
  float edge = smoothstep(0.18, 1.0, r2);
  col = mix(col, vec3(0.55, 0.02, 0.01) * (0.35 + l), clamp(uDamage * edge * 0.85 + uLowHealth * edge * edge * 0.25 * (0.75 + 0.25 * sin(uTime * 5.0)), 0.0, 1.0));
  col *= 1.0 - uFade;
  col = toSRGB(clamp(col, 0.0, 1.0));
  gl_FragColor = vec4(col, dot(col, vec3(0.299, 0.587, 0.114)));
}`;

/**
 * 输出前的收尾 pass：以亮度 alpha 做的轻量 FXAA、在强边缘退让的反锐化、亮度加权动态胶片颗粒，最后加 1/255 抖动压住天空渐变的色带
 */
export var SALTLINE_FINAL_FRAG = `${SALTLINE_POST_COMMON}
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uTime, uGrain, uSharpen, uFxaa;
void main(){
  vec4 M = texture2D(tSrc, vUv);
  vec3 col = M.rgb;
  vec4 NW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel), NE = texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel);
  vec4 SW = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel), SE = texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel);
  float lMin = min(M.a, min(min(NW.a, NE.a), min(SW.a, SE.a)));
  float lMax = max(M.a, max(max(NW.a, NE.a), max(SW.a, SE.a)));
  float contrast = lMax - lMin;
  if (uFxaa > 0.5 && contrast > max(0.0312, lMax * 0.10)) {
    vec2 dir = vec2(-((NW.a + NE.a) - (SW.a + SE.a)), (NW.a + SW.a) - (NE.a + SE.a));
    float dirReduce = max((NW.a + NE.a + SW.a + SE.a) * 0.03125, 0.0078125);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
    vec4 A = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)) + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)));
    vec4 B = A * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5) + texture2D(tSrc, vUv + dir * 0.5));
    col = (B.a < lMin || B.a > lMax) ? A.rgb : B.rgb;
  }
  // light unsharp mask, backed off on strong edges (those belong to FXAA)
  vec3 blur = (NW.rgb + NE.rgb + SW.rgb + SE.rgb) * 0.25;
  col += (M.rgb - blur) * uSharpen * (1.0 - smoothstep(0.04, 0.22, contrast));
  // animated, luminance-weighted film grain
  vec2 seed = gl_FragCoord.xy + fract(uTime * vec2(7.31, 3.17)) * vec2(311.7, 173.3);
  float g = hash12(seed) + hash12(seed + 57.3) - 1.0;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col += g * uGrain * mix(1.0, 0.30, smoothstep(0.25, 0.9, l)) * (0.35 + 0.65 * smoothstep(0.0, 0.08, l));
  // dither against banding in the sky gradients
  col += (hash12(gl_FragCoord.xy * 1.37 + 11.0) + hash12(gl_FragCoord.xy * 0.71 + 3.0) - 1.0) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;
