// render/shaders/post/depth.js — 从 render/postprocessing.js 拆出的后处理着色器常量；纯 GLSL 字符串，跨文件引用靠 src/.manifest.json 的 order 保证求值顺序。

import { GLSL_LINEAR_DEPTH_NEAR_EPS, GLSL_RAW_DEPTH_NEAR_EPS, SALTLINE_EXPOSURE_GLSL, SALTLINE_POST_COMMON } from './common.js';
import { SALTLINE_HORIZON_GLSL } from '../../sky.js';

/**
 * 只写深度的复制 pass：把不可采样的主 RT 深度写进带 DepthTexture 的目标供后续 pass 读取（关闭 colorWrite，depthFunc 恒通过）
 */
export var SALTLINE_DEPTHCOPY_FRAG = `${SALTLINE_POST_COMMON}
uniform sampler2D tDepth;
void main(){ gl_FragDepth = texture2D(tDepth, vUv).r; gl_FragColor = vec4(0.0); }`;

/**
 * 半分辨率线性深度：用 texelFetch 精确取 2×2 中的一个深度再反算视距，注释说明为何不能用 uv 采样（取样会跨行、在地面产生 AO 条纹）
 */
export var SALTLINE_DEPTHHALF_FRAG = `${SALTLINE_POST_COMMON}
uniform sampler2D tDepth; uniform float uNear, uFar;
void main(){
  // exact texel fetch: sampling at a texel corner would pick rows unpredictably and band the AO on grazing floors
  ivec2 p = min(ivec2(gl_FragCoord.xy) * 2, textureSize(tDepth, 0) - 1);
  float d = texelFetch(tDepth, p, 0).r;
  float z = d < ${GLSL_RAW_DEPTH_NEAR_EPS} ? 0.01 : (uNear * uFar) / (uFar - d * (uFar - uNear));
  gl_FragColor = vec4(z, 0.0, 0.0, 1.0);
}`;

/**
 * 半分辨率 SSAO：由四邻域深度差重建视空间法线，按 Vogel 螺旋在球内采样做遮挡积分，半径随距离略增；taps 由 define 按画质注入
 */
