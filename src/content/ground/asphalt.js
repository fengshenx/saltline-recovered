// content/ground/asphalt.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { MARKING_BOUNDS, TERRAIN_BOUNDS } from './ground.js';

/**
 * 湿滑停机坪材质的 GLSL 公共层：哈希与值噪声、四抽样 B 样条双三次采样（放大时看不到数据图的纹素边）、单层稀疏雨滴涟漪的斜率
 */
var APRON_WET_SURF = `
uniform float uTime, uRain, uWetG, uReflOn, uReflLod, uMarkRes, uMaskRes;
uniform sampler2D uMask, uMarks, uDetail, uDetailN, uRefl;
uniform vec3 uMaskRect; uniform vec4 uMarkRect; uniform mat4 uReflMatrix; uniform vec2 uReflScale;
varying vec3 vGWorld;
float gRough; vec2 gNxz; float gPuddle; float gWet; float gFilm; float gSoak;
vec3 gHash3(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xxy + q.yzz) * q.zyx); }
float gH1(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float gVN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gH1(i), gH1(i + vec2(1.0, 0.0)), f.x), mix(gH1(i + vec2(0.0, 1.0)), gH1(i + vec2(1.0, 1.0)), f.x), f.y); }
// 4-tap B-spline bicubic of the base level: no texel edge of a data map can ever show, however close the camera is
vec4 gBicubic(sampler2D t, vec2 uv, float res){
  vec2 p = uv * res - 0.5; vec2 i = floor(p); vec2 f = p - i; vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i + w1 / g0 - 0.5) / res, h1 = (i + w3 / g1 + 1.5) / res;
  return (textureLod(t, vec2(h0.x, h0.y), 0.0) * g0.x + textureLod(t, vec2(h1.x, h0.y), 0.0) * g1.x) * g0.y
       + (textureLod(t, vec2(h0.x, h1.y), 0.0) * g0.x + textureLod(t, vec2(h1.x, h1.y), 0.0) * g1.x) * g1.y;
}
// one sparse layer of rain rings: every cell gets a new drop (position, size, strength) each cycle, thin soft crest
// that fades as it expands. Returns a slope (xz) contribution.
vec2 gRipple(vec2 p, float t, float cell, float seed){
  vec2 q = p / cell + seed * 17.3; vec2 id = floor(q); vec2 f = fract(q);
  vec3 h0 = gHash3(id + seed);
  float tt = t * (0.5 + 0.55 * h0.x) + h0.y * 9.0;
  float cyc = floor(tt), life = fract(tt);
  vec3 h = gHash3(id + seed + cyc * 7.31);
  vec3 hc = gHash3(id.yx + cyc * 3.71 + seed * 5.0);
  float on = step(h.z, 0.16 + 0.5 * uRain);
  float rmax = mix(0.1, 0.36, h.x * h.x);
  vec2 c = mix(vec2(rmax + 0.05), vec2(0.95 - rmax), hc.xy);
  vec2 dv = (f - c) * cell; float d = length(dv);
  float r = life * rmax * cell;
  float w = 0.005 + 0.02 * life;
  float x = (d - r) / w;
  float ring = x * exp(-x * x) * 2.3;
  float amp = 1.0 - life; amp = amp * amp * on * mix(0.3, 1.0, h.y) * smoothstep(0.0, 0.06, life);
  return (dv / max(d, 1e-4)) * ring * amp;
}
`;

/**
 * 湿滑停机坪的表面片元体：沥青与混凝土底色、6 米伸缩缝加焦油灌缝、裂缝、标线剥落与轮胎橡胶、油污，以及积水—浸湿—潮湿的连续梯度、粗糙度与法线斜率
 */
