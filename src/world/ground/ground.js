// world/ground/ground.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { WORLD_BOUNDS } from '../../core/config.js';

import { fbm2, smoothstepClamped, valueNoise2 } from '../../core/math.js';

import { So } from '../../misc.js';

import { createPlanarReflectionPass, createWetApron } from './asphalt.js';

import { createApronMarkingsTexture } from './geometry.js';

import { createRainSystem, createSeaSurface } from './water.js';

/**
 * 11 条漆色别名到「材质名 + 顶点色乘子」的映射（含 rust/black/olive 这类复合色），道具统一按别名取漆
 */
export var PAINT_COLOR_ALIASES = {
  red: ['paint_red', 1],
  blue: ['paint_blue', 1],
  green: ['paint_green', 1],
  yellow: ['paint_yellow', 1],
  orange: ['paint_orange', 1],
  white: ['paint_white', 1],
  grey: ['paint_grey', 1],
  teal: ['paint_teal', 1],
  rust: ['steel_rust', 1],
  black: ['paint_grey', [0.2, 0.2, 0.22]],
  olive: ['paint_green', [0.75, 0.8, 0.45]],
};

/**
 * 地面/地形模块注册表，用 getter 惰性暴露 create/showcase 两个入口
 */
export var groundModule = {};

/**
 * 地面基准高度；高于它算旱地、低于它算积水，是贴图里水/陆分界的判据
 */
var TERRAIN_BASE_HEIGHT = 0.385;

/**
 * 地面烘焙的覆盖范围（x0/z0/边长 80 m），决定高度图分辨率与世界坐标的换算
 */
export var TERRAIN_BOUNDS = {
  x0: -44,
  z0: -40,
  size: 80,
};

/**
 * 26 个地面凹陷印章（中心 x/z、椭圆半径、深度），在水泥地上压出坑洼与积水洼；纯数据，改这里就能改地形
 */
var TERRAIN_DIPS = [
  [-30.5, 6.6, 2.6, 1.7, 0.24],
  [-19.5, 5.2, 7.5, 1.5, 0.27],
  [-11.5, 7, 5, 1.2, 0.24],
  [-7.6, 5.6, 2.3, 1.7, 0.2],
  [5.6, 4.7, 3.3, 1.35, 0.26],
  [13, 6.6, 2.6, 1.2, 0.2],
  [-13, -1.3, 4.6, 1.5, 0.2],
  [1, -1.6, 3.4, 1.4, 0.18],
  [12.5, -1.4, 2.4, 1.3, 0.18],
  [-3.5, -8.2, 4.4, 1.6, 0.2],
  [-20, -8.6, 3.6, 1.6, 0.18],
  [14.6, -19.5, 2, 3.6, 0.2],
  [23.5, 6.9, 3.2, 2, 0.22],
  [23.2, -7.6, 3.4, 1.8, 0.2],
  [20.8, 1.5, 1.4, 3.6, 0.16],
  [23.5, 22.5, 3, 2, 0.2],
  [24, -25, 2.8, 2.6, 0.2],
  [-1, 16.5, 7, 1.7, 0.2],
  [11.5, 16.9, 3.6, 1.4, 0.18],
  [-17, 15.8, 3.2, 1.5, 0.18],
  [8.6, 12.3, 1.5, 3.4, 0.17],
  [-7.8, 19.5, 1.7, 3.6, 0.17],
  [-8, 25.8, 6, 1.3, 0.18],
  [9, 25.9, 4, 1.2, 0.18],
  [-32, -4, 2.6, 3.4, 0.18],
  [-31, 18, 3, 4, 0.18],
];

/**
 * 凹陷印章的半径缩放，整体调节坑洼大小
 */
var DIP_RADIUS_SCALE = 1;

/**
 * 每个凹陷额外加的深度偏置，避免浅坑在量化后消失
 */
var DIP_DEPTH_BIAS = 0.02;

/**
 * 地面高度场：分形基准 + 26 个凹陷印章 + 车辙沟槽 + 码头侧抬升，返回该点的相对高度
 */
