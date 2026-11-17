// content/level/buildings.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  beveledBoxGeometry,
  boxGeometry,
  createShadowMesh,
  cylinderGeometry,
  tubeGeometry,
} from '../../assets/procedural/geometry.js';

import { LABEL_ATLAS_GUTTER } from '../../assets/procedural/textures.js';

import { SHED_SKYLIGHT_HOLES } from '../backdrop/harbor-skyline.js';

import { PAINT_COLOR_ALIASES } from '../ground/ground.js';

import { PropAssembler } from '../props/detail-geometry.js';

import { addEuroPallet } from '../props/detailed-builders.js';

/**
 * 查漆色别名，未知别名回退到调用方给的默认色，保证 e.color 传错也不炸
 */
export function resolvePaintColorAlias(alias, e = 'blue') {
  return PAINT_COLOR_ALIASES[alias] || PAINT_COLOR_ALIASES[e];
}

/**
 * 单只木托盘道具，委托 addEuroPallet 生成
 */
export function buildPallet(ctx, opts, variant) {
  let n = new PropAssembler(ctx, 'pallet', variant);
  return (
    addEuroPallet(n, n.rng, {
      broken: !!opts.broken,
      bevel: !0,
    }),
    n.finish()
  );
}

/**
 * 不需要物理碰撞的道具白名单（交通锥、油桶体积小、踩过去无妨），关卡布置时跳过碰撞体生成
 */
var NO_COLLIDER_PROPS = new Set(['traffic_cone', 'jerry_can']);

/**
 * 关卡布置工具箱：提供静态/动态两个根节点与 add/box/slab/cyl/tube/rod/ibeam/quad/decal/label 造型语法、col 手动碰撞、place 摆道具并自动登记碰撞与 updater、stairs/catwalk 专用摆放、stack 集装箱堆叠（自动叠高、可带冷机）、isMetal 金属区查询
 */
export function createLevelKit(ctx) {
  let staticRoot = new THREE.Group();
  staticRoot.name = 'level-static';
  let dynRoot = new THREE.Group();
  dynRoot.name = 'level-dynamic';
  let metalRects = [],
    updaters = [],
    placed = [],
    rand = ctx.rng && ctx.rng.fork ? ctx.rng.fork() : Math.random,
    rnd = (T, D) => T + (D - T) * rand(),
    materialOf = (T, D) => ctx.mats.get(T, D),
    interiorMaterialOf = (T, D) =>
      ctx.mats.get(T, {
        interior: !0,
        ...(D || {}),
      }),
    resolveMaterial = (T) => (typeof T == 'string' ? materialOf(T) : T);
  function addMesh(T, D, C = {}) {
    let G = createShadowMesh(T, resolveMaterial(D), {
      cast: C.cast !== !1,
      recv: C.recv !== !1,
    });
    return (
      C.p && G.position.set(C.p[0], C.p[1], C.p[2]),
      C.r && G.rotation.set(C.r[0] || 0, C.r[1] || 0, C.r[2] || 0),
      (C.parent || staticRoot).add(G),
      G
    );
  }
  function box(T, D, C, G, j, N, Q, K = {}) {
    let ie = K.bevel ? beveledBoxGeometry(D, C, G, K.bevel) : boxGeometry(D, C, G);
    return addMesh(ie, T, {
      ...K,
      p: [j, N, Q],
    });
  }
  function slab(centroidX, centroidY, centroidZ, G, j, N, Q, K = {}) {
    return box(
      centroidX,
      Math.abs(j - centroidY),
      Math.abs(N - centroidZ),
      Math.abs(Q - G),
      (centroidY + j) / 2,
      (centroidZ + N) / 2,
      (G + Q) / 2,
      K,
    );
  }
  function cyl(T, D, C, G, j, N, Q = {}) {
    let K = cylinderGeometry(Q.rTop ?? D, D, C, Q.seg || 12, !!Q.open),
      ie =
        Q.axis === 'x'
          ? [0, 0, Math.PI / 2]
          : Q.axis === 'z'
            ? [Math.PI / 2, 0, 0]
            : Q.r || [0, 0, 0];
    return addMesh(K, T, {
      ...Q,
      p: [G, j, N],
      r: ie,
    });
  }
  function tube(T, D, C = 0.03, G = {}) {
    return addMesh(tubeGeometry(D, C, G.radial || 6, !1, G.tension ?? 0.5), T, G);
  }
  function rod(T, D, C, G = 0.015, j = {}) {
    let N = new THREE.Vector3(...D),
      Q = new THREE.Vector3(...C),
      K = N.distanceTo(Q),
      ie = cylinderGeometry(G, G, K, j.seg || 6),
      F = addMesh(ie, T, j);
    return (
      F.position.copy(N).add(Q).multiplyScalar(0.5),
      F.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Q.sub(N).normalize()),
      F
    );
  }
  function ibeam(
    T,
    D,
    C,
    G,
    j,
    N,
    {
      depth: Q = 0.4,
      width: K = 0.2,
      tf: ie = 0.02,
      tw: F = 0.012,
      depthAxis: X = null,
      r: ne = null,
    } = {},
  ) {
    let re = new THREE.Group();
    (re.position.set(G, j, N), ne && re.rotation.set(ne[0] || 0, ne[1] || 0, ne[2] || 0));
    let $ = X || (D === 'y' ? 'z' : 'y'),
      ue = ['x', 'y', 'z'].find((P) => P !== D && P !== $),
      me = (P, V, Y) => {
        let L = {};
        return ((L[D] = P), (L[$] = V), (L[ue] = Y), [L.x, L.y, L.z]);
      },
      ee = (P) => {
        let V = {
          x: 0,
          y: 0,
          z: 0,
        };
        return ((V[$] = P), [V.x, V.y, V.z]);
      },
      B = resolveMaterial(T);
    for (let P of [-1, 1])
      addMesh(boxGeometry(...me(C, ie, K)), B, {
        parent: re,
        p: ee(P * (Q / 2 - ie / 2)),
      });
    return (
      addMesh(boxGeometry(...me(C, Q - 2 * ie, F)), B, {
        parent: re,
      }),
      staticRoot.add(re),
      re
    );
  }
  function quad(T, D, C, G, j, N, Q = 'z+', K = 0) {
    let ie = new THREE.PlaneGeometry(D, C),
      F = new THREE.Mesh(ie, T);
    return (
      (F.castShadow = !1),
      (F.receiveShadow = !0),
      F.position.set(G, j, N),
      Q === 'z-'
        ? (F.rotation.y = Math.PI)
        : Q === 'x+'
          ? (F.rotation.y = Math.PI / 2)
          : Q === 'x-'
            ? (F.rotation.y = -Math.PI / 2)
            : Q === 'y+' && ((F.rotation.x = -Math.PI / 2), (F.rotation.z = K)),
      staticRoot.add(F),
      F
    );
  }
  function decalQuad(T, D, C, G, j, N, Q) {
    try {
      let K = ctx.mats.decal(T);
      return !K || !K.material ? null : quad(K.material, D, D / (K.aspect || 1), C, G, j, N, Q);
    } catch {
      return null;
    }
  }
  function labelQuad(T, D, C, G, j, N, Q) {
    try {
      let K = ctx.mats.label(T, Q || {});
      return !K || !K.material ? null : quad(K.material, D * (K.aspect || 4), D, C, G, j, N);
    } catch {
      return null;
    }
  }
  function col(T, D, C, G, j, N, Q = 'concrete', K = {}) {
    return ctx.physics.addBox([T, D, C], [G, j, N], {
      surface: Q,
      ...K,
    });
  }
  let box3Temp = new THREE.Box3();
  function addColliders(T, D, C = {}) {
    let G = T.userData.colliders || [],
      j = Math.abs(Math.sin(2 * D)) > 0.2;
    for (let N of G) {
      let Q = [N];
      if (j) {
        let K = N.max[0] - N.min[0],
          ie = N.max[2] - N.min[2],
          F = K >= ie ? 0 : 2,
          X = Math.max(K, ie),
          ne = Math.max(0.25, Math.min(K, ie)),
          re = Math.min(10, Math.max(1, Math.round(X / ne)));
        if (re > 1) {
          Q = [];
          for (let $ = 0; $ < re; $++) {
            let ue = N.min.slice(),
              me = N.max.slice();
            ((ue[F] = N.min[F] + (X * $) / re),
              (me[F] = N.min[F] + (X * ($ + 1)) / re),
              Q.push({
                min: ue,
                max: me,
                surface: N.surface,
              }));
          }
        }
      }
      for (let K of Q)
        if (
          (box3Temp.min.set(K.min[0], K.min[1], K.min[2]),
          box3Temp.max.set(K.max[0], K.max[1], K.max[2]),
          box3Temp.applyMatrix4(T.matrixWorld),
          !(box3Temp.max.y - box3Temp.min.y < 0.2 && box3Temp.max.y < 0.3))
        ) {
          if (j) {
            let ie = (box3Temp.max.x - box3Temp.min.x) * 0.07,
              F = (box3Temp.max.z - box3Temp.min.z) * 0.07;
            ((box3Temp.min.x += ie),
              (box3Temp.max.x -= ie),
              (box3Temp.min.z += F),
              (box3Temp.max.z -= F));
          }
          ctx.physics.addBox(box3Temp.min, box3Temp.max, {
            surface: K.surface || N.surface || 'metal',
            ...(C.colOpts || {}),
          });
        }
    }
  }
  function place(T, D, C, G = 0, j = {}, N = 0, Q = {}) {
    let K = ctx.props.build(T, j);
    return (
      K.position.set(D, N, C),
      (K.rotation.y = G),
      (Q.dynamic ? dynRoot : staticRoot).add(K),
      K.updateMatrixWorld(!0),
      !Q.noCol && !NO_COLLIDER_PROPS.has(T) && addColliders(K, G, Q),
      typeof K.userData.update == 'function' && updaters.push((ie) => K.userData.update(ie)),
      placed.push({
        name: T,
        x: D,
        y: N,
        z: C,
        yaw: G,
      }),
      K
    );
  }
  function stairs(T, D, C = 0, G = 0, j = {}) {
    let N = place('stairs_metal', T, D, C, j, G),
      Q = Math.abs(Math.cos(C)) > 0.5;
    return (
      metalRects.push(
        Q ? [T - 1.5, D - 0.5, T + 1.5, D + 0.5] : [T - 0.5, D - 1.5, T + 0.5, D + 1.5],
      ),
      N
    );
  }
  function catwalk(T, D, C = 0, G = 0, j = {}, N = [!0, !0]) {
    let Q = N[0] && N[1] ? 'both' : N[0] ? 'left' : N[1] ? 'right' : 'none',
      K = place(
        'catwalk',
        T,
        D,
        C,
        {
          ...j,
          rails: Q,
        },
        G,
      ),
      ie = Math.abs(Math.cos(C)) > 0.5,
      F = ie ? 1.5 : 0.6,
      X = ie ? 0.6 : 1.5;
    return (metalRects.push([T - F, D - X, T + F, D + X]), K);
  }
  let containerAliases = {
      20: 'container20',
      40: 'container40',
      hc: 'container40hc',
    },
    containerHeights = {
      container20: 2.59,
      container40: 2.59,
      container40hc: 2.9,
    },
    containerLengths = {
      container20: 6.06,
      container40: 12.19,
      container40hc: 12.19,
    };
  function stackContainers(T, D, C, G = 0, j = 1) {
    let N = 0,
      Q = [];
    for (let K = 0; K < C.length; K++) {
      let [ie, F, X = {}] = C[K],
        ne = containerAliases[ie],
        re = (X.dx || 0) + (K ? rnd(-0.05, 0.05) * j : 0),
        $ = (X.dz || 0) + (K ? rnd(-0.04, 0.04) * j : 0),
        ue = G + rnd(-1, 1) * 0.022 * j * (K ? 0.6 : 1) + (X.flip ? Math.PI : 0),
        me = place(
          ne,
          T + re,
          D + $,
          ue,
          {
            color: F,
            seed: Math.floor(rnd(1, 99999)),
            wear: X.wear ?? rnd(0.2, 0.85),
            doors: X.doors || 0,
          },
          N,
        ),
        ee = containerLengths[ne],
        B = containerHeights[ne],
        P = Math.abs(Math.cos(G)) > 0.5,
        V = (P ? ee : 2.44) / 2,
        Y = (P ? 2.44 : ee) / 2;
      if ((metalRects.push([T + re - V, D + $ - Y, T + re + V, D + $ + Y]), X.reefer)) {
        let L = -(ee / 2 + 0.2),
          Z = Math.cos(ue),
          J = Math.sin(ue);
        place(
          'reefer_unit',
          T + re + L * Z,
          D + $ - L * J,
          ue,
          {
            seed: K + 3,
          },
          N + 0.14,
        );
      }
      (Q.push(me), (N += B));
    }
    return {
      top: N,
      objs: Q,
    };
  }
  function isMetal(T, D) {
    for (let C of metalRects) if (T >= C[0] && T <= C[2] && D >= C[1] && D <= C[3]) return !0;
    return !1;
  }
  return {
    G: ctx,
    THREE: THREE,
    staticRoot: staticRoot,
    dynRoot: dynRoot,
    metalRects: metalRects,
    updaters: updaters,
    placed: placed,
    rng: rand,
    rnd: rnd,
    M: materialOf,
    MI: interiorMaterialOf,
    add: addMesh,
    box: box,
    slab: slab,
    cyl: cyl,
    tube: tube,
    rod: rod,
    ibeam: ibeam,
    quad: quad,
    decal: decalQuad,
    label: labelQuad,
    col: col,
    place: place,
    stairs: stairs,
    catwalk: catwalk,
    stack: stackContainers,
    isMetal: isMetal,
  };
}

