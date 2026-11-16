// render/materials/surface-shaders.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

/**
 * 全屏四边形的 GLSL3 顶点着色器：直接把单位平面 position.xy 送进裁剪空间并输出 vUv，供表面烘焙与所有后处理 blit 复用
 */
export var SALTLINE_FULLSCREEN_VERT = `
in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * 表面纹理烘焙的公共前导（约三成代码是它）：uP/uSeed/uTexel uniform、线性化 L()、PCG 哈希 h3、梯度噪声 gn、fbm、voronoi、直线划痕 scr，以及 rustMask/chipsF/paintDmg 掉漆-底锈-流痕损坏模型，和写三张 MRT 的 emit；27 个 surf 函数全部依赖它
 */
export var SALTLINE_SURF_PRELUDE_FRAG = `
precision highp float; precision highp int;
uniform vec4 uP; uniform float uSeed; uniform float uTexel;
in vec2 vUv;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
#define TAU 6.28318530718
#define sat(x) clamp(x, 0.0, 1.0)
#define OV(D, k) { float k_ = sat(k); nt = mix(nt, D, k_); ta = mix(ta, 0.0, k_); }
vec3 L(float r, float g, float b){ return pow(vec3(r, g, b), vec3(2.2)); }
uvec3 pcg3(uvec3 v){ v = v * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> 16u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; return v; }
vec3 h3(vec2 c, vec2 per, float s){ c = mod(c, per); return vec3(pcg3(uvec3(uint(c.x + 0.5), uint(c.y + 0.5), uint(s + uSeed)))) * (1.0 / 4294967296.0); }
float gn(vec2 p, vec2 per, float s){
  vec2 i = floor(p), f = p - i; vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(h3(i, per, s).xy * 2.0 - 1.0, f);
  float b = dot(h3(i + vec2(1.0, 0.0), per, s).xy * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(h3(i + vec2(0.0, 1.0), per, s).xy * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(h3(i + vec2(1.0, 1.0), per, s).xy * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// fractal noise, ~0..1 centred on 0.5 (std ~0.18)
float fbm(vec2 uv, vec2 f, int oct, float s){
  float a = 0.5, v = 0.0, t = 0.0;
  for (int i = 0; i < oct; i++){ v += a * gn(uv * f, f, s + float(i) * 7.0); t += a; a *= 0.5; f *= 2.0; }
  return sat(v / t * 1.8 + 0.5);
}
// voronoi: x = F1, y = F2, z = cell random, w = second cell random
vec4 vor(vec2 p, vec2 per, float s){
  vec2 i = floor(p), f = p - i; float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y)); vec3 r = h3(i + o, per, s); vec2 d = o + r.xy - f; float dd = dot(d, d);
    if (dd < d1){ d2 = d1; d1 = dd; id = vec2(r.z, fract(r.z * 37.0 + r.x * 11.0)); } else if (dd < d2) d2 = dd;
  }
  return vec4(sqrt(d1), sqrt(d2), id);
}
// scattered straight scratches: f cells per tile, w half-width (cells), base angle + spread, density 0..1
float scr(vec2 uv, float f, float s, float w, float ang, float spread, float dens){
  vec2 p = uv * f; vec2 i = floor(p); vec2 fr = p - i; float m = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y)); vec3 r = h3(i + o, vec2(f), s); vec3 r2 = h3(i + o, vec2(f), s + 31.0);
    vec2 c = o + r.xy - fr; float a = ang + (r.z - 0.5) * spread; vec2 dir = vec2(cos(a), sin(a));
    float al = dot(c, dir), ac = dot(c, vec2(-dir.y, dir.x)); float len = 0.15 + r2.x * 0.8;
    m = max(m, smoothstep(w, w * 0.3, abs(ac)) * smoothstep(len, len * 0.7, abs(al)) * step(r2.y, dens) * (0.35 + 0.65 * r2.z));
  }
  return m;
}
void emit(vec3 c, float a, float h, float ao, float r, float m){
  o0 = vec4(sqrt(clamp(c, 0.0, 1.0)), sat(a));
  o1 = vec4(sat(ao), clamp(r, 0.03, 1.0), sat(m), 1.0);
  float hh = sat(h) * 255.0; float fl = floor(hh); o2 = vec4(fl / 255.0, hh - fl, 0.0, 1.0);
}
// soft, grainy rust patch mask: f = patch frequency, th = threshold (higher = rarer)
float rustMask(vec2 uv, vec2 f, float th, float s){
  float n = fbm(uv, f, 5, s), g = fbm(uv, f * 14.0, 3, s + 50.0);
  return smoothstep(th, th + 0.14, n + (g - 0.5) * 0.3) * (0.5 + 0.5 * g);
}
// ---- shared paint damage model ----
float chipsF(vec2 uv, vec2 f, float s, float dens, float rmax){
  vec4 v = vor(uv * f, f, s); float e = fbm(uv, f * 3.0, 3, s + 3.0) - 0.5; float r = rmax * (0.25 + 0.75 * v.w);
  return step(v.z, dens) * smoothstep(r, r * 0.55, v.x + e * 0.6);
}
// chip: 0 = intact paint .. 1 = through to substrate; stain: thin oxide halo; run: rust run below damage (-V is down)
void paintDmg(vec2 uv, float amt, out float chip, out float stain, out float run){
  float wearN = fbm(uv, vec2(3.0), 6, 21.0);
  float zone = smoothstep(0.58, 0.82, fbm(uv, vec2(2.0), 3, 22.0));      // damage clusters; most of the panel is clean
  float dn = (0.012 + 0.085 * zone) * (0.5 + amt);
  float c1 = chipsF(uv, vec2(20.0, 11.0), 23.0, dn, 0.24);                // vertically stretched flakes
  float c2 = chipsF(uv, vec2(64.0, 40.0), 24.0, dn * 1.6, 0.34);
  float th = 0.925 - 0.06 * amt;
  float c3 = smoothstep(th, th + 0.03, wearN + (fbm(uv, vec2(40.0), 3, 25.0) - 0.5) * 0.12);
  float s1 = scr(uv, 5.0, 26.0, 0.0035, 0.0, 0.4, 0.2 + 0.25 * amt);
  float s2 = scr(uv, 16.0, 27.0, 0.009, 1.57, 0.5, 0.12 + 0.2 * amt);
  float sbreak = smoothstep(0.4, 0.65, fbm(uv, vec2(50.0), 2, 28.0));
  chip = sat(max(max(c1, c2), max(c3, max(s1, s2) * sbreak)));
  vec4 v = vor(uv * vec2(20.0, 11.0), vec2(20.0, 11.0), 23.0);
  float b1 = step(v.z, dn) * smoothstep(0.42, 0.14, v.x) * (0.3 + 0.7 * v.w);
  float bn = fbm(uv, vec2(36.0), 4, 29.0);
  stain = sat(max(b1 * smoothstep(0.4, 0.7, bn) * 0.8, smoothstep(th - 0.03, th + 0.02, wearN) * smoothstep(0.4, 0.7, bn) * 0.7));
  float streak = fbm(uv, vec2(120.0, 1.0), 3, 30.0);
  float rr = 0.0;
  for (int i = 1; i <= 4; i++){
    vec2 q = uv + vec2(0.0, float(i) * 0.034);
    float src = max(chipsF(q, vec2(20.0, 11.0), 23.0, dn, 0.24), smoothstep(th, th + 0.03, fbm(q, vec2(3.0), 6, 21.0)));
    rr = max(rr, src * (1.0 - float(i) / 5.0));
  }
  run = rr * smoothstep(0.5, 0.78, streak);
}
`;

/**
 * 表面烘焙片元的入口尾巴，唯一职责是用 vUv 调用具体 surf 函数；拼装顺序是 prelude + SURFACE_SHADERS[fn] + 这段
 */
export var SALTLINE_SURF_MAIN_FRAG = `
void main(){ surf(vUv); }`;

/**
 * 27 个表面 surf 函数组成的 GLSL 库（asphalt/concrete/brick/epoxy/paint/hazard/hull/galv/metal/brushed/rust/diamond/corrugated/chainlink/gunmetal/polymer/carbon/fabric/armor/wood/plastic/tarp/cardboard/rope/tire/glass/water），键名与 SURFACE_DEFS.fn 一一对应，是全部程序化材质的唯一纹理来源
 */
export var SURFACE_SHADERS = {};

/**
 * paint 与 hazard 两个 surf 共享的漆面本体：按 chip 分级叠到底漆/裸钢/铁锈/新划痕，再盖污垢膜与垂直水洗痕，最后用调用方给的 shade/baseR 参数差异化底色与粗糙度
 */
export var SALTLINE_PAINT_BODY = `
  float fine = fbm(uv, vec2(260.0), 2, 1.0), mid = fbm(uv, vec2(16.0), 4, 2.0), big = fbm(uv, vec2(2.0), 4, 3.0);
  float chalk = smoothstep(0.3, 0.8, fbm(uv, vec2(1.0, 2.0), 4, 4.0));
  float dirt = smoothstep(0.42, 0.85, fbm(uv, vec2(3.0, 2.0), 5, 5.0));
  float vs1 = fbm(uv, vec2(70.0, 1.0), 3, 6.0), vs2 = fbm(uv, vec2(22.0, 1.0), 3, 16.0), vs3 = fbm(uv, vec2(9.0, 2.0), 3, 17.0);
  float steel = smoothstep(0.55, 0.8, chip);
  float primer = smoothstep(0.15, 0.4, chip) * (1.0 - steel);
  float rustN = fbm(uv, vec2(60.0), 4, 7.0);
  float fresh = steel * smoothstep(0.78, 0.86, fbm(uv, vec2(25.0), 3, 8.0));
  vec3 rustC = mix(L(0.2, 0.135, 0.105), L(0.36, 0.23, 0.15), rustN);
  rustC = mix(rustC, L(0.5, 0.33, 0.18), smoothstep(0.7, 0.95, fbm(uv, vec2(120.0), 2, 9.0)) * 0.5);
  vec3 nt = vec3(0.0); float ta = shade * (0.9 + 0.2 * (mid - 0.5) + 0.2 * (big - 0.5));
  // dirt film: broad grime + fine and broad vertical wash streaks
  float df = sat(dirt * 0.3 + smoothstep(0.55, 0.85, vs1) * 0.3 * (0.4 + dirt) + smoothstep(0.55, 0.8, vs2) * 0.38 * (0.3 + dirt) + smoothstep(0.5, 0.8, vs3) * 0.2);
  float clean = smoothstep(0.6, 0.85, 1.0 - vs2) * 0.5;            // rain-washed lighter streaks
  float rs = sat(stain * 0.7 + run * 0.85);
  ta *= 1.0 + clean * 0.08 - chalk * 0.06;
  OV(vec3(0.72), chalk * 0.075 + clean * 0.02);
  OV(L(0.24, 0.22, 0.19), df * 0.42);
  OV(mix(L(0.3, 0.2, 0.14), L(0.44, 0.28, 0.16), rustN), rs * 0.5);
  OV(mix(L(0.5, 0.25, 0.2), L(0.55, 0.54, 0.5), 0.35), primer);
  OV(rustC, steel);
  OV(L(0.55, 0.55, 0.57), fresh);
  float h = 0.62 + (fine - 0.5) * 0.05 + (mid - 0.5) * 0.04;
  h = mix(h, 0.5, primer); h = mix(h, 0.36 + rustN * 0.14, steel); h += rs * 0.02 * rustN;
  float r = baseR + chalk * 0.26 + df * 0.3 - clean * 0.06 + (mid - 0.5) * 0.14 + (big - 0.5) * 0.1; r = mix(r, 0.75, primer); r = mix(r, 0.92, steel); r = mix(r, 0.35, fresh); r = mix(r, 0.72, rs * 0.6);
  float m = fresh * 0.95 + (steel - fresh) * 0.15;
  float ao = 1.0 - steel * 0.25 - primer * 0.1;
`;