function terrainHeight(worldX, worldZ) {
  let height =
    0.5 +
    (fbm2(worldX / 8.5, worldZ / 8.5, 11, 4) - 0.47) * 0.3 +
    (fbm2(worldX / 2.4, worldZ / 2.4, 23, 3) - 0.5) * 0.14;
  for (let dipIdx = 0; dipIdx < TERRAIN_DIPS.length; dipIdx++) {
    let dipEntry = TERRAIN_DIPS[dipIdx],
      normDx = (worldX - dipEntry[0]) / (dipEntry[2] * DIP_RADIUS_SCALE),
      normDz = (worldZ - dipEntry[1]) / (dipEntry[3] * DIP_RADIUS_SCALE),
      dist2 = normDx * normDx + normDz * normDz;
    dist2 < 9 && (height -= (dipEntry[4] + DIP_DEPTH_BIAS) * Math.exp(-dist2 * dist2));
  }
  if (worldX > -37 && worldX < 29) {
    let dipIdx = 0.5 + 0.5 * valueNoise2(worldX / 6, 3.1, 5),
      dipEntry = (worldZ - 4.9) / 0.5,
      normDx = (worldZ - 7.1) / 0.5,
      normDz = (worldZ - 15.4) / 0.5,
      dist2 = (worldZ - 17.2) / 0.5,
      rutMask =
        smoothstepClamped(0.14, 0.34, fbm2(worldX / 9, 7.7, 19, 2)) *
        smoothstepClamped(-27, -24, worldX) *
        (1 - smoothstepClamped(14, 17, worldX));
    height -=
      0.22 *
        (0.55 + 0.45 * dipIdx) *
        rutMask *
        (Math.exp(-dipEntry * dipEntry) + Math.exp(-normDx * normDx)) +
      0.09 *
        dipIdx *
        (1 - smoothstepClamped(0.3, 0.6, fbm2(worldX / 9, 7.7, 19, 2))) *
        (Math.exp(-normDz * normDz) + Math.exp(-dist2 * dist2));
  }
  return ((height += 0.25 * smoothstepClamped(28.6, 29.8, worldX)), height);
}

/**
 * 把高度场烘成一张 RGBA 数据贴图：R=高度、G=粗糙、B=积水、A=湿滑，供着色器直接采样
 */
function bakeTerrainTexture(size) {
  let pixelData = new Uint8Array(size * size * 4),
    { x0: boundX0, z0: boundZ0, size: worldSpan } = TERRAIN_BOUNDS,
    cellSize = worldSpan / size;
  for (let rowIdx = 0; rowIdx < size; rowIdx++) {
    let worldZ = boundZ0 + (rowIdx + 0.5) * cellSize;
    for (let colIdx = 0; colIdx < size; colIdx++) {
      let worldX = boundX0 + (colIdx + 0.5) * cellSize,
        pixelIdx = (rowIdx * size + colIdx) * 4,
        terrainH = terrainHeight(worldX, worldZ);
      ((pixelData[pixelIdx] = Math.round(So(0.5 + (terrainH - TERRAIN_BASE_HEIGHT) * 2.5) * 255)),
        (pixelData[pixelIdx + 1] = Math.round(
          So(0.5 + (fbm2(worldX / 5.5, worldZ / 5.5, 41, 3) - 0.5) * 1.5 + (0.5 - terrainH) * 0.9) *
            255,
        )));
      let wetness =
        smoothstepClamped(0.6, 0.78, fbm2(worldX / 1.4, worldZ / 1.4, 77, 4)) *
        smoothstepClamped(0.47, 0.62, fbm2(worldX / 9, worldZ / 9, 91, 2));
      ((pixelData[pixelIdx + 2] = Math.round(So(wetness) * 255)),
        (pixelData[pixelIdx + 3] = Math.round(
          So(
            fbm2(worldX / 22, worldZ / 0.9, 57, 3) * 0.6 +
              fbm2(worldX / 13, worldZ / 13, 63, 3) * 0.4,
          ) * 255,
        )));
    }
  }
  return pixelData;
}

/**
 * 按世界坐标双线性采样烘焙结果（可指定通道），让物理/寻路与视觉共用同一份地面数据
 */