/**
 * 把场景里所有 name='label' 的铭牌贴图重排进一张 canvas 图集并改写各网格 UV，把几十次铭牌绘制压成一次；失败时返回空句柄让调用方静默跳过
 */
export function buildLabelAtlas(
  root,
  { scale: atlasScale = 0.5, maxW: maxAtlasWidth = 2048 } = {},
) {
  let fallback = {
    count: 0,
    material: null,
    update() {},
  };
  if (typeof document > 'u') return fallback;
  let byMaterial = new Map();
  if (
    (root.traverse((item) => {
      if (!item.isMesh || Array.isArray(item.material)) return;
      let aux = item.material;
      if (!aux || aux.name !== 'label' || !aux.map || !aux.map.image || !aux.map.image.width)
        return;
      let ancestor = item,
        skipMerge = !1;
      for (; ancestor;) {
        if (ancestor.userData && ancestor.userData.noMerge) {
          skipMerge = !0;
          break;
        }
        ancestor = ancestor.parent;
      }
      skipMerge || (byMaterial.has(aux) || byMaterial.set(aux, []), byMaterial.get(aux).push(item));
    }),
    byMaterial.size < 2)
  )
    return fallback;
  let entries = [...byMaterial.keys()].map((item) => {
    let aux = item.map.image;
    return {
      m: item,
      img: aux,
      w: Math.max(4, Math.ceil(aux.width * atlasScale)),
      h: Math.max(4, Math.ceil(aux.height * atlasScale)),
    };
  });
  entries.sort((item, aux) => aux.h - item.h || aux.w - item.w);
  let cursorX = 0,
    cursorY = 0,
    rowHeight = 0;
  for (let item of entries) {
    let aux = Math.min(item.w, maxAtlasWidth - 2 * LABEL_ATLAS_GUTTER);
    (aux < item.w && ((item.h = Math.max(4, Math.round((item.h * aux) / item.w))), (item.w = aux)),
      cursorX + item.w + 2 * LABEL_ATLAS_GUTTER > maxAtlasWidth &&
        ((cursorX = 0), (cursorY += rowHeight), (rowHeight = 0)),
      (item.x = cursorX + LABEL_ATLAS_GUTTER),
      (item.y = cursorY + LABEL_ATLAS_GUTTER),
      (cursorX += item.w + 2 * LABEL_ATLAS_GUTTER),
      (rowHeight = Math.max(rowHeight, item.h + 2 * LABEL_ATLAS_GUTTER)));
  }
  let atlasWidth = maxAtlasWidth,
    atlasHeight = THREE.MathUtils.ceilPowerOfTwo(Math.max(16, cursorY + rowHeight));
  if (atlasHeight > 4096) return fallback;
  let canvas = document.createElement('canvas');
  ((canvas.width = atlasWidth), (canvas.height = atlasHeight));
  let ctx2d = canvas.getContext('2d'),
    repaint = () => {
      (ctx2d.setTransform(1, 0, 0, 1, 0, 0),
        (ctx2d.globalAlpha = 1),
        (ctx2d.globalCompositeOperation = 'source-over'),
        ctx2d.clearRect(0, 0, atlasWidth, atlasHeight));
      for (let idxC of entries)
        (ctx2d.drawImage(
          idxC.img,
          idxC.x - LABEL_ATLAS_GUTTER,
          idxC.y - LABEL_ATLAS_GUTTER,
          idxC.w + 2 * LABEL_ATLAS_GUTTER,
          idxC.h + 2 * LABEL_ATLAS_GUTTER,
        ),
          ctx2d.clearRect(idxC.x, idxC.y, idxC.w, idxC.h),
          ctx2d.drawImage(idxC.img, idxC.x, idxC.y, idxC.w, idxC.h),
          (idxC.version = idxC.m.map.version));
    };
  repaint();
  let baseMaterial = entries[0].m,
    atlasTexture = new THREE.CanvasTexture(canvas);
  ((atlasTexture.colorSpace = baseMaterial.map.colorSpace),
    (atlasTexture.anisotropy = baseMaterial.map.anisotropy),
    (atlasTexture.generateMipmaps = !0),
    (atlasTexture.minFilter = THREE.LinearMipmapLinearFilter));
  let atlasMaterial = baseMaterial.clone();
  ((atlasMaterial.map = atlasTexture), (atlasMaterial.name = 'label_atlas'));
  let geometryCache = new Map();
  for (let item of entries) {
    let aux = item.x / atlasWidth,
      ancestor = (item.x + item.w) / atlasWidth,
      skipMerge = 1 - item.y / atlasHeight,
      vMin = 1 - (item.y + item.h) / atlasHeight;
    for (let labelMesh of byMaterial.get(item.m)) {
      let cacheKey = labelMesh.geometry.uuid + '|' + item.m.uuid,
        cachedGeometry = geometryCache.get(cacheKey);
      if (!cachedGeometry) {
        cachedGeometry = labelMesh.geometry.clone();
        let uvAttr = cachedGeometry.attributes.uv;
        if (uvAttr) {
          for (let vertexIndex = 0; vertexIndex < uvAttr.count; vertexIndex++)
            uvAttr.setXY(
              vertexIndex,
              aux + THREE.MathUtils.clamp(uvAttr.getX(vertexIndex), 0, 1) * (ancestor - aux),
              vMin + THREE.MathUtils.clamp(uvAttr.getY(vertexIndex), 0, 1) * (skipMerge - vMin),
            );
          uvAttr.needsUpdate = !0;
        }
        geometryCache.set(cacheKey, cachedGeometry);
      }
      ((labelMesh.geometry = cachedGeometry), (labelMesh.material = atlasMaterial));
    }
  }
  let elapsed = 0;
  return {
    count: entries.length,
    material: atlasMaterial,
    size: [atlasWidth, atlasHeight],
    update(item) {
      if (!(elapsed > 8)) {
        elapsed += item;
        for (let aux of entries)
          if (aux.m.map.version !== aux.version) {
            (repaint(), (atlasTexture.needsUpdate = !0));
            break;
          }
      }
    },
  };
}

/**
 * 修理车间（BERTH 4 WORKSHOP）的平面与剖面尺寸：墙体 x/z 范围、檐口与屋脊高度、屋脊 z、地坪厚度，整栋建筑的唯一定义源
 */