var APRON_WET_MAP_FRAG = `
{
  vec2 gxz = vGWorld.xz;
  float gDist = length(cameraPosition - vGWorld);
  // ---- unique large-scale masks (puddle height, dampness, oil, wear) ----
  vec2 muv = (gxz - uMaskRect.xy) * uMaskRect.z;
  float mIn = smoothstep(0.0, 0.05, min(min(muv.x, 1.0 - muv.x), min(muv.y, 1.0 - muv.y)));
  vec4 mk = mix(vec4(0.66, 0.5, 0.0, 0.5), gBicubic(uMask, muv, uMaskRes), mIn);
  // ---- tiling detail ----
  vec4 d1 = texture2D(uDetail, gxz * 0.21);
  vec4 d2 = texture2D(uDetail, gxz * 1.37 + 0.37);
  vec4 n1 = texture2D(uDetailN, gxz * 1.37 + 0.37);
  vec4 n0 = texture2D(uDetailN, gxz * 0.21);
  float grain = d2.r;
  // ---- slabs: 6 m expansion joints with tar sealing ----
  vec2 sj = gxz / 6.0;
  vec2 sf = (0.5 - abs(fract(sj) - 0.5)) * 6.0;
  float jd = min(sf.x, sf.y) + (d1.a - 0.5) * 0.035;
  float jaa = fwidth(jd) + 1e-5;
  float tarW = 0.022 + 0.03 * d1.g;
  float tar = (1.0 - smoothstep(tarW - jaa, tarW + jaa, jd)) * clamp(tarW / jaa, 0.0, 1.0);
  float groove = (1.0 - smoothstep(0.004, 0.012 + jaa, jd)) * clamp(0.02 / jaa, 0.0, 1.0);
  vec2 sid = floor(sj);
  float sh = fract(sin(dot(sid, vec2(127.1, 311.7))) * 43758.5453);
  float sh2 = fract(sh * 7.31 + 0.13);
  // ---- cracks, some sealed with tar ----
  float crArea = smoothstep(0.6, 0.76, mk.a * 0.7 + sh * 0.45);
  float cfw = fwidth(d1.b) * 1.5 + 0.004;
  float crack = smoothstep(0.955 - cfw, 0.975, d1.b) * crArea;
  float seal = smoothstep(0.915 - cfw, 0.94, d1.b) * crArea * step(0.72, sh2);
  // ---- base albedo: worn asphalt in the yard, concrete slabs on the quay ----
  float conc = smoothstep(15.6, 16.6, gxz.x + (d1.g - 0.5) * 0.6);
  vec3 alb = mix(vec3(0.125, 0.125, 0.13), vec3(0.22, 0.215, 0.2), conc);
  alb *= (0.8 + 0.4 * sh2) * (0.8 + 0.4 * d1.g) * (0.62 + 0.76 * grain);
  alb += vec3(0.11, 0.105, 0.095) * smoothstep(0.58, 0.78, d2.a) * (1.0 - conc * 0.6);    // pale aggregate
  float polish = smoothstep(0.38, 0.72, mk.a);                                            // traffic-polished lanes
  alb *= mix(1.0, 0.78, polish);
  alb = mix(alb, vec3(0.018, 0.018, 0.02), max(max(tar, seal * 0.4) * 0.94, crack * 0.9));
  alb *= 1.0 - 0.62 * mk.b;                                                               // oil
  // ---- painted markings (worn, chipped) + tyre rubber ----
  vec2 kuv = (gxz - uMarkRect.xy) * uMarkRect.zw;
  float kIn = step(0.0, kuv.x) * step(kuv.x, 1.0) * step(0.0, kuv.y) * step(kuv.y, 1.0);
  vec3 mp = texture2D(uMarks, kuv).rgb;
  float kpx = max(fwidth(kuv.x), fwidth(kuv.y)) * uMarkRes;
  if (kpx < 1.0) mp = mix(gBicubic(uMarks, kuv, uMarkRes).rgb, mp, smoothstep(0.5, 1.0, kpx));   // magnified: no texel blocks
  mp *= kIn;
  float kw = clamp(kpx * 0.5, 0.16, 0.5);
  // chips: world-space procedural noise down to sub-centimetre (never the texels of a map)
  float chipN = 0.5;
  if (max(mp.r, mp.g) > 0.02) {
    float cf2 = 1.0 - smoothstep(6.0, 18.0, gDist), cf3 = 1.0 - smoothstep(2.5, 7.0, gDist);
    chipN = gVN(gxz * 17.0) * 0.45 + mix(0.5, gVN(gxz * 57.0 + 11.0), cf2) * 0.33 + mix(0.5, gVN(gxz * 181.0 + 5.0), cf3) * 0.22;
  }
  float chip = chipN * 0.62 + d1.a * 0.38;
  float wear = clamp(mk.a * 1.25 - 0.22 + mp.b * 0.6, 0.0, 1.0);
  float wt = mix(0.24, 0.55, wear);
  float keep = smoothstep(wt - 0.045, wt + 0.045, chip) * (1.0 - max(tar, crack));
  float eN = (chipN - 0.5) * 0.55 * (1.0 - kw * 2.0);
  float pY = smoothstep(0.5 - kw, 0.5 + kw, mp.r + eN) * keep;
  float pW = smoothstep(0.5 - kw, 0.5 + kw, mp.g + eN) * keep;
  alb *= 1.0 - 0.6 * mp.b * (1.0 - 0.5 * conc);
  float fade = 0.72 + 0.28 * d1.g;
  alb = mix(alb, vec3(0.52, 0.34, 0.035) * fade, pY * 0.94);
  alb = mix(alb, vec3(0.47, 0.47, 0.44) * fade, pW * 0.94);
  float paint = max(pY, pW);
  // ---- water: one continuous gradient  standing water -> soaked band -> damp -> drier patches ----
  // organic shoreline: world-space noise (40 / 15 / 5 cm) on the water-level comparison, independent of the mask res
  float sf2 = 1.0 - smoothstep(25.0, 60.0, gDist), sf3 = 1.0 - smoothstep(8.0, 22.0, gDist);
  float sn1 = gVN(gxz * 2.5 + 3.0), sn2 = mix(0.5, gVN(gxz * 6.7 + 17.0), sf2), sn3 = mix(0.5, gVN(gxz * 20.0 + 9.0), sf3);
  float sn = sn1 * 0.5 + sn2 * 0.3 + sn3 * 0.2;
  float depth = 0.5 - mk.r + (sn - 0.5) * 0.11 + (d1.g - 0.5) * 0.03 + (grain - 0.5) * 0.012 + groove * 0.04 + crack * 0.02 - paint * 0.01;
  float puddle = smoothstep(0.0, 0.035, depth) * uWetG;                 // mirror weight (~5 cm ramp)
  float deep = smoothstep(0.0, 0.22, depth);                           // 0 at the rim (bed shows) .. 1 a hand deep
  float bandW = 0.05 + 0.15 * sn1 * sn1 + 0.05 * d1.g;                  // soaked band, roughly 10-30 cm, varies along the shore
  float soak = smoothstep(-bandW, 0.0, depth) * uWetG;
  float fringe = smoothstep(-0.65, -0.02, depth);                      // damp halo, about a metre
  float dryP = 1.0 - smoothstep(0.2, 0.42, mk.g + fringe * 0.55 + (d1.g - 0.5) * 0.25 + (sn - 0.5) * 0.12);
  float damp = (1.0 - dryP) * uWetG;
  float wet = clamp(damp * 0.7 + soak * 0.3, 0.0, 1.0);
  float film = clamp(soak * (1.0 - smoothstep(0.35, 0.95, grain + (1.0 - soak) * 0.6)) + groove * 0.5, 0.0, 1.0) * (1.0 - paint * 0.4);
  alb *= mix(0.95, mix(0.7, 0.54, 1.0 - paint), damp);
  alb *= mix(1.0, 0.5, soak);
  // standing water: shallow rim shows the wet bed, deeper water goes murky and dark (never a black cut-out)
  alb = mix(alb, alb * mix(0.85, 0.4, deep) + vec3(0.004, 0.006, 0.0065) * deep, puddle);
  diffuseColor.rgb *= alb;
  // ---- roughness: dry ~0.72 -> damp 0.36..0.56 -> soaked 0.1..0.2 -> water 0.055, all smooth ramps ----
  float rough = mix(0.74, 0.42, damp) + (grain - 0.5) * 0.24 + (d1.g - 0.5) * 0.16 + conc * 0.03 - paint * 0.05;
  rough -= polish * 0.07 + mk.b * 0.16 + max(tar, seal) * 0.1;
  rough = mix(rough, 0.2 + (grain - 0.5) * 0.14, soak * 0.9);
  rough = mix(rough, 0.13, film * 0.8);
  rough += smoothstep(10.0, 80.0, gDist) * 0.04;
  rough = mix(clamp(rough, 0.1, 1.0), 0.055, puddle);
  // ---- normal (world xz slope): aggregate grain + lumps break up the mirror outside puddles ----
  vec2 nxz = (n1.rg - 0.5) * mix(2.1, 0.7, max(film, soak * 0.6)) + (n0.ba - 0.5) * 0.3;
  nxz *= 1.0 - puddle;
  float wsum = puddle + film * 0.2;
  vec2 wv = texture2D(uDetailN, gxz * 0.13 + uTime * vec2(0.031, 0.017)).ba - 0.5;
  vec2 wv2 = texture2D(uDetailN, gxz.yx * 0.31 - uTime * vec2(0.043, 0.027)).ba - 0.5;
  if (wsum > 0.004) {
    float rf = 1.0 - smoothstep(10.0, 34.0, gDist);
    vec2 rip = vec2(0.0);
    if (rf > 0.0) {
      vec2 gp2 = vec2(0.8 * gxz.x - 0.6 * gxz.y, 0.6 * gxz.x + 0.8 * gxz.y);
      vec2 r2 = gRipple(gp2, uTime * 0.87, 1.31, 2.0);
      rip = gRipple(gxz, uTime, 0.83, 1.0) + vec2(0.8 * r2.x + 0.6 * r2.y, -0.6 * r2.x + 0.8 * r2.y) * 0.9 + gRipple(gxz.yx, uTime * 1.13, 0.57, 3.0).yx * 0.6;
      rip *= rf * (0.3 + 0.7 * uRain) * 0.3 * smoothstep(0.0, 0.08, depth);
    }
    nxz += (rip + (wv * 0.03 + wv2 * 0.018) * (0.4 + 0.6 * deep)) * wsum;
    rough += (1.0 - rf) * 0.03 * puddle * uRain;
  }
  gSoak = soak;
  gRough = rough; gNxz = nxz; gPuddle = puddle; gWet = wet; gFilm = film;
}
`;