function sampleTerrainTexture(data, size, worldX, worldZ, channel) {
  let fxPos = ((worldX - TERRAIN_BOUNDS.x0) / TERRAIN_BOUNDS.size) * size - 0.5,
    fzPos = ((worldZ - TERRAIN_BOUNDS.z0) / TERRAIN_BOUNDS.size) * size - 0.5;
  ((fxPos = fxPos < 0 ? 0 : fxPos > size - 1.001 ? size - 1.001 : fxPos),
    (fzPos = fzPos < 0 ? 0 : fzPos > size - 1.001 ? size - 1.001 : fzPos));
  let cellX = fxPos | 0,
    cellZ = fzPos | 0,
    xFrac = fxPos - cellX,
    zFrac = fzPos - cellZ,
    baseIdx = (cellZ * size + cellX) * 4 + channel,
    rowStride = size * 4;
  return (
    ((data[baseIdx] * (1 - xFrac) + data[baseIdx + 4] * xFrac) * (1 - zFrac) +
      (data[baseIdx + rowStride] * (1 - xFrac) + data[baseIdx + rowStride + 4] * xFrac) * zFrac) /
    255
  );
}

/**
 * 由高度场差分出法线与湿滑通道（环形采样保证无缝），输出两张 RGBA 贴图给地面材质
 */
function bakeTerrainNormals(size) {
  let detailBytes = new Uint8Array(size * size * 4),
    normalBytes = new Uint8Array(size * size * 4),
    heightField = new Float32Array(size * size),
    wetField = new Float32Array(size * size);
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) {
      let uCoord = col / size,
        vCoord = row / size,
        cellIdx = row * size + col,
        heightVal =
          fbm2(uCoord * 96, vCoord * 96, 3, 2, 96) * 0.6 +
          fbm2(uCoord * 40, vCoord * 40, 9, 2, 40) * 0.4,
        detailVal = fbm2(uCoord * 6, vCoord * 6, 21, 4, 6),
        warpX = (fbm2(uCoord * 8, vCoord * 8, 31, 2, 8) - 0.5) * 0.25,
        warpZ = (fbm2(uCoord * 8, vCoord * 8, 37, 2, 8) - 0.5) * 0.25,
        ridge = 1 - Math.abs(2 * fbm2((uCoord + warpX) * 5, (vCoord + warpZ) * 5, 43, 3, 5) - 1),
        grain = fbm2(uCoord * 28, vCoord * 28, 51, 3, 28);
      ((detailBytes[cellIdx * 4] = Math.round(So(heightVal) * 255)),
        (detailBytes[cellIdx * 4 + 1] = Math.round(So(detailVal) * 255)),
        (detailBytes[cellIdx * 4 + 2] = Math.round(So(ridge) * 255)),
        (detailBytes[cellIdx * 4 + 3] = Math.round(So(grain) * 255)),
        (heightField[cellIdx] = heightVal),
        (wetField[cellIdx] = fbm2(uCoord * 9, vCoord * 9, 71, 4, 9)));
    }
  let wrapIdx = (r) => (r + size) % size;
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) {
      let uCoord = row * size + col,
        vCoord =
          (heightField[row * size + wrapIdx(col + 1)] -
            heightField[row * size + wrapIdx(col - 1)]) *
          2.2,
        cellIdx =
          (heightField[wrapIdx(row + 1) * size + col] -
            heightField[wrapIdx(row - 1) * size + col]) *
          2.2,
        heightVal =
          (wetField[row * size + wrapIdx(col + 2)] - wetField[row * size + wrapIdx(col - 2)]) * 9,
        detailVal =
          (wetField[wrapIdx(row + 2) * size + col] - wetField[wrapIdx(row - 2) * size + col]) * 9;
      ((normalBytes[uCoord * 4] = Math.round(So(0.5 - vCoord) * 255)),
        (normalBytes[uCoord * 4 + 1] = Math.round(So(0.5 - cellIdx) * 255)),
        (normalBytes[uCoord * 4 + 2] = Math.round(So(0.5 - heightVal) * 255)),
        (normalBytes[uCoord * 4 + 3] = Math.round(So(0.5 - detailVal) * 255)));
    }
  return {
    det: detailBytes,
    nrm: normalBytes,
  };
}

