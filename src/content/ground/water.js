// content/ground/water.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  SEA_WAVE_DETAIL,
  SEA_WAVE_MAIN,
  TERRAIN_BOUNDS,
  buildSeaGridSteps,
  formatGlslFloat,
} from './ground.js';

import { SKY_COLORS, SUN, WORLD_BOUNDS } from '../../core/config.js';

/**
 * 按主波浪谱逐波生成的顶点位移代码：沿波向正弦抬升，并附加 60% 幅度的水平轨道位移让浪形倾斜
 */
var SEA_WAVE_DISPLACE_VERT = SEA_WAVE_MAIN.map(
  (i) =>
    `  { float ph = ${formatGlslFloat(i[4])} * dot(vec2(${formatGlslFloat(i[0])}, ${formatGlslFloat(i[1])}), swp.xz) - ${formatGlslFloat(i[5])} * uTime; sdisp.y += ${formatGlslFloat(i[3])} * sin(ph); sdisp.xz += vec2(${formatGlslFloat(i[0])}, ${formatGlslFloat(i[1])}) * (${formatGlslFloat(i[3] * 0.6)} * cos(ph)); }`,
).join(`
`);

/**
 * 主波浪的逐波斜率（解析导数）累加代码，供片元法线使用，远处也不依赖贴图分辨率
 */
var SEA_WAVE_MAIN_SLOPE_FRAG = SEA_WAVE_MAIN.map(
  (i) =>
    `  slopeA += vec2(${formatGlslFloat(i[0])}, ${formatGlslFloat(i[1])}) * (${formatGlslFloat(i[3] * i[4])} * cos(${formatGlslFloat(i[4])} * dot(vec2(${formatGlslFloat(i[0])}, ${formatGlslFloat(i[1])}), sxz) - ${formatGlslFloat(i[5])} * uTime));`,
).join(`
`);

/**
 * 细节波浪的斜率累加代码，只按近处权重参与法线，避免远处高频噪点闪烁
 */
var SEA_WAVE_DETAIL_SLOPE_FRAG = SEA_WAVE_DETAIL.map(
  (i) =>
    `  slopeB += vec2(${formatGlslFloat(i[0])}, ${formatGlslFloat(i[1])}) * (${formatGlslFloat(i[3] * i[4])} * cos(${formatGlslFloat(i[4])} * dot(vec2(${formatGlslFloat(i[0])}, ${formatGlslFloat(i[1])}), sxz) - ${formatGlslFloat(i[5])} * uTime));`,
).join(`
`);

/**
 * 海面片元的 uniform 与全局变量声明（粗糙度、法线斜率 gNxz、遮蔽、到相机距离、太阳闪光强度），是表面体与后续 include 之间的契约
 */
var SEA_SURF_DECL = `
uniform float uTime; uniform sampler2D uDetail, uDetailN; uniform vec3 uHazeA, uHazeB, uSunDirW;
varying vec3 vGWorld; varying float vSAmp;
float gRough; vec2 gNxz; float gOcc; float gSDist; float gSpark;
`;

/**
 * 海面表面体：深色水体底色、码头墙与船体周围的泡沫和浮渣、风斑（cat's-paw）与长涌浪明暗、粗糙度随距离与风斑变化、岸边遮蔽
 */