export var SHED_BOUNDS = {
  X0: -16,
  X1: 12,
  Z0: -28,
  Z1: -11,
  EAVE: 7,
  RIDGE: 9.5,
  ZR: -19.5,
  FLOOR: 0.03,
};

/**
 * 车间沿 x 方向的 6 道墙板分格线，同时是抗风柱、屋架与地坪分段的参照点
 */
var SHED_BAY_XS = [-16, -11.1, -6.2, -0.8, 5.6, 12];

/**
 * 车间南墙卷帘门洞的 x 区间与门高，墙板铺装时在此挖空
 */
var SHED_DOOR_OPENING = {
  x0: -6,
  x1: -1,
  h: 5,
};

/**
 * 车间东墙采光窗洞的 z 区间与窗高
 */
var SHED_WINDOW_OPENING = {
  z0: -22,
  z1: -17,
  h: 4.5,
};

/**
 * 屋面沿坡长方向的分带比例（0=屋脊，1=檐口），决定天窗与屋面檩条的分段位置
 */
var ROOF_BAND_FRACTIONS = [-0.04, 0.25, 0.5, 0.75, 1];

/**
 * 屋面沿车间长度方向切分的列数，逐格铺屋面板并按 SHED_SKYLIGHT_HOLES 挖洞
 */
var ROOF_COLUMN_COUNT = 20;

/**
 * 搭建 BERTH 4 修理车间：瓦楞墙板与屋面、卷帘门、通风机、吊灯、货架与地面杂物，返回天窗矩形、室内灯光与中继节点位置
 */