/**
 * 把字节数组包成 DataTexture（可平铺、带 mipmap 与各向异性），地面烘焙结果统一走它
 */
function makeDataTexture(data, size, { repeat: repeatWrap = !0, aniso: anisoLevel = 1 } = {}) {
  let tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  return (
    (tex.wrapS = tex.wrapT = repeatWrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping),
    (tex.magFilter = THREE.LinearFilter),
    (tex.minFilter = THREE.LinearMipmapLinearFilter),
    (tex.generateMipmaps = !0),
    (tex.anisotropy = anisoLevel),
    (tex.colorSpace = THREE.NoColorSpace),
    (tex.needsUpdate = !0),
    tex
  );
}

/**
 * 地面标线画布覆盖的世界范围（x0/z0/宽/高），canvas 像素坐标与场地坐标的换算基准
 */
export var MARKING_BOUNDS = {
  x0: -40,
  z0: -30,
  w: 70,
  h: 60,
};

/**
 * 海面主波浪谱：4 条方向/波长/振幅/相速的正弦波（方向已归一化并补出角频率与 ω），CPU 高度计算与顶点位移共用同一组参数
 */
export var SEA_WAVE_MAIN = [
  [-0.92, 0.39, 9.5, 0.06],
  [-0.75, -0.66, 5.7, 0.04],
  [-0.99, 0.12, 3.3, 0.026],
  [-0.5, 0.87, 2, 0.016],
];

/**
 * 海面细节波浪谱：7 条更短的波，只参与片元法线斜率计算，让远处海面不显得平滑呆板
 */
export var SEA_WAVE_DETAIL = [
  [-0.8, 0.6, 1.31, 0.02],
  [-0.95, -0.31, 0.83, 0.014],
  [-0.35, -0.94, 0.57, 0.01],
  [-0.6, 0.8, 0.39, 0.007],
  [-1, 0.05, 0.27, 0.005],
  [0.3, 0.95, 0.47, 0.006],
  [-0.86, -0.51, 0.21, 0.0035],
];

/**
 * 把波浪参数格式化成 GLSL float 字面量（整数补小数点、其余保留 5 位），保证模板拼出的着色器数值类型合法可读
 */
export var formatGlslFloat = (value) =>
  Number.isInteger(value) ? value.toFixed(1) : value.toFixed(5);

/**
 * 按主波浪谱解析求某点海面高度，近岸 50 米内平滑衰减到 0，供漂浮物与浪花贴合水面用
 */
function seaHeightAt(posX, posZ, time) {
  let shoreFade = 1 - THREE.MathUtils.smoothstep(Math.hypot(posX - 30, posZ), 50, 220),
    heightSum = 0;
  for (let wave of SEA_WAVE_MAIN)
    heightSum += wave[3] * Math.sin(wave[4] * (wave[0] * posX + wave[1] * posZ) - wave[5] * time);
  return WORLD_BOUNDS.seaY + heightSum * shoreFade;
}

/**
 * 生成海面网格的一维坐标序列：步长按比例几何递增并设上限，近处顶点密远处疏，在顶点预算内保住近处浪形
 */
export function buildSeaGridSteps(start, end, step, growth, maxStep) {
  let coordList = [start],
    cursor = start,
    stepSize = step;
  for (; cursor < end - 0.001;)
    ((cursor = Math.min(end, cursor + stepSize)),
      coordList.push(cursor),
      (stepSize = Math.min(maxStep, stepSize * growth)));
  return coordList;
}

/**
 * 装配整套地面系统（标线、积水掩膜、细节图与法线图、湿滑停机坪、海面、雨、平面反射 prepass），并暴露海水高度、积水深度、湿度查询与雨量设置 API
 */