/**
 * 把平面反射图按粗糙度与掠射角取多级模糊 lod 混合进 radiance：积水是锐利镜面，湿沥青只是被纵向拉伸的柔光，避免变成第二面镜子
 */
var APRON_WET_REFLECT_FRAG = `
{
  vec3 gV = normalize(cameraPosition - vGWorld);
  vec4 rc = uReflMatrix * vec4(vGWorld.x, 0.0, vGWorld.z, 1.0);
  vec2 ruv = rc.xy / max(rc.w, 1e-4);
  vec2 gf = normalize(-gV.xz + vec2(1e-5)); vec2 gs = vec2(-gf.y, gf.x);
  float sinE = clamp(gV.y, 0.03, 1.0);
  float dk = (gPuddle + gFilm * 0.15 + 0.03) / (1.0 + length(cameraPosition - vGWorld) * 0.07);
  vec2 tilt = vec2(dot(gNxz, gs) * sinE, dot(gNxz, gf)) * dk;
  tilt = clamp(tilt, vec2(-0.12), vec2(0.12));
  ruv += tilt * uReflScale;
  float r = material.roughness;
  // puddles: sharp mirror. Damp asphalt: only a heavily blurred, vertically stretched reflection that tightens a
  // little at grazing angles (so it reads as a sheen, not as a second mirror)
  float graz = pow(1.0 - clamp(gV.y, 0.0, 1.0), 5.0);
  float lodP = clamp(r * 9.5 - 0.45, 0.0, 6.5) + 0.9;      // puddles: a touch soft, never razor sharp
  float lodD = clamp(3.0 + r * 6.5 - 3.4 * graz, 2.0, 7.5);
  float lod = mix(mix(lodD, min(lodD, 2.6 + r * 5.0), gSoak), lodP, gPuddle) + uReflLod;
  vec2 st = vec2(0.0, r * 0.11 + (1.0 - gPuddle) * 0.05);
  vec2 lo = vec2(0.002), hi = vec2(0.998);
  vec3 pr = textureLod(uRefl, clamp(ruv, lo, hi), lod).rgb * 0.5
          + textureLod(uRefl, clamp(ruv + st, lo, hi), lod + 0.6).rgb * 0.25
          + textureLod(uRefl, clamp(ruv - st * 0.6, lo, hi), lod + 0.6).rgb * 0.25;
  pr = min(pr, vec3(48.0));
  float pw = mix(1.0 - smoothstep(0.55, 0.9, r), 1.0, max(gPuddle, gSoak)) * uReflOn;
  radiance = mix(radiance, pr, pw);
}
`;

