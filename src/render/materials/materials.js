// render/materials/materials.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  SALTLINE_HEIGHT_TO_NORMAL_FRAG,
  SALTLINE_TEX_COPY_FRAG,
  createDecalLibrary,
} from '../../assets/procedural/textures.js';

import { valueNoise3 } from '../../core/math.js';

import {
  FALLBACK_SPEC,
  SL_AOMAP_FRAGMENT,
  SL_FRAG_COMMON,
  SL_FRAG_MAP,
  SL_FRAG_METALNESS,
  SL_FRAG_NORMAL,
  SL_FRAG_ROUGHNESS,
  SL_VERT_POSITION,
  SL_VERT_VARYINGS,
  SURFACE_DEFS,
  SURFACE_LIB,
} from './catalog.js';

import {
  SALTLINE_FULLSCREEN_VERT,
  SALTLINE_SURF_MAIN_FRAG,
  SALTLINE_SURF_PRELUDE_FRAG,
  SURFACE_SHADERS,
} from './surface-shaders.js';

/**
 * 材质模块的导出命名空间（create/applyPatch/showcase 三个惰性 getter），在启动时作为 app.mats 挂到上下文上，避免模块循环依赖
 */
export var materialsModule = {};

/**
 * 湿润参数的四元组基线 [暗化, 粗糙度倍率, 垂直水痕, 水珠]，作为 makeSurfaceSpec 的默认值；朝向决定强弱，朝上的面才有水膜
 */
var WET_DEFAULT = [0.42, 0.38, 0.5, 0];

/**
 * 漆面湿润预设：漆膜淋雨后明显变暗、变亮（粗糙度大幅下降）并挂出水痕，被 paint/hazard/armor/hull 系列共用
 */
export var WET_PAINT = [0.05, 0.62, 0.65, 0.7];

/**
 * 镀锌/钢材湿润预设：金属面湿后粗糙度降得多但几乎不变色，水痕更硬更直
 */
export var WET_METAL = [0, 0.7, 0.55, 0.5];

/**
 * 锈面湿润预设：多孔锈层吸水后只轻微变暗、不变光滑，避免锈迹被雨水洗成镜面
 */
export var WET_RUST = [0.3, 0.6, 0.55, 0];

/**
 * 塑料/帆布湿润预设：介于漆面与金属之间的中性湿润，用于周转箱、油桶、篷布材质
 */
export var WET_PLASTIC = [0.08, 0.62, 0.6, 0.5];

/**
 * 木材湿润预设：吸水后略微变暗而不反光，用于托盘与木箱
 */
export var WET_WOOD = [0.4, 0.5, 0.6, 0];

/**
 * 全零湿润参数，彻底关闭天气光泽：铁丝网、玻璃、水面这些靠自身高光或透明度表现的表面不该再叠水膜
 */
export var WET_NONE = [0, 1, 0, 0];

/**
 * 宏观噪声（粗）预设：面板级别的大块色差与低频污垢，主要用于集装箱、墙面等大面积涂装
 */
export var MACRO_COARSE = [0.22, 0.12, 0.35, 0.35];

/**
 * 宏观噪声默认预设：中等幅度色差 + 中等污垢，内容未指定 macro 时使用
 */
var MACRO_DEFAULT = [0.14, 0.1, 0.8, 0.2];

/**
 * 宏观噪声（细）预设：高频、几乎无污垢，用于枪械、绳子、轮胎这类近距离小件
 */
export var MACRO_FINE = [0.07, 0.06, 3, 0];

/**
 * 全零宏观噪声，用于玻璃、铁丝网、水面等不该出现大块色差的表面
 */
export var MACRO_NONE = [0, 0, 1, 0];

/**
 * 生成一条材质规格：绑定纹理集 set，并把 tint 混合模式、color、rough/metal 倍率、wet/macro/nrm 全部补成默认值，SURFACE_LIB 里每条都经过它
 */
export var makeSurfaceSpec = (set, e = {}) => ({
  set: set,
  tint: 0,
  color: 16777215,
  rough: 1,
  metal: 1,
  wet: WET_DEFAULT,
  macro: MACRO_DEFAULT,
  nrm: 1,
  ...e,
});

/**
 * 把表面系统的 8 段 GLSL 按锚点注入 MeshStandardMaterial 的 onBeforeCompile 钩子并挂上 uniforms；这是所有自定义表面进入 three 标准光照的唯一入口，锚点一旦对不上就会静默失效
 */