export async function createGround(game) {
  let hiRes = (game.quality.tex || 512) >= 1024,
    maxAniso = Math.min(
      8,
      game.renderer.capabilities.getMaxAnisotropy
        ? game.renderer.capabilities.getMaxAnisotropy()
        : 1,
    ),
    maskSize = hiRes ? 1024 : 512,
    maskData = bakeTerrainTexture(maskSize),
    maskTexture = makeDataTexture(maskData, maskSize, {
      repeat: !1,
      aniso: 2,
    }),
    detailSize = hiRes ? 512 : 256,
    { det: detailCanvas, nrm: detailNormalCanvas } = bakeTerrainNormals(detailSize),
    detailTexture = makeDataTexture(detailCanvas, detailSize, {
      aniso: maxAniso,
    }),
    detailNormalTexture = makeDataTexture(detailNormalCanvas, detailSize, {
      aniso: maxAniso,
    });
  try {
    document.fonts &&
      document.fonts.load &&
      (await Promise.race([
        document.fonts.load('900 40px "Big Shoulders Display"'),
        new Promise((M) => setTimeout(M, 350)),
      ]));
  } catch {}
  let marksTexture = createApronMarkingsTexture(hiRes ? 2048 : 1024, maxAniso),
    blackTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackTexture.needsUpdate = !0;
  let textures = {
      mask: maskTexture,
      detail: detailTexture,
      detailN: detailNormalTexture,
      marks: marksTexture,
      black: blackTexture,
    },
    root = new THREE.Group();
  root.name = 'ground';
  let apron = createWetApron(game, textures),
    sea = createSeaSurface(game, textures),
    rain = createRainSystem(game, textures);
  (root.add(apron.mesh, sea.mesh, sea.skirt, rain.rain, rain.splash), game.scene.add(root));
  let planar = createPlanarReflectionPass(game, apron.uniforms, [
    apron.mesh,
    sea.mesh,
    rain.rain,
    rain.splash,
  ]);
  game.render && game.render.addPrePass && game.render.addPrePass(planar.pass);
  let isIndoor = (length, strokeW) => {
      let branchDepth = game.level && game.level.interiorBoxes;
      if (!branchDepth) return !1;
      for (let segCount = 0; segCount < branchDepth.length; segCount++) {
        let segIdx = branchDepth[segCount];
        if (
          segIdx &&
          segIdx.min &&
          length > segIdx.min.x &&
          length < segIdx.max.x &&
          strokeW > segIdx.min.z &&
          strokeW < segIdx.max.z
        )
          return !0;
      }
      return !1;
    },
    inMaskRect = (M, E) =>
      M > TERRAIN_BOUNDS.x0 &&
      M < TERRAIN_BOUNDS.x0 + TERRAIN_BOUNDS.size &&
      E > TERRAIN_BOUNDS.z0 &&
      E < TERRAIN_BOUNDS.z0 + TERRAIN_BOUNDS.size,
    time = 0,
    ground = {
      root: root,
      apron: apron.mesh,
      sea: sea.mesh,
      rain: rain.rain,
      planar: planar,
      reflectionTarget: planar.target,
      reflectionCamera: planar.camera,
      maskTexture: maskTexture,
      uniforms: apron.uniforms,
      puddleDepth(M, E) {
        return M > WORLD_BOUNDS.quayX || !inMaskRect(M, E) || isIndoor(M, E)
          ? -0.2
          : 0.5 - sampleTerrainTexture(maskData, maskSize, M, E, 0);
      },
      isPuddle(M, E) {
        return ground.puddleDepth(M, E) > 0.015;
      },
      wetnessAt(M, E) {
        if (M > WORLD_BOUNDS.quayX) return 1;
        if (isIndoor(M, E)) return 0.12;
        if (!inMaskRect(M, E)) return 0.6;
        let w = 0.5 - sampleTerrainTexture(maskData, maskSize, M, E, 0);
        if (w > 0.015) return 1;
        let S = THREE.MathUtils.smoothstep,
          z = S(w, -0.11, 0),
          H = S(w, -0.65, -0.02),
          O = 1 - S(sampleTerrainTexture(maskData, maskSize, M, E, 1) + H * 0.55, 0.2, 0.42);
        return Math.min(0.95, 0.25 + (1 - O) * 0.4 + z * 0.3);
      },
      seaHeight(M, E) {
        return seaHeightAt(M, E, time);
      },
      setRain(M) {
        rain.setRain(M);
      },
      get rainLevel() {
        return rain.rainLevel;
      },
      setReflections(M) {
        planar.enabled = !!M;
      },
      update(M) {
        ((time += M),
          rain.update(M),
          (apron.uniforms.uTime.value = time),
          (apron.uniforms.uRain.value = rain.rainLevel),
          (sea.uniforms.uTime.value = time));
      },
    };
  return ground;
}