/**
 * 创建停机坪地面（190×320 单面 plane）与注入了湿滑/反射着色器的 MeshStandardMaterial，返回材质、uniforms 和网格供地面系统每帧驱动
 */
export function createWetApron(game, tex) {
  let uniforms = {
      uTime: {
        value: 0,
      },
      uRain: {
        value: 0.6,
      },
      uWetG: (game.mats && game.mats.uniforms && game.mats.uniforms.wet) || {
        value: 1,
      },
      uReflOn: {
        value: 0,
      },
      uReflLod: {
        value: 0,
      },
      uMarkRes: {
        value: tex.marks.image.width,
      },
      uMaskRes: {
        value: tex.mask.image.width,
      },
      uMask: {
        value: tex.mask,
      },
      uMarks: {
        value: tex.marks,
      },
      uDetail: {
        value: tex.detail,
      },
      uDetailN: {
        value: tex.detailN,
      },
      uRefl: {
        value: tex.black,
      },
      uMaskRect: {
        value: new THREE.Vector3(TERRAIN_BOUNDS.x0, TERRAIN_BOUNDS.z0, 1 / TERRAIN_BOUNDS.size),
      },
      uMarkRect: {
        value: new THREE.Vector4(
          MARKING_BOUNDS.x0,
          MARKING_BOUNDS.z0,
          1 / MARKING_BOUNDS.w,
          1 / MARKING_BOUNDS.h,
        ),
      },
      uReflMatrix: {
        value: new THREE.Matrix4(),
      },
      uReflScale: {
        value: new THREE.Vector2(0.5, 0.5),
      },
    },
    material = new THREE.MeshStandardMaterial({
      color: 16777215,
      roughness: 1,
      metalness: 0,
    });
  ((material.name = 'apron_wet'),
    (material.onBeforeCompile = (r) => {
      (Object.assign(r.uniforms, uniforms),
        (r.vertexShader =
          `varying vec3 vGWorld;
` +
          r.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
  vGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
          )),
        (r.fragmentShader = r.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
` + APRON_WET_SURF,
          )
          .replace('#include <map_fragment>', APRON_WET_MAP_FRAG)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
  normal = normalize(mat3(viewMatrix) * normalize(vec3(-gNxz.x, 1.0, -gNxz.y)));`,
          )
          .replace(
            '#include <lights_physical_fragment>',
            `#include <lights_physical_fragment>
  material.specularColor = mix(material.specularColor, vec3(0.075), max(gPuddle, gSoak * 0.5));`,
          )
          .replace(
            '#include <lights_fragment_maps>',
            `#include <lights_fragment_maps>
` + APRON_WET_REFLECT_FRAG,
          )
          .replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
  reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(40.0));`,
          )));
    }),
    (material.customProgramCacheKey = () => 'saltline-apron-3'));
  let geometry = new THREE.PlaneGeometry(190, 320, 1, 1).rotateX(-Math.PI / 2).translate(-65, 0, 0),
    mesh = new THREE.Mesh(geometry, material);
  return (
    (mesh.receiveShadow = !0),
    (mesh.castShadow = !1),
    (mesh.name = 'apron'),
    (mesh.matrixAutoUpdate = !1),
    mesh.updateMatrix(),
    {
      mesh: mesh,
      material: material,
      uniforms: uniforms,
    }
  );
}

/**
 * 用镜像相机把场景再渲染一次得到平面反射贴图：含斜裁剪近平面修正与纹理矩阵、按画质档位缩放分辨率、渲染时临时隐藏自身相关网格，作为 prepass 挂在主循环上
 */
export function createPlanarReflectionPass(game, uniforms, exclude) {
  let mirrorCamera = new THREE.PerspectiveCamera();
  (mirrorCamera.layers.set(0), (mirrorCamera.matrixAutoUpdate = !0));
  let renderTarget = new THREE.WebGLRenderTarget(16, 16, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: !0,
    depthBuffer: !0,
    stencilBuffer: !1,
    samples: 0,
  });
  renderTarget.texture.name = 'planarReflection';
  let cameraPos = new THREE.Vector3(),
    lookDir = new THREE.Vector3(),
    cameraRotation = new THREE.Matrix4(),
    bufferSize = new THREE.Vector2(),
    mirrorPlane = new THREE.Plane(),
    clipPlane = new THREE.Vector4(),
    clipVector = new THREE.Vector4(),
    textureMatrix = new THREE.Matrix4().set(
      0.5,
      0,
      0,
      0.5,
      0,
      0.5,
      0,
      0.5,
      0,
      0,
      0.5,
      0.5,
      0,
      0,
      0,
      1,
    ),
    prevVisible = [],
    pass = {
      target: renderTarget,
      camera: mirrorCamera,
      enabled: !0,
      active: !1,
    };
  function renderReflection(g, x, boundsMin) {
    let boundsMax = game.quality.planar || 0;
    if (!pass.enabled || boundsMax <= 0) {
      ((uniforms.uReflOn.value = 0), (pass.active = !1));
      return;
    }
    if ((cameraPos.setFromMatrixPosition(boundsMin.matrixWorld), cameraPos.y < 0.03)) {
      ((uniforms.uReflOn.value = 0), (pass.active = !1));
      return;
    }
    let eachCorner = game.render && game.render.resolution;
    eachCorner && eachCorner.x > 8
      ? bufferSize.copy(eachCorner)
      : g.getDrawingBufferSize(bufferSize);
    let cornerIndex = Math.max(64, Math.round((bufferSize.x * boundsMax) / 16) * 16),
      _ = Math.max(32, Math.round((bufferSize.y * boundsMax) / 8) * 8);
    ((renderTarget.width !== cornerIndex || renderTarget.height !== _) &&
      renderTarget.setSize(cornerIndex, _),
      cameraRotation.extractRotation(boundsMin.matrixWorld),
      lookDir.set(0, 0, -1).applyMatrix4(cameraRotation).add(cameraPos),
      mirrorCamera.position.set(cameraPos.x, -cameraPos.y, cameraPos.z),
      mirrorCamera.up.set(0, 1, 0).applyMatrix4(cameraRotation),
      (mirrorCamera.up.y = -mirrorCamera.up.y),
      (lookDir.y = -lookDir.y),
      mirrorCamera.lookAt(lookDir),
      (mirrorCamera.near = boundsMin.near),
      (mirrorCamera.far = boundsMin.far),
      mirrorCamera.updateMatrixWorld(!0),
      mirrorCamera.matrixWorldInverse.copy(mirrorCamera.matrixWorld).invert(),
      mirrorCamera.projectionMatrix.copy(boundsMin.projectionMatrix),
      uniforms.uReflMatrix.value
        .copy(textureMatrix)
        .multiply(mirrorCamera.projectionMatrix)
        .multiply(mirrorCamera.matrixWorldInverse),
      mirrorPlane.normal.set(0, 1, 0),
      (mirrorPlane.constant = 0.01),
      mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse),
      clipPlane.set(
        mirrorPlane.normal.x,
        mirrorPlane.normal.y,
        mirrorPlane.normal.z,
        mirrorPlane.constant,
      ));
    let M = mirrorCamera.projectionMatrix.elements;
    ((clipVector.x = (Math.sign(clipPlane.x) + M[8]) / M[0]),
      (clipVector.y = (Math.sign(clipPlane.y) + M[9]) / M[5]),
      (clipVector.z = -1),
      (clipVector.w = (1 + M[10]) / M[14]),
      clipPlane.multiplyScalar(2 / clipPlane.dot(clipVector)),
      (M[2] = clipPlane.x),
      (M[6] = clipPlane.y),
      (M[10] = clipPlane.z + 1),
      (M[14] = clipPlane.w),
      mirrorCamera.projectionMatrixInverse.copy(mirrorCamera.projectionMatrix).invert());
    let E = boundsMin.projectionMatrix.elements;
    (uniforms.uReflScale.value.set(E[0] * 0.5, E[5] * 0.5),
      (uniforms.uReflLod.value = Math.log2(Math.max(_, 1) / 270)));
    for (let w = 0; w < exclude.length; w++)
      ((prevVisible[w] = exclude[w].visible), (exclude[w].visible = !1));
    try {
      game.render.renderWorld(mirrorCamera, renderTarget);
    } finally {
      for (let w = 0; w < exclude.length; w++) exclude[w].visible = prevVisible[w];
    }
    ((uniforms.uRefl.value = renderTarget.texture),
      (uniforms.uReflOn.value = 1),
      (pass.active = !0));
  }
  return ((pass.pass = renderReflection), pass);
}