export function patchMaterialShader(shader, uniforms) {
  (Object.assign(shader.uniforms, uniforms),
    (shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
` + SL_VERT_VARYINGS,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
` + SL_VERT_POSITION,
      )),
    (shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
` + SL_FRAG_COMMON,
      )
      .replace('#include <map_fragment>', SL_FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', SL_FRAG_ROUGHNESS)
      .replace('#include <metalnessmap_fragment>', SL_FRAG_METALNESS)
      .replace('#include <normal_fragment_maps>', SL_FRAG_NORMAL)
      .replace('#include <aomap_fragment>', SL_AOMAP_FRAGMENT)));
}

/**
 * 创建材质库：按需为每种表面烘出 albedo/ORM/法线三张 RT（先用 surf shader 渲进 MRT，再拆成可 mipmap 的独立贴图），生成并缓存 MeshStandardMaterial（带湿润/宏观/三平面 define 与稳定的 programCacheKey），并导出贴花、标牌、数字与自发光材质
 */
export async function createMaterials(app) {
  let renderer = app.renderer || (app.render && app.render.renderer),
    params = app.params || {},
    baseSize = +(params.tex || 0) || (app.quality && app.quality.tex) || 1024,
    texSize = Math.min(baseSize, 1024),
    anisotropy = Math.min(
      8,
      renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1,
    ),
    uniforms = {
      wet: {
        value: params.wet !== void 0 ? +params.wet : 1,
      },
    },
    stats = {
      sets: 0,
      bytes: 0,
      ms: 0,
    },
    blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    blitScene = new THREE.Scene(),
    blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  ((blitQuad.frustumCulled = !1), blitScene.add(blitQuad));
  let targetCache = new Map(),
    shaderCache = new Map(),
    setCache = new Map(),
    lastUseTime = 0,
    blitPasses = null,
    makeBlitMaterial = (O, q) =>
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: SALTLINE_FULLSCREEN_VERT,
        fragmentShader: O,
        uniforms: q,
        depthTest: !1,
        depthWrite: !1,
      });
  function getBlitPasses() {
    return (
      blitPasses ||
        (blitPasses = {
          normal: makeBlitMaterial(SALTLINE_HEIGHT_TO_NORMAL_FRAG, {
            tH: {
              value: null,
            },
            uK: {
              value: new THREE.Vector2(),
            },
            uTexel: {
              value: 0,
            },
          }),
          copy: makeBlitMaterial(SALTLINE_TEX_COPY_FRAG, {
            tA: {
              value: null,
            },
            uSq: {
              value: 0,
            },
          }),
        }),
      blitPasses
    );
  }
  function blit(O, q) {
    ((blitQuad.material = q), renderer.setRenderTarget(O), renderer.render(blitScene, blitCamera));
  }
  function makeTarget(O, q) {
    let U = new THREE.WebGLRenderTarget(O, O, {
      depthBuffer: !1,
      generateMipmaps: !0,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      anisotropy: anisotropy,
      colorSpace: q ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    return ((stats.bytes += O * O * 4 * 1.34), U);
  }
  function resolveTexSize(O) {
    let q = Math.round(texSize * O.size);
    return (O.hero && baseSize >= 2048 && (q = 2048), Math.max(32, q));
  }
  function generateSet(O) {
    let q = setCache.get(O);
    if (q) return q;
    let U = SURFACE_DEFS[O],
      T = performance.now(),
      D = resolveTexSize(U),
      C = Array.isArray(U.tile) ? U.tile : [U.tile, U.tile],
      G = targetCache.get(D);
    G ||
      ((G = new THREE.WebGLRenderTarget(D, D, {
        count: 3,
        depthBuffer: !1,
        generateMipmaps: !1,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
      })),
      targetCache.set(D, G));
    let j = shaderCache.get(U.fn);
    j ||
      ((j = makeBlitMaterial(
        SALTLINE_SURF_PRELUDE_FRAG + SURFACE_SHADERS[U.fn] + SALTLINE_SURF_MAIN_FRAG,
        {
          uP: {
            value: new THREE.Vector4(),
          },
          uSeed: {
            value: 0,
          },
          uTexel: {
            value: 0,
          },
        },
      )),
      shaderCache.set(U.fn, j));
    let N = U.p || [];
    (j.uniforms.uP.value.set(N[0] || 0, N[1] || 0, N[2] || 0, N[3] || 0),
      (j.uniforms.uSeed.value = U.seed || 0),
      (j.uniforms.uTexel.value = 1 / D));
    let Q = getBlitPasses(),
      K = renderer.getRenderTarget(),
      ie = renderer.autoClear,
      F = renderer.xr.enabled,
      X = renderer.shadowMap.autoUpdate;
    ((renderer.autoClear = !0),
      (renderer.xr.enabled = !1),
      (renderer.shadowMap.autoUpdate = !1),
      blit(G, j));
    let ne = makeTarget(D, !0),
      re = makeTarget(D, !1),
      $ = makeTarget(D, !1);
    ((Q.copy.uniforms.tA.value = G.textures[0]),
      (Q.copy.uniforms.uSq.value = 1),
      blit(ne, Q.copy),
      (Q.copy.uniforms.tA.value = G.textures[1]),
      (Q.copy.uniforms.uSq.value = 0),
      blit(re, Q.copy),
      (Q.normal.uniforms.tH.value = G.textures[2]),
      (Q.normal.uniforms.uTexel.value = 1 / D),
      Q.normal.uniforms.uK.value.set((U.bump * 0.001 * D) / C[0], (U.bump * 0.001 * D) / C[1]),
      blit($, Q.normal),
      renderer.setRenderTarget(K),
      (renderer.autoClear = ie),
      (renderer.xr.enabled = F),
      (renderer.shadowMap.autoUpdate = X));
    for (let ue of [ne, re, $])
      (ue.texture.repeat.set(1 / C[0], 1 / C[1]), (ue.texture.name = 'sl_' + O));
    return (
      (q = {
        key: O,
        albedo: ne.texture,
        orm: re.texture,
        normal: $.texture,
        tile: C,
        size: D,
        targets: [ne, re, $],
      }),
      setCache.set(O, q),
      stats.sets++,
      (stats.ms += performance.now() - T),
      (lastUseTime = performance.now()),
      q
    );
  }
  function disposeCaches() {
    for (let O of targetCache.values()) O.dispose();
    targetCache.clear();
    for (let O of shaderCache.values()) O.dispose();
    shaderCache.clear();
  }
  let materialCache = new Map(),
    warnedNames = new Set();
  function getMaterial(O, q = {}) {
    let U =
        O +
        '|' +
        (q.vertexColors ? 'v' : '') +
        (q.triplanar ? 't' + (q.scale || 1) : '') +
        (q.doubleSide ? 'd' : '') +
        (q.interior ? 'i' : '') +
        (q.color !== void 0 ? 'c' + q.color : ''),
      T = materialCache.get(U);
    if (T) return T;
    let D = SURFACE_LIB[O];
    D ||
      (warnedNames.has(O) ||
        (warnedNames.add(O), console.warn(`[mats] unknown material "${O}" \u2014 using fallback`)),
      (D = FALLBACK_SPEC));
    let C;
    try {
      C = generateSet(D.set);
    } catch (K) {
      return (
        warnedNames.has('gen:' + D.set) ||
          (warnedNames.add('gen:' + D.set),
          console.error(`[mats] texture set "${D.set}" failed: ${(K && K.message) || K}`)),
        (T = new THREE.MeshStandardMaterial({
          color: q.color !== void 0 ? q.color : D.tint ? D.color : 8421504,
          roughness: 0.6,
          metalness: 0,
          vertexColors: !!q.vertexColors,
        })),
        (T.name = O),
        materialCache.set(U, T),
        T
      );
    }
    let G = !!q.triplanar,
      j = !D.transparent && !D.alphaCut;
    ((T = new THREE.MeshStandardMaterial({
      map: C.albedo,
      normalMap: C.normal,
      roughnessMap: C.orm,
      metalnessMap: C.orm,
      aoMap: C.orm,
      color: q.color !== void 0 ? q.color : D.color,
      roughness: D.rough,
      metalness: D.metal,
      vertexColors: !!q.vertexColors,
    })),
      T.normalScale.set(D.nrm, D.nrm),
      (T.name = O),
      (q.doubleSide || D.side === 2) && (T.side = THREE.DoubleSide),
      D.transparent && ((T.transparent = !0), (T.depthWrite = !1), (T.envMapIntensity = 1.4)),
      D.alphaCut && (T.alphaTest = 0.5),
      (T.defines = {
        ...T.defines,
        SL_TINT: D.tint,
      }),
      G && (T.defines.SL_TRIPLANAR = ''),
      j && (T.defines.SL_FX = ''),
      D.alphaCut && !G && (T.defines.SL_ACUT = ''));
    let N = {
      uSlWet: uniforms.wet,
      uSlWetP: {
        value: new THREE.Vector4(...D.wet),
      },
      uSlMacro: {
        value: new THREE.Vector4(...D.macro),
      },
      uSlUv: {
        value: new THREE.Vector3(1, 1, G ? (q.scale || 1) / C.tile[0] : C.size),
      },
      uSlX: {
        value: new THREE.Vector2(q.interior ? 0.12 : 1, 0),
      },
    };
    ((T.userData.sl = N),
      (T.userData.set = C.key),
      (T.userData.tile = C.tile),
      q.interior && (T.userData.interior = !0),
      (T.onBeforeCompile = (K) => patchMaterialShader(K, N)));
    let Q = 'sl2|' + D.tint + (G ? 't' : '') + (j ? 'f' : '') + (D.alphaCut ? 'a' : '');
    return ((T.customProgramCacheKey = () => Q), materialCache.set(U, T), T);
  }
  function emissiveMaterial(O = 16777215, q = 4) {
    let U = 'em|' + O + '|' + q;
    if (materialCache.has(U)) return materialCache.get(U);
    let T = new THREE.MeshBasicMaterial({
      color: new THREE.Color(O).multiplyScalar(q),
      toneMapped: !0,
    });
    return ((T.name = 'emissive'), materialCache.set(U, T), T);
  }
  let decals = createDecalLibrary(app, anisotropy);
  return {
    get: getMaterial,
    emissive: emissiveMaterial,
    decal: decals.decal,
    label: decals.label,
    number: decals.number,
    names: Object.keys(SURFACE_LIB),
    decalNames: decals.names,
    uniforms: uniforms,
    update(O) {
      targetCache.size && performance.now() - lastUseTime > 4e3 && disposeCaches();
    },
    prewarm(O) {
      for (let q of O || Object.keys(SURFACE_LIB)) getMaterial(q);
    },
    stats() {
      return {
        sets: stats.sets,
        textureMB: +(stats.bytes / 1048576).toFixed(1),
        genMs: +stats.ms.toFixed(0),
        decalMB: +(decals.bytes() / 1048576).toFixed(1),
      };
    },
    tileOf(O) {
      let q = SURFACE_LIB[O];
      return q ? SURFACE_DEFS[q.set].tile : 1;
    },
  };
}

/**
 * 以材质库为键的 WeakMap 缓存：同一材质的铭牌/贴花材质只查一次，避免重复生成 canvas 纹理
 */
export var MATERIAL_LOOKUP_CACHE = new WeakMap();

/**
 * 顶点着色计算结果的三元缓存，逐顶点复用避免每顶点新分配数组
 */
var TMP_TINT_OUT = [1, 1, 1];

/**
 * 白色（不改变基色）的着色基准值，作为顶点着色的默认入参
 */
export var WHITE_TINT = [1, 1, 1];

/**
 * 按顶点坐标哈希出亮度与锈色偏移，给合批后的大网格制造脏旧色差，否则整面墙会是一条纯色
 */
export function tintByHash(vertexX, vertexY, vertexZ, baseTint = WHITE_TINT, strength = 1) {
  let coarseNoise = valueNoise3(vertexX * 0.31 + 11.3, vertexY * 0.23 + 5.1, vertexZ * 0.31 + 3.7),
    rustNoise = valueNoise3(vertexX * 1.7 + 40.2, 9.5, vertexZ * 1.7 + 17.9),
    brightness = 1 - strength * (0.3 - 0.36 * coarseNoise),
    tintR = baseTint[0] * brightness,
    tintG = baseTint[1] * brightness,
    tintB = baseTint[2] * brightness;
  if (rustNoise > 0.68) {
    let rustAmount =
      Math.min(1, (rustNoise - 0.68) / 0.3) *
      0.6 *
      strength *
      (0.35 + 0.65 * valueNoise3(vertexX * 0.9, vertexY * 0.45, vertexZ * 0.9));
    ((tintR *= 1 + 0.45 * rustAmount),
      (tintG *= 1 - 0.3 * rustAmount),
      (tintB *= 1 - 0.6 * rustAmount));
  }
  return (
    (TMP_TINT_OUT[0] = tintR),
    (TMP_TINT_OUT[1] = tintG),
    (TMP_TINT_OUT[2] = tintB),
    TMP_TINT_OUT
  );
}

/**
 * 登记表：标记哪些材质需要按顶点坐标写入随机顶点色，合批时据此决定是否补色
 */
export var TINTED_MATERIALS = new WeakSet();

/**
 * 取（或创建）带 vertexColors 的材质变体并登记到 TINTED_MATERIALS，是结构装配默认使用的材质入口
 */
export function getTintedMaterial(ctx, name, t = {}) {
  let n = ctx.mats.get(name, {
    vertexColors: !0,
    ...t,
  });
  return (TINTED_MATERIALS.add(n), n);
}
