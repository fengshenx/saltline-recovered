// render/effects/effects.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import { beveledBoxGeometry, boxGeometry, createShadowMesh, cylinderGeometry } from '../../assets/procedural/geometry.js';
import * as THREE from 'three';
import { FX_SCRATCH_VEC_A, FX_SCRATCH_VEC_B, FX_SCRATCH_VEC_C, FX_SCRATCH_VEC_D, FX_SCRATCH_VEC_E, FX_SCRATCH_VEC_F, PARTICLE_FLAG_BOUNCE, PARTICLE_FLAG_KILL_ON_GROUND, ParticlePool, TracerPool, fxRandom, randRange } from './particle-pool.js';
import { SKY_COLORS, SUN } from '../../core/config.js';
import { createFxBatch } from './fx-batch.js';
import { SMOKE_ATLAS_COLS, SMOKE_ATLAS_ROWS, SPARK_ATLAS_COLS, SPARK_ATLAS_ROWS, SPARK_CELL_BURST_A, SPARK_CELL_DISC, SPARK_CELL_FLASH, SPARK_CELL_PUFF, SPARK_CELL_RING, SPARK_CELL_SPIKE, SPARK_CELL_STREAK, createSmokeFlipbook, createSparkFlipbook } from '../../assets/procedural/textures.js';
import { DebrisPool, DecalBatch, ShellPool } from './pools.js';
import { Ei } from '../../misc.js';

/**
 * 往父节点上挂一块可倒圆角的板件；墙板、柱脚、横梁、小箱件全用它拼，倒角参数统一由调用方给
 */
export function addRoundedBox(
  ctx,
  parent,
  mat,
  boxW,
  boxH,
  boxD,
  posX,
  posY,
  posZ,
  bevelR = 0,
  rotXyz = null,
) {
  let slab = createShadowMesh(
    bevelR ? beveledBoxGeometry(boxW, boxH, boxD, bevelR) : boxGeometry(boxW, boxH, boxD),
    typeof mat == 'string' ? ctx.M(mat) : mat,
  );
  return (
    slab.position.set(posX, posY, posZ),
    rotXyz && slab.rotation.set(rotXyz[0], rotXyz[1], rotXyz[2]),
    parent.add(slab),
    slab
  );
}

/**
 * 往父节点上挂一根圆柱（管、杆、罐体、轮盘），统一处理分段数、旋转与轴向对齐
 */
export function addCylinderMesh(
  ctx,
  parent,
  mat,
  radius,
  height,
  posX,
  posY,
  posZ,
  rotation = null,
  radialSegments = 8,
) {
  let cylMesh = createShadowMesh(
    cylinderGeometry(radius, radius, height, radialSegments),
    typeof mat == 'string' ? ctx.M(mat) : mat,
  );
  return (
    cylMesh.position.set(posX, posY, posZ),
    rotation && cylMesh.rotation.set(rotation[0], rotation[1], rotation[2]),
    parent.add(cylMesh),
    cylMesh
  );
}

/**
 * 世界向上轴常量
 */
export var UP_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * fx 子模块的对外命名空间：create 惰性取到特效系统构造函数，showcase 取演示场景，供启动流程与场景注册表按名加载
 */
export var FX_MODULE = {};

/**
 * 复用的 Vector2，读取 drawingBuffer 尺寸时避免每次渲染都新建对象
 */
export var FX_SCRATCH_SIZE = new THREE.Vector2();

/**
 * 复用的临时矩阵，组装碎块与弹壳的实例变换
 */
export var FX_SCRATCH_MATRIX = new THREE.Matrix4();

/**
 * 复用的临时四元数
 */
export var FX_SCRATCH_QUAT = new THREE.Quaternion();

/**
 * 复用的临时位置向量
 */
export var FX_SCRATCH_POS = new THREE.Vector3();

/**
 * 复用的临时缩放向量
 */
export var FX_SCRATCH_SCALE = new THREE.Vector3();

/**
 * 复用的临时旋转轴向量
 */
export var FX_SCRATCH_AXIS = new THREE.Vector3();

/**
 * 向下射线方向常量，弹壳拾取地面高度与表面材质用
 */
export var RAY_DOWN = new THREE.Vector3(0, -1, 0);

/**
 * 复用的射线起点向量
 */
export var FX_SCRATCH_RAY_ORIGIN = new THREE.Vector3();

/**
 * 复用的弹壳姿态四元数
 */
export var FX_SCRATCH_SHELL_QUAT = new THREE.Quaternion();

/**
 * 复用的欧拉角，用来随机初始姿态与让弹壳侧躺
 */
export var FX_SCRATCH_EULER = new THREE.Euler();

/**
 * 受光粒子池容量上限（烟雾、尘土这类要吃光照的粒子）
 */
var FX_LIT_PARTICLE_CAP = 1400;

/**
 * 加色粒子池容量上限（火花、光斑这类只做加色的粒子）
 */
var FX_ADD_PARTICLE_CAP = 3200;

/**
 * 世界向下轴常量（重力方向）
 */
var DOWN_AXIS = new THREE.Vector3(0, -1, 0);

/**
 * 复用的临时 Color，用于解析十六进制或字符串颜色
 */
var FX_SCRATCH_COLOR = new THREE.Color();

/**
 * 复用的 RGB 三分量数组，颜色解析结果直接写这里，返回给调用方不再分配
 */
var FX_SCRATCH_RGB = [1, 1, 1];

/**
 * 把各种颜色写法（缺省数字三元、数组、THREE.Color、十六进制）统一解析成复用的 RGB 数组，特效 API 的入口参数都靠它归一化
 */
function toRgbTriple(color, fallbackR, fallbackG, fallbackB) {
  return (
    color == null
      ? ((FX_SCRATCH_RGB[0] = fallbackR),
        (FX_SCRATCH_RGB[1] = fallbackG),
        (FX_SCRATCH_RGB[2] = fallbackB))
      : Array.isArray(color)
        ? ((FX_SCRATCH_RGB[0] = color[0]),
          (FX_SCRATCH_RGB[1] = color[1]),
          (FX_SCRATCH_RGB[2] = color[2]))
        : color.isColor
          ? ((FX_SCRATCH_RGB[0] = color.r),
            (FX_SCRATCH_RGB[1] = color.g),
            (FX_SCRATCH_RGB[2] = color.b))
          : (FX_SCRATCH_COLOR.set(color),
            (FX_SCRATCH_RGB[0] = FX_SCRATCH_COLOR.r),
            (FX_SCRATCH_RGB[1] = FX_SCRATCH_COLOR.g),
            (FX_SCRATCH_RGB[2] = FX_SCRATCH_COLOR.b)),
    FX_SCRATCH_RGB
  );
}

/**
 * 在给定方向上做球面随机抖动并归一化，spread 控制张角，用于碎屑与火花的初速发散
 */
function randomDirectionAround(dir, spread, out) {
  let randX = fxRandom() * 2 - 1,
    randY = fxRandom() * 2 - 1,
    randZ = fxRandom() * 2 - 1,
    vecLength = Math.hypot(randX, randY, randZ) || 1,
    spreadScale = (spread * Math.cbrt(fxRandom())) / vecLength;
  out.set(dir.x + randX * spreadScale, dir.y + randY * spreadScale, dir.z + randZ * spreadScale);
  let outLength = out.length();
  return (outLength < 1e-4 ? out.copy(dir) : out.multiplyScalar(1 / outLength), out);
}

/**
 * 场景特效总线：预分配并批处理烟雾/火花/曳光/枪口焰/爆炸/水花/碎屑/贴花与长寿命发射器（蒸汽、火、余烬、滴漏），并把 impact、player:step、player:land 事件翻译成对应特效；用一次射线决定粒子是否处于遮蔽阴影中，整套特效不依赖外部贴图和 GPU 粒子。
 */
