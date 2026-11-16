// render/sky.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { SKY_COLORS, SUN } from '../core/config.js';

/**
 * 共享噪声前缀：基于 tNoise 采样贴图的 n2() 值噪声与 5/3 八度 fbm，被天空、体积光与镜头污渍等着色器 include，保证各 pass 用同一套噪声统计
 */
export var SALTLINE_NOISE_GLSL = `
uniform sampler2D tNoise;
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return texture2D(tNoise, (i + f + 0.5) / 256.0).r; }
float fbm5(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3; a *= 0.5; } return s / 0.96875; }
float fbm3(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a * n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3; a *= 0.5; } return s / 0.875; }
`;

/**
 * 共享地平线色函数：skyToSun 给出去向太阳的方位权重，horizonColor 按该权重混合背日/向日/近日三层暖色，天空与体积光的远景雾必须用同一函数才不会接缝
 */
export var SALTLINE_HORIZON_GLSL = `
uniform vec3 uSunDir, uZen, uHor, uHorAway, uSunCol;
float skyToSun(vec3 d){ return clamp(dot(normalize(d.xz + vec2(1e-5)), normalize(uSunDir.xz)) * 0.5 + 0.5, 0.0, 1.0); }
vec3 horizonColor(vec3 d){
  float ts = skyToSun(d);
  vec3 c = mix(uHorAway, uHorAway * 1.25 + vec3(0.05, 0.03, 0.02), smoothstep(0.2, 0.75, ts));
  c = mix(c, uHor * vec3(1.9, 1.55, 1.2), pow(ts, 6.0));
  c = mix(c, vec3(1.0, 0.60, 0.24) * 3.4, pow(ts, 34.0));
  return c;
}
`;

/**
 * 生成 256×256 随机值噪声贴图（xorshift 填充 RGBA，RepeatWrapping + 线性滤波 + 无 mipmap + NoColorSpace）：给 GLSL 的 n2()/fbm 提供可平铺重复的采样底图，不依赖外部图片
 */