var SEA_SURF_FRAG = `
{
  vec2 sxz = vGWorld.xz;
  float sd = length(cameraPosition - vGWorld); gSDist = sd;
  vec2 slopeA = vec2(0.0), slopeB = vec2(0.0);
${SEA_WAVE_MAIN_SLOPE_FRAG}
${SEA_WAVE_DETAIL_SLOPE_FRAG}
  float nearB = 1.0 - smoothstep(25.0, 110.0, sd);
  vec2 t1 = texture2D(uDetailN, sxz * 0.113 + uTime * vec2(-0.021, 0.009)).ba - 0.5;
  vec2 t2 = texture2D(uDetailN, sxz * 0.031 + uTime * vec2(-0.007, -0.004)).ba - 0.5;
  vec2 t3 = texture2D(uDetailN, sxz.yx * 0.39 + uTime * vec2(0.031, -0.027)).ba - 0.5;
  gNxz = slopeA * vSAmp + slopeB * nearB + t1 * 0.2 + t2 * 0.24 + t3 * 0.1 * nearB;
  // foam / scum along the quay wall (x = 30) and around the moored hull x[33,49] z[-60,-9]
  float dq = sxz.x - 30.0;
  vec2 hq = abs(sxz - vec2(41.0, -34.5)) - vec2(4.0, 21.5);
  float dh = length(max(hq, 0.0)) + min(max(hq.x, hq.y), 0.0) - 4.0;
  float de = min(dq, dh);
  vec4 fn = texture2D(uDetail, sxz * 0.41 + uTime * vec2(-0.012, 0.007));
  vec4 fn2 = texture2D(uDetail, sxz * 0.093 + uTime * vec2(0.004, 0.003));
  float band = 1.0 - smoothstep(0.0, 0.2 + fn2.g * fn2.g * 2.2, de);
  float foam = clamp(band * smoothstep(0.5, 0.68, fn.a * 0.55 + fn.r * 0.25 + fn2.g * 0.3 + band * 0.2), 0.0, 1.0) * step(-0.3, de);
  float scum = (1.0 - smoothstep(0.0, 5.0, de)) * smoothstep(0.4, 0.7, fn2.g);
  vec3 alb = vec3(0.0045, 0.013, 0.017);
  alb = mix(alb, vec3(0.03, 0.04, 0.034), scum * 0.6);
  alb = mix(alb, vec3(0.3, 0.32, 0.3), foam * 0.7);
  diffuseColor.rgb *= alb;
  // wind structure: broad cat's-paw patches (ruffled, darker, duller) between calmer slicks, plus long swell shading
  vec4 fn3 = texture2D(uDetail, sxz * 0.0123 + uTime * vec2(0.0016, 0.0011));
  float gust = smoothstep(0.38, 0.62, fn2.g * 0.45 + fn3.g * 0.75 - 0.1);
  float swell = sin(dot(sxz, vec2(-0.118, 0.05)) - uTime * 0.55 + fn3.a * 5.0) * 0.5 + 0.5;
  gNxz = gNxz * mix(0.4, 1.35, gust) + vec2(-0.92, 0.39) * (swell - 0.5) * 0.07;
  gSpark = mix(0.55, 1.0, swell) * mix(1.0, 0.6, gust);
  diffuseColor.rgb *= mix(1.0, 0.6, gust);
  gRough = mix(mix(0.1, 0.32, smoothstep(12.0, 380.0, sd)) * mix(0.62, 1.5, gust), 0.65, max(foam, scum * 0.3));
  gNxz *= 1.0 - foam * 0.6;
  gOcc = mix(0.3, 1.0, smoothstep(0.0, 8.0, de)) * mix(0.8, 1.05, swell);
}
`;

/**
 * 海面远处与雾霾融合：按视线方位与太阳方向在两种霾色之间插值，让海平线不再是一条硬边
 */
var SEA_HAZE_FRAG = `
{
  vec3 sdir = normalize(vGWorld - cameraPosition);
  float toSun = pow(max(dot(normalize(sdir.xz + vec2(1e-5)), normalize(uSunDirW.xz)), 0.0), 3.0);
  vec3 hz = mix(uHazeA, uHazeB, toSun);
  outgoingLight = mix(outgoingLight, hz, smoothstep(220.0, 860.0, gSDist) * 0.8);
}
`;

/**
 * 创建海面网格（分级网格加外围补片填满可视范围）、海面材质与码头裙板，含浪高位移、泡沫、太阳闪光与远雾融合着色
 */