export function buildWorkshopShed(ctx) {
  let {
      M: makeSurfaceMat,
      MI: matFlat,
      box: addBox,
      slab: addSlab,
      cyl: addCyl,
      rod: addRod,
      ibeam: addIBeam,
      col: addCollider,
      add: addGeometry,
      G: game,
    } = ctx,
    {
      X0: shedX0,
      X1: shedX1,
      Z0: shedZ0,
      Z1: shedZ1,
      EAVE: eaveY,
      RIDGE: ridgeY,
      ZR: ridgeZ,
      FLOOR: floorY,
    } = SHED_BOUNDS,
    halfDepth = (shedZ1 - shedZ0) / 2,
    riseH = ridgeY - eaveY,
    roofAngle = Math.atan2(riseH, halfDepth),
    slopeLen = Math.hypot(halfDepth, riseH),
    matLit = (L) => eaveY + riseH * (1 - Math.abs(L - ridgeZ) / halfDepth),
    roofOuterMat = makeSurfaceMat('corrugated_roof'),
    roofInnerMat = matFlat('corrugated_roof'),
    concreteMat = makeSurfaceMat('concrete'),
    concretePaintMat = matFlat('concrete_painted'),
    greyPaintMat = matFlat('paint_grey'),
    galvFlatMat = matFlat('steel_galv'),
    galvMat = makeSurfaceMat('steel_galv'),
    darkSteelMat = matFlat('steel_dark'),
    wallThickness = 0.25;
  (addSlab(matFlat('floor_epoxy'), shedX0, -0.25, shedZ0, shedX1, floorY, shedZ1, {
    cast: !1,
  }),
    addCollider(shedX0, -0.5, shedZ0, shedX1, floorY, shedZ1, 'concrete'),
    addSlab(
      concreteMat,
      SHED_DOOR_OPENING.x0 - 0.4,
      -0.2,
      shedZ1,
      SHED_DOOR_OPENING.x1 + 0.4,
      0.02,
      shedZ1 + 1.4,
      {
        cast: !1,
      },
    ),
    addSlab(
      concreteMat,
      shedX1,
      -0.2,
      SHED_WINDOW_OPENING.z0 - 0.4,
      shedX1 + 1.4,
      0.02,
      SHED_WINDOW_OPENING.z1 + 0.4,
      {
        cast: !1,
      },
    ));
  function wallSpanZ(L, Z, J, oe, fe, le) {
    if (oe - J < 0.02 || le - fe < 0.02) return;
    let R = L,
      I = L - Z * wallThickness;
    if (fe < 1.2) {
      let ae = L - Z * wallThickness * 0.5;
      (addSlab(
        concreteMat,
        J,
        floorY - 0.2,
        Math.min(R, ae),
        oe,
        Math.min(1.2, le),
        Math.max(R, ae),
        {
          bevel: 0.015,
        },
      ),
        addSlab(
          concretePaintMat,
          J,
          floorY - 0.2,
          Math.min(ae, I),
          oe,
          Math.min(1.2, le),
          Math.max(ae, I),
          {
            bevel: 0.015,
          },
        ));
    }
    let se = Math.max(fe, 1.2);
    le <= se ||
      (addSlab(
        roofOuterMat,
        J,
        se - 0.03,
        Math.min(R + Z * 0.02, R + Z * 0.06),
        oe,
        le,
        Math.max(R + Z * 0.02, R + Z * 0.06),
      ),
      addSlab(
        roofInnerMat,
        J,
        se,
        Math.min(R - Z * 0.1, R - Z * 0.13),
        oe,
        le,
        Math.max(R - Z * 0.1, R - Z * 0.13),
      ));
  }
  function wallSpanX(L, Z, J, oe, fe, le) {
    if (oe - J < 0.02 || le - fe < 0.02) return;
    let R = L,
      I = L - Z * wallThickness;
    if (fe < 1.2) {
      let ae = L - Z * wallThickness * 0.5;
      (addSlab(
        concreteMat,
        Math.min(R, ae),
        floorY - 0.2,
        J,
        Math.max(R, ae),
        Math.min(1.2, le),
        oe,
        {
          bevel: 0.015,
        },
      ),
        addSlab(
          concretePaintMat,
          Math.min(ae, I),
          floorY - 0.2,
          J,
          Math.max(ae, I),
          Math.min(1.2, le),
          oe,
          {
            bevel: 0.015,
          },
        ));
    }
    let se = Math.max(fe, 1.2);
    le <= se ||
      (addSlab(
        roofOuterMat,
        Math.min(R + Z * 0.02, R + Z * 0.06),
        se - 0.03,
        J,
        Math.max(R + Z * 0.02, R + Z * 0.06),
        le,
        oe,
      ),
      addSlab(
        roofInnerMat,
        Math.min(R - Z * 0.1, R - Z * 0.13),
        se,
        J,
        Math.max(R - Z * 0.1, R - Z * 0.13),
        le,
        oe,
      ));
  }
  function addGirtSpanZ(L, Z, J, oe, fe, le, R = 0.25, I = 0.45, se = 0.26) {
    let ae = Math.max(1, Math.floor((le - fe - 0.1) / I));
    for (let k = 0; k <= ae; k++) {
      let ce = fe + 0.08 + ((le - fe - 0.16) * k) / ae;
      addBox(galvMat, oe - J, 0.018, se, (J + oe) / 2, ce, L - Z * 0.06, {
        r: [Z * R, 0, 0],
      });
    }
    for (let k of [J + 0.03, oe - 0.03, (J + oe) / 2])
      addSlab(galvMat, k - 0.03, fe, L - Z * 0.2, k + 0.03, le, L + Z * 0.06);
    (addSlab(galvMat, J, fe - 0.05, L - Z * 0.2, oe, fe, L + Z * 0.07),
      addSlab(galvMat, J, le, L - Z * 0.2, oe, le + 0.05, L + Z * 0.07));
  }
  function addGirtSpanX(L, Z, J, oe, fe, le, R = 0.5, I = 0.45, se = 0.26) {
    let ae = Math.max(1, Math.floor((le - fe - 0.1) / I));
    for (let k = 0; k <= ae; k++) {
      let ce = fe + 0.08 + ((le - fe - 0.16) * k) / ae;
      addBox(galvMat, se, 0.018, oe - J, L - Z * 0.06, ce, (J + oe) / 2, {
        r: [0, 0, -Z * R],
      });
    }
    for (let k of [J + 0.03, oe - 0.03, (J + oe) / 2])
      addSlab(galvMat, L - Z * 0.2, fe, k - 0.03, L + Z * 0.06, le, k + 0.03);
    (addSlab(galvMat, L - Z * 0.2, fe - 0.05, J, L + Z * 0.07, fe, oe),
      addSlab(galvMat, L - Z * 0.2, le, J, L + Z * 0.07, le + 0.05, oe));
  }
  let sillY = 5.45,
    headerY = 6.8;
  for (let spanAxisPos = 0; spanAxisPos < SHED_BAY_XS.length - 1; spanAxisPos++) {
    let inwardSign = SHED_BAY_XS[spanAxisPos],
      spanStartPos = SHED_BAY_XS[spanAxisPos + 1];
    spanAxisPos === 2
      ? (wallSpanZ(shedZ1, 1, inwardSign, SHED_DOOR_OPENING.x0, 0, eaveY),
        wallSpanZ(shedZ1, 1, SHED_DOOR_OPENING.x1, spanStartPos, 0, eaveY),
        wallSpanZ(
          shedZ1,
          1,
          SHED_DOOR_OPENING.x0,
          SHED_DOOR_OPENING.x1,
          SHED_DOOR_OPENING.h,
          eaveY,
        ))
      : (wallSpanZ(shedZ1, 1, inwardSign, spanStartPos, 0, sillY - 0.05),
        wallSpanZ(shedZ1, 1, inwardSign, spanStartPos, headerY + 0.05, eaveY),
        addGirtSpanZ(shedZ1, 1, inwardSign + 0.15, spanStartPos - 0.15, sillY, headerY));
  }
  (wallSpanZ(shedZ0, -1, shedX0, shedX1, 0, eaveY),
    addSlab(
      matFlat('paint_grey'),
      6.2,
      floorY,
      shedZ0 + wallThickness,
      7.2,
      2.1,
      shedZ0 + wallThickness + 0.04,
    ),
    addSlab(makeSurfaceMat('paint_grey'), 6.2, 0, shedZ0 - 0.09, 7.2, 2.1, shedZ0 - 0.05),
    wallSpanX(shedX0, -1, shedZ0, shedZ1, 0, eaveY),
    wallSpanX(shedX1, 1, shedZ0, SHED_WINDOW_OPENING.z0, 0, sillY - 0.05));
  let doorOpening = {
    z0: -15.55,
    z1: -13.35,
    y0: 3.3,
  };
  (wallSpanX(shedX1, 1, SHED_WINDOW_OPENING.z1, doorOpening.z0, 0, sillY - 0.05),
    wallSpanX(shedX1, 1, doorOpening.z1, shedZ1, 0, sillY - 0.05),
    wallSpanX(shedX1, 1, doorOpening.z0, doorOpening.z1, 0, doorOpening.y0),
    addBox(
      roofOuterMat,
      0.03,
      1.5,
      1.05,
      shedX1 + 0.2,
      doorOpening.y0 - 0.55,
      doorOpening.z0 + 0.5,
      {
        r: [0.25, 0.1, -0.22],
      },
    ),
    addBox(roofOuterMat, 1, 0.03, 2, shedX1 + 1.3, 0.05, doorOpening.z0 + 1.6, {
      r: [0.02, 0.5, 0.03],
    }));
  for (let spanAxisPos of [doorOpening.z0, doorOpening.z1])
    addSlab(
      galvFlatMat,
      shedX1 - 0.16,
      doorOpening.y0,
      spanAxisPos - 0.03,
      shedX1 - 0.1,
      sillY - 0.05,
      spanAxisPos + 0.03,
    );
  (wallSpanX(
    shedX1,
    1,
    SHED_WINDOW_OPENING.z0,
    SHED_WINDOW_OPENING.z1,
    SHED_WINDOW_OPENING.h,
    sillY - 0.05,
  ),
    wallSpanX(shedX1, 1, shedZ0, shedZ1, headerY + 0.05, eaveY));
  for (let [spanAxisPos, inwardSign] of [
    [shedZ0 + 0.3, -22.45],
    [-22.15, -16.85],
    [-16.55, shedZ1 - 0.3],
  ])
    addGirtSpanX(shedX1, 1, spanAxisPos, inwardSign, sillY, headerY);
  let fanHole = {
    y: 8.02,
    r: 0.56,
  };
  function addGableEnds(L, Z, J) {
    let oe = (extrudeDepth, gableMat, xOffset) => {
      let roofShape = new THREE.Shape();
      if (
        (roofShape.moveTo(-(shedZ1 + 0.05), eaveY - 0.02),
        roofShape.lineTo(-ridgeZ, ridgeY),
        roofShape.lineTo(-(shedZ0 - 0.05), eaveY - 0.02),
        roofShape.closePath(),
        J)
      ) {
        let fanHolePath = new THREE.Path();
        (fanHolePath.absarc(-ridgeZ, fanHole.y, fanHole.r, 0, Math.PI * 2, !0),
          roofShape.holes.push(fanHolePath));
      }
      let gableGeo = new THREE.ExtrudeGeometry(roofShape, {
        depth: extrudeDepth,
        bevelEnabled: !1,
        curveSegments: 20,
      });
      (gableGeo.rotateY(Math.PI / 2),
        gableGeo.translate(L + xOffset, 0, 0),
        addGeometry(gableGeo, gableMat));
    };
    (oe(0.04, roofOuterMat, Z > 0 ? 0.02 : -0.06), oe(0.03, roofInnerMat, Z > 0 ? -0.13 : 0.1));
  }
  (addGableEnds(shedX1, 1, !0),
    addGableEnds(shedX0, -1, !1),
    addCollider(
      shedX0,
      0,
      shedZ1 - wallThickness,
      SHED_DOOR_OPENING.x0,
      eaveY,
      shedZ1 + 0.06,
      'metal',
    ),
    addCollider(
      SHED_DOOR_OPENING.x1,
      0,
      shedZ1 - wallThickness,
      shedX1,
      eaveY,
      shedZ1 + 0.06,
      'metal',
    ),
    addCollider(
      SHED_DOOR_OPENING.x0,
      SHED_DOOR_OPENING.h - 0.5,
      shedZ1 - 0.6,
      SHED_DOOR_OPENING.x1,
      eaveY,
      shedZ1 + 0.06,
      'metal',
    ),
    addCollider(shedX0, 0, shedZ0 - 0.06, shedX1, eaveY, shedZ0 + wallThickness, 'metal'),
    addCollider(shedX0 - 0.06, 0, shedZ0, shedX0 + wallThickness, ridgeY, shedZ1, 'metal'),
    addCollider(
      shedX1 - wallThickness,
      0,
      shedZ0,
      shedX1 + 0.06,
      ridgeY,
      SHED_WINDOW_OPENING.z0,
      'metal',
    ),
    addCollider(
      shedX1 - wallThickness,
      0,
      SHED_WINDOW_OPENING.z1,
      shedX1 + 0.06,
      ridgeY,
      -15.55,
      'metal',
    ),
    addCollider(shedX1 - wallThickness, 0, -13.35, shedX1 + 0.06, ridgeY, shedZ1, 'metal'),
    addCollider(shedX1 - wallThickness, 0, -15.55, shedX1 + 0.06, 3.3, -13.35, 'metal'),
    addCollider(shedX1 - wallThickness, 5.4, -15.55, shedX1 + 0.06, ridgeY, -13.35, 'metal'),
    addCollider(
      shedX1 - wallThickness,
      SHED_WINDOW_OPENING.h,
      SHED_WINDOW_OPENING.z0,
      shedX1 + 0.06,
      ridgeY,
      SHED_WINDOW_OPENING.z1,
      'metal',
    ));
  let skylights = [],
    columnWidth = (shedX1 - shedX0 + 0.6) / ROOF_COLUMN_COUNT,
    columnStartX = shedX0 - 0.3;
  for (let spanAxisPos of ['S', 'N']) {
    let inwardSign = spanAxisPos === 'S' ? 1 : -1,
      spanStartPos = [inwardSign * roofAngle, 0, 0],
      farEdgePos = Math.cos(roofAngle),
      lowEdgePos = inwardSign * Math.sin(roofAngle);
    for (let scratchValue = 0; scratchValue < 4; scratchValue++) {
      let innerFacePos = ROOF_BAND_FRACTIONS[scratchValue],
        bandEndValue = ROOF_BAND_FRACTIONS[scratchValue + 1],
        midValue = (innerFacePos + bandEndValue) / 2,
        stepIndex = (bandEndValue - innerFacePos) * slopeLen,
        spanMidCoord = ridgeZ + inwardSign * halfDepth * (1 - midValue),
        roofHeightAt = eaveY + riseH * midValue,
        columnCursor = 0;
      for (; columnCursor < ROOF_COLUMN_COUNT;) {
        if (
          SHED_SKYLIGHT_HOLES.some(
            (skylightHole) =>
              skylightHole[0] === spanAxisPos &&
              skylightHole[1] === scratchValue &&
              skylightHole[2] === columnCursor,
          )
        ) {
          columnCursor++;
          continue;
        }
        let runEndColumn = columnCursor;
        for (
          ;
          runEndColumn + 1 < ROOF_COLUMN_COUNT &&
          !SHED_SKYLIGHT_HOLES.some(
            (skylightHole) =>
              skylightHole[0] === spanAxisPos &&
              skylightHole[1] === scratchValue &&
              skylightHole[2] === runEndColumn + 1,
          );
        )
          runEndColumn++;
        let runStartX = columnStartX + columnCursor * columnWidth,
          runEndX = columnStartX + (runEndColumn + 1) * columnWidth,
          ribPanelCenterX = (runStartX + runEndX) / 2;
        (addBox(
          roofOuterMat,
          runEndX - runStartX,
          0.04,
          stepIndex + 0.02,
          ribPanelCenterX,
          roofHeightAt + farEdgePos * 0.03,
          spanMidCoord + lowEdgePos * 0.03,
          {
            r: spanStartPos,
          },
        ),
          addBox(
            roofInnerMat,
            runEndX - runStartX,
            0.02,
            stepIndex + 0.02,
            ribPanelCenterX,
            roofHeightAt - farEdgePos * 0.02,
            spanMidCoord - lowEdgePos * 0.02,
            {
              r: spanStartPos,
            },
          ));
        let bandEaveSideZ = ridgeZ + inwardSign * halfDepth * (1 - innerFacePos),
          bandRidgeSideZ = ridgeZ + inwardSign * halfDepth * (1 - bandEndValue);
        (addCollider(
          Math.max(runStartX, shedX0 - 0.3),
          eaveY + riseH * Math.max(0, innerFacePos) - 0.05,
          Math.min(bandEaveSideZ, bandRidgeSideZ),
          runEndX,
          eaveY + riseH * bandEndValue + 0.08,
          Math.max(bandEaveSideZ, bandRidgeSideZ),
          'metal',
          {
            noNav: !0,
          },
        ),
          (columnCursor = runEndColumn + 1));
      }
    }
    for (let scratchValue of SHED_SKYLIGHT_HOLES)
      if (scratchValue[0] === spanAxisPos) {
        let innerFacePos = ROOF_BAND_FRACTIONS[scratchValue[1]],
          bandEndValue = ROOF_BAND_FRACTIONS[scratchValue[1] + 1],
          midValue = columnStartX + scratchValue[2] * columnWidth,
          stepIndex = (innerFacePos + bandEndValue) / 2,
          spanMidCoord = ridgeZ + inwardSign * halfDepth * (1 - stepIndex),
          roofHeightAt = eaveY + riseH * stepIndex;
        (skylights.push({
          x: midValue + columnWidth / 2,
          y: roofHeightAt,
          z: spanMidCoord,
          w: columnWidth,
          d: (bandEndValue - innerFacePos) * halfDepth,
        }),
          ctx.decal(
            'leak_stain',
            1.9,
            midValue + columnWidth / 2 + 0.2,
            floorY + 0.004,
            spanMidCoord,
            'y+',
            scratchValue[2] * 1.7,
          ),
          addBox(
            galvFlatMat,
            0.05,
            0.05,
            (bandEndValue - innerFacePos) * slopeLen,
            midValue + 0.02,
            roofHeightAt - farEdgePos * 0.06,
            spanMidCoord - lowEdgePos * 0.06,
            {
              r: spanStartPos,
            },
          ),
          addBox(
            galvFlatMat,
            0.05,
            0.05,
            (bandEndValue - innerFacePos) * slopeLen,
            midValue + columnWidth - 0.02,
            roofHeightAt - farEdgePos * 0.06,
            spanMidCoord - lowEdgePos * 0.06,
            {
              r: spanStartPos,
            },
          ));
      }
    for (let scratchValue of [0.03, 0.2, 0.37, 0.54, 0.71, 0.88, 0.985]) {
      let innerFacePos = ridgeZ + inwardSign * halfDepth * (1 - scratchValue),
        bandEndValue = eaveY + riseH * scratchValue;
      addBox(
        galvFlatMat,
        shedX1 - shedX0 - 0.3,
        0.17,
        0.06,
        (shedX0 + shedX1) / 2,
        bandEndValue - farEdgePos * 0.13,
        innerFacePos - lowEdgePos * 0.13,
        {
          r: spanStartPos,
        },
      );
    }
    let highEdgePos = ridgeZ + inwardSign * (halfDepth + 0.38);
    (addSlab(
      galvMat,
      shedX0 - 0.3,
      eaveY - 0.22,
      Math.min(highEdgePos, highEdgePos + inwardSign * 0.16),
      shedX1 + 0.3,
      eaveY - 0.08,
      Math.max(highEdgePos, highEdgePos + inwardSign * 0.16),
    ),
      addSlab(
        galvMat,
        shedX0 - 0.3,
        eaveY - 0.22,
        Math.min(highEdgePos - inwardSign * 0.05, highEdgePos + inwardSign * 0.21),
        shedX1 + 0.3,
        eaveY - 0.19,
        Math.max(highEdgePos - inwardSign * 0.05, highEdgePos + inwardSign * 0.21),
      ));
    for (let scratchValue = 0; scratchValue < SHED_BAY_XS.length; scratchValue++) {
      if (spanAxisPos === 'S' && (scratchValue === 2 || scratchValue === 3)) continue;
      let innerFacePos =
          Math.min(shedX1 - 0.5, Math.max(shedX0 + 0.5, SHED_BAY_XS[scratchValue])) + 0.42,
        bandEndValue = ridgeZ + inwardSign * (halfDepth + 0.13);
      (addCyl(galvMat, 0.055, eaveY - 0.4, innerFacePos, (eaveY - 0.4) / 2 + 0.2, bandEndValue, {
        seg: 8,
      }),
        addRod(
          galvMat,
          [innerFacePos, eaveY - 0.2, bandEndValue],
          [innerFacePos, eaveY - 0.12, highEdgePos + inwardSign * 0.08],
          0.05,
        ));
      for (let midValue of [1.6, 3.6, 5.6])
        addBox(galvMat, 0.16, 0.04, 0.14, innerFacePos, midValue, bandEndValue - inwardSign * 0.02);
      addRod(
        galvMat,
        [innerFacePos, 0.2, bandEndValue],
        [innerFacePos + 0.02, 0.06, bandEndValue + inwardSign * 0.22],
        0.055,
      );
    }
  }
  for (let spanAxisPos of [-1, 1])
    addBox(
      galvMat,
      shedX1 - shedX0 + 0.7,
      0.03,
      0.34,
      (shedX0 + shedX1) / 2,
      ridgeY + 0.03,
      ridgeZ + spanAxisPos * 0.15,
      {
        r: [spanAxisPos * roofAngle, 0, 0],
      },
    );
  for (let spanAxisPos of [shedX0 - 0.31, shedX1 + 0.31])
    for (let inwardSign of [-1, 1])
      addBox(
        galvMat,
        0.04,
        0.22,
        slopeLen + 0.4,
        spanAxisPos,
        (eaveY + ridgeY) / 2 - 0.05,
        ridgeZ + inwardSign * (halfDepth / 2 + 0.1),
        {
          r: [inwardSign * roofAngle, 0, 0],
        },
      );
  let girtZs = [shedZ1 - wallThickness - 0.24, shedZ0 + wallThickness + 0.24];
  for (let spanAxisPos = 0; spanAxisPos < SHED_BAY_XS.length; spanAxisPos++) {
    let inwardSign =
      spanAxisPos === 0
        ? shedX0 + wallThickness + 0.12
        : spanAxisPos === SHED_BAY_XS.length - 1
          ? shedX1 - wallThickness - 0.12
          : SHED_BAY_XS[spanAxisPos];
    for (let spanStartPos of girtZs)
      (addIBeam(
        greyPaintMat,
        'y',
        eaveY - 0.35,
        inwardSign,
        floorY + (eaveY - 0.35) / 2,
        spanStartPos,
        {
          depth: 0.46,
          width: 0.22,
          depthAxis: 'z',
        },
      ),
        addBox(darkSteelMat, 0.36, 0.03, 0.62, inwardSign, floorY + 0.015, spanStartPos),
        addCollider(
          inwardSign - 0.12,
          0,
          spanStartPos - 0.24,
          inwardSign + 0.12,
          eaveY,
          spanStartPos + 0.24,
          'metal',
        ));
    for (let spanStartPos of [1, -1]) {
      let farEdgePos = ridgeZ + (spanStartPos * halfDepth) / 2 - spanStartPos * 0.14,
        lowEdgePos = eaveY + riseH / 2 - 0.42;
      (addIBeam(greyPaintMat, 'z', slopeLen - 0.5, inwardSign, lowEdgePos, farEdgePos, {
        depth: 0.4,
        width: 0.2,
        depthAxis: 'y',
        r: [spanStartPos * roofAngle, 0, 0],
      }),
        addBox(
          greyPaintMat,
          0.014,
          0.5,
          1.5,
          inwardSign,
          eaveY - 0.55,
          ridgeZ + spanStartPos * (halfDepth - wallThickness - 0.9),
          {
            r: [spanStartPos * (roofAngle + 0.22), 0, 0],
          },
        ),
        addBox(
          greyPaintMat,
          0.2,
          0.02,
          1.55,
          inwardSign,
          eaveY - 0.82,
          ridgeZ + spanStartPos * (halfDepth - wallThickness - 0.95),
          {
            r: [spanStartPos * (roofAngle + 0.42), 0, 0],
          },
        ));
    }
    addBox(greyPaintMat, 0.22, 0.5, 0.03, inwardSign, ridgeY - 0.55, ridgeZ);
  }
  for (let spanAxisPos of [shedX0 + wallThickness + 0.12, shedX1 - wallThickness - 0.12])
    for (let inwardSign of [-22.3, -16.7]) {
      let spanStartPos = matLit(inwardSign) - 0.55;
      (addIBeam(
        greyPaintMat,
        'y',
        spanStartPos,
        spanAxisPos,
        floorY + spanStartPos / 2,
        inwardSign,
        {
          depth: 0.3,
          width: 0.18,
          depthAxis: 'x',
        },
      ),
        addCollider(
          spanAxisPos - 0.16,
          0,
          inwardSign - 0.1,
          spanAxisPos + 0.16,
          spanStartPos,
          inwardSign + 0.1,
          'metal',
        ));
    }
  for (let spanAxisPos of girtZs) {
    let inwardSign = spanAxisPos > ridgeZ ? 1 : -1;
    for (let spanStartPos of [2.3, 3.7, 5.15])
      inwardSign > 0
        ? (addSlab(
            galvFlatMat,
            shedX0 + 0.3,
            spanStartPos - 0.08,
            shedZ1 - 0.2,
            SHED_DOOR_OPENING.x0 - 0.2,
            spanStartPos + 0.08,
            shedZ1 - 0.14,
          ),
          addSlab(
            galvFlatMat,
            SHED_DOOR_OPENING.x1 + 0.2,
            spanStartPos - 0.08,
            shedZ1 - 0.2,
            shedX1 - 0.3,
            spanStartPos + 0.08,
            shedZ1 - 0.14,
          ))
        : addSlab(
            galvFlatMat,
            shedX0 + 0.3,
            spanStartPos - 0.08,
            shedZ0 + 0.14,
            shedX1 - 0.3,
            spanStartPos + 0.08,
            shedZ0 + 0.2,
          );
    addBox(
      greyPaintMat,
      shedX1 - shedX0 - 0.6,
      0.14,
      0.14,
      (shedX0 + shedX1) / 2,
      eaveY - 0.25,
      spanAxisPos,
    );
  }
  for (let spanAxisPos of [shedX0 + 0.17, shedX1 - 0.17])
    for (let inwardSign of [2.3, 3.7, 5.15])
      spanAxisPos > 0
        ? (addSlab(
            galvFlatMat,
            spanAxisPos - 0.03,
            inwardSign - 0.08,
            shedZ0 + 0.3,
            spanAxisPos + 0.03,
            inwardSign + 0.08,
            SHED_WINDOW_OPENING.z0 - 0.2,
          ),
          addSlab(
            galvFlatMat,
            spanAxisPos - 0.03,
            inwardSign - 0.08,
            SHED_WINDOW_OPENING.z1 + 0.2,
            spanAxisPos + 0.03,
            inwardSign + 0.08,
            shedZ1 - 0.3,
          ))
        : addSlab(
            galvFlatMat,
            spanAxisPos - 0.03,
            inwardSign - 0.08,
            shedZ0 + 0.3,
            spanAxisPos + 0.03,
            inwardSign + 0.08,
            shedZ1 - 0.3,
          );
  for (let [spanAxisPos, inwardSign] of [
    [SHED_BAY_XS[0] + 0.4, SHED_BAY_XS[1]],
    [SHED_BAY_XS[4], SHED_BAY_XS[5] - 0.4],
  ]) {
    for (let spanStartPos of girtZs)
      (addRod(
        galvFlatMat,
        [spanAxisPos, 1.35, spanStartPos],
        [inwardSign, 5.3, spanStartPos],
        0.016,
      ),
        addRod(
          galvFlatMat,
          [inwardSign, 1.35, spanStartPos + 0.04],
          [spanAxisPos, 5.3, spanStartPos + 0.04],
          0.016,
        ));
    for (let spanStartPos of [1, -1]) {
      let farEdgePos = ridgeZ + spanStartPos * (halfDepth - 0.6),
        lowEdgePos = -0.3;
      (addRod(
        galvFlatMat,
        [spanAxisPos, eaveY + lowEdgePos + 0.1, farEdgePos],
        [inwardSign, ridgeY + lowEdgePos - 0.1, ridgeZ + spanStartPos * 0.3],
        0.014,
      ),
        addRod(
          galvFlatMat,
          [inwardSign, eaveY + lowEdgePos + 0.1, farEdgePos],
          [spanAxisPos, ridgeY + lowEdgePos - 0.1, ridgeZ + spanStartPos * 0.3],
          0.014,
        ));
    }
  }
  {
    let spanAxisPos = shedZ1 - wallThickness;
    for (let inwardSign of [SHED_DOOR_OPENING.x0 - 0.07, SHED_DOOR_OPENING.x1 + 0.07])
      (addSlab(
        darkSteelMat,
        inwardSign - 0.07,
        floorY,
        spanAxisPos - 0.16,
        inwardSign + 0.07,
        SHED_DOOR_OPENING.h + 0.75,
        shedZ1 + 0.07,
      ),
        addSlab(
          makeSurfaceMat('hazard_stripes'),
          inwardSign - 0.11,
          floorY,
          spanAxisPos - 0.2,
          inwardSign + 0.11,
          1.3,
          shedZ1 + 0.1,
          {
            bevel: 0.01,
          },
        ));
    (addSlab(
      darkSteelMat,
      SHED_DOOR_OPENING.x0 - 0.2,
      SHED_DOOR_OPENING.h,
      spanAxisPos - 0.1,
      SHED_DOOR_OPENING.x1 + 0.2,
      SHED_DOOR_OPENING.h + 0.14,
      shedZ1 + 0.08,
    ),
      addSlab(
        galvFlatMat,
        SHED_DOOR_OPENING.x0 - 0.25,
        SHED_DOOR_OPENING.h + 0.78,
        spanAxisPos - 0.72,
        SHED_DOOR_OPENING.x1 + 0.25,
        SHED_DOOR_OPENING.h + 0.81,
        spanAxisPos,
      ),
      addSlab(
        galvFlatMat,
        SHED_DOOR_OPENING.x0 - 0.25,
        SHED_DOOR_OPENING.h + 0.3,
        spanAxisPos - 0.72,
        SHED_DOOR_OPENING.x1 + 0.25,
        SHED_DOOR_OPENING.h + 0.81,
        spanAxisPos - 0.69,
      ));
    for (let inwardSign of [SHED_DOOR_OPENING.x0 - 0.24, SHED_DOOR_OPENING.x1 + 0.24])
      addSlab(
        galvFlatMat,
        inwardSign - 0.012,
        SHED_DOOR_OPENING.h + 0.05,
        spanAxisPos - 0.72,
        inwardSign + 0.012,
        SHED_DOOR_OPENING.h + 0.81,
        spanAxisPos,
      );
    (addCyl(
      roofInnerMat,
      0.3,
      SHED_DOOR_OPENING.x1 - SHED_DOOR_OPENING.x0 + 0.3,
      (SHED_DOOR_OPENING.x0 + SHED_DOOR_OPENING.x1) / 2,
      SHED_DOOR_OPENING.h + 0.44,
      spanAxisPos - 0.36,
      {
        axis: 'x',
        seg: 18,
      },
    ),
      addCyl(
        darkSteelMat,
        0.05,
        SHED_DOOR_OPENING.x1 - SHED_DOOR_OPENING.x0 + 0.46,
        (SHED_DOOR_OPENING.x0 + SHED_DOOR_OPENING.x1) / 2,
        SHED_DOOR_OPENING.h + 0.44,
        spanAxisPos - 0.36,
        {
          axis: 'x',
          seg: 8,
        },
      ),
      addSlab(
        roofInnerMat,
        SHED_DOOR_OPENING.x0 + 0.02,
        SHED_DOOR_OPENING.h - 0.42,
        spanAxisPos - 0.09,
        SHED_DOOR_OPENING.x1 - 0.02,
        SHED_DOOR_OPENING.h + 0.42,
        spanAxisPos - 0.06,
      ),
      addSlab(
        makeSurfaceMat('hazard_stripes'),
        SHED_DOOR_OPENING.x0 + 0.02,
        SHED_DOOR_OPENING.h - 0.52,
        spanAxisPos - 0.12,
        SHED_DOOR_OPENING.x1 - 0.02,
        SHED_DOOR_OPENING.h - 0.42,
        spanAxisPos - 0.03,
      ),
      addSlab(
        darkSteelMat,
        SHED_DOOR_OPENING.x1 + 0.28,
        SHED_DOOR_OPENING.h + 0.2,
        spanAxisPos - 0.6,
        SHED_DOOR_OPENING.x1 + 0.7,
        SHED_DOOR_OPENING.h + 0.7,
        spanAxisPos - 0.15,
        {
          bevel: 0.02,
        },
      ),
      addRod(
        darkSteelMat,
        [SHED_DOOR_OPENING.x1 + 0.5, SHED_DOOR_OPENING.h + 0.2, spanAxisPos - 0.3],
        [SHED_DOOR_OPENING.x1 + 0.5, 1.2, spanAxisPos - 0.3],
        0.008,
      ));
    for (let inwardSign of [SHED_DOOR_OPENING.x0 - 0.45, SHED_DOOR_OPENING.x1 + 0.45])
      ctx.place('bollard_post', inwardSign, shedZ1 + 0.55, 0, {
        seed: 5,
      });
  }
  {
    let spanAxisPos = shedX1 + 0.12,
      inwardSign = SHED_WINDOW_OPENING.z0 - 0.25,
      spanStartPos = inwardSign - 5.1;
    addSlab(
      roofOuterMat,
      spanAxisPos,
      0.12,
      spanStartPos,
      spanAxisPos + 0.05,
      SHED_WINDOW_OPENING.h + 0.1,
      inwardSign,
    );
    for (let farEdgePos of [spanStartPos, inwardSign, (spanStartPos + inwardSign) / 2])
      addSlab(
        galvMat,
        spanAxisPos - 0.02,
        0.1,
        farEdgePos - 0.05,
        spanAxisPos + 0.09,
        SHED_WINDOW_OPENING.h + 0.12,
        farEdgePos + 0.05,
      );
    for (let farEdgePos of [0.14, SHED_WINDOW_OPENING.h + 0.08, SHED_WINDOW_OPENING.h * 0.5])
      addSlab(
        galvMat,
        spanAxisPos - 0.02,
        farEdgePos - 0.05,
        spanStartPos,
        spanAxisPos + 0.09,
        farEdgePos + 0.05,
        inwardSign,
      );
    (addRod(
      galvMat,
      [spanAxisPos + 0.02, 0.2, spanStartPos + 0.1],
      [spanAxisPos + 0.02, SHED_WINDOW_OPENING.h, (spanStartPos + inwardSign) / 2],
      0.02,
    ),
      addRod(
        galvMat,
        [spanAxisPos + 0.02, 0.2, inwardSign - 0.1],
        [spanAxisPos + 0.02, SHED_WINDOW_OPENING.h, (spanStartPos + inwardSign) / 2],
        0.02,
      ),
      addSlab(
        darkSteelMat,
        spanAxisPos - 0.04,
        SHED_WINDOW_OPENING.h + 0.16,
        spanStartPos - 0.2,
        spanAxisPos + 0.12,
        SHED_WINDOW_OPENING.h + 0.3,
        SHED_WINDOW_OPENING.z1 + 0.3,
      ),
      addSlab(
        darkSteelMat,
        shedX1 - wallThickness - 0.02,
        floorY,
        SHED_WINDOW_OPENING.z0 - 0.12,
        shedX1 + 0.08,
        SHED_WINDOW_OPENING.h + 0.1,
        SHED_WINDOW_OPENING.z0,
      ),
      addSlab(
        darkSteelMat,
        shedX1 - wallThickness - 0.02,
        floorY,
        SHED_WINDOW_OPENING.z1,
        shedX1 + 0.08,
        SHED_WINDOW_OPENING.h + 0.1,
        SHED_WINDOW_OPENING.z1 + 0.12,
      ),
      addSlab(
        darkSteelMat,
        shedX1 - wallThickness - 0.02,
        SHED_WINDOW_OPENING.h,
        SHED_WINDOW_OPENING.z0 - 0.12,
        shedX1 + 0.08,
        SHED_WINDOW_OPENING.h + 0.12,
        SHED_WINDOW_OPENING.z1 + 0.12,
      ));
    for (let farEdgePos of [SHED_WINDOW_OPENING.z0 - 0.06, SHED_WINDOW_OPENING.z1 + 0.06])
      addSlab(
        makeSurfaceMat('hazard_stripes'),
        shedX1 - wallThickness - 0.05,
        floorY,
        farEdgePos - 0.1,
        shedX1 + 0.1,
        1.3,
        farEdgePos + 0.1,
        {
          bevel: 0.01,
        },
      );
    (addCollider(
      spanAxisPos - 0.05,
      0,
      spanStartPos,
      spanAxisPos + 0.12,
      SHED_WINDOW_OPENING.h + 0.3,
      inwardSign,
      'metal',
    ),
      ctx.place('bollard_post', shedX1 + 0.6, SHED_WINDOW_OPENING.z0 - 0.4, 0, {
        seed: 6,
      }));
  }
  let fanGroup = new THREE.Group();
  (fanGroup.position.set(shedX1 - 0.05, fanHole.y, ridgeZ), (fanGroup.userData.noMerge = !0));
  {
    let spanAxisPos = new THREE.TorusGeometry(fanHole.r + 0.02, 0.05, 8, 28);
    (spanAxisPos.rotateY(Math.PI / 2),
      addGeometry(spanAxisPos, galvMat, {
        p: [shedX1 + 0.04, fanHole.y, ridgeZ],
      }));
    let inwardSign = new THREE.TorusGeometry(fanHole.r + 0.02, 0.035, 6, 28);
    (inwardSign.rotateY(Math.PI / 2),
      addGeometry(inwardSign, galvFlatMat, {
        p: [shedX1 - 0.16, fanHole.y, ridgeZ],
      }));
    for (let lowEdgePos of [0.4, 0.4 + Math.PI / 2])
      addRod(
        galvMat,
        [
          shedX1 + 0.1,
          fanHole.y - Math.sin(lowEdgePos) * fanHole.r,
          ridgeZ - Math.cos(lowEdgePos) * fanHole.r,
        ],
        [
          shedX1 + 0.1,
          fanHole.y + Math.sin(lowEdgePos) * fanHole.r,
          ridgeZ + Math.cos(lowEdgePos) * fanHole.r,
        ],
        0.012,
      );
    for (let lowEdgePos of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3])
      addRod(
        galvFlatMat,
        [
          shedX1 - 0.18,
          fanHole.y + Math.sin(lowEdgePos) * fanHole.r,
          ridgeZ + Math.cos(lowEdgePos) * fanHole.r,
        ],
        [shedX1 - 0.18, fanHole.y, ridgeZ],
        0.014,
      );
    addCyl(darkSteelMat, 0.13, 0.26, shedX1 - 0.22, fanHole.y, ridgeZ, {
      axis: 'x',
      seg: 12,
    });
    let spanStartPos = matFlat('steel_worn');
    for (let lowEdgePos = 0; lowEdgePos < 5; lowEdgePos++) {
      let highEdgePos = boxGeometry(0.012, 0.42, 0.2);
      (highEdgePos.rotateY(0.5),
        highEdgePos.translate(0, 0.3, 0),
        highEdgePos.rotateX((lowEdgePos / 5) * Math.PI * 2));
      let scratchValue = new THREE.Mesh(highEdgePos, spanStartPos);
      ((scratchValue.castShadow = !0),
        (scratchValue.receiveShadow = !0),
        fanGroup.add(scratchValue));
    }
    let farEdgePos = new THREE.Mesh(
      cylinderGeometry(0.1, 0.1, 0.1, 12).rotateZ(Math.PI / 2),
      darkSteelMat,
    );
    ((farEdgePos.castShadow = !0), fanGroup.add(farEdgePos), ctx.dynRoot.add(fanGroup));
  }
  let lampGlowMat = game.mats.emissive(16757864, 7),
    aluminiumMat = matFlat('aluminium'),
    pendantPositions = [];
  for (let spanAxisPos of [-15.4, -23.6])
    for (let inwardSign of [-13.6, -8.5, -3.5, 2.6, 8.6])
      (spanAxisPos < -20 && inwardSign < -10) || pendantPositions.push([inwardSign, spanAxisPos]);
  for (let [spanAxisPos, inwardSign] of pendantPositions) {
    let spanStartPos = matLit(inwardSign) - 0.3,
      farEdgePos = 6.05;
    (addRod(
      darkSteelMat,
      [spanAxisPos, spanStartPos, inwardSign],
      [spanAxisPos, farEdgePos + 0.3, inwardSign],
      0.012,
      {
        cast: !1,
      },
    ),
      addCyl(aluminiumMat, 0.33, 0.3, spanAxisPos, farEdgePos + 0.15, inwardSign, {
        rTop: 0.09,
        seg: 14,
      }),
      addCyl(darkSteelMat, 0.09, 0.14, spanAxisPos, farEdgePos + 0.37, inwardSign, {
        seg: 10,
      }),
      addCyl(lampGlowMat, 0.24, 0.02, spanAxisPos, farEdgePos + 0.02, inwardSign, {
        seg: 14,
        cast: !1,
        recv: !1,
      }));
  }
  let shedLights = [];
  for (let [spanAxisPos, inwardSign] of [
    [-8.5, -15.4],
    [2.6, -15.4],
    [-3.5, -23.6],
    [8.6, -23.6],
  ]) {
    let spanStartPos = new THREE.PointLight(16761994, 34, 13, 2);
    (spanStartPos.position.set(spanAxisPos, 5.75, inwardSign),
      (spanStartPos.castShadow = !1),
      ctx.dynRoot.add(spanStartPos),
      shedLights.push(spanStartPos));
  }
  {
    let inwardSign = shedX0 + wallThickness + 0.02,
      spanStartPos = -10.25,
      farEdgePos = shedZ0 + wallThickness + 0.02,
      lowEdgePos = -23.75;
    addSlab(
      matFlat('diamond_plate'),
      inwardSign,
      2.6 - 0.1,
      farEdgePos,
      spanStartPos,
      2.6,
      lowEdgePos,
    );
    for (let runEndColumn of [inwardSign + 0.1, -13, spanStartPos - 0.08])
      addSlab(
        greyPaintMat,
        runEndColumn - 0.07,
        2.6 - 0.3,
        farEdgePos,
        runEndColumn + 0.07,
        2.6 - 0.1,
        lowEdgePos,
      );
    for (let [runEndColumn, runStartX] of [
      [spanStartPos - 0.08, lowEdgePos - 0.08],
      [spanStartPos - 0.08, farEdgePos + 0.3],
      [-13, lowEdgePos - 0.08],
    ])
      (addBox(greyPaintMat, 0.14, 2.6 - 0.1, 0.14, runEndColumn, (2.6 - 0.1) / 2, runStartX, {
        bevel: 0.01,
      }),
        addCollider(
          runEndColumn - 0.08,
          0,
          runStartX - 0.08,
          runEndColumn + 0.08,
          2.6,
          runStartX + 0.08,
          'metal',
          {
            noNav: !0,
          },
        ));
    let highEdgePos = matFlat('paint_white'),
      scratchValue = makeSurfaceMat('glass_dirty'),
      innerFacePos = inwardSign + 0.05,
      bandEndValue = spanStartPos - 0.05,
      midValue = farEdgePos + 0.05,
      stepIndex = lowEdgePos - 0.05,
      spanMidCoord = 5,
      roofHeightAt = (Te, Pe, Re, Fe = 0.07) => {
        (addSlab(Re, innerFacePos, Te, stepIndex - Fe, bandEndValue, Pe, stepIndex),
          addSlab(Re, bandEndValue - Fe, Te, midValue, bandEndValue, Pe, stepIndex - Fe));
      };
    (roofHeightAt(2.6, 3.5, highEdgePos),
      roofHeightAt(4.45, spanMidCoord, highEdgePos),
      roofHeightAt(3.5, 4.45, scratchValue, 0.02));
    for (let runEndColumn of [innerFacePos + 0.04, -14.2, -12.9, -11.75, bandEndValue - 0.04])
      addSlab(
        highEdgePos,
        runEndColumn - 0.04,
        3.5,
        stepIndex - 0.07,
        runEndColumn + 0.04,
        4.45,
        stepIndex,
      );
    for (let runEndColumn of [midValue + 0.04, -26.3, -25, stepIndex - 0.04])
      addSlab(
        highEdgePos,
        bandEndValue - 0.07,
        3.5,
        runEndColumn - 0.04,
        bandEndValue,
        4.45,
        runEndColumn + 0.04,
      );
    (addSlab(matFlat('paint_grey'), -11.65, 2.6, stepIndex - 0.01, -10.75, 4.6, stepIndex + 0.03),
      addSlab(
        highEdgePos,
        innerFacePos,
        spanMidCoord,
        midValue,
        bandEndValue + 0.1,
        spanMidCoord + 0.08,
        stepIndex + 0.1,
      ),
      addSlab(
        matFlat('wood_dark'),
        innerFacePos + 0.2,
        3.3,
        midValue + 0.3,
        bandEndValue - 0.3,
        3.36,
        midValue + 1,
      ),
      addSlab(darkSteelMat, -13.4, 3.36, midValue + 0.5, -12.7, 3.8, midValue + 0.56),
      addBox(game.mats.emissive(13624063, 2.4), 1.2, 0.04, 0.14, -13, spanMidCoord - 0.05, -25.8, {
        cast: !1,
        recv: !1,
      }),
      addBox(game.mats.emissive(10473727, 1.6), 0.6, 0.36, 0.01, -13.05, 3.6, midValue + 0.59, {
        cast: !1,
        recv: !1,
      }),
      addCollider(
        innerFacePos,
        2.6 - 0.12,
        midValue,
        bandEndValue,
        spanMidCoord + 0.08,
        stepIndex,
        'metal',
        {
          noNav: !0,
        },
      ),
      addCollider(inwardSign, 2.6 - 0.12, farEdgePos, spanStartPos, 2.6, lowEdgePos, 'metal', {
        noNav: !0,
      }));
    let columnCursor = lowEdgePos + 0.6;
    (ctx.catwalk(
      -14.25,
      columnCursor,
      0,
      2.6 - 0.05,
      {
        seed: 2,
      },
      [!1, !0],
    ),
      ctx.catwalk(
        -11.25,
        columnCursor,
        0,
        2.6 - 0.05,
        {
          seed: 3,
        },
        [!1, !0],
      ));
    for (let runEndColumn of [-15.6, -12.75, -9.85])
      addBox(
        greyPaintMat,
        0.1,
        2.6 - 0.12,
        0.1,
        runEndColumn,
        (2.6 - 0.12) / 2,
        columnCursor + 0.5,
        {
          bevel: 0.01,
        },
      );
    (addSlab(
      greyPaintMat,
      -15.75,
      2.6 - 0.26,
      columnCursor + 0.44,
      -9.75,
      2.6 - 0.12,
      columnCursor + 0.56,
    ),
      ctx.stairs(-8.25, columnCursor, Math.PI, 0, {
        seed: 4,
      }),
      ctx.metalRects.push([inwardSign, farEdgePos, -6.7, columnCursor + 0.6]));
  }
  {
    let spanStartPos = shedZ1 - wallThickness - 0.05,
      farEdgePos = spanStartPos - 0.75;
    addSlab(matFlat('wood_dark'), 1.6, 0.88, farEdgePos, 5, 0.94, spanStartPos, {
      bevel: 0.012,
    });
    for (let lowEdgePos of [1.6 + 0.06, 5 - 0.06, (1.6 + 5) / 2])
      for (let highEdgePos of [farEdgePos + 0.06, spanStartPos - 0.06])
        addBox(darkSteelMat, 0.05, 0.86, 0.05, lowEdgePos, floorY + 0.43, highEdgePos);
    (addSlab(darkSteelMat, 1.6 + 0.04, 0.2, farEdgePos + 0.06, 5 - 0.04, 0.23, spanStartPos - 0.04),
      addSlab(
        matFlat('paint_grey'),
        1.6 + 0.1,
        0.55,
        farEdgePos + 0.04,
        1.6 + 1.3,
        0.86,
        spanStartPos - 0.05,
        {
          bevel: 0.01,
        },
      ),
      addSlab(matFlat('wood_pallet'), 1.6, 1.25, spanStartPos - 0.02, 5, 2.3, spanStartPos + 0.01));
    for (let lowEdgePos = 0; lowEdgePos < 7; lowEdgePos++)
      addRod(
        galvFlatMat,
        [1.6 + 0.3 + lowEdgePos * 0.42, 1.5 + (lowEdgePos % 3) * 0.12, spanStartPos - 0.04],
        [1.6 + 0.3 + lowEdgePos * 0.42, 2.05 + (lowEdgePos % 2) * 0.1, spanStartPos - 0.04],
        0.012 + (lowEdgePos % 2) * 0.006,
        {
          cast: !1,
        },
      );
    (addBox(darkSteelMat, 0.16, 0.14, 0.3, 5 - 0.5, 1.01, farEdgePos + 0.2, {
      bevel: 0.015,
    }),
      addBox(galvFlatMat, 0.03, 0.03, 0.34, 5 - 0.5, 1.1, farEdgePos + 0.12),
      addBox(matFlat('paint_red'), 0.45, 0.22, 0.24, 1.6 + 1.9, 1.05, farEdgePos + 0.35, {
        bevel: 0.02,
        r: [0, 0.3, 0],
      }),
      addSlab(darkSteelMat, 1.6, 2.5, spanStartPos - 0.3, 5, 2.53, spanStartPos),
      addBox(
        game.mats.emissive(16773328, 3),
        5 - 1.6 - 0.4,
        0.03,
        0.1,
        (1.6 + 5) / 2,
        2.48,
        spanStartPos - 0.18,
        {
          cast: !1,
          recv: !1,
        },
      ),
      addCollider(1.6, 0, farEdgePos, 5, 0.94, spanStartPos, 'wood'));
  }
  {
    for (let lowEdgePos of [-1, 1]) {
      let highEdgePos = -11.6 + (lowEdgePos * 2.6) / 2;
      (addRod(
        matFlat('paint_yellow'),
        [highEdgePos, floorY, -17.6 - 0.9],
        [highEdgePos, 3.3, -17.6],
        0.045,
      ),
        addRod(
          matFlat('paint_yellow'),
          [highEdgePos, floorY, -17.6 + 0.9],
          [highEdgePos, 3.3, -17.6],
          0.045,
        ),
        addRod(
          matFlat('paint_yellow'),
          [highEdgePos, 1, -17.6 - 0.62],
          [highEdgePos, 1, -17.6 + 0.62],
          0.03,
        ));
      for (let scratchValue of [-17.6 - 0.9, -17.6 + 0.9])
        addCyl(darkSteelMat, 0.07, 0.1, highEdgePos, floorY + 0.05, scratchValue, {
          axis: 'x',
          seg: 8,
        });
    }
    (addIBeam(matFlat('paint_yellow'), 'x', 2.6 + 0.5, -11.6, 3.3 + 0.1, -17.6, {
      depth: 0.22,
      width: 0.14,
    }),
      addBox(darkSteelMat, 0.3, 0.26, 0.24, -11.6 + 0.2, 3.3 - 0.14, -17.6, {
        bevel: 0.02,
      }),
      addRod(galvFlatMat, [-11.6 + 0.2, 3.3 - 0.26, -17.6], [-11.6 + 0.2, 1.75, -17.6], 0.012),
      addRod(
        galvFlatMat,
        [-11.6 + 0.32, 3.3 - 0.26, -17.6],
        [-11.6 + 0.34, 2.2, -17.6 + 0.02],
        0.008,
      ),
      addBox(darkSteelMat, 0.85, 0.5, 0.55, -11.6 + 0.2, 1.42, -17.6, {
        bevel: 0.03,
        r: [0, 0.2, 0.05],
      }),
      addBox(matFlat('steel_worn'), 0.7, 0.16, 0.42, -11.6 + 0.2, 1.74, -17.6, {
        bevel: 0.02,
        r: [0, 0.2, 0.05],
      }),
      addCyl(matFlat('steel_bare'), 0.16, 0.12, -11.6 - 0.28, 1.4, -17.6 - 0.08, {
        axis: 'x',
        seg: 12,
      }),
      addCollider(
        -11.6 - 2.6 / 2 - 0.1,
        0,
        -17.6 - 0.35,
        -11.6 + 2.6 / 2 + 0.1,
        1.9,
        -17.6 + 0.35,
        'metal',
      ));
  }
  let halfPi = Math.PI / 2,
    placeProp = (L, Z, J, oe, fe, le = floorY, R) => ctx.place(L, Z, J, oe, fe, le, R);
  for (let spanAxisPos of [-8.4, -5.6, -2.8, 2.8, 5.6, 8.4])
    placeProp('shelf_rack', spanAxisPos, shedZ0 + wallThickness + 0.62, 0, {
      seed: Math.round(spanAxisPos * 7 + 90),
    });
  for (let spanAxisPos of [2.8, 5.6, 8.4])
    placeProp('shelf_rack', spanAxisPos, -23.45, 0, {
      seed: Math.round(spanAxisPos * 5 + 40),
    });
  return (
    placeProp('pallet_stack', 0, -26.9, 0.1, {
      seed: 3,
    }),
    placeProp(
      'cardboard_boxes',
      -0.05,
      -26.9,
      0.5,
      {
        seed: 4,
      },
      floorY + 1.15,
      {
        noCol: !0,
      },
    ),
    placeProp('crate_stack', 2.9, -15.9, 0.12, {
      seed: 11,
    }),
    placeProp('crate_wood', 4.15, -16.3, -0.25, {
      seed: 12,
    }),
    placeProp('pallet_stack', 2, -17.3, 1.45, {
      seed: 13,
    }),
    placeProp('ibc_tote', 6.9, -19.6, 0.1, {
      seed: 14,
    }),
    placeProp('barrel', 7.9, -18.5, 0, {
      seed: 15,
      color: 'blue',
    }),
    placeProp('barrel', 6, -18.4, 0.6, {
      seed: 16,
      color: 'red',
    }),
    placeProp('ibc_tote', -7.6, -16.4, -0.08, {
      seed: 17,
    }),
    placeProp('barrel', -8.6, -15.3, 0, {
      seed: 18,
    }),
    placeProp('barrel', -7.9, -15, 0.9, {
      seed: 19,
      color: 'yellow',
    }),
    placeProp('sandbags', 10.2, -16.4, halfPi + 0.05, {
      seed: 20,
    }),
    placeProp('forklift', 8.3, -13.9, 2.75, {
      seed: 21,
    }),
    placeProp('toolbox_cart', 6, -12.2, 0.15, {
      seed: 22,
    }),
    placeProp('gas_cylinders', 10.9, -11.9, 0, {
      seed: 23,
    }),
    placeProp('tarp_cargo', -13.2, -13.2, 0.12, {
      seed: 24,
    }),
    placeProp('tire_stack', -15, -15.6, 0, {
      seed: 25,
    }),
    placeProp('tire_stack', -14.9, -16.6, 0.4, {
      seed: 26,
    }),
    placeProp('cardboard_boxes', -14.6, -26.6, 0.2, {
      seed: 27,
    }),
    placeProp('crate_wood', -12.4, -26.9, -0.1, {
      seed: 28,
    }),
    placeProp('barrel', -10.9, -27, 0, {
      seed: 29,
      color: 'green',
    }),
    placeProp('crate_wood', -14.7, -24.6, 0.3, {
      seed: 30,
    }),
    placeProp('jerry_can', -9.3, -12, 0.4, {
      seed: 31,
    }),
    placeProp('jerry_can', -9.7, -12.1, 1.2, {
      seed: 32,
    }),
    placeProp('pallet', 10.6, -13.6, 0.2, {
      seed: 33,
    }),
    placeProp(
      'cardboard_boxes',
      10.6,
      -13.6,
      0.3,
      {
        seed: 34,
      },
      0.17,
    ),
    placeProp('traffic_cone', -6.6, -12.2, 0, {
      seed: 35,
    }),
    placeProp('traffic_cone', -0.4, -12.3, 0, {
      seed: 36,
    }),
    ctx.tube(
      matFlat('rubber'),
      [
        [1.7, 0.9, -11.9],
        [1.4, 0.4, -12.3],
        [1.2, 0.06, -13.2],
        [2.4, 0.055, -14],
        [1, 0.055, -14.9],
        [-0.8, 0.055, -14.4],
        [-1.6, 0.055, -15.6],
      ],
      0.018,
      {
        cast: !1,
      },
    ),
    addSlab(darkSteelMat, 7.2, floorY, -14.6, 8.4, floorY + 0.04, -13.6),
    ctx.decal('oil_stain', 2.2, 7.6, floorY + 0.004, -15.2, 'y+', 0.6),
    ctx.decal('oil_stain', 1.6, -3.8, floorY + 0.004, -13.6, 'y+', 2.1),
    ctx.decal('hazard_voltage', 0.5, -1.25, 1.9, shedZ1 - wallThickness - 0.142, 'z-'),
    ctx.decal('caution_stripes', 2.4, -3.5, floorY + 0.004, -11.9, 'y+', 0),
    {
      fan: fanGroup,
      lights: shedLights,
      skylights: skylights,
      relayPos: new THREE.Vector3(-2, floorY, -19.5),
      update(spanAxisPos) {
        fanGroup.rotation.x += spanAxisPos * 1.7;
      },
    }
  );
}