/**
 * 地面模块的演示场景：先移除占位平面再装配地面系统，摆一组集装箱/油桶/灯柱样张，返回固定机位以便单独观察湿滑地面与反射
 */
export async function showcaseGround(game) {
  let placeholderPlane = game.scene.children.find(
    (o) =>
      o.isMesh &&
      o.geometry &&
      o.geometry.type === 'PlaneGeometry' &&
      o.geometry.parameters &&
      o.geometry.parameters.width === 80,
  );
  (placeholderPlane && game.scene.remove(placeholderPlane),
    (game.ground = await createGround(game)));
  let propGroup = new THREE.Group(),
    addProp = (hissLoop, bpLoop, bufLen, mixBuf, dropBuf, workBuf = 0) => {
      let dropPos = new THREE.Mesh(hissLoop, bpLoop);
      return (
        dropPos.position.set(bufLen, mixBuf, dropBuf),
        (dropPos.rotation.y = workBuf),
        (dropPos.castShadow = dropPos.receiveShadow = !0),
        propGroup.add(dropPos),
        dropPos
      );
    },
    getMat = (materialName) => game.mats.get(materialName);
  return (
    addProp(new THREE.BoxGeometry(6.06, 2.59, 2.44), getMat('paint_red'), 3, 1.295, -0.2),
    addProp(new THREE.BoxGeometry(6.06, 2.59, 2.44), getMat('paint_blue'), 9.4, 1.295, -0.2),
    addProp(new THREE.BoxGeometry(6.06, 2.59, 2.44), getMat('paint_teal'), 9.4, 3.885, -0.2),
    addProp(new THREE.BoxGeometry(12.19, 2.59, 2.44), getMat('paint_yellow'), 3, 1.295, 11.2),
    addProp(new THREE.BoxGeometry(6.06, 2.59, 2.44), getMat('paint_white'), 12.4, 1.295, 11.2),
    addProp(new THREE.BoxGeometry(1.1, 1.1, 1.1), getMat('paint_orange'), 5.6, 0.55, 4.7, 0.4),
    addProp(
      new THREE.CylinderGeometry(0.29, 0.29, 0.88, 20),
      getMat('plastic_blue'),
      3.9,
      0.44,
      6.3,
    ),
    addProp(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 20), getMat('steel_rust'), 4.6, 0.44, 6.6),
    addProp(new THREE.CylinderGeometry(0.06, 0.06, 5, 10), getMat('steel_galv'), 12.5, 2.5, 6.2),
    addProp(
      new THREE.BoxGeometry(0.08, 1.6, 0.08),
      game.mats.emissive(16726556, 6),
      6.6,
      0.82,
      2.6,
    ),
    addProp(new THREE.BoxGeometry(0.08, 1.6, 0.08), game.mats.emissive(3524863, 5), 2.2, 0.82, 3.2),
    addProp(
      new THREE.BoxGeometry(2.4, 0.08, 0.06),
      game.mats.emissive(16773328, 6),
      9.4,
      2.2,
      1.06,
    ),
    addProp(new THREE.BoxGeometry(0.3, 0.12, 0.3), game.mats.emissive(16760944, 12), 12.5, 5, 6.2),
    addProp(new THREE.BoxGeometry(0.06, 1.2, 0.06), game.mats.emissive(5832570, 5), 23, 0.62, 8.2),
    addProp(new THREE.BoxGeometry(1.2, 1.2, 1.2), getMat('steel_dark'), 22.4, 0.6, 9.6, 0.3),
    game.scene.add(propGroup),
    {
      cam: [-9, 1.65, 5.6],
      target: [14, 0.4, 5],
    }
  );
}