export function createSeaSurface(game, tex) {
  let seaLevel = WORLD_BOUNDS.seaY,
    xSteps = buildSeaGridSteps(27.5, 880, 0.75, 1.075, 120),
    zSteps = buildSeaGridSteps(48, 880, 0.9, 1.085, 120),
    zRows = zSteps
      .map((shaderProgram) => -shaderProgram)
      .reverse()
      .concat(buildSeaGridSteps(-48 + 0.9, 48 - 0.9, 0.9, 1, 0.9), zSteps.slice(0)),
    xCount = xSteps.length,
    zCount = zRows.length,
    extraQuads = 12,
    positions = new Float32Array((xCount * zCount + extraQuads) * 3),
    indices = [],
    writeIdx = 0;
  for (let shaderProgram = 0; shaderProgram < zCount; shaderProgram++)
    for (let colIdx = 0; colIdx < xCount; colIdx++)
      ((positions[writeIdx++] = xSteps[colIdx]),
        (positions[writeIdx++] = seaLevel),
        (positions[writeIdx++] = zRows[shaderProgram]));
  for (let shaderProgram = 0; shaderProgram < zCount - 1; shaderProgram++)
    for (let colIdx = 0; colIdx < xCount - 1; colIdx++) {
      let topLeftIdx = shaderProgram * xCount + colIdx,
        topRightIdx = topLeftIdx + 1,
        bottomLeftIdx = topLeftIdx + xCount,
        bottomRightIdx = bottomLeftIdx + 1;
      indices.push(
        topLeftIdx,
        bottomLeftIdx,
        topRightIdx,
        topRightIdx,
        bottomLeftIdx,
        bottomRightIdx,
      );
    }
  let addQuad = (e1x, e1y, e1z, e2x) => {
    let e2y = writeIdx / 3;
    for (let [e2z, crossX] of [
      [e1x, e1y],
      [e1z, e1y],
      [e1x, e2x],
      [e1z, e2x],
    ])
      ((positions[writeIdx++] = e2z),
        (positions[writeIdx++] = seaLevel),
        (positions[writeIdx++] = crossX));
    indices.push(e2y, e2y + 2, e2y + 1, e2y + 1, e2y + 2, e2y + 3);
  };
  (addQuad(-880, -880, 27.5, -158), addQuad(-880, 158, 27.5, 880), addQuad(-880, -158, -158, 158));
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  let normals = new Float32Array(positions.length);
  for (let shaderProgram = 1; shaderProgram < normals.length; shaderProgram += 3)
    normals[shaderProgram] = 1;
  (geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)),
    geometry.setIndex(indices),
    (geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, seaLevel, 0), 1300)));
  let hazeAway = SKY_COLORS.horizonAway.clone().multiplyScalar(0.85),
    hazeToward = SKY_COLORS.horizon.clone().multiplyScalar(0.8),
    uniforms = {
      uTime: {
        value: 0,
      },
      uDetail: {
        value: tex.detail,
      },
      uDetailN: {
        value: tex.detailN,
      },
      uHazeA: {
        value: hazeAway,
      },
      uHazeB: {
        value: hazeToward,
      },
      uSunDirW: {
        value: SUN.dir.clone(),
      },
    },
    material = new THREE.MeshStandardMaterial({
      color: 16777215,
      roughness: 0.1,
      metalness: 0,
    });
  ((material.name = 'sea'),
    (material.onBeforeCompile = (shaderProgram) => {
      (Object.assign(shaderProgram.uniforms, uniforms),
        (shaderProgram.vertexShader =
          `uniform float uTime; varying vec3 vGWorld; varying float vSAmp;
` +
          shaderProgram.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
  vec3 swp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vSAmp = 1.0 - smoothstep(50.0, 220.0, distance(swp.xz, vec2(30.0, 0.0)));
  vec3 sdisp = vec3(0.0);
${SEA_WAVE_DISPLACE_VERT}
  transformed += sdisp * vSAmp;
  vGWorld = swp;`,
          )),
        (shaderProgram.fragmentShader = shaderProgram.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
` + SEA_SURF_DECL,
          )
          .replace('#include <map_fragment>', SEA_SURF_FRAG)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
  normal = normalize(mat3(viewMatrix) * normalize(vec3(-gNxz.x, 1.0, -gNxz.y)));`,
          )
          .replace(
            '#include <lights_fragment_maps>',
            `#include <lights_fragment_maps>
  radiance *= gOcc; iblIrradiance *= gOcc;`,
          )
          .replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
  { // sun glitter: strongest along the sun's azimuth, calmer to the sides; broken by swell and cat's paws
    vec3 sv = normalize(vGWorld - cameraPosition);
    float az = max(dot(normalize(sv.xz + vec2(1e-5)), normalize(uSunDirW.xz)), 0.0);
    reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(40.0)) * gSpark * mix(0.3, 1.0, az * az * az);
  }`,
          )
          .replace(
            '#include <opaque_fragment>',
            SEA_HAZE_FRAG +
              `
#include <opaque_fragment>`,
          )));
    }),
    (material.customProgramCacheKey = () => 'saltline-sea-1'));
  let mesh = new THREE.Mesh(geometry, material);
  ((mesh.name = 'sea'),
    (mesh.receiveShadow = !0),
    (mesh.castShadow = !1),
    (mesh.frustumCulled = !1),
    (mesh.matrixAutoUpdate = !1));
  let skirtMaterial = new THREE.MeshStandardMaterial({
      color: 724238,
      roughness: 0.55,
      metalness: 0,
    }),
    skirtMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(320, 4.4).rotateY(Math.PI / 2).translate(29.88, -2.18, 0),
      skirtMaterial,
    );
  return (
    (skirtMesh.name = 'quaySkirt'),
    (skirtMesh.receiveShadow = !0),
    (skirtMesh.matrixAutoUpdate = !1),
    {
      mesh: mesh,
      skirt: skirtMesh,
      uniforms: uniforms,
      material: material,
    }
  );
}

