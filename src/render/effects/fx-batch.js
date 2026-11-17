// render/effects/fx-batch.js — 从 render/effects/particles.js 按职责拆出（贴花图集与 GPU 粒子批本是两件事）。

import * as THREE from 'three';
import { FX_SCRATCH_SIZE } from './effects.js';

/**
 * 特效 billboard 顶点着色器：支持面向相机、速度拉伸、贴面三种模式，图集取帧，并按距离维持最小屏幕宽度以免远处火花消失
 */
var FX_BILLBOARD_VERT = `
attribute vec4 aPos;    // xyz centre, w size (m)
attribute vec4 aAxis;   // mode 1: stretch axis (length = streak length); mode 2: plane normal; w = roll (rad)
attribute vec4 aCol;    // rgb (HDR), a
attribute vec4 aMisc;   // x atlas frame, y mode (0 billboard, 1 velocity-stretched, 2 surface-aligned), z age 0..1, w sun visibility
uniform vec2 uAtlas;
uniform float uPx;      // world size of one pixel at distance 1
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vOff;
varying vec3 vToCam;
varying vec3 vInfo;     // view z, age, shade
varying float vSoftD;
varying vec3 vT;
varying vec3 vB;
void main() {
  vec2 c = position.xy;
  vec3 center = aPos.xyz; float size = aPos.w; float mode = aMisc.y;
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 toCam = cameraPosition - center; float dist = length(toCam); toCam /= max(dist, 1e-4);
  float sn = sin(aAxis.w), cs = cos(aAxis.w);
  vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  vec3 off; float comp = 1.0;
  if (mode < 0.5) {
    off = (camR * rc.x + camU * rc.y) * size;
    vT = camR * cs + camU * sn; vB = camU * cs - camR * sn;
  } else if (mode < 1.5) {
    float len = length(aAxis.xyz); vec3 d = aAxis.xyz / max(len, 1e-5);
    vec3 side = cross(d, toCam); float sl = length(side); side = sl > 1e-3 ? side / sl : camR;
    float w = max(size, dist * uPx * 1.4); comp = size / w;
    if (aMisc.w > 1.5) w = min(w, dist * uPx * aMisc.w);       // additive only: cap on-screen width (tracers near the lens)
    off = d * (c.x * max(len, w)) + side * (c.y * w);
    vT = d; vB = side;
  } else {
    vec3 n = normalize(aAxis.xyz);
    vec3 t = normalize(abs(n.y) > 0.9 ? cross(n, vec3(1.0, 0.0, 0.0)) : cross(vec3(0.0, 1.0, 0.0), n));
    vec3 b = cross(n, t);
    off = (t * rc.x + b * rc.y) * size;
    vT = t * cs + b * sn; vB = b * cs - t * sn;
  }
  vec4 mv = viewMatrix * vec4(center + off, 1.0);
  gl_Position = projectionMatrix * mv;
  float f = floor(aMisc.x + 0.5);
  float col = mod(f, uAtlas.x), row = floor(f / uAtlas.x);
  vUv = (vec2(col, row) + c + 0.5) / uAtlas;
  vCol = vec4(aCol.rgb * comp, aCol.a);
  vOff = off / max(size, 1e-4);
  vToCam = toCam;
  vInfo = vec3(mv.z, aMisc.z, aMisc.w);
  vSoftD = clamp(size * 0.4, 0.04, 0.7);
}`;

/**
 * 特效片元共用部分：用深度纹理做软相交淡出，让烟与贴花贴地时不出现硬切边
 */
var FX_SOFT_FRAG = `
uniform sampler2D uTex;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform vec2 uNearFar;
uniform float uSoft;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vOff;
varying vec3 vToCam;
varying vec3 vInfo;
varying float vSoftD;
varying vec3 vT;
varying vec3 vB;
float softFade() {
  float s = 1.0;
  if (uSoft > 0.5) {
    float d = texture2D(uDepth, gl_FragCoord.xy / uRes).x;
    float zs = (uNearFar.x * uNearFar.y) / ((uNearFar.y - uNearFar.x) * d - uNearFar.y);
    s = clamp((vInfo.x - zs) / vSoftD, 0.0, 1.0);
  }
  return s;
}`;

/**
 * 受光特效片元：球面法线叠加翻页法线求光、前向散射、薄边透光，并带一条 alpha 混合的火焰分支（热核 / 橙皮 / 下方烟炱）
 */