export var SALTLINE_AO_FRAG = `${SALTLINE_POST_COMMON}
uniform sampler2D tDepthHalf; uniform vec2 uTanHalf, uTexel; uniform float uRadius, uIntensity, uAspect;
vec3 vpos(vec2 uv, float z){ return vec3((uv * 2.0 - 1.0) * uTanHalf * z, -z); }
void main(){
  float z0 = texture2D(tDepthHalf, vUv).r;
  if (z0 < ${GLSL_LINEAR_DEPTH_NEAR_EPS} || z0 > 140.0) { gl_FragColor = vec4(1.0); return; }
  vec3 P = vpos(vUv, z0);
  vec2 ox = vec2(uTexel.x, 0.0), oy = vec2(0.0, uTexel.y);
  float zl = texture2D(tDepthHalf, vUv - ox).r, zr = texture2D(tDepthHalf, vUv + ox).r;
  float zd = texture2D(tDepthHalf, vUv - oy).r, zu = texture2D(tDepthHalf, vUv + oy).r;
  vec3 dx = abs(zl - z0) < abs(zr - z0) ? P - vpos(vUv - ox, zl) : vpos(vUv + ox, zr) - P;
  vec3 dy = abs(zd - z0) < abs(zu - z0) ? P - vpos(vUv - oy, zd) : vpos(vUv + oy, zu) - P;
  vec3 n = normalize(cross(dx, dy));
  float R = uRadius * (0.6 + 0.4 * clamp(z0 / 12.0, 0.0, 1.0));
  float rUv = clamp(R / (2.0 * z0 * uTanHalf.y), 3.0 * uTexel.y, 0.14);
  float R2 = R * R;
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;
  for (int i = 0; i < AO_TAPS; i++) {
    float a = (float(i) + 0.5) / float(AO_TAPS);
    float th = a * 6.2831853 * 3.0 + rot;
    vec2 o = vec2(cos(th), sin(th)) * a * rUv; o.x /= uAspect;
    vec2 uv2 = vUv + o;
    float z2 = texture2D(tDepthHalf, uv2).r;
    vec3 v = vpos(uv2, z2) - P;
    float vv = dot(v, v), vn = dot(v, n);
    float f = max(R2 - vv, 0.0);
    sum += f * f * f * max((vn - (0.015 + 0.004 * z0)) / (vv + 0.004), 0.0);
  }
  float ao = max(0.0, 1.0 - uIntensity * sum * 5.0 / (R2 * R2 * R2 * float(AO_TAPS)));
  ao = mix(ao, 1.0, smoothstep(70.0, 140.0, z0));
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

/**
 * 半分辨率体积光柱：射线步进累积双瓣 HG 相函数、太阳阴影可见性与高度衰减，仓库内部盒体额外加尘以显出门窗光柱；超出步进距离的远景用解析式接上该方向的地平线色避免断层
 */
export var SALTLINE_VOLUMETRIC_FRAG = `${SALTLINE_POST_COMMON}
uniform sampler2D tDepthHalf, tShadow;
uniform mat4 uShadowMatrix, uCamWorld;
uniform vec3 uCamPos, uSunRad, uAmb;
uniform vec2 uTanHalf;
uniform float uHasShadow, uMaxDist, uSigma, uFarZ, uFarHaze, uFlicker, uBoxDust;
uniform vec3 uBoxMin, uBoxMax;
${SALTLINE_HORIZON_GLSL}
float shape(float h){ return 0.30 + 0.70 * exp(-max(h, 0.0) / 5.5); }
float hg(float mu, float g){ float g2 = g * g; return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5)); }
float sunVis(vec3 p){
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 || sc.z < 0.0) return 1.0;
  float d = dot(texture2D(tShadow, sc.xy), vec4(0.99609375, 0.99609375 / 256.0, 0.99609375 / 65536.0, 1.0 / 16777216.0));
  return step(sc.z - 0.0006, d);
}
void main(){
  float z = texture2D(tDepthHalf, vUv).r;
  if (z < ${GLSL_LINEAR_DEPTH_NEAR_EPS}) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 vd = vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0);
  float rl = length(vd);
  vec3 rd = normalize(mat3(uCamWorld) * vd);
  float dist = z * rl;
  bool isSky = z > uFarZ * 0.97;
  float maxD = min(dist, isSky ? uMaxDist * 0.55 : uMaxDist);
  float mu = dot(rd, uSunDir);
  // two-lobe phase: tight forward lobe for the gold glow toward the sun + a broad lobe so side-lit shafts stay visible
  float ph = min(hg(mu, 0.78) * 0.55 + hg(mu, 0.25) * 0.45, 1.15);
  float j = ign(gl_FragCoord.xy);
  vec3 acc = vec3(0.0); float T = 1.0; float tPrev = 0.0;
  for (int i = 0; i < VOL_STEPS; i++) {
    float f = (float(i) + 1.0) / float(VOL_STEPS);
    float t1 = maxD * f * (0.35 + 0.65 * f);              // denser sampling near the eye
    float ds = t1 - tPrev;
    vec3 p = uCamPos + rd * (tPrev + ds * j);
    float sh = uHasShadow > 0.5 ? sunVis(p) : 1.0;
    // dusty interior (the shed): thicker air so sun shafts through doors, louvres and roof holes read; less sky ambient
    vec3 bq = step(uBoxMin, p) * step(p, uBoxMax); float inb = bq.x * bq.y * bq.z;
    float ext = uSigma * shape(p.y) * (1.0 + uBoxDust * inb);
    float Ti = exp(-ext * ds);
    // art direction: beams near the eye read strongly (shafts between stacks), the far field stays a restrained veil
    float nearW = mix(2.3, 0.55, smoothstep(4.0, 85.0, tPrev + ds * j));
    vec3 src = uSunRad * (ph * sh * mix(nearW, 1.6, inb)) + uAmb * (0.40 + 0.60 * sh) * mix(1.0, 0.22, inb);
    acc += T * src * (1.0 - Ti);
    T *= Ti; tPrev = t1;
  }
  // analytic continuation for far geometry (ship, cranes, skyline): fades into the horizon colour of that direction
  if (!isSky && dist > uMaxDist) {
    float h1 = uCamPos.y + rd.y * uMaxDist, h2 = uCamPos.y + rd.y * dist;
    float tau = uSigma * uFarHaze * (dist - uMaxDist) * 0.5 * (shape(h1) + shape(h2));
    float Tf = exp(-tau);
    vec3 hc = horizonColor(rd) * 0.50 + uAmb * 0.6;
    acc += T * hc * (1.0 - Tf);
    T *= Tf;
  }
  gl_FragColor = vec4(acc, T);
}`;

/**
 * 半分辨率缓冲的上采样合成：按深度做联合双边上采样把 AO 与体积光还原到全分辨率；遮蔽只压环境光并在亮部淡出以免出现脏光晕，体积光按 col·T+scatter 叠加
 */
export var SALTLINE_COMPOSITE_FRAG = `${SALTLINE_POST_COMMON}
uniform sampler2D tColor, tDepth, tDepthHalf, tAO, tVol;
uniform vec2 uHalfRes; uniform float uNear, uFar, uAoOn, uVolOn, uAoStrength;
${SALTLINE_EXPOSURE_GLSL}
void main(){
  vec3 col = max(texture2D(tColor, vUv).rgb, vec3(0.0));
  float d = texture2D(tDepth, vUv).r;
  if (d >= ${GLSL_RAW_DEPTH_NEAR_EPS}) {
    float z = (uNear * uFar) / (uFar - d * (uFar - uNear));
    // joint bilateral upsample of the half-res buffers
    vec2 hp = vUv * uHalfRes - 0.5; vec2 f = fract(hp); vec2 base = (floor(hp) + 0.5) / uHalfRes; vec2 tx = 1.0 / uHalfRes;
    float ao = 0.0; vec4 vol = vec4(0.0); float ws = 0.0;
    float zc = min(z, 300.0);
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(float(k & 1), float(k >> 1));
      vec2 uv = base + o * tx;
      float zh = min(texture2D(tDepthHalf, uv).r, 300.0);
      float w = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
      w *= 1.0 / (0.015 + abs(zh - zc) / zc) ;
      w = max(w, 1e-5);
      ao += texture2D(tAO, uv).r * w; vol += texture2D(tVol, uv) * w; ws += w;
    }
    ao /= ws; vol /= ws;
    if (uAoOn > 0.5 && d < 0.99999) {
      // occlusion belongs to ambient light: fade it out on brightly lit pixels so sunlit surfaces never get dirty halos
      float lit = smoothstep(0.16, 0.85, luma(col) * slExposure());
      float a = mix(1.0, ao, uAoStrength * (1.0 - 0.8 * lit));
      col *= mix(vec3(a), vec3(1.0), vec3(0.0, 0.03, 0.07));      // faintly cool occlusion
    }
    if (uVolOn > 0.5) col = col * vol.a + vol.rgb;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