/**
 * 雨系顶点着色器的公共部分：室内盒体包含判定与 Henyey-Greenstein 相函数（逆光时雨丝边缘发亮）
 */
var RAIN_COMMON_VERT = `
uniform vec3 uBoxMin[4]; uniform vec3 uBoxMax[4];
bool wInside(vec3 p){
  for (int i = 0; i < 4; i++) { if (all(greaterThan(p, uBoxMin[i])) && all(lessThan(p, uBoxMax[i]))) return true; }
  return false;
}
float wPhase(float c){ float g = 0.72; return (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
`;

/**
 * 雨丝顶点着色器：种子在跟随相机的盒内循环下落，按室内盒体与天窗开口剔除并另有一条屋檐滴水管线，按距离维持最小屏幕宽度
 */
var RAIN_STREAK_VERT = `
uniform float uTime, uRain, uPix, uDrip; uniform vec3 uVel, uBox, uSunDir, uSunCol, uAmb;
attribute vec4 aSeed;
varying vec3 vCol; varying float vA; varying vec2 vUv;
${RAIN_COMMON_VERT}
uniform vec4 uSky[8];   // roof openings (x, z, half w, half d): rain falls through these into the shed
bool wSky(vec3 p){
  for (int i = 0; i < 8; i++) { if (abs(p.x - uSky[i].x) < uSky[i].z && abs(p.z - uSky[i].y) < uSky[i].w) return true; }
  return false;
}
void main(){
  vUv = position.xy;
  float sp = 0.82 + 0.36 * aSeed.w;
  vec3 vel = uVel * sp;
  vec3 p; float len; float kill = 0.0;
  if (aSeed.w < 0.0) {                       // eave drip line (shed south eave), free-fall from 7 m
    float T = 1.19; float t = fract(uTime / T * (0.9 + 0.2 * aSeed.y) + aSeed.z) * T;
    p = vec3(mix(-16.0, 12.0, aSeed.x), 7.0 - 4.9 * t * t, -10.72 + 0.05 * sin(aSeed.x * 911.0));
    vel = vec3(0.0, -9.81 * t - 0.3, 0.0); len = 0.022 * length(vel) + 0.03;
    kill = 1.0 - uDrip;
    if (fract(aSeed.x * 37.7) > 0.55 + 0.45 * uRain) kill = 1.0;
  } else {
    p = aSeed.xyz * uBox + vel * uTime;
    p = mod(p - cameraPosition + 0.5 * uBox, uBox) - 0.5 * uBox + cameraPosition;
    len = 0.03 * length(vel);
    if (fract(aSeed.w * 7.13 + aSeed.x) > uRain) kill = 1.0;
    if (wInside(p) && !wSky(p)) kill = 1.0;
  }
  if (p.y < (p.x > 30.0 ? -1.6 : 0.0)) kill = 1.0;
  vec3 dir = normalize(vel);
  vec3 toP = p - cameraPosition; float dist = length(toP);
  vec3 side = normalize(cross(dir, toP));
  float w0 = 0.005 + 0.004 * fract(aSeed.w * 3.7);
  float w = max(w0, dist * uPix * 0.75);
  vec3 wp = p + dir * (len * (position.y - 0.5)) + side * (w * position.x);
  float a = (w0 / w) * smoothstep(0.7, 2.6, dist) * (1.0 - smoothstep(0.38, 0.5, dist / uBox.x));
  float c = dot(toP / max(dist, 1e-3), uSunDir);
  vCol = uAmb + uSunCol * wPhase(c);
  vA = a * (0.55 + 0.45 * fract(aSeed.w * 13.3));
  gl_Position = kill > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

/**
 * 雨丝片元着色器：横向与纵向双向软化的加色细条，不采样纹理
 */
var RAIN_STREAK_FRAG = `
varying vec3 vCol; varying float vA; varying vec2 vUv;
void main(){
  float x = 1.0 - abs(vUv.x) * 2.0;
  float e = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
  gl_FragColor = vec4(vCol, vA * x * e);
}`;

/**
 * 溅水顶点着色器：只在积水掩膜处生成、按周期循环的水冠，靠近玩家更密，超出 15 米淡出
 */
var RAIN_SPLASH_VERT = `
uniform float uTime, uRain; uniform vec3 uSunDir, uSunCol, uAmb, uMaskRect; uniform sampler2D uMask;
attribute vec4 aSeed;
varying vec3 vCol; varying float vA; varying vec2 vUv; varying float vLife;
${RAIN_COMMON_VERT}
vec2 sHash(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
void main(){
  vUv = position.xy;
  float period = 0.26 + 0.14 * aSeed.z;
  float tt = uTime / period + aSeed.w * 10.0; float cyc = floor(tt); float life = fract(tt);
  vec2 r = sHash(aSeed.xy * 91.7 + cyc * 0.371);
  vec2 rr = r - 0.5; rr *= 0.35 + 1.3 * abs(rr);                    // denser near the player
  vec2 snap = floor(cameraPosition.xz / 4.0) * 4.0;
  vec3 p = vec3(snap.x + rr.x * 30.0, 0.0, snap.y + rr.y * 30.0);
  float kill = 0.0;
  vec2 muv = (p.xz - uMaskRect.xy) * uMaskRect.z;
  float inM = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  float pud = step(textureLod(uMask, muv, 0.0).r, 0.49) * inM;
  float k = fract(aSeed.w * 5.3 + cyc * 0.17);
  if (pud < 0.5 && k > 0.3) kill = 1.0;
  if (k > 0.2 + 0.8 * uRain) kill = 1.0;
  if (p.x > 29.7 || wInside(p + vec3(0.0, 0.2, 0.0))) kill = 1.0;
  float sz = mix(0.04, 0.08, aSeed.z) * mix(0.65, 1.0, pud);
  float wd = sz * (0.7 + 1.5 * life), ht = sz * (0.4 + 1.3 * sin(life * 3.14159));
  vec3 toP = p - cameraPosition; float dist = length(toP);
  vec3 side = normalize(vec3(toP.z, 0.0, -toP.x));
  vec3 wp = p + side * (wd * position.x * 2.0) + vec3(0.0, ht * position.y + 0.004, 0.0);
  float c = dot(toP / max(dist, 1e-3), uSunDir);
  vCol = uAmb * 1.4 + uSunCol * wPhase(c) * 0.8;
  vA = (1.0 - life) * (1.0 - smoothstep(11.0, 15.0, dist)) * mix(0.5, 1.0, pud);
  vLife = life;
  gl_Position = kill > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

/**
 * 溅水片元着色器：水冠圆弧加少量飞溅小点的软形状，alpha 随生命周期衰减
 */
var RAIN_SPLASH_FRAG = `
varying vec3 vCol; varying float vA; varying vec2 vUv; varying float vLife;
void main(){
  float x = vUv.x * 2.0, y = vUv.y;
  // little crown: a rim arc that opens outward, plus a few thrown droplets
  float dome = smoothstep(1.0, 0.25, length(vec2(x * 1.15, y * 1.5)));
  float crown = dome * (0.35 + 0.65 * smoothstep(0.25, 0.75, length(vec2(x, y * 1.4))));
  float core = smoothstep(0.5, 0.0, length(vec2(x * 1.6, (y - 0.25) * 1.6))) * (1.0 - vLife);
  float dots = smoothstep(0.16, 0.05, length(vec2(abs(x) - 0.75, y - 0.82))) + smoothstep(0.14, 0.04, length(vec2(x - 0.2, y - 0.93)));
  float a = clamp(crown * 0.5 + core * 0.8 + dots * 0.0, 0.0, 1.0) * vA * 0.6;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol, a);
}`;

/**
 * 构造雨丝与溅水共用的实例化四边形几何，每实例一个随机种子 aSeed；末尾 drips 个实例把种子写成负数，标记为屋檐滴水支线
 */
function createRainInstanceGeometry(streaks, drips, rng) {
  let rainGeo = new THREE.InstancedBufferGeometry();
  (rainGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3),
  ),
    rainGeo.setIndex([0, 1, 2, 2, 1, 3]));
  let seeds = new Float32Array((streaks + drips) * 4);
  for (let instIdx = 0; instIdx < (streaks + drips) * 4; instIdx++) seeds[instIdx] = rng();
  for (let instIdx = streaks; instIdx < streaks + drips; instIdx++) seeds[instIdx * 4 + 3] = -1;
  return (
    rainGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4)),
    (rainGeo.instanceCount = streaks + drips),
    (rainGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)),
    rainGeo
  );
}