export async function createEffects(ctx) {
  let scene = ctx.scene || (ctx.render && ctx.render.scene),
    windDir = new THREE.Vector3(-0.8, 0, 0.3),
    sunColor = new THREE.Vector3(SUN.color.r, SUN.color.g, SUN.color.b).multiplyScalar(
      (SUN.intensity / Math.PI) * 0.9,
    ),
    ambientHigh = new THREE.Vector3(
      SKY_COLORS.zenith.r * 0.6 + SKY_COLORS.horizonAway.r * 0.5 + SKY_COLORS.fog.r * 0.25,
      SKY_COLORS.zenith.g * 0.6 + SKY_COLORS.horizonAway.g * 0.5 + SKY_COLORS.fog.g * 0.25,
      SKY_COLORS.zenith.b * 0.6 + SKY_COLORS.horizonAway.b * 0.5 + SKY_COLORS.fog.b * 0.25,
    ),
    ambientLow = new THREE.Vector3(
      SKY_COLORS.horizonAway.r * 0.3 + SKY_COLORS.fog.r * 0.14,
      SKY_COLORS.horizonAway.g * 0.3 + SKY_COLORS.fog.g * 0.14,
      SKY_COLORS.horizonAway.b * 0.3 + SKY_COLORS.fog.b * 0.14,
    ),
    litBatch = createFxBatch(ctx, FX_LIT_PARTICLE_CAP, {
      lit: !0,
      tex: createSmokeFlipbook(128),
      cols: SMOKE_ATLAS_COLS,
      rows: SMOKE_ATLAS_ROWS,
      renderOrder: 10,
      sun: sunColor,
      sunDir: SUN.dir.clone().normalize(),
      ambLo: ambientLow,
      ambHi: ambientHigh,
    }),
    unlitBatch = createFxBatch(ctx, FX_ADD_PARTICLE_CAP, {
      lit: !1,
      tex: createSparkFlipbook(128),
      cols: SPARK_ATLAS_COLS,
      rows: SPARK_ATLAS_ROWS,
      renderOrder: 20,
    }),
    litEmitter = new ParticlePool(FX_LIT_PARTICLE_CAP, !0),
    unlitEmitter = new ParticlePool(FX_ADD_PARTICLE_CAP - 160, !1),
    tracerPool = new TracerPool(48),
    debrisPool = new DebrisPool(ctx, 256),
    shellPool = new ShellPool(ctx, 60),
    decalPool = new DecalBatch(ctx, 160),
    root = new THREE.Group();
  ((root.name = 'fx'),
    root.add(decalPool.mesh, debrisPool.mesh, shellPool.mesh, litBatch.mesh, unlitBatch.mesh),
    scene.add(root));
  let time = 0,
    lastMetalFlashAt = -1,
    lastTracerTrailAt = -1,
    getLightPool = () => ctx.render && ctx.render.lightPool,
    flashLight = (ee, B, P, V, Y) => {
      let L = getLightPool();
      L && L.flash(ee, B, P, V, Y);
    };
  function shadeAt(ee, B) {
    let P = ctx.physics;
    if (!P || !P.raycast) return 1;
    (FX_SCRATCH_VEC_E.copy(ee),
      B && FX_SCRATCH_VEC_E.addScaledVector(B, 0.08),
      (FX_SCRATCH_VEC_E.y += 0.03));
    let V = null;
    try {
      V = P.raycast(FX_SCRATCH_VEC_E, SUN.dir, 90);
    } catch {
      V = null;
    }
    return V ? 0.2 : 1;
  }
  function groundHeightAt(ee) {
    let B = ctx.physics;
    if (!B || !B.raycast) return 0;
    (FX_SCRATCH_VEC_E.copy(ee), (FX_SCRATCH_VEC_E.y += 0.1));
    let P = null;
    try {
      P = B.raycast(FX_SCRATCH_VEC_E, DOWN_AXIS, 12);
    } catch {
      P = null;
    }
    return P ? P.point.y : -50;
  }
  function emitParticle(ee, B, P, V, Y, L, Z, J, oe, fe, le, R, I, se, ae, k, ce, ve) {
    let _e = litEmitter.emit(ee, B, P, V, Y, L, Z, J, oe);
    return _e < 0
      ? -1
      : ((litEmitter.r[_e] = fe),
        (litEmitter.g[_e] = le),
        (litEmitter.b[_e] = R),
        (litEmitter.a[_e] = I),
        (litEmitter.shade[_e] = se),
        (litEmitter.drag[_e] = ae),
        (litEmitter.grav[_e] = -k),
        (litEmitter.wind[_e] = ce),
        (litEmitter.turb[_e] = 0.5),
        (litEmitter.rot[_e] = fxRandom() * 6.283),
        (litEmitter.rotv[_e] = (fxRandom() - 0.5) * 1.2),
        (litEmitter.frame[_e] = ve < 0 ? (fxRandom() * 6) | 0 : ve),
        (litEmitter.fin[_e] = 0.06),
        (litEmitter.fout[_e] = 0.3),
        (litEmitter.sk[_e] = 2.5),
        _e);
  }
  function emitStreak(ee, B, P, V, Y, L, Z, J, oe, fe, le, R) {
    let I = unlitEmitter.emit(ee, B, P, V, Y, L, Z, J, J * 0.5);
    return I < 0
      ? -1
      : ((unlitEmitter.mode[I] = 1),
        (unlitEmitter.frame[I] = SPARK_CELL_STREAK),
        (unlitEmitter.stretch[I] = 0.03),
        (unlitEmitter.grav[I] = 9.81),
        (unlitEmitter.drag[I] = 0.9),
        (unlitEmitter.ramp[I] = 1),
        (unlitEmitter.r[I] = oe * 0.6),
        (unlitEmitter.g[I] = fe * 0.6),
        (unlitEmitter.b[I] = le * 0.6),
        (unlitEmitter.fout[I] = 0.55),
        (unlitEmitter.flags[I] = R),
        (unlitEmitter.sk[I] = 1),
        I);
  }
  function emitSparkBurst(ee, B, P, V, Y, L, Z, J, oe, fe, le, R) {
    for (let I = 0; I < P; I++) {
      randomDirectionAround(B, L, FX_SCRATCH_VEC_D);
      let se = randRange(V, Y) * (0.35 + 0.65 * fxRandom());
      emitStreak(
        ee.x,
        ee.y,
        ee.z,
        FX_SCRATCH_VEC_D.x * se,
        FX_SCRATCH_VEC_D.y * se,
        FX_SCRATCH_VEC_D.z * se,
        randRange(Z, J),
        randRange(0.01, 0.02),
        oe * randRange(0.6, 1.2),
        fe * randRange(0.6, 1.2),
        le,
        R,
      );
    }
  }
  function emitGlow(ee, B, P, V, Y, L, Z, J, oe, fe) {
    let le = unlitEmitter.emit(ee, B, P, 0, 0, 0, V, Y, L);
    return le < 0
      ? -1
      : ((unlitEmitter.frame[le] = fe),
        (unlitEmitter.r[le] = Z),
        (unlitEmitter.g[le] = J),
        (unlitEmitter.b[le] = oe),
        (unlitEmitter.fout[le] = 0.2),
        (unlitEmitter.rot[le] = fxRandom() * 6.283),
        (unlitEmitter.sk[le] = 1.5),
        le);
  }
  function emitRipple(ee, B, P, V, Y, L, Z, J, oe) {
    let fe = unlitEmitter.emit(ee, B, P, 0, 0, 0, V, Y, L);
    return fe < 0
      ? -1
      : ((unlitEmitter.mode[fe] = 2),
        (unlitEmitter.frame[fe] = SPARK_CELL_RING),
        (unlitEmitter.r[fe] = Z),
        (unlitEmitter.g[fe] = J),
        (unlitEmitter.b[fe] = oe),
        (unlitEmitter.fout[fe] = 0.15),
        (unlitEmitter.fin[fe] = 0.08),
        (unlitEmitter.sk[fe] = 2.2),
        (unlitEmitter.rot[fe] = fxRandom() * 6.283),
        fe);
  }
  function emitDebris(ee, B, P, V, Y, L, Z, J, oe, fe, le, R, I, se, ae, k) {
    for (let ce = 0; ce < P; ce++) {
      randomDirectionAround(B, ae, FX_SCRATCH_VEC_D);
      let ve = randRange(V, Y),
        _e = randRange(0.8, 1.15);
      debrisPool.add(
        ee.x + FX_SCRATCH_VEC_D.x * 0.02,
        ee.y + FX_SCRATCH_VEC_D.y * 0.02,
        ee.z + FX_SCRATCH_VEC_D.z * 0.02,
        FX_SCRATCH_VEC_D.x * ve,
        FX_SCRATCH_VEC_D.y * ve + 0.8,
        FX_SCRATCH_VEC_D.z * ve,
        randRange(L, Z),
        randRange(J, oe),
        randRange(fe, le),
        R * _e,
        I * _e,
        se * _e,
        randRange(3.5, 6),
        k,
      );
    }
  }
  function sparkBurstAt(ee, B, P = 12) {
    (FX_SCRATCH_VEC_B.copy(B || Ei),
      FX_SCRATCH_VEC_B.lengthSq() < 1e-6 && FX_SCRATCH_VEC_B.copy(Ei),
      FX_SCRATCH_VEC_B.normalize(),
      emitSparkBurst(
        ee,
        FX_SCRATCH_VEC_B,
        P,
        5,
        18,
        0.6,
        0.15,
        0.5,
        36,
        22,
        9,
        PARTICLE_FLAG_BOUNCE,
      ),
      emitGlow(ee.x, ee.y, ee.z, 0.05, 0.2, 0.35, 10, 6.5, 3, SPARK_CELL_FLASH));
  }
  function smokeAt(ee, B = {}) {
    let P = B.size || 1,
      V = B.life || 2.5,
      Y = B.rise === void 0 ? 0.6 : B.rise,
      L = toRgbTriple(B.color, 0.32, 0.32, 0.33),
      Z = B.vel,
      J = shadeAt(ee, null),
      oe = B.count || 3;
    for (let fe = 0; fe < oe; fe++)
      emitParticle(
        ee.x + (fxRandom() - 0.5) * 0.2 * P,
        ee.y + (fxRandom() - 0.5) * 0.2 * P,
        ee.z + (fxRandom() - 0.5) * 0.2 * P,
        (Z ? Z.x : 0) + (fxRandom() - 0.5) * 0.4,
        (Z ? Z.y : 0) + fxRandom() * 0.3,
        (Z ? Z.z : 0) + (fxRandom() - 0.5) * 0.4,
        V * randRange(0.75, 1.2),
        P * 0.3,
        P * randRange(1, 1.5),
        L[0],
        L[1],
        L[2],
        B.alpha || 0.4,
        J,
        1.2,
        Y,
        1,
        -1,
      );
  }
  function dustAt(ee, B, P = 1, V = 0.5, Y = 0.48, L = 0.45) {
    (FX_SCRATCH_VEC_A.copy(B || Ei),
      FX_SCRATCH_VEC_A.lengthSq() < 1e-6 && FX_SCRATCH_VEC_A.copy(Ei),
      FX_SCRATCH_VEC_A.normalize());
    let Z = shadeAt(ee, FX_SCRATCH_VEC_A);
    for (let J = 0; J < 8; J++) {
      randomDirectionAround(FX_SCRATCH_VEC_A, 0.5, FX_SCRATCH_VEC_D);
      let oe = randRange(1, 4.5) * P,
        fe = randRange(0.85, 1.1);
      emitParticle(
        ee.x + FX_SCRATCH_VEC_A.x * 0.03,
        ee.y + FX_SCRATCH_VEC_A.y * 0.03,
        ee.z + FX_SCRATCH_VEC_A.z * 0.03,
        FX_SCRATCH_VEC_D.x * oe,
        FX_SCRATCH_VEC_D.y * oe,
        FX_SCRATCH_VEC_D.z * oe,
        randRange(0.5, 1.1),
        0.08 * P,
        randRange(0.35, 0.7) * P,
        V * fe,
        Y * fe,
        L * fe,
        0.9,
        Z,
        3.5,
        0.15,
        0.6,
        J < 3 ? 7 : -1,
      );
    }
    for (let J = 0; J < 2; J++)
      emitParticle(
        ee.x + FX_SCRATCH_VEC_A.x * 0.15,
        ee.y + FX_SCRATCH_VEC_A.y * 0.15,
        ee.z + FX_SCRATCH_VEC_A.z * 0.15,
        FX_SCRATCH_VEC_A.x * 0.5 + (fxRandom() - 0.5) * 0.3,
        FX_SCRATCH_VEC_A.y * 0.5 + 0.1,
        FX_SCRATCH_VEC_A.z * 0.5 + (fxRandom() - 0.5) * 0.3,
        randRange(2.2, 3.6),
        0.25 * P,
        randRange(0.9, 1.5) * P,
        V,
        Y,
        L,
        0.28,
        Z,
        1.5,
        0.1,
        1,
        -1,
      );
    return Z;
  }
  function debrisBurstAt(ee, B = {}) {
    let P;
    if (B.color !== void 0) P = toRgbTriple(B.color, 0.4, 0.4, 0.4);
    else if (B.mat) {
      let oe = null;
      try {
        oe = typeof B.mat == 'string' ? ctx.mats.get(B.mat) : B.mat;
      } catch {
        oe = null;
      }
      P = toRgbTriple(oe && oe.color ? oe.color : null, 0.4, 0.4, 0.4);
    } else P = toRgbTriple(null, 0.4, 0.39, 0.37);
    let V = P[0],
      Y = P[1],
      L = P[2],
      Z = B.size || 0.06,
      J = B.speed || 5;
    (FX_SCRATCH_VEC_A.copy(B.normal || Ei).normalize(),
      emitDebris(
        ee,
        FX_SCRATCH_VEC_A,
        Math.min(B.count || 6, 40),
        J * 0.4,
        J * 1.3,
        Z * 0.4,
        Z * 1.2,
        Z * 0.3,
        Z * 0.9,
        Z * 0.4,
        Z * 1.2,
        V,
        Y,
        L,
        B.spread || 1,
        groundHeightAt(ee),
      ));
  }
  function splashAt(ee, B = 1) {
    let P = shadeAt(ee, Ei),
      V = ee.y;
    for (let fe = 0; fe < 5; fe++) {
      let le = randRange(0.35, 0.6) * B,
        R = emitParticle(
          ee.x + (fxRandom() - 0.5) * 0.08 * B,
          V + 0.1 * B,
          ee.z + (fxRandom() - 0.5) * 0.08 * B,
          (fxRandom() - 0.5) * 0.5,
          randRange(1.6, 2.8) * Math.sqrt(B),
          (fxRandom() - 0.5) * 0.5,
          randRange(0.4, 0.65),
          le * 0.3,
          le,
          0.72,
          0.78,
          0.84,
          0.95,
          P,
          0.5,
          -7,
          0,
          6,
        );
      R >= 0 &&
        ((litEmitter.rot[R] = (fxRandom() - 0.5) * 0.3),
        (litEmitter.rotv[R] = 0),
        (litEmitter.turb[R] = 0),
        (litEmitter.sk[R] = 3),
        (litEmitter.fout[R] = 0.4));
    }
    for (let fe = 0; fe < 2; fe++)
      emitParticle(
        ee.x,
        V + 0.15 * B,
        ee.z,
        (fxRandom() - 0.5) * 0.6,
        0.5,
        (fxRandom() - 0.5) * 0.6,
        randRange(0.7, 1.1),
        0.2 * B,
        0.7 * B,
        0.7,
        0.75,
        0.8,
        0.14,
        P,
        2,
        0,
        0.8,
        -1,
      );
    let Y = 1.9 * P + 0.35,
      L = 1.5 * P + 0.45,
      Z = 1.05 * P + 0.55,
      J = Math.round(14 * Math.min(B, 1.6));
    for (let fe = 0; fe < J; fe++) {
      randomDirectionAround(Ei, 0.75, FX_SCRATCH_VEC_D);
      let le = randRange(1.5, 4.8) * Math.sqrt(B),
        R = unlitEmitter.emit(
          ee.x,
          V + 0.03,
          ee.z,
          FX_SCRATCH_VEC_D.x * le,
          Math.abs(FX_SCRATCH_VEC_D.y) * le,
          FX_SCRATCH_VEC_D.z * le,
          randRange(0.5, 1),
          randRange(0.012, 0.024),
          0.01,
        );
      R >= 0 &&
        ((unlitEmitter.mode[R] = 1),
        (unlitEmitter.frame[R] = SPARK_CELL_DISC),
        (unlitEmitter.stretch[R] = 0.012),
        (unlitEmitter.grav[R] = 9.81),
        (unlitEmitter.drag[R] = 0.4),
        (unlitEmitter.r[R] = Y),
        (unlitEmitter.g[R] = L),
        (unlitEmitter.b[R] = Z),
        (unlitEmitter.fout[R] = 0.7),
        (unlitEmitter.flags[R] = PARTICLE_FLAG_KILL_ON_GROUND),
        (unlitEmitter.sk[R] = 1),
        (unlitEmitter.gy[R] = V));
    }
    emitRipple(
      ee.x,
      V + 0.012,
      ee.z,
      0.9,
      0.12 * B,
      1.5 * B,
      0.3 * P + 0.08,
      0.27 * P + 0.09,
      0.22 * P + 0.1,
    );
    let oe = emitRipple(
      ee.x,
      V + 0.012,
      ee.z,
      1.3,
      0.05 * B,
      1 * B,
      0.2 * P + 0.05,
      0.18 * P + 0.06,
      0.15 * P + 0.07,
    );
    oe >= 0 && (unlitEmitter.fin[oe] = 0.35);
  }
  let scratch = {
    p: new THREE.Vector3(),
  };
  function impactAt(ee, B, P, V, Y) {
    (FX_SCRATCH_VEC_A.copy(B || Ei),
      FX_SCRATCH_VEC_A.lengthSq() < 1e-6 && FX_SCRATCH_VEC_A.copy(Ei),
      FX_SCRATCH_VEC_A.normalize(),
      V && V.lengthSq() > 1e-6
        ? FX_SCRATCH_VEC_B.copy(V).normalize()
        : FX_SCRATCH_VEC_B.copy(FX_SCRATCH_VEC_A).negate(),
      FX_SCRATCH_VEC_C.copy(FX_SCRATCH_VEC_B)
        .addScaledVector(FX_SCRATCH_VEC_A, -2 * FX_SCRATCH_VEC_B.dot(FX_SCRATCH_VEC_A))
        .normalize());
    let L = scratch.p.copy(ee);
    if (
      (Y && (P = 'enemy'),
      P !== 'enemy' &&
        P !== 'water' &&
        FX_SCRATCH_VEC_A.y > 0.7 &&
        ctx.ground &&
        ctx.ground.isPuddle)
    )
      try {
        ctx.ground.isPuddle(L.x, L.z) && L.y < 0.08 && (P = 'water');
      } catch {}
    let J =
        (ctx.camera ? ctx.camera.position : FX_SCRATCH_VEC_E.set(0, 0, 0)).distanceToSquared(L) >
        3025,
      oe = J ? 0.5 : 1,
      fe = FX_SCRATCH_VEC_A.x,
      le = FX_SCRATCH_VEC_A.y,
      R = FX_SCRATCH_VEC_A.z;
    switch (P) {
      case 'metal': {
        (FX_SCRATCH_VEC_D.copy(FX_SCRATCH_VEC_C).addScaledVector(FX_SCRATCH_VEC_A, 0.6).normalize(),
          FX_SCRATCH_VEC_B.copy(FX_SCRATCH_VEC_D),
          emitSparkBurst(
            L,
            FX_SCRATCH_VEC_B,
            Math.round(18 * oe),
            6,
            24,
            0.55,
            0.1,
            0.38,
            40,
            25,
            10.5,
            0,
          ),
          emitSparkBurst(
            L,
            FX_SCRATCH_VEC_B,
            2 + ((fxRandom() * 2) | 0),
            9,
            18,
            0.9,
            0.7,
            1.3,
            32,
            18,
            7,
            PARTICLE_FLAG_BOUNCE,
          ),
          emitGlow(
            L.x + fe * 0.03,
            L.y + le * 0.03,
            L.z + R * 0.03,
            0.05,
            0.25,
            0.45,
            16,
            11,
            5.5,
            SPARK_CELL_FLASH,
          ),
          emitGlow(
            L.x + fe * 0.04,
            L.y + le * 0.04,
            L.z + R * 0.04,
            0.04,
            0.35,
            0.5,
            9,
            6,
            2.6,
            SPARK_CELL_BURST_A + ((fxRandom() * 2) | 0),
          ),
          time - lastMetalFlashAt > 0.09 &&
            ((lastMetalFlashAt = time),
            FX_SCRATCH_VEC_E.copy(L).addScaledVector(FX_SCRATCH_VEC_A, 0.12),
            flashLight(FX_SCRATCH_VEC_E, 16760944, 10, 5, 0.05)));
        let I = shadeAt(L, FX_SCRATCH_VEC_A);
        for (let se = 0; se < 2; se++)
          emitParticle(
            L.x + fe * 0.04,
            L.y + le * 0.04,
            L.z + R * 0.04,
            fe * 0.8 + (fxRandom() - 0.5) * 0.5,
            le * 0.8 + 0.2,
            R * 0.8 + (fxRandom() - 0.5) * 0.5,
            randRange(0.5, 0.9),
            0.06,
            randRange(0.3, 0.5),
            0.4,
            0.4,
            0.41,
            0.4,
            I,
            2.5,
            0.3,
            0.8,
            -1,
          );
        (J ||
          emitDebris(
            L,
            FX_SCRATCH_VEC_A,
            2,
            1.5,
            4,
            0.012,
            0.03,
            0.003,
            0.005,
            0.01,
            0.025,
            0.2,
            0.21,
            0.23,
            0.8,
            groundHeightAt(L),
          ),
          decalPool.add(L, FX_SCRATCH_VEC_A, 'bullet_metal'));
        break;
      }
      case 'wood': {
        let I = dustAt(L, FX_SCRATCH_VEC_A, 0.75, 0.5, 0.42, 0.32);
        (emitDebris(
          L,
          FX_SCRATCH_VEC_A,
          J ? 3 : 7,
          2,
          6,
          0.004,
          0.009,
          0.03,
          0.1,
          0.004,
          0.012,
          0.62,
          0.5,
          0.33,
          0.7,
          groundHeightAt(L),
        ),
          I > 0.5 &&
            fxRandom() < 0.3 &&
            emitGlow(L.x, L.y, L.z, 0.04, 0.1, 0.2, 3, 2, 1, SPARK_CELL_FLASH),
          decalPool.add(L, FX_SCRATCH_VEC_A, 'bullet_wood'));
        break;
      }
      case 'water': {
        splashAt(L, 1);
        break;
      }
      case 'rubber':
      case 'dirt': {
        let I = shadeAt(L, FX_SCRATCH_VEC_A),
          se = P === 'dirt',
          ae = se ? 0.3 : 0.14,
          k = se ? 0.25 : 0.14,
          ce = se ? 0.19 : 0.14;
        for (let ve = 0; ve < 5; ve++) {
          randomDirectionAround(FX_SCRATCH_VEC_A, 0.6, FX_SCRATCH_VEC_D);
          let _e = randRange(0.6, 2.6);
          emitParticle(
            L.x + fe * 0.03,
            L.y + le * 0.03,
            L.z + R * 0.03,
            FX_SCRATCH_VEC_D.x * _e,
            FX_SCRATCH_VEC_D.y * _e,
            FX_SCRATCH_VEC_D.z * _e,
            randRange(0.5, 1),
            0.07,
            randRange(0.3, 0.55),
            ae,
            k,
            ce,
            0.85,
            I,
            3.5,
            0.1,
            0.6,
            ve < 2 ? 7 : -1,
          );
        }
        (emitDebris(
          L,
          FX_SCRATCH_VEC_A,
          3,
          1.5,
          4,
          0.01,
          0.03,
          0.008,
          0.02,
          0.01,
          0.03,
          ae * 0.8,
          k * 0.8,
          ce * 0.8,
          0.7,
          groundHeightAt(L),
        ),
          decalPool.add(L, FX_SCRATCH_VEC_A, 'soot', 0.2, 1, 0.8));
        break;
      }
      case 'glass': {
        for (let I = 0; I < 12; I++) {
          randomDirectionAround(FX_SCRATCH_VEC_A, 0.9, FX_SCRATCH_VEC_D);
          let se = randRange(1.5, 6),
            ae = unlitEmitter.emit(
              L.x,
              L.y,
              L.z,
              FX_SCRATCH_VEC_D.x * se,
              FX_SCRATCH_VEC_D.y * se,
              FX_SCRATCH_VEC_D.z * se,
              randRange(0.4, 0.9),
              randRange(0.012, 0.02),
              0.008,
            );
          ae >= 0 &&
            ((unlitEmitter.mode[ae] = 1),
            (unlitEmitter.frame[ae] = SPARK_CELL_DISC),
            (unlitEmitter.stretch[ae] = 0.01),
            (unlitEmitter.grav[ae] = 9.81),
            (unlitEmitter.r[ae] = 2.6),
            (unlitEmitter.g[ae] = 2.7),
            (unlitEmitter.b[ae] = 2.8),
            (unlitEmitter.flags[ae] = PARTICLE_FLAG_KILL_ON_GROUND),
            (unlitEmitter.ramp[ae] = 3));
        }
        (emitDebris(
          L,
          FX_SCRATCH_VEC_A,
          4,
          1.5,
          5,
          0.01,
          0.03,
          0.002,
          0.004,
          0.01,
          0.03,
          0.62,
          0.72,
          0.74,
          0.8,
          groundHeightAt(L),
        ),
          emitParticle(
            L.x,
            L.y,
            L.z,
            fe * 0.6,
            le * 0.6 + 0.2,
            R * 0.6,
            0.6,
            0.08,
            0.4,
            0.75,
            0.8,
            0.82,
            0.2,
            shadeAt(L, FX_SCRATCH_VEC_A),
            2.5,
            0.2,
            0.8,
            -1,
          ),
          decalPool.add(L, FX_SCRATCH_VEC_A, 'bullet_glass'));
        break;
      }
      case 'enemy': {
        (FX_SCRATCH_VEC_D.copy(FX_SCRATCH_VEC_C).addScaledVector(FX_SCRATCH_VEC_A, 0.8).normalize(),
          FX_SCRATCH_VEC_B.copy(FX_SCRATCH_VEC_D),
          emitSparkBurst(
            L,
            FX_SCRATCH_VEC_B,
            Math.round(13 * oe),
            5,
            20,
            0.9,
            0.12,
            0.45,
            42,
            29,
            14,
            0,
          ),
          emitSparkBurst(
            L,
            FX_SCRATCH_VEC_B,
            2,
            6,
            12,
            1,
            0.6,
            1.1,
            32,
            18,
            7,
            PARTICLE_FLAG_BOUNCE,
          ),
          emitGlow(L.x, L.y, L.z, 0.06, 0.3, 0.55, 18, 12, 6, SPARK_CELL_FLASH),
          emitGlow(
            L.x,
            L.y,
            L.z,
            0.04,
            0.3,
            0.45,
            8,
            5,
            2.4,
            SPARK_CELL_BURST_A + ((fxRandom() * 2) | 0),
          ),
          time - lastMetalFlashAt > 0.09 &&
            ((lastMetalFlashAt = time), flashLight(L, 16756832, 8, 4.5, 0.05)));
        let I = shadeAt(L, FX_SCRATCH_VEC_A);
        for (let se = 0; se < 2; se++)
          emitParticle(
            L.x,
            L.y,
            L.z,
            fe * 0.5 + (fxRandom() - 0.5) * 0.4,
            le * 0.5 + 0.3,
            R * 0.5 + (fxRandom() - 0.5) * 0.4,
            randRange(0.6, 1.1),
            0.06,
            randRange(0.3, 0.5),
            0.13,
            0.13,
            0.14,
            0.65,
            I,
            2.2,
            0.5,
            0.9,
            -1,
          );
        if (!J) {
          let se = fxRandom() < 0.35;
          emitDebris(
            L,
            FX_SCRATCH_VEC_A,
            3,
            2,
            6,
            0.012,
            0.035,
            0.004,
            0.008,
            0.012,
            0.03,
            0.6,
            se ? 0.2 : 0.62,
            se ? 0.05 : 0.64,
            0.8,
            groundHeightAt(L),
          );
        }
        break;
      }
      default: {
        (dustAt(L, FX_SCRATCH_VEC_A, 1, 0.52, 0.5, 0.47),
          emitDebris(
            L,
            FX_SCRATCH_VEC_A,
            J ? 2 : 4,
            1.5,
            5.5,
            0.012,
            0.035,
            0.008,
            0.02,
            0.012,
            0.035,
            0.42,
            0.41,
            0.39,
            0.7,
            groundHeightAt(L),
          ),
          FX_SCRATCH_VEC_D.copy(FX_SCRATCH_VEC_C)
            .addScaledVector(FX_SCRATCH_VEC_A, 0.7)
            .normalize(),
          FX_SCRATCH_VEC_B.copy(FX_SCRATCH_VEC_D));
        for (let I = 0; I < 4; I++) {
          randomDirectionAround(FX_SCRATCH_VEC_B, 0.5, FX_SCRATCH_VEC_D);
          let se = randRange(3, 9),
            ae = emitParticle(
              L.x,
              L.y,
              L.z,
              FX_SCRATCH_VEC_D.x * se,
              FX_SCRATCH_VEC_D.y * se,
              FX_SCRATCH_VEC_D.z * se,
              randRange(0.25, 0.45),
              0.03,
              0.09,
              0.6,
              0.58,
              0.54,
              0.7,
              1,
              2,
              -6,
              0.2,
              7,
            );
          ae >= 0 && (litEmitter.turb[ae] = 0);
        }
        (fxRandom() < 0.3 &&
          emitSparkBurst(L, FX_SCRATCH_VEC_B, 3, 4, 10, 0.6, 0.08, 0.2, 26, 15, 6, 0),
          decalPool.add(L, FX_SCRATCH_VEC_A, 'bullet_concrete'));
      }
    }
  }
  function tracer(alignDot, B, P = {}) {
    let V = toRgbTriple(P.color, 1, 0.8, 0.46),
      Y = P.intensity || 16;
    if (
      (tracerPool.add(alignDot, B, V[0] * Y, V[1] * Y, V[2] * Y, P.speed || 260, P.width || 0.024),
      time - lastTracerTrailAt > 0.07 && P.trail !== !1)
    ) {
      ((lastTracerTrailAt = time), FX_SCRATCH_VEC_D.subVectors(B, alignDot));
      let L = FX_SCRATCH_VEC_D.length();
      if (L > 2) {
        FX_SCRATCH_VEC_D.multiplyScalar(1 / L);
        let Z = 5,
          J = Math.min(L, 7),
          oe = shadeAt(alignDot, null);
        for (let fe = 0; fe < Z; fe++) {
          let le = 0.6 + ((fe + fxRandom()) / Z) * (J - 0.6),
            R = emitParticle(
              alignDot.x + FX_SCRATCH_VEC_D.x * le,
              alignDot.y + FX_SCRATCH_VEC_D.y * le,
              alignDot.z + FX_SCRATCH_VEC_D.z * le,
              FX_SCRATCH_VEC_D.x * 0.6,
              0.05,
              FX_SCRATCH_VEC_D.z * 0.6,
              randRange(0.45, 0.8),
              0.04,
              randRange(0.12, 0.2),
              0.6,
              0.6,
              0.62,
              0.1,
              oe,
              2,
              0.1,
              0.7,
              -1,
            );
          R >= 0 && (litEmitter.fin[R] = 0.25);
        }
      }
    }
  }
  function muzzleFlash(ee, B, P = {}) {
    let V = P.scale || 1;
    (FX_SCRATCH_VEC_B.copy(B || Ei),
      FX_SCRATCH_VEC_B.lengthSq() < 1e-6 && FX_SCRATCH_VEC_B.set(0, 0, -1),
      FX_SCRATCH_VEC_B.normalize());
    let Y = toRgbTriple(P.color, 1, 0.68, 0.32),
      L = ee.x,
      Z = ee.y,
      J = ee.z,
      oe = Y[0],
      fe = Y[1],
      le = Y[2];
    (emitGlow(
      L + FX_SCRATCH_VEC_B.x * 0.1 * V,
      Z + FX_SCRATCH_VEC_B.y * 0.1 * V,
      J + FX_SCRATCH_VEC_B.z * 0.1 * V,
      0.045,
      0.75 * V,
      1.15 * V,
      34 * oe,
      34 * fe,
      34 * le,
      SPARK_CELL_BURST_A,
    ),
      emitGlow(
        L + FX_SCRATCH_VEC_B.x * 0.14 * V,
        Z + FX_SCRATCH_VEC_B.y * 0.14 * V,
        J + FX_SCRATCH_VEC_B.z * 0.14 * V,
        0.035,
        0.5 * V,
        0.85 * V,
        22 * oe,
        22 * fe,
        22 * le,
        SPARK_CELL_BURST_A + 1,
      ),
      emitGlow(
        L + FX_SCRATCH_VEC_B.x * 0.05 * V,
        Z + FX_SCRATCH_VEC_B.y * 0.05 * V,
        J + FX_SCRATCH_VEC_B.z * 0.05 * V,
        0.045,
        0.13 * V,
        0.2 * V,
        22,
        22 * (fe + 0.25),
        22 * (le + 0.3),
        SPARK_CELL_FLASH,
      ),
      emitGlow(L, Z, J, 0.05, 0.8 * V, 1.1 * V, 0.4 * oe, 0.4 * fe, 0.4 * le, SPARK_CELL_FLASH));
    let R = unlitEmitter.emit(
      L + FX_SCRATCH_VEC_B.x * 0.4 * V,
      Z + FX_SCRATCH_VEC_B.y * 0.4 * V,
      J + FX_SCRATCH_VEC_B.z * 0.4 * V,
      -FX_SCRATCH_VEC_B.x,
      -FX_SCRATCH_VEC_B.y,
      -FX_SCRATCH_VEC_B.z,
      0.04,
      0.11 * V,
      0.14 * V,
    );
    R >= 0 &&
      ((unlitEmitter.mode[R] = 1),
      (unlitEmitter.frame[R] = SPARK_CELL_SPIKE),
      (unlitEmitter.stretch[R] = 0.9 * V),
      (unlitEmitter.r[R] = 18 * oe),
      (unlitEmitter.g[R] = 18 * fe),
      (unlitEmitter.b[R] = 18 * le),
      (unlitEmitter.fout[R] = 0.3));
    for (let I = 0; I < 3; I++) {
      randomDirectionAround(FX_SCRATCH_VEC_B, 0.25, FX_SCRATCH_VEC_D);
      let se = randRange(8, 22);
      emitStreak(
        L,
        Z,
        J,
        FX_SCRATCH_VEC_D.x * se,
        FX_SCRATCH_VEC_D.y * se,
        FX_SCRATCH_VEC_D.z * se,
        randRange(0.08, 0.22),
        0.012,
        30,
        18,
        7,
        0,
      );
    }
    (emitParticle(
      L + FX_SCRATCH_VEC_B.x * 0.2,
      Z + FX_SCRATCH_VEC_B.y * 0.2,
      J + FX_SCRATCH_VEC_B.z * 0.2,
      FX_SCRATCH_VEC_B.x * 1.5,
      FX_SCRATCH_VEC_B.y * 1.5 + 0.2,
      FX_SCRATCH_VEC_B.z * 1.5,
      randRange(0.5, 0.9),
      0.08 * V,
      0.45 * V,
      0.5,
      0.5,
      0.52,
      0.16,
      1,
      3,
      0.3,
      0.8,
      -1,
    ),
      FX_SCRATCH_VEC_E.copy(ee).addScaledVector(FX_SCRATCH_VEC_B, 0.25),
      flashLight(FX_SCRATCH_VEC_E, 16756832, 16 * V, 7 * V, 0.05));
  }
  function addShell(ee, B) {
    shellPool.add(ee, B);
  }
  let explosionEvent = {
    pos: new THREE.Vector3(),
    size: 1,
  };
  function explosionAt(ee, B = 1) {
    let P = Math.max(0.4, Math.min(B, 4)),
      V = ee.x,
      Y = ee.y,
      L = ee.z,
      Z = Math.sqrt(P),
      J = groundHeightAt(ee),
      oe = Y - J < 1.4 * P,
      fe = shadeAt(ee, Ei);
    (FX_SCRATCH_VEC_E.set(V, Y + 0.4, L),
      flashLight(FX_SCRATCH_VEC_E, 16769712, 320 * P, 10 + 9 * P, 0.08),
      flashLight(FX_SCRATCH_VEC_E, 16747056, 55 * P, 8 + 6 * P, 0.45));
    let le = Y + 0.35 * P;
    (emitGlow(V, le, L, 0.055, 1.5 * P, 2.3 * P, 16, 13.5, 9.5, SPARK_CELL_FLASH),
      emitGlow(
        V,
        le,
        L,
        0.05,
        2.6 * P,
        4.2 * P,
        7,
        5,
        2.4,
        SPARK_CELL_BURST_A + ((fxRandom() * 2) | 0),
      ),
      emitGlow(V, le, L, 0.3, 3.5 * P, 5.5 * P, 0.35, 0.2, 0.08, SPARK_CELL_FLASH));
    let R = Math.round(13 + 5 * P);
    for (let ae = 0; ae < R; ae++) {
      (randomDirectionAround(Ei, 1.6, FX_SCRATCH_VEC_D),
        oe && FX_SCRATCH_VEC_D.y < -0.1 && (FX_SCRATCH_VEC_D.y = -FX_SCRATCH_VEC_D.y * 0.5));
      let k = randRange(2.2, 7.5) * Z,
        ce = randRange(0.7, 1.15),
        ve = litEmitter.emit(
          V + FX_SCRATCH_VEC_D.x * 0.3 * P,
          le + FX_SCRATCH_VEC_D.y * 0.3 * P,
          L + FX_SCRATCH_VEC_D.z * 0.3 * P,
          FX_SCRATCH_VEC_D.x * k,
          FX_SCRATCH_VEC_D.y * k + 1.4,
          FX_SCRATCH_VEC_D.z * k,
          randRange(0.55, 1.05),
          0.85 * P,
          randRange(1.8, 2.7) * P,
        );
      ve >= 0 &&
        ((litEmitter.frame[ve] = ae % 4 === 0 ? 7 : (fxRandom() * 6) | 0),
        (litEmitter.ramp[ve] = 2),
        (litEmitter.r[ve] = 5.8 * ce),
        (litEmitter.g[ve] = 2.4 * ce),
        (litEmitter.b[ve] = 0.5 * ce),
        (litEmitter.a[ve] = 0.96),
        (litEmitter.shade[ve] = 2 + fe),
        (litEmitter.drag[ve] = 4),
        (litEmitter.grav[ve] = -2.6),
        (litEmitter.wind[ve] = 0.6),
        (litEmitter.turb[ve] = 1.5),
        (litEmitter.rot[ve] = fxRandom() * 6.283),
        (litEmitter.rotv[ve] = (fxRandom() - 0.5) * 2.5),
        (litEmitter.sk[ve] = 3),
        (litEmitter.fin[ve] = 0),
        (litEmitter.fout[ve] = 0.6));
    }
    for (let ae = 0; ae < 5; ae++) {
      randomDirectionAround(Ei, 1.4, FX_SCRATCH_VEC_D);
      let k = randRange(2, 5) * Z,
        ce = unlitEmitter.emit(
          V + FX_SCRATCH_VEC_D.x * 0.3 * P,
          le + FX_SCRATCH_VEC_D.y * 0.3 * P,
          L + FX_SCRATCH_VEC_D.z * 0.3 * P,
          FX_SCRATCH_VEC_D.x * k,
          Math.abs(FX_SCRATCH_VEC_D.y) * k + 1.2,
          FX_SCRATCH_VEC_D.z * k,
          randRange(0.3, 0.55),
          0.6 * P,
          randRange(1.2, 1.8) * P,
        );
      ce >= 0 &&
        ((unlitEmitter.frame[ce] = SPARK_CELL_PUFF),
        (unlitEmitter.ramp[ce] = 2),
        (unlitEmitter.r[ce] = 2.4),
        (unlitEmitter.g[ce] = 1.1),
        (unlitEmitter.b[ce] = 0.3),
        (unlitEmitter.drag[ce] = 4),
        (unlitEmitter.grav[ce] = -2.5),
        (unlitEmitter.rot[ce] = fxRandom() * 6.283),
        (unlitEmitter.sk[ce] = 3),
        (unlitEmitter.fout[ce] = 0.4));
    }
    let I = Math.round(11 + 5 * P);
    for (let ae = 0; ae < I; ae++) {
      let k = ae % 2 === 0;
      (randomDirectionAround(Ei, 1.4, FX_SCRATCH_VEC_D),
        oe && FX_SCRATCH_VEC_D.y < 0 && (FX_SCRATCH_VEC_D.y = -FX_SCRATCH_VEC_D.y * 0.4));
      let ce = (k ? randRange(4.5, 9) : randRange(1.5, 5)) * Z,
        ve = randRange(0.04, 0.1),
        _e = k ? 0.75 : 0.3,
        Te = emitParticle(
          V + FX_SCRATCH_VEC_D.x * _e * P,
          le + FX_SCRATCH_VEC_D.y * _e * P,
          L + FX_SCRATCH_VEC_D.z * _e * P,
          FX_SCRATCH_VEC_D.x * ce,
          FX_SCRATCH_VEC_D.y * ce + 0.8,
          FX_SCRATCH_VEC_D.z * ce,
          randRange(2.8, 4.8),
          (k ? 0.8 : 1.2) * P,
          randRange(2.6, 4.2) * P,
          ve,
          ve * 0.95,
          ve * 0.9,
          k ? 0.7 : 0.8,
          fe,
          3.4,
          randRange(0.8, 1.7),
          1,
          ae % 3 === 0 ? 7 : -1,
        );
      Te >= 0 &&
        ((litEmitter.fin[Te] = k ? 0.025 : 0.16),
        (litEmitter.fout[Te] = 0.35),
        (litEmitter.turb[Te] = 1.2));
    }
    addEmitterAt(V, Y + 0.3 * P, L, 'smolder', 1.3 + 0.3 * P, P, fe);
    let se = Math.min(90, Math.round(34 * P));
    for (let ae = 0; ae < se; ae++) {
      (randomDirectionAround(Ei, 1.5, FX_SCRATCH_VEC_D),
        oe && FX_SCRATCH_VEC_D.y < 0 && (FX_SCRATCH_VEC_D.y = -FX_SCRATCH_VEC_D.y));
      let k = randRange(6, 26) * Z,
        ce = emitStreak(
          V,
          Y + 0.05,
          L,
          FX_SCRATCH_VEC_D.x * k,
          FX_SCRATCH_VEC_D.y * k,
          FX_SCRATCH_VEC_D.z * k,
          randRange(0.5, 1.5),
          randRange(0.014, 0.028),
          40,
          23,
          8,
          PARTICLE_FLAG_BOUNCE,
        );
      ce >= 0 && ((unlitEmitter.drag[ce] = 1.4), (unlitEmitter.stretch[ce] = 0.035));
    }
    for (let ae = 0; ae < 10 * P; ae++) {
      randomDirectionAround(Ei, 1.2, FX_SCRATCH_VEC_D);
      let k = randRange(1, 5),
        ce = unlitEmitter.emit(
          V,
          Y + 0.3,
          L,
          FX_SCRATCH_VEC_D.x * k,
          Math.abs(FX_SCRATCH_VEC_D.y) * k + 1,
          FX_SCRATCH_VEC_D.z * k,
          randRange(1.4, 3),
          0.035,
          0.02,
        );
      ce >= 0 &&
        ((unlitEmitter.frame[ce] = SPARK_CELL_FLASH),
        (unlitEmitter.ramp[ce] = 3),
        (unlitEmitter.r[ce] = 9),
        (unlitEmitter.g[ce] = 4),
        (unlitEmitter.b[ce] = 1),
        (unlitEmitter.drag[ce] = 1.2),
        (unlitEmitter.grav[ce] = 0.6),
        (unlitEmitter.turb[ce] = 3),
        (unlitEmitter.wind[ce] = 1),
        (unlitEmitter.fout[ce] = 0.5));
    }
    if (oe) {
      let ae = J + 0.015;
      emitRipple(V, ae, L, 0.32, 0.6 * P, 9 * P, 1.6, 1.2, 0.75);
      let k = Math.round(12 + 3 * P);
      for (let ce = 0; ce < k; ce++) {
        let ve = ((ce + fxRandom()) / k) * 6.283,
          _e = randRange(5, 10) * Z,
          Te = randRange(0.42, 0.55),
          Pe = emitParticle(
            V + Math.cos(ve) * 0.4 * P,
            ae + 0.2,
            L + Math.sin(ve) * 0.4 * P,
            Math.cos(ve) * _e,
            randRange(0.2, 0.9),
            Math.sin(ve) * _e,
            randRange(1.2, 2.2),
            0.4 * P,
            randRange(1.2, 1.9) * P,
            Te,
            Te * 0.96,
            Te * 0.9,
            0.26,
            fe,
            3,
            0.15,
            0.7,
            -1,
          );
        Pe >= 0 && (litEmitter.fin[Pe] = 0.1);
      }
      (FX_SCRATCH_VEC_F.set(V, J, L),
        decalPool.add(FX_SCRATCH_VEC_F, Ei, 'scorch', 2.3 * P, 1, 0.92));
    }
    (FX_SCRATCH_VEC_F.set(V, Math.max(Y, J + 0.1), L),
      emitDebris(
        FX_SCRATCH_VEC_F,
        Ei,
        Math.round(13 + 6 * P),
        4,
        13 * Z,
        0.04,
        0.13,
        0.025,
        0.08,
        0.04,
        0.13,
        0.07,
        0.066,
        0.062,
        1.1,
        J,
      ),
      explosionEvent.pos.copy(ee),
      (explosionEvent.size = B),
      ctx.events.emit('explosion', explosionEvent));
  }
  let emitterPool = [];
  for (let effectPos = 0; effectPos < 24; effectPos++) {
    let surfaceNormal = {
      active: !1,
      kind: 'steam',
      pos: new THREE.Vector3(),
      acc: 0,
      acc2: 0,
      ttl: 1 / 0,
      scale: 1,
      shade: 1,
      t: 0,
      light: null,
      drop: -1,
    };
    ((surfaceNormal.stop = () => {
      ((surfaceNormal.active = !1),
        surfaceNormal.light && (surfaceNormal.light.release(), (surfaceNormal.light = null)));
    }),
      (surfaceNormal.setPos = (effectCount) => {
        surfaceNormal.pos.copy(effectCount);
      }),
      emitterPool.push(surfaceNormal));
  }
  let NULL_EMITTER = {
    active: !1,
    pos: new THREE.Vector3(),
    stop() {},
    setPos() {},
  };
  function addEmitterAt(ee, B, P, V, Y, L, Z) {
    let J = null;
    for (let oe = 0; oe < emitterPool.length; oe++)
      if (!emitterPool[oe].active) {
        J = emitterPool[oe];
        break;
      }
    if (!J) return NULL_EMITTER;
    if (
      ((J.active = !0),
      (J.kind = V),
      J.pos.set(ee, B, P),
      (J.acc = 0),
      (J.acc2 = 0),
      (J.ttl = Y),
      (J.scale = L),
      (J.t = 0),
      (J.drop = -1),
      (J.shade = Z === void 0 ? shadeAt(J.pos, null) : Z),
      V === 'fire')
    ) {
      let oe = getLightPool();
      ((J.light = oe && oe.acquire ? oe.acquire() : null),
        J.light &&
          (J.light.light.color.set(16747066),
          (J.light.light.distance = 9),
          J.light.light.position.set(ee, B + 0.5, P)));
    }
    return J;
  }
  function addEmitter(ee, B = 'steam', P = {}) {
    return addEmitterAt(ee.x, ee.y, ee.z, B, P.ttl || 1 / 0, P.scale || 1, void 0);
  }
  function updateEmitters(ee) {
    for (let B = 0; B < emitterPool.length; B++) {
      let P = emitterPool[B];
      if (!P.active) continue;
      if (((P.t += ee), P.t > P.ttl)) {
        P.stop();
        continue;
      }
      let V = P.pos.x,
        Y = P.pos.y,
        L = P.pos.z,
        Z = P.scale;
      if (P.kind === 'steam')
        for (P.acc += ee * 13; P.acc > 1;) {
          P.acc -= 1;
          let J = emitParticle(
            V + (fxRandom() - 0.5) * 0.08,
            Y,
            L + (fxRandom() - 0.5) * 0.08,
            (fxRandom() - 0.5) * 0.4,
            randRange(1.4, 2.4),
            (fxRandom() - 0.5) * 0.4,
            randRange(1.8, 3),
            0.12 * Z,
            randRange(0.8, 1.3) * Z,
            0.8,
            0.82,
            0.85,
            0.2,
            P.shade,
            1.3,
            0.5,
            1,
            -1,
          );
          J >= 0 && ((litEmitter.fin[J] = 0.12), (litEmitter.turb[J] = 0.9));
        }
      else if (P.kind === 'smolder')
        for (P.acc += ee * 9 * (1 - P.t / P.ttl); P.acc > 1;) {
          P.acc -= 1;
          let J = randRange(0.05, 0.11),
            oe = emitParticle(
              V + (fxRandom() - 0.5) * 0.5 * Z,
              Y,
              L + (fxRandom() - 0.5) * 0.5 * Z,
              (fxRandom() - 0.5) * 0.6,
              randRange(1.2, 2.4),
              (fxRandom() - 0.5) * 0.6,
              randRange(2.4, 3.8),
              0.5 * Z,
              randRange(1.6, 2.6) * Z,
              J,
              J,
              J,
              0.6,
              P.shade,
              1,
              0.9,
              1,
              -1,
            );
          oe >= 0 && ((litEmitter.fin[oe] = 0.12), (litEmitter.turb[oe] = 1));
        }
      else if (P.kind === 'embers')
        for (P.acc += ee * 8; P.acc > 1;) {
          P.acc -= 1;
          let J = unlitEmitter.emit(
            V + (fxRandom() - 0.5) * 0.4 * Z,
            Y,
            L + (fxRandom() - 0.5) * 0.4 * Z,
            (fxRandom() - 0.5) * 0.6,
            randRange(0.6, 1.8),
            (fxRandom() - 0.5) * 0.6,
            randRange(1.5, 3.2),
            randRange(0.02, 0.04),
            0.012,
          );
          J >= 0 &&
            ((unlitEmitter.frame[J] = SPARK_CELL_FLASH),
            (unlitEmitter.ramp[J] = 3),
            (unlitEmitter.r[J] = 10),
            (unlitEmitter.g[J] = 4.2),
            (unlitEmitter.b[J] = 1),
            (unlitEmitter.drag[J] = 0.8),
            (unlitEmitter.grav[J] = -0.5),
            (unlitEmitter.turb[J] = 3.5),
            (unlitEmitter.wind[J] = 1),
            (unlitEmitter.fout[J] = 0.5));
        }
      else if (P.kind === 'fire') {
        for (P.acc += ee * 24; P.acc > 1;) {
          P.acc -= 1;
          let J = unlitEmitter.emit(
            V + (fxRandom() - 0.5) * 0.3 * Z,
            Y + 0.1 * Z,
            L + (fxRandom() - 0.5) * 0.3 * Z,
            (fxRandom() - 0.5) * 0.5,
            randRange(1.2, 2.6) * Z,
            (fxRandom() - 0.5) * 0.5,
            randRange(0.35, 0.65),
            0.45 * Z,
            randRange(0.2, 0.35) * Z,
          );
          J >= 0 &&
            ((unlitEmitter.frame[J] = SPARK_CELL_PUFF),
            (unlitEmitter.ramp[J] = 2),
            (unlitEmitter.r[J] = 9),
            (unlitEmitter.g[J] = 5.5),
            (unlitEmitter.b[J] = 2.2),
            (unlitEmitter.drag[J] = 1),
            (unlitEmitter.rot[J] = fxRandom() * 6.283),
            (unlitEmitter.rotv[J] = (fxRandom() - 0.5) * 4),
            (unlitEmitter.fin[J] = 0.12),
            (unlitEmitter.fout[J] = 0.4),
            (unlitEmitter.wind[J] = 1),
            (unlitEmitter.turb[J] = 2));
        }
        for (P.acc2 += ee * 4; P.acc2 > 1;) {
          P.acc2 -= 1;
          let J = randRange(0.05, 0.1),
            oe = emitParticle(
              V,
              Y + 0.8 * Z,
              L,
              (fxRandom() - 0.5) * 0.4,
              randRange(1.2, 2),
              (fxRandom() - 0.5) * 0.4,
              randRange(2.2, 3.4),
              0.3 * Z,
              randRange(1.1, 1.8) * Z,
              J,
              J,
              J,
              0.5,
              P.shade,
              0.9,
              0.8,
              1,
              -1,
            );
          oe >= 0 && ((litEmitter.fin[oe] = 0.2), (litEmitter.turb[oe] = 1));
          let fe = unlitEmitter.emit(
            V + (fxRandom() - 0.5) * 0.3,
            Y + 0.3,
            L + (fxRandom() - 0.5) * 0.3,
            fxRandom() - 0.5,
            randRange(1.5, 3),
            fxRandom() - 0.5,
            randRange(1, 2.2),
            0.03,
            0.012,
          );
          fe >= 0 &&
            ((unlitEmitter.frame[fe] = SPARK_CELL_FLASH),
            (unlitEmitter.ramp[fe] = 3),
            (unlitEmitter.r[fe] = 10),
            (unlitEmitter.g[fe] = 4.2),
            (unlitEmitter.b[fe] = 1),
            (unlitEmitter.drag[fe] = 0.8),
            (unlitEmitter.grav[fe] = -0.6),
            (unlitEmitter.turb[fe] = 4),
            (unlitEmitter.wind[fe] = 1));
        }
        P.light &&
          (P.light.light.intensity = (14 + 6 * Math.sin(P.t * 23) + 4 * Math.sin(P.t * 37.7)) * Z);
      } else if (P.kind === 'drip') {
        if (((P.acc += ee * 1.6), P.drop >= 0 && ((P.drop -= ee), P.drop < 0))) {
          let J = P.shade;
          emitRipple(V, 0.014, L, 0.8, 0.05, 0.55, 0.4 * J + 0.14, 0.36 * J + 0.16, 0.3 * J + 0.18);
          for (let oe = 0; oe < 3; oe++) {
            randomDirectionAround(Ei, 0.7, FX_SCRATCH_VEC_D);
            let fe = unlitEmitter.emit(
              V,
              0.03,
              L,
              FX_SCRATCH_VEC_D.x * 1.2,
              Math.abs(FX_SCRATCH_VEC_D.y) * 1.6,
              FX_SCRATCH_VEC_D.z * 1.2,
              0.35,
              0.012,
              0.008,
            );
            fe >= 0 &&
              ((unlitEmitter.mode[fe] = 1),
              (unlitEmitter.frame[fe] = SPARK_CELL_DISC),
              (unlitEmitter.stretch[fe] = 0.012),
              (unlitEmitter.grav[fe] = 9.81),
              (unlitEmitter.r[fe] = 1.6 * J + 0.3),
              (unlitEmitter.g[fe] = 1.3 * J + 0.4),
              (unlitEmitter.b[fe] = 0.9 * J + 0.5),
              (unlitEmitter.flags[fe] = PARTICLE_FLAG_KILL_ON_GROUND));
          }
        }
        for (; P.acc > 1;) {
          P.acc -= 1 + fxRandom() * 0.6;
          let J = Math.sqrt((2 * Math.max(Y, 0.05)) / 9.81),
            oe = unlitEmitter.emit(V, Y, L, 0, -0.2, 0, J + 0.05, 0.014, 0.014);
          (oe >= 0 &&
            ((unlitEmitter.mode[oe] = 1),
            (unlitEmitter.frame[oe] = SPARK_CELL_DISC),
            (unlitEmitter.stretch[oe] = 0.02),
            (unlitEmitter.grav[oe] = 9.81),
            (unlitEmitter.r[oe] = 1.4 * P.shade + 0.4),
            (unlitEmitter.g[oe] = 1.2 * P.shade + 0.5),
            (unlitEmitter.b[oe] = 0.9 * P.shade + 0.6),
            (unlitEmitter.flags[oe] = PARTICLE_FLAG_KILL_ON_GROUND),
            (unlitEmitter.fout[oe] = 0.98)),
            (P.drop = J));
        }
      }
    }
  }
  ctx.events.on('impact', (effectPos) => {
    !effectPos ||
      !effectPos.point ||
      impactAt(
        effectPos.point,
        effectPos.normal,
        effectPos.surface,
        effectPos.dir,
        effectPos.enemy,
      );
  });
  let isPuddleAt = (ee, B) => {
    try {
      return !!(ctx.ground && ctx.ground.isPuddle && ctx.ground.isPuddle(ee, B));
    } catch {
      return !1;
    }
  };
  (ctx.events.on('player:step', (effectPos) => {
    let surfaceNormal = (effectPos && effectPos.pos) || (ctx.player && ctx.player.pos);
    surfaceNormal &&
      ((effectPos && effectPos.surface === 'water') ||
        isPuddleAt(surfaceNormal.x, surfaceNormal.z)) &&
      (FX_SCRATCH_VEC_F.set(surfaceNormal.x, Math.max(0, surfaceNormal.y), surfaceNormal.z),
      splashAt(FX_SCRATCH_VEC_F, effectPos && effectPos.sprint ? 0.55 : 0.4));
  }),
    ctx.events.on('player:land', (effectPos) => {
      let surfaceNormal = ctx.player && ctx.player.pos;
      if (surfaceNormal) {
        if (
          (FX_SCRATCH_VEC_F.set(surfaceNormal.x, Math.max(0, surfaceNormal.y), surfaceNormal.z),
          (effectPos && effectPos.surface === 'water') ||
            isPuddleAt(surfaceNormal.x, surfaceNormal.z))
        )
          splashAt(FX_SCRATCH_VEC_F, 0.9);
        else if (effectPos && effectPos.speed > 5) {
          let effectCount = shadeAt(FX_SCRATCH_VEC_F, Ei);
          for (let effectLife = 0; effectLife < 6; effectLife++) {
            let riseSpeed = fxRandom() * 6.283;
            emitParticle(
              FX_SCRATCH_VEC_F.x + Math.cos(riseSpeed) * 0.2,
              FX_SCRATCH_VEC_F.y + 0.08,
              FX_SCRATCH_VEC_F.z + Math.sin(riseSpeed) * 0.2,
              Math.cos(riseSpeed) * 1.6,
              0.3,
              Math.sin(riseSpeed) * 1.6,
              randRange(0.7, 1.2),
              0.15,
              randRange(0.5, 0.8),
              0.45,
              0.44,
              0.42,
              0.22,
              effectCount,
              3,
              0.1,
              0.8,
              -1,
            );
          }
        }
      }
    }));
  function update(ee) {
    (ee > 0 || (ee = 0), (time += ee), updateEmitters(ee));
    let B = ctx.camera ? ctx.camera.position : FX_SCRATCH_VEC_E.set(0, 0, 0);
    (litBatch.begin(),
      litEmitter.update(ee, litBatch, B, windDir, time),
      litBatch.end(),
      unlitBatch.begin(),
      unlitEmitter.update(ee, unlitBatch, B, windDir, time),
      tracerPool.update(ee, unlitBatch, SPARK_CELL_SPIKE, SPARK_CELL_FLASH),
      unlitBatch.end(),
      debrisPool.update(ee),
      shellPool.update(ee));
  }
  function clear() {
    (litEmitter.clear(),
      unlitEmitter.clear(),
      tracerPool.clear(),
      debrisPool.clear(),
      shellPool.clear(),
      decalPool.clear());
    for (let ee of emitterPool) ee.active && ee.stop();
    (litBatch.begin(), litBatch.end(), unlitBatch.begin(), unlitBatch.end());
  }
  return {
    update: update,
    clear: clear,
    muzzleFlash: muzzleFlash,
    tracer: tracer,
    impact: impactAt,
    sparks: sparkBurstAt,
    smoke: smokeAt,
    dust: dustAt,
    explosion: explosionAt,
    shell: addShell,
    splash: splashAt,
    addEmitter: addEmitter,
    debris: debrisBurstAt,
    decal(effectPos, surfaceNormal, effectCount = 'bullet_concrete', effectLife) {
      (FX_SCRATCH_VEC_A.copy(surfaceNormal || Ei),
        decalPool.add(effectPos, FX_SCRATCH_VEC_A, effectCount, effectLife));
    },
    wind: windDir,
    root: root,
    stats() {
      return {
        lit: litEmitter.n,
        add: unlitEmitter.n,
        tracers: tracerPool.n,
        debris: debrisPool.live,
        drawCalls: 5,
      };
    },
  };
}