export function createNoiseTexture() {
  let pixelData = new Uint8Array(262144),
    rngState = 2654435769,
    rand = () => (
      (rngState ^= rngState << 13),
      (rngState >>>= 0),
      (rngState ^= rngState >>> 17),
      (rngState ^= rngState << 5),
      (rngState >>>= 0),
      rngState / 4294967296
    );
  for (let pixelIndex = 0; pixelIndex < 256 * 256; pixelIndex++)
    ((pixelData[pixelIndex * 4] = rand() * 256),
      (pixelData[pixelIndex * 4 + 1] = rand() * 256),
      (pixelData[pixelIndex * 4 + 2] = rand() * 256),
      (pixelData[pixelIndex * 4 + 3] = 255));
  let noiseTexture = new THREE.DataTexture(
    pixelData,
    256,
    256,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  return (
    (noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping),
    (noiseTexture.magFilter = noiseTexture.minFilter = THREE.LinearFilter),
    (noiseTexture.generateMipmaps = !1),
    (noiseTexture.colorSpace = THREE.NoColorSpace),
    (noiseTexture.needsUpdate = !0),
    noiseTexture
  );
}

/**
 * 天空片元着色器：程序化云层（fbm 密度 + 云缘燃烧 + 云洞漏日 + 薄碎云）、日盘、云内闪电与海面雾霭；uEnv=1 时钳制高光并隐去日盘，供 PMREM 环境捕获不产生 firefly
 */
var SALTLINE_SKY_FRAG = `
// SALTLINE_SKY
precision highp float;
varying vec3 vDir;
uniform float uTime, uEnv, uFlash;
uniform vec3 uFlashDir;
${SALTLINE_NOISE_GLSL}
${SALTLINE_HORIZON_GLSL}

void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float mu = dot(d, uSunDir);
  float s = max(mu, 0.0);
  float ts = skyToSun(d);

  // ---- clear sky behind / below the deck ----
  vec3 hc = horizonColor(d);
  vec3 midC = mix(vec3(0.15, 0.24, 0.36), vec3(0.72, 0.50, 0.34), pow(ts, 3.0));   // pale band above the fire
  vec3 clearC = mix(hc, midC, smoothstep(0.0, 0.17, h));
  clearC = mix(clearC, vec3(0.085, 0.145, 0.24), smoothstep(0.10, 0.5, h));
  // aureole (mie glow round the sun)
  clearC += uSunCol * vec3(1.0, 0.86, 0.68) * (pow(s, 8.0) * 0.14 + pow(s, 64.0) * 0.55 + pow(s, 600.0) * 2.2 + pow(s, 6000.0) * 14.0);

  // ---- cloud deck ----
  vec2 cuv = d.xz / (h + 0.10) * vec2(0.62, 0.95);          // rolls of cloud run roughly east-west
  vec2 wind = vec2(-0.012, 0.004) * uTime;
  vec2 q = cuv + wind;
  float warp = fbm3(q * 0.45 + 7.1);
  vec2 qq = q + (warp - 0.5) * 1.3;
  float dens = fbm5(qq);
  // rippled underside (ridged detail), fading with distance so the horizon does not alias
  float ridg = 1.0 - abs(2.0 * fbm3(qq * 3.1 + 5.0) - 1.0);
  dens = dens * 0.86 + (ridg - 0.6) * 0.16 * smoothstep(0.03, 0.25, h);
  float big = n2(q * 0.19 + 3.7);
  float body = dens * 0.74 + big * 0.36;
  float cov = smoothstep(0.31, 0.50, body);
  // the deck ends above the eastern horizon: clear, burning gap toward the sun; almost down to the sea elsewhere
  float edge = mix(0.030, 0.285, pow(ts, 1.7));
  float rag = (n2(q * 0.9 + 11.0) - 0.5) * 0.16 + (dens - 0.5) * 0.10;
  float deck = smoothstep(edge - 0.035, edge + 0.11, h + rag * (0.35 + ts));
  cov *= deck;
  // the sun always burns through a ragged hole in the gap, never sits behind solid cloud
  float hole = smoothstep(0.972, 0.9985, mu + (dens - 0.5) * 0.012);
  cov *= 1.0 - 0.93 * hole;
  // thin scud drifting in the gap (veils the sun a little, catches fire)
  float scud = smoothstep(0.55, 0.85, fbm3(q * vec2(0.55, 1.9) + 31.0)) * (1.0 - deck) * smoothstep(0.02, 0.10, h) * 0.55 * (1.0 - 0.8 * hole);

  // lighting: density gradient toward the sun = self shadowing of the underside relief
  vec2 sd = normalize(uSunDir.xz);
  float densS = fbm5(qq + sd * 0.22);
  float relief = clamp((dens - densS) * 4.5 + 0.5, 0.0, 1.0);
  float thick = smoothstep(0.40, 0.72, body);
  vec3 cool = mix(vec3(0.155, 0.195, 0.255), vec3(0.030, 0.042, 0.064), thick);       // slate, darker where the deck is thick
  cool *= 0.55 + 0.9 * relief * relief;
  cool += vec3(0.07, 0.10, 0.15) * pow(1.0 - thick, 3.0);                             // thin spots let cold light through
  // warm light raking the underside from the gap: strongest near the sun and near the deck edge
  float nearSun = pow(ts, 5.0) * exp(-max(h - edge, 0.0) * 4.5) * 0.9 + pow(s, 7.0) * 0.9;
  vec3 warm = (uHor * vec3(1.30, 0.66, 0.40)) * nearSun * (0.05 + 2.2 * relief * relief * relief) * 1.15;
  // burning rim where cloud thins at the edge of the gap
  float rim = cov * (1.0 - cov) * 4.0;
  warm += uSunCol * rim * pow(ts, 4.0) * (0.5 + 1.6 * pow(s, 6.0)) * (1.0 - 0.85 * hole);
  vec3 cloudC = cool + warm;
  // sheet lightning inside the deck
  float fl = uFlash * pow(max(dot(d, uFlashDir), 0.0), 5.0);
  cloudC += vec3(0.55, 0.68, 1.0) * fl * (0.4 + 2.2 * dens * dens);
  // aerial perspective: far cloud melts into the horizon colour
  cloudC = mix(cloudC, hc * 0.55 + cloudC * 0.45, exp(-h * 11.0));

  vec3 col = mix(clearC, cloudC, cov * 0.985);
  vec3 scudC = mix(vec3(0.10, 0.11, 0.14), uHor * 1.5, pow(ts, 3.0)) + uSunCol * pow(s, 24.0) * 2.0;
  col = mix(col, scudC, scud);

  // sun disk (not in the environment capture: the directional light is the sun there)
  float veil = (1.0 - cov * 0.92) * (1.0 - scud * 0.7);
  float disk = smoothstep(0.999905, 0.999955, mu);
  col += vec3(1.0, 0.80, 0.52) * disk * 110.0 * veil * (1.0 - uEnv);

  // below the horizon: sea haze / ground bounce (mostly hidden by geometry)
  if (d.y < 0.0) {
    float t = clamp(-d.y * 5.0, 0.0, 1.0);
    vec3 low = mix(uHorAway * 0.42, vec3(0.060, 0.064, 0.070), uEnv);
    low += uHor * 0.55 * pow(ts, 6.0) * exp(d.y * 7.0);
    col = mix(hc + uSunCol * pow(s, 48.0) * 1.5, low, smoothstep(0.0, 1.0, t));
  }
  // keep the PMREM free of fireflies
  col = mix(col, min(col, vec3(6.0)), uEnv);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

/**
 * 天空盒顶点着色器：输出方向向量并把 gl_Position 的 z 压到 w（等价推到远平面），使天空始终铺满视野且不参与深度排序
 */
var SALTLINE_SKY_VERT = `
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`;

/**
 * 生成天空材质 uniform（噪声贴图、时间、环境模式、闪电强度/方向，以及从 SUN/SKY_COLORS 克隆的太阳与地平线色），真实天空与环境捕获共用同一套定义
 */
function createSkyUniforms(noiseTex) {
  return {
    tNoise: {
      value: noiseTex,
    },
    uTime: {
      value: 0,
    },
    uEnv: {
      value: 0,
    },
    uFlash: {
      value: 0,
    },
    uFlashDir: {
      value: new THREE.Vector3(-0.5, 0.5, -0.7).normalize(),
    },
    uSunDir: {
      value: SUN.dir.clone(),
    },
    uZen: {
      value: SKY_COLORS.zenith.clone(),
    },
    uHor: {
      value: SKY_COLORS.horizon.clone(),
    },
    uHorAway: {
      value: SKY_COLORS.horizonAway.clone(),
    },
    uSunCol: {
      value: SUN.color.clone(),
    },
  };
}

/**
 * 建天空网格：BackSide 盒体 + 定制 ShaderMaterial，关深度写入与雾、renderOrder=-1000、matrixAutoUpdate 关掉（始终随相机不参与变换），返回 mesh/material/geometry 三件套以便同一材质再用于环境捕获
 */
export function createSkyDome(noiseTex) {
  let skyMat = new THREE.ShaderMaterial({
      name: 'saltline-sky',
      side: THREE.BackSide,
      depthWrite: !1,
      depthTest: !0,
      fog: !1,
      toneMapped: !1,
      uniforms: createSkyUniforms(noiseTex),
      vertexShader: SALTLINE_SKY_VERT,
      fragmentShader: SALTLINE_SKY_FRAG,
    }),
    skyGeo = new THREE.BoxGeometry(2, 2, 2),
    skyMesh = new THREE.Mesh(skyGeo, skyMat);
  return (
    (skyMesh.name = 'sky'),
    (skyMesh.frustumCulled = !1),
    (skyMesh.renderOrder = -1e3),
    (skyMesh.castShadow = !1),
    (skyMesh.receiveShadow = !1),
    (skyMesh.matrixAutoUpdate = !1),
    {
      mesh: skyMesh,
      material: skyMat,
      geometry: skyGeo,
    }
  );
}

/**
 * 把天空材质克隆一份置 uEnv=1，用 PMREMGenerator 烘成环境贴图（烘完即 dispose 临时材质与生成器），使场景 IBL 与可见天空严格一致
 */
export function captureSkyEnvironment(renderer, sky) {
  let pmremGen = new THREE.PMREMGenerator(renderer),
    envMaterial = sky.material.clone();
  ((envMaterial.uniforms.tNoise.value = sky.material.uniforms.tNoise.value),
    (envMaterial.uniforms.uEnv.value = 1));
  let captureScene = new THREE.Scene(),
    skyBoxMesh = new THREE.Mesh(sky.geometry, envMaterial);
  ((skyBoxMesh.frustumCulled = !1), captureScene.add(skyBoxMesh));
  let envTarget = pmremGen.fromScene(captureScene, 0, 0.1, 100);
  return (envMaterial.dispose(), pmremGen.dispose(), envTarget);
}