var FX_LIT_FRAG =
  FX_SOFT_FRAG +
  `
uniform vec3 uSun, uSunDir, uAmbLo, uAmbHi;
void main() {
  vec4 t = texture2D(uTex, vUv);
  float er = vInfo.y * 0.45;                                  // wisps erode as the puff ages
  float a = smoothstep(er, er + (vInfo.z > 1.5 ? 0.38 : 0.6), t.a) * vCol.a;   // fire lobes: denser body, crisper edge
  a *= softFade() * smoothstep(0.2, 0.9, -vInfo.x);           // soft intersection + fade right at the lens
  if (a < 0.004) discard;
  vec3 V = normalize(vToCam);
  vec3 q = vOff * 2.0; float r2 = min(dot(q, q), 1.0);
  vec3 Ns = q + V * (sqrt(1.0 - r2) * 0.9 + 0.05);            // overall sphere normal
  vec2 tn = t.rg * 2.0 - 1.0;                                 // billow normal from the flipbook
  vec3 Nb = vT * tn.x + vB * tn.y + V * sqrt(max(1.0 - dot(tn, tn), 0.0));
  vec3 N = normalize(Ns * 0.55 + Nb);
  float wrap = clamp((dot(N, uSunDir) + 0.45) / 1.45, 0.0, 1.0);
  float back = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 5.0);   // looking into the sun: forward scatter through thin edges
  float thin = 1.0 - t.b * smoothstep(0.0, 0.5, a);
  float hot = step(1.5, vInfo.z), shade = vInfo.z - 2.0 * hot;      // aMisc.w >= 2: emissive fire lobe (colour = emission)
  vec3 sun = uSun * (wrap * wrap * 0.85 + back * (0.15 + 1.3 * thin)) * shade;
  vec3 amb = mix(uAmbLo, uAmbHi, N.y * 0.5 + 0.5) * (1.0 - 0.35 * t.b);
  vec3 col = vCol.rgb * (amb + sun);
  if (hot > 0.5) {
    // alpha-blended fire: hot dense cores, dim orange skin, soot underneath. Because it is NOT additive, overlapping lobes
    // keep their shape and smoke in front can occlude them.
    float lump = clamp(dot(tn, vec2(0.6, 0.8)) * 0.6 + 0.5, 0.0, 1.0);
    float core = t.b * t.b * smoothstep(0.15, 0.9, t.a);
    vec3 fire = vCol.rgb * (0.10 + 1.7 * core) * (0.45 + 1.1 * lump);
    col = vec3(0.045, 0.042, 0.04) * (amb + sun) + fire;
  }
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;                         // premultiply after the (possibly no-op) output transform
}`;

/**
 * 加色特效片元：单通道强度乘颜色，最省的路径，用于火花与曳光
 */