/**
 * 创建雨丝与溅水两套加色实例网格及材质，按室内盒体、天窗开口与积水掩膜控制可见性，随画质缩放实例数，并定时发 thunder 事件驱动雷声与闪电
 */
export function createRainSystem(game, tex) {
  let rng = game.rng && game.rng.fork ? game.rng.fork() : Math.random,
    rainQuality = Math.max(0.15, game.quality.rain || 0.5),
    streakCount = Math.round(9e3 * rainQuality),
    dripCount = 260,
    splashCount = Math.round(900 * rainQuality),
    boxMin = [0, 1, 2, 3].map(() => new THREE.Vector3()),
    boxMax = [0, 1, 2, 3].map(() => new THREE.Vector3()),
    sunColor = SUN.color.clone().multiplyScalar(1.9),
    ambColor = SKY_COLORS.fog.clone().multiplyScalar(0.15),
    baseUniforms = {
      uTime: {
        value: 0,
      },
      uRain: {
        value: 0.6,
      },
      uBoxMin: {
        value: boxMin,
      },
      uBoxMax: {
        value: boxMax,
      },
      uSunDir: {
        value: SUN.dir.clone(),
      },
      uSunCol: {
        value: sunColor,
      },
      uAmb: {
        value: ambColor,
      },
    },
    skylights = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector4(0, 0, -1, -1)),
    streakUniforms = {
      ...baseUniforms,
      uSky: {
        value: skylights,
      },
      uPix: {
        value: 0.002,
      },
      uDrip: {
        value: 0,
      },
      uVel: {
        value: new THREE.Vector3(-2.6, -9.4, 1.1),
      },
      uBox: {
        value: new THREE.Vector3(26, 15, 26),
      },
    },
    streakMaterial = new THREE.ShaderMaterial({
      uniforms: streakUniforms,
      vertexShader: RAIN_STREAK_VERT,
      fragmentShader: RAIN_STREAK_FRAG,
      transparent: !0,
      depthWrite: !1,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: !1,
    }),
    streakMesh = new THREE.Mesh(
      createRainInstanceGeometry(streakCount, dripCount, rng),
      streakMaterial,
    );
  ((streakMesh.frustumCulled = !1),
    (streakMesh.renderOrder = 900),
    (streakMesh.name = 'rain'),
    (streakMesh.matrixAutoUpdate = !1),
    (streakMesh.castShadow = streakMesh.receiveShadow = !1));
  let splashUniforms = {
      ...baseUniforms,
      uMask: {
        value: tex.mask,
      },
      uMaskRect: {
        value: new THREE.Vector3(TERRAIN_BOUNDS.x0, TERRAIN_BOUNDS.z0, 1 / TERRAIN_BOUNDS.size),
      },
    },
    splashMaterial = new THREE.ShaderMaterial({
      uniforms: splashUniforms,
      vertexShader: RAIN_SPLASH_VERT,
      fragmentShader: RAIN_SPLASH_FRAG,
      transparent: !0,
      depthWrite: !1,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: !1,
    }),
    splashMesh = new THREE.Mesh(createRainInstanceGeometry(splashCount, 0, rng), splashMaterial);
  ((splashMesh.frustumCulled = !1),
    (splashMesh.renderOrder = 890),
    (splashMesh.name = 'rainSplash'),
    (splashMesh.matrixAutoUpdate = !1));
  let rainLevel = 0.6,
    targetLevel = 0.6,
    thunderIn = 22 + rng() * 25,
    time = 0,
    bufferSize = new THREE.Vector2();
  return {
    rain: streakMesh,
    splash: splashMesh,
    wind: streakUniforms.uVel.value,
    setRain(deltaSeconds) {
      targetLevel = Math.min(1, Math.max(0, deltaSeconds));
    },
    get rainLevel() {
      return rainLevel;
    },
    update(deltaSeconds) {
      ((time += deltaSeconds),
        (rainLevel += (targetLevel - rainLevel) * Math.min(1, deltaSeconds * 0.8)),
        (baseUniforms.uTime.value = time),
        (baseUniforms.uRain.value = rainLevel),
        (streakMesh.visible = splashMesh.visible = rainLevel > 0.01));
      let activeCamera = game.camera;
      if (activeCamera) {
        let bufferResolution = game.render && game.render.resolution;
        (bufferResolution && bufferResolution.x > 8
          ? bufferSize.copy(bufferResolution)
          : game.renderer.getDrawingBufferSize(bufferSize),
          (streakUniforms.uPix.value =
            (2 * Math.tan((activeCamera.fov * Math.PI) / 360)) / Math.max(1, bufferSize.y)));
      }
      let interiorBoxList = (game.level && game.level.interiorBoxes) || [];
      for (let bufferResolution = 0; bufferResolution < 4; bufferResolution++) {
        let boxEntry = interiorBoxList[bufferResolution];
        boxEntry && boxEntry.min && boxEntry.max
          ? (boxMin[bufferResolution].set(
              boxEntry.min.x - 0.15,
              boxEntry.min.y - 1,
              boxEntry.min.z - 0.15,
            ),
            boxMax[bufferResolution].set(
              boxEntry.max.x + 0.15,
              boxEntry.max.y + 0.3,
              boxEntry.max.z + 0.15,
            ))
          : (boxMin[bufferResolution].set(0, 0, 0), boxMax[bufferResolution].set(0, 0, 0));
      }
      streakUniforms.uDrip.value = interiorBoxList.length ? 1 : 0;
      let skylightList = (game.level && game.level.skylights) || [];
      for (let bufferResolution = 0; bufferResolution < 8; bufferResolution++) {
        let boxEntry = skylightList[bufferResolution];
        boxEntry && boxEntry.w > 0
          ? skylights[bufferResolution].set(
              boxEntry.x,
              boxEntry.z,
              boxEntry.w * 0.5,
              (boxEntry.d || boxEntry.w) * 0.5,
            )
          : skylights[bufferResolution].set(0, 0, -1, -1);
      }
      ((thunderIn -= deltaSeconds),
        thunderIn <= 0 &&
          ((thunderIn = 30 + rng() * 30),
          game.events.emit('thunder', {
            intensity: 0.3 + 0.7 * rng(),
          })));
    },
  };
}