/**
 * 特效调参与截图用的独立测试场景：摆放混凝土/铁皮/木托盘三块靶板并循环触发冲击、曳光、抛壳与爆炸，支持 fxshow/fxhold/fxage/fxsize 参数与 window.__setShot 逐帧定格，用于离线比对特效迭代效果。
 */
export function showcaseEffects(ctx) {
  let fx = ctx.fx,
    mode = ctx.params.fxshow || 'all',
    propGroup = new THREE.Group(),
    addProp = (N, Q, K, ie, F) => {
      let X = new THREE.Mesh(N, ctx.mats.get(Q));
      return (X.position.set(K, ie, F), (X.castShadow = X.receiveShadow = !0), propGroup.add(X), X);
    };
  (addProp(beveledBoxGeometry(2.6, 2.2, 0.3, 0.02), 'concrete', -3.2, 1.1, 0),
    addProp(beveledBoxGeometry(2.2, 2, 0.08, 0.01), 'paint_blue', 0, 1, 0),
    addProp(beveledBoxGeometry(1.2, 1.2, 1.2, 0.015), 'wood_pallet', 3.2, 0.6, 0),
    ctx.scene.add(propGroup),
    ctx.physics.addBox([-4.5, 0, -0.15], [-1.9, 2.2, 0.15], {
      surface: 'concrete',
    }),
    ctx.physics.addBox([-1.1, 0, -0.04], [1.1, 2, 0.04], {
      surface: 'metal',
    }),
    ctx.physics.addBox([2.6, 0, -0.6], [3.8, 1.2, 0.6], {
      surface: 'wood',
    }));
  let makeVec = (N, Q, K) => new THREE.Vector3(N, Q, K),
    muzzleA = makeVec(-6.5, 1.5, 7),
    muzzleB = makeVec(6.5, 1.4, 7),
    airGunPos = makeVec(5.2, 1.3, 3.2),
    ejectPos = makeVec(-4.6, 1.35, 4.2),
    aimPoint = makeVec(0, 0, 0),
    shotDir = makeVec(0, 0, 0),
    effectPos = makeVec(0, 0, 0),
    upDir = makeVec(0, 1, 0),
    impactEvent = {
      point: makeVec(0, 0, 0),
      normal: makeVec(0, 1, 0),
      surface: 'concrete',
      dir: makeVec(0, 0, 0),
      enemy: null,
      from: 'player',
    },
    rand = Math.random,
    time = 0,
    impactIndex = 0,
    shotIndex = 0,
    boomIndex = 0,
    impactTimer = 0,
    tracerTimer = 0.2,
    shellTimer = 0,
    boomTimer = 3.4,
    warmedUp = !1,
    doImpacts = mode === 'all' || mode === 'impact',
    doExplosions = mode === 'all' || mode === 'explosion',
    doTracers = mode === 'all' || mode === 'tracer',
    boomInterval = mode === 'explosion' ? 2.4 : 3.5;
  (mode === 'explosion' && (boomTimer = 0.6),
    (mode === 'all' || mode === 'impact') &&
      (fx.addEmitter(makeVec(-6.2, 0.05, -1.5), 'steam'),
      fx.addEmitter(makeVec(5.6, 0, 1.6), 'fire'),
      fx.addEmitter(makeVec(0.4, 2.6, 1.6), 'drip')));
  function fireImpact(N) {
    let Q = shotIndex++ % 2 ? muzzleB : muzzleA;
    if (((impactEvent.enemy = null), (impactEvent.from = 'player'), N === 5)) {
      (impactEvent.point.set(-1.5 + rand() * 0.3, 2.5 + rand() * 0.3, 0.8),
        impactEvent.normal.copy(Q).sub(impactEvent.point).normalize(),
        (impactEvent.surface = 'enemy'),
        (impactEvent.enemy = {}),
        impactEvent.dir.copy(impactEvent.point).sub(Q).normalize(),
        fx.tracer(Q, impactEvent.point),
        ctx.events.emit('impact', impactEvent));
      return;
    }
    (N === 0
      ? aimPoint.set(-3.2 + (rand() - 0.5) * 2, 0.4 + rand() * 1.5, 0)
      : N === 1 || N === 7
        ? aimPoint.set((rand() - 0.5) * 1.8, 0.3 + rand() * 1.5, 0)
        : N === 2
          ? aimPoint.set(3.2 + (rand() - 0.5) * 0.9, 0.2 + rand() * 0.9, 0.6)
          : N === 3
            ? aimPoint.set(-1.6 + (rand() - 0.5) * 1.2, 0, 2.2 + rand())
            : N === 4
              ? aimPoint.set(1.5 + (rand() - 0.5) * 0.8, 0, 2.6 + rand() * 0.8)
              : aimPoint.set(3.4 + (rand() - 0.5), 0, 2.4 + rand() * 0.6),
      shotDir.copy(aimPoint).sub(Q).normalize());
    let K = ctx.physics.raycast(Q, shotDir, 100);
    K &&
      (impactEvent.point.copy(K.point),
      impactEvent.normal.copy(K.normal),
      impactEvent.dir.copy(shotDir),
      (impactEvent.surface = N === 4 ? 'water' : N === 6 ? 'dirt' : K.surface),
      fx.tracer(Q, impactEvent.point),
      ctx.events.emit('impact', impactEvent));
  }
  let holdMode = ctx.params.fxhold,
    muzzlePos = makeVec(0, 1.3, 3),
    muzzleDir = makeVec(1, 0, 0);
  function step(N) {
    if (
      ((time += N),
      holdMode === 'muzzle' &&
        (fx.muzzleFlash(muzzlePos, muzzleDir, {
          scale: 1,
        }),
        (muzzlePos.x = 2.5),
        muzzleDir.set(-0.5, 0, 0.86),
        fx.muzzleFlash(muzzlePos, muzzleDir, {
          scale: 1.6,
        }),
        (muzzlePos.x = 0),
        muzzleDir.set(1, 0, 0)),
      doImpacts)
    )
      for (impactTimer -= N; impactTimer <= 0;)
        ((impactTimer += mode === 'impact' ? 0.09 : 0.13), fireImpact(impactIndex++ % 8));
    if (
      (doTracers &&
        ((tracerTimer -= N),
        tracerTimer <= 0 &&
          ((tracerTimer += mode === 'tracer' ? 0.16 : 0.45),
          effectPos.set(-5 + rand() * 3, 1.2 + rand() * 0.8, 6 + rand() * 2),
          shotDir.copy(effectPos).sub(airGunPos).normalize(),
          fx.muzzleFlash(airGunPos, shotDir, {
            scale: 1,
          }),
          fx.tracer(airGunPos, effectPos, {
            color: 16730658,
            speed: 120,
          }),
          mode === 'tracer' &&
            (effectPos.set(6, 1 + rand() * 1.5, -6 - rand() * 6),
            aimPoint.set(-7, 1.6, 6.5),
            fx.tracer(aimPoint, effectPos, {
              speed: 200,
            }))),
        (shellTimer -= N),
        shellTimer <= 0 &&
          ((shellTimer += 0.22),
          effectPos.set(1.6 + rand() * 0.8, 1.6 + rand() * 0.8, 0.4 + (rand() - 0.5) * 0.8),
          fx.shell(ejectPos, effectPos))),
      doExplosions && ((boomTimer -= N), boomTimer <= 0))
    ) {
      boomTimer += boomInterval;
      let Q = +(ctx.params.fxsize || 0) || 1 + (boomIndex++ % 3);
      (effectPos.set(mode === 'explosion' ? 0 : 7, 0.25, mode === 'explosion' ? 3.5 : -3.5),
        fx.explosion(effectPos, Q));
    }
  }
  let frozen = !1,
    baseUpdate = fx.update;
  fx.update = (geometryOrDelta) => {
    frozen || baseUpdate(geometryOrDelta);
  };
  let prevSetShot = window.__setShot;
  return (
    prevSetShot &&
      (window.__setShot = (geometryOrDelta) => {
        if (geometryOrDelta && geometryOrDelta.fxage !== void 0) {
          (fx.clear(),
            effectPos.set(0, 0.25, 3.5),
            fx.explosion(effectPos, +(geometryOrDelta.fxsize || 1.2)));
          let materialOrScalar = +geometryOrDelta.fxage;
          for (
            let coordXOrElapsed = 0;
            coordXOrElapsed < materialOrScalar - 1e-6;
            coordXOrElapsed += 1 / 60
          )
            baseUpdate(1 / 60);
          (baseUpdate(0), (frozen = !0));
        }
        prevSetShot(geometryOrDelta);
      }),
    {
      cam: mode === 'explosion' ? [0, 2, 12.5] : [0.3, 1.6, 7.2],
      target: mode === 'explosion' ? [0, 2.2, 3.5] : [0.2, 1, 0],
      update(geometryOrDelta) {
        if (!warmedUp) {
          warmedUp = !0;
          let materialOrScalar = +(ctx.params.fxt || 0);
          for (
            let coordXOrElapsed = 0;
            coordXOrElapsed < materialOrScalar;
            coordXOrElapsed += 1 / 30
          )
            (step(1 / 30), fx.update(1 / 30));
        }
        frozen || step(geometryOrDelta);
      },
    }
  );
}