var FX_ADD_FRAG =
  FX_SOFT_FRAG +
  `
void main() {
  float t = texture2D(uTex, vUv).r;
  float k = t * vCol.a * softFade();
  if (k < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb * k, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * 创建实例化 billboard 批次：aPos/aAxis/aCol/aMisc 四条实例流，受光与加色两种材质，深度软相交与像素尺寸按相机自动更新，供粒子、曳光、火焰统一提交
 */
export function createFxBatch(
  game,
  capacity,
  {
    lit: litFlag,
    tex: atlasTex,
    cols: atlasCols,
    rows: atlasRows,
    renderOrder: meshOrder,
    sun: sunLight,
    sunDir: sunDirection,
    ambLo: ambLow,
    ambHi: ambHigh,
  },
) {
  let geometry = new THREE.InstancedBufferGeometry();
  (geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3,
    ),
  ),
    geometry.setIndex([0, 1, 2, 0, 2, 3]));
  let addInstanceAttribute = (S) => {
      let z = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      return (z.setUsage(THREE.DynamicDrawUsage), geometry.setAttribute(S, z), z);
    },
    posAttr = addInstanceAttribute('aPos'),
    axisAttr = addInstanceAttribute('aAxis'),
    colorAttr = addInstanceAttribute('aCol'),
    miscAttr = addInstanceAttribute('aMisc');
  geometry.instanceCount = 0;
  let uniforms = {
    uTex: {
      value: atlasTex,
    },
    uAtlas: {
      value: new THREE.Vector2(atlasCols, atlasRows),
    },
    uPx: {
      value: 0.001,
    },
    uDepth: {
      value: null,
    },
    uRes: {
      value: new THREE.Vector2(1, 1),
    },
    uNearFar: {
      value: new THREE.Vector2(0.08, 900),
    },
    uSoft: {
      value: 0,
    },
  };
  litFlag &&
    Object.assign(uniforms, {
      uSun: {
        value: sunLight,
      },
      uSunDir: {
        value: sunDirection,
      },
      uAmbLo: {
        value: ambLow,
      },
      uAmbHi: {
        value: ambHigh,
      },
    });
  let material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: FX_BILLBOARD_VERT,
    fragmentShader: litFlag ? FX_LIT_FRAG : FX_ADD_FRAG,
    transparent: !0,
    depthWrite: !1,
    depthTest: !0,
    side: THREE.DoubleSide,
    fog: !1,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: litFlag ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  material.name = litFlag ? 'fx_lit' : 'fx_add';
  let mesh = new THREE.Mesh(geometry, material);
  ((mesh.frustumCulled = !1),
    (mesh.renderOrder = meshOrder),
    (mesh.castShadow = !1),
    (mesh.receiveShadow = !1),
    (mesh.matrixAutoUpdate = !1),
    (mesh.name = material.name),
    (mesh.onBeforeRender = (rendererOrPositionX, sceneOrPositionY, cameraOrPositionZ) => {
      let renderTargetOrSize = rendererOrPositionX.getRenderTarget(),
        targetHeightOrAxisX;
      renderTargetOrSize
        ? (targetHeightOrAxisX = renderTargetOrSize.height)
        : (rendererOrPositionX.getDrawingBufferSize(FX_SCRATCH_SIZE),
          (targetHeightOrAxisX = FX_SCRATCH_SIZE.y));
      let projectionOrAxisY = cameraOrPositionZ.projectionMatrix.elements;
      uniforms.uPx.value =
        2 / (Math.max(projectionOrAxisY[5], 0.001) * Math.max(targetHeightOrAxisX, 1));
      let renderStateOrAxisZ = game.render,
        depthTextureOrAxisW = renderStateOrAxisZ && renderStateOrAxisZ.depthTexture;
      depthTextureOrAxisW &&
      depthTextureOrAxisW.image &&
      cameraOrPositionZ === game.camera &&
      renderStateOrAxisZ.depthTextureIsLive !== !0 &&
      game.params.fxsoft !== '0'
        ? ((uniforms.uDepth.value = depthTextureOrAxisW),
          (uniforms.uSoft.value = 1),
          renderStateOrAxisZ.resolution && renderStateOrAxisZ.resolution.x > 0
            ? uniforms.uRes.value.set(
                renderStateOrAxisZ.resolution.x,
                renderStateOrAxisZ.resolution.y,
              )
            : uniforms.uRes.value.set(
                depthTextureOrAxisW.image.width || 1,
                depthTextureOrAxisW.image.height || 1,
              ),
          uniforms.uNearFar.value.set(cameraOrPositionZ.near, cameraOrPositionZ.far))
        : ((uniforms.uDepth.value = null), (uniforms.uSoft.value = 0));
    }));
  let posArray = posAttr.array,
    axisArray = axisAttr.array,
    colorArray = colorAttr.array,
    miscArray = miscAttr.array,
    batch = {
      mesh: mesh,
      cap: capacity,
      n: 0,
      P: posArray,
      A: axisArray,
      C: colorArray,
      M: miscArray,
      begin() {
        batch.n = 0;
      },
      push(
        rendererOrPositionX,
        sceneOrPositionY,
        cameraOrPositionZ,
        renderTargetOrSize,
        targetHeightOrAxisX,
        projectionOrAxisY,
        renderStateOrAxisZ,
        depthTextureOrAxisW,
        colorRed,
        colorGreen,
        colorBlue,
        colorAlpha,
        miscFloatA,
        miscFloatB,
        miscFloatC,
        miscFloatD,
      ) {
        let instanceSlot = batch.n;
        if (instanceSlot >= capacity) return !1;
        let floatOffset = instanceSlot * 4;
        return (
          (posArray[floatOffset] = rendererOrPositionX),
          (posArray[floatOffset + 1] = sceneOrPositionY),
          (posArray[floatOffset + 2] = cameraOrPositionZ),
          (posArray[floatOffset + 3] = renderTargetOrSize),
          (axisArray[floatOffset] = targetHeightOrAxisX),
          (axisArray[floatOffset + 1] = projectionOrAxisY),
          (axisArray[floatOffset + 2] = renderStateOrAxisZ),
          (axisArray[floatOffset + 3] = depthTextureOrAxisW),
          (colorArray[floatOffset] = colorRed),
          (colorArray[floatOffset + 1] = colorGreen),
          (colorArray[floatOffset + 2] = colorBlue),
          (colorArray[floatOffset + 3] = colorAlpha),
          (miscArray[floatOffset] = miscFloatA),
          (miscArray[floatOffset + 1] = miscFloatB),
          (miscArray[floatOffset + 2] = miscFloatC),
          (miscArray[floatOffset + 3] = miscFloatD),
          (batch.n = instanceSlot + 1),
          !0
        );
      },
      end: null,
    },
    attributes = [posAttr, axisAttr, colorAttr, miscAttr];
  return (
    (batch.end = () => {
      let rendererOrPositionX = batch.n;
      if (
        ((geometry.instanceCount = rendererOrPositionX),
        (mesh.visible = rendererOrPositionX > 0),
        !!rendererOrPositionX)
      )
        for (let sceneOrPositionY = 0; sceneOrPositionY < 4; sceneOrPositionY++) {
          let cameraOrPositionZ = attributes[sceneOrPositionY];
          (cameraOrPositionZ.clearUpdateRanges(),
            cameraOrPositionZ.addUpdateRange(0, rendererOrPositionX * 4),
            (cameraOrPositionZ.needsUpdate = !0));
        }
    }),
    batch
  );
}

/**
 * 曳光池所有并行数组的字段名清单，交换删除时按此列表整体搬移，避免漏搬某个字段
 */
export var TRACER_FIELD_NAMES = [
  'fx',
  'fy',
  'fz',
  'dx',
  'dy',
  'dz',
  'dist',
  'speed',
  'trav',
  'len',
  'width',
  'r',
  'g',
  'b',
];
