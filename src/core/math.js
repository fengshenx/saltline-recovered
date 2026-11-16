// core/math.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { hash3, hashInt3 } from './random.js';

import { Mat4, Quat, Vec3 } from './three-types.js';

import { So, um } from '../misc.js';

import { WeaponQuat } from '../weapons/weapon.js';

/**
 * 数值限幅小工具（已存在同名语义的 Zn，此处为 gull 域内的局部副本）
 */
export var clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * 线性插值，用于参数过渡与向量混合
 */
export var lerp = (a, b, t) => a + (b - a) * t;

/**
 * 把值夹到 [0,1]，用于归一化进度、强度与颜色通道
 */
export var saturate = (value) => Math.min(1, Math.max(0, value));

/**
 * 在 [edge0,edge1] 间做 3t²-2t³ 平滑过渡，端点导数为零，用于淡入淡出与门限软化
 */
export var smoothstep = (edge0, edge1, x) => {
  let n = saturate((x - edge0) / (edge1 - edge0));
  return n * n * (3 - 2 * n);
};

/**
 * 帧率无关的指数趋近 current+(target-current)·e^(-λdt)：不管掉帧与否收敛速度一致，用于相机跟随与各类平滑
 */
export var damp = (current, target, lambda, dt) =>
  target + (current - target) * Math.exp(-lambda * dt);

/**
 * 整数格点哈希：由两个浮点格坐标散列出 [0,1) 的确定性随机值，是二维值噪声的底座
 */
function hash2D(x, y) {
  let t = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return t - Math.floor(t);
}

/**
 * 二维平滑值噪声：四角哈希 + smoothstep 双线性插值，用于混凝土污渍、锈斑等表面斑驳
 */
export function valueNoise2D(coordX, coordY) {
  let cellX = Math.floor(coordX),
    cellY = Math.floor(coordY),
    fracX = coordX - cellX,
    fracY = coordY - cellY,
    smoothX = fracX * fracX * (3 - 2 * fracX),
    smoothY = fracY * fracY * (3 - 2 * fracY),
    v00 = hash2D(cellX, cellY),
    v10 = hash2D(cellX + 1, cellY),
    v01 = hash2D(cellX, cellY + 1),
    v11 = hash2D(cellX + 1, cellY + 1);
  return (
    v00 +
    (v10 - v00) * smoothX +
    (v01 - v00) * smoothY +
    (v00 - v10 - v01 + v11) * smoothX * smoothY
  );
}

/**
 * 把值夹到 0..1，手套轮廓与混合权重到处都在用
 */
export var clamp01 = (value) => Math.max(0, Math.min(1, value));

/**
 * 三分量线性插值，配合顶点色回调使用：把基色按暴露度混向锈色/污色
 */
export var lerpVec3 = (from, to, t) => [
  from[0] + (to[0] - from[0]) * t,
  from[1] + (to[1] - from[1]) * t,
  from[2] + (to[2] - from[2]) * t,
];

/**
 * π 的又一个模块内副本，与 PI 等价
 */
export var PI_LATER = Math.PI;

/**
 * π 的模块内副本，继电器节点生成器专用
 */
export var PI_RELAY = Math.PI;

/**
 * π 的模块内副本（又一处），后续道具生成器统一用它做角度换算
 */
export var PI_TWO = Math.PI;

/**
 * 三维格点整数哈希，产出 [0,1) 确定性随机值，是三维值噪声的底座
 */
function hash3D(x, y, z) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  return ((n = Math.imul(n ^ (n >>> 13), 1274126177)), ((n ^ (n >>> 16)) >>> 0) / 4294967296);
}

/**
 * 三维平滑值噪声，用来给木箱/塑料桶/篷布等加不规则起伏与脏迹，避免平直几何的塑料感
 */
export function valueNoise3D(px, py = 0, t = 0) {
  let n = Math.floor(px),
    iy = Math.floor(py),
    o = Math.floor(t),
    fx = px - n,
    fy = py - iy,
    fz = t - o;
  ((fx = fx * fx * (3 - 2 * fx)), (fy = fy * fy * (3 - 2 * fy)), (fz = fz * fz * (3 - 2 * fz)));
  let lerp = (u, h, f) => u + (h - u) * f;
  return lerp(
    lerp(
      lerp(hash3D(n, iy, o), hash3D(n + 1, iy, o), fx),
      lerp(hash3D(n, iy + 1, o), hash3D(n + 1, iy + 1, o), fx),
      fy,
    ),
    lerp(
      lerp(hash3D(n, iy, o + 1), hash3D(n + 1, iy, o + 1), fx),
      lerp(hash3D(n, iy + 1, o + 1), hash3D(n + 1, iy + 1, o + 1), fx),
      fy,
    ),
    fz,
  );
}

/**
 * 几何装配段通用的 Vector3 构造简写，避免到处写 new THREE.Vector3
 */
export var newVec3 = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * 把 [x,y,z] 数组或已有 Vector3 统一成 Vector3，让几何工具同时接受两种写法
 */
export var toVec3 = (v) => (v.isVector3 ? v : new THREE.Vector3(v[0], v[1], v[2]));

/**
 * 单位缩放常量，构造变换矩阵时复用，避免重复分配
 */
export var ONE_SCALE = new THREE.Vector3(1, 1, 1);

/**
 * 临时四元数暂存对象，供几何变换复用
 */
export var TMP_QUAT = new THREE.Quaternion();

/**
 * 临时 4x4 矩阵暂存对象，供几何变换复用
 */
export var TMP_MATRIX = new THREE.Matrix4();

/**
 * 三维值噪声（三线性 + smoothstep 插值），给表面污渍、草色等提供低频不均匀扰动
 */
export function valueNoise3(coordX, coordY, coordZ) {
  let cellX = Math.floor(coordX),
    cellY = Math.floor(coordY),
    cellZ = Math.floor(coordZ),
    fracX = coordX - cellX,
    fracY = coordY - cellY,
    fracZ = coordZ - cellZ;
  ((fracX = fracX * fracX * (3 - 2 * fracX)),
    (fracY = fracY * fracY * (3 - 2 * fracY)),
    (fracZ = fracZ * fracZ * (3 - 2 * fracZ)));
  let mixLerp = (u, h, f) => u + (h - u) * f;
  return mixLerp(
    mixLerp(
      mixLerp(hash3(cellX, cellY, cellZ), hash3(cellX + 1, cellY, cellZ), fracX),
      mixLerp(hash3(cellX, cellY + 1, cellZ), hash3(cellX + 1, cellY + 1, cellZ), fracX),
      fracY,
    ),
    mixLerp(
      mixLerp(hash3(cellX, cellY, cellZ + 1), hash3(cellX + 1, cellY, cellZ + 1), fracX),
      mixLerp(hash3(cellX, cellY + 1, cellZ + 1), hash3(cellX + 1, cellY + 1, cellZ + 1), fracX),
      fracY,
    ),
    fracZ,
  );
}

/**
 * 二维值噪声（wrap 参数可做无缝平铺），地面起伏与积水量都用它取低频变化
 */
export function valueNoise2(px, py, seed, wrap) {
  let s = Math.floor(px),
    iy = Math.floor(py),
    fx = px - s,
    fy = py - iy,
    sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy),
    ix0 = s,
    ix1 = s + 1,
    iy0 = iy,
    iy1 = iy + 1;
  wrap &&
    ((ix0 = ((ix0 % wrap) + wrap) % wrap),
    (ix1 = ((ix1 % wrap) + wrap) % wrap),
    (iy0 = ((iy0 % wrap) + wrap) % wrap),
    (iy1 = ((iy1 % wrap) + wrap) % wrap));
  let v00 = hashInt3(ix0, iy0, seed),
    v10 = hashInt3(ix1, iy0, seed),
    v01 = hashInt3(ix0, iy1, seed),
    v11 = hashInt3(ix1, iy1, seed);
  return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
}

/**
 * 二维分形噪声：多层倍频叠加并逐层减权，让地面细节既有大起伏又有碎颗粒
 */
export function fbm2(x, y, seed, n = 4, s = 0) {
  let o = 0,
    r = 0.5,
    a = 0;
  for (let l = 0; l < n; l++)
    ((o += r * valueNoise2(x, y, seed + l * 17, s)),
      (a += r),
      (x *= 2),
      (y *= 2),
      (s *= 2),
      (r *= 0.5));
  return o / a;
}

/**
 * 钳位版 smoothstep，用于地面湿痕、车辙的软边过渡
 */
export var smoothstepClamped = (edge0, edge1, value) => {
  let n = So((value - edge0) / (edge1 - edge0));
  return n * n * (3 - 2 * n);
};

/**
 * 把 x 从 [edge0,edge1] 映射成 0..1 的平滑阶跃并两端钳制，纹理合成里所有软边界与遮罩都靠它
 */
export var smoothstepClamp = (edge0, edge1, x) => {
  let n = (x - edge0) / (edge1 - edge0);
  return ((n = n < 0 ? 0 : n > 1 ? 1 : n), n * n * (3 - 2 * n));
};

/**
 * 把 v 从区间 a..b 归一化后做 smoothstep，用于轮廓随长度的渐变
 */
export var smoothRange = (a, b, v) => ((v = um((v - a) / (b - a))), v * v * (3 - 2 * v));

/**
 * 保号幂运算，用来把圆截面捏成超椭圆（指数 0.8）让指节、掌面不是正圆
 */
export var signedPow = (v, exponent) => Math.sign(v) * Math.pow(Math.abs(v), exponent);

/**
 * 绕 Y 轴的四元数，用于手指的整体偏摆
 */
export var quatFromYaw = (yaw) => new Quat().setFromAxisAngle(new Vec3(0, 1, 0), yaw);

/**
 * 绕 X 轴的四元数，用于手指各节的弯曲角
 */
export var quatFromPitch = (pitch) => new Quat().setFromAxisAngle(new Vec3(1, 0, 0), pitch);

/**
 * 由朝向向量与参考上方向构造正交基再转四元数，拇指各节的朝向就靠它从方向直接得到
 */
export function quatFromDirection(dir, upHint) {
  let backward = dir.clone().negate(),
    rightAxis = new Vec3().crossVectors(upHint, backward);
  (rightAxis.lengthSq() < 1e-6 && rightAxis.set(1, 0, 0), rightAxis.normalize());
  let upAxis = new Vec3().crossVectors(backward, rightAxis);
  return new Quat().setFromRotationMatrix(new Mat4().makeBasis(rightAxis, upAxis, backward));
}

/**
 * 五次平滑阶跃：换弹/换手/后坐力曲线的统一缓动，保证关键帧之间速度连续
 */
export var smootherStep = (t) => ((t = saturate(t)), t * t * t * (t * (6 * t - 15) + 10));

/**
 * 创建一个阻尼弹簧状态 {x,v,k,c}，枪身位移/摇摆/落地冲击都用不同刚度与阻尼的弹簧来模拟
 */
export var makeSpring = (stiffness, damping) => ({
  x: 0,
  v: 0,
  k: stiffness,
  c: damping,
});

/**
 * 定步长积分弹簧到目标值（最多 8ms 一子步，防大 dt 爆炸），返回当前位置
 */
export function stepSpring(spring, target, frameDt) {
  let subSteps = frameDt > 0.012 ? Math.ceil(frameDt / 0.008) : 1,
    subDt = frameDt / subSteps;
  for (let stepIdx = 0; stepIdx < subSteps; stepIdx++)
    ((spring.v += ((target - spring.x) * spring.k - spring.v * spring.c) * subDt),
      (spring.x += spring.v * subDt));
  return spring.x;
}

/**
 * 欧拉角转四元数，用于手套握持朝向的链式拼接
 */
export var eulerQuat = (x, y, z, n = 'XYZ') =>
  new WeaponQuat().setFromEuler(new THREE.Euler(x, y, z, n));

/**
 * 把角度差归一化到 (-π, π]，角度控制环必须先过这一步才不会绕远路转圈
 */
export var wrapAngle = (angle, ref) => {
  let t = (angle - ref) % (Math.PI * 2);
  return (t > Math.PI ? (t -= Math.PI * 2) : t < -Math.PI && (t += Math.PI * 2), t);
};

/**
 * hound 域内的角度差归一化副本，与 gull 侧逻辑相同
 */
export var wrapAngleHound = (angle, ref) => {
  let t = (angle - ref) % (Math.PI * 2);
  return (t > Math.PI ? (t -= Math.PI * 2) : t < -Math.PI && (t += Math.PI * 2), t);
};

/**
 * hound 域内的数值限幅副本
 */
export var clampHound = (value, min, max) => (value < min ? min : value > max ? max : value);

/**
 * 单轴弹簧积分器（stiffness/damping 参数化）：机体起伏、枪身俯仰顿挫这类第二序动画都靠它，短步长下无条件稳定
 */
export function springStep(spring, target, stiffness, damping, deltaTime) {
  return (
    (spring.v += ((target - spring.x) * stiffness - spring.v * damping) * deltaTime),
    (spring.x += spring.v * deltaTime),
    spring.x
  );
}

/**
 * 射线与球的最近正向交点求解，用于敌人弱点（头/镜头）的命中判定，只接受比已有命中更近的结果
 */
export function raySphere(origin, dir, center, radius, maxDist, hit) {
  let ocX = origin.x - center.x,
    ocY = origin.y - center.y,
    ocZ = origin.z - center.z,
    bTerm = ocX * dir.x + ocY * dir.y + ocZ * dir.z,
    cTerm = ocX * ocX + ocY * ocY + ocZ * ocZ - radius * radius,
    discriminant = bTerm * bTerm - cTerm;
  if (discriminant < 0) return !1;
  let tNear = -bTerm - Math.sqrt(discriminant);
  return tNear < 0 || tNear > maxDist || tNear >= hit.dist
    ? !1
    : ((hit.dist = tNear),
      hit.point.copy(origin).addScaledVector(dir, tNear),
      hit.normal.copy(hit.point).sub(center).normalize(),
      !0);
}

/**
 * rayCapsule 内部复用的临时向量（胶囊轴方向）
 */
var segDir = new THREE.Vector3();

/**
 * rayCapsule 内部复用的临时向量（射线起点相对胶囊起点的偏移）
 */
var rayToOrigin = new THREE.Vector3();

/**
 * rayCapsule 内部复用的临时向量（轴线上离射线最近的点）
 */
var segClosest = new THREE.Vector3();

/**
 * 射线与胶囊求交：先把射线投影到胶囊轴线上取最近点，再退化成 raySphere 测试，用于敌人躯干的宽松命中体
 */
export function rayCapsule(origin, dir, segStart, segEnd, radius, maxDist, hit) {
  (segDir.copy(segEnd).sub(segStart), rayToOrigin.copy(origin).sub(segStart));
  let segLenSq = segDir.dot(segDir),
    segDotDir = segDir.dot(dir),
    segDotOrigin = segDir.dot(rayToOrigin),
    dirDotOrigin = dir.dot(rayToOrigin),
    denom = segLenSq - segDotDir * segDotDir,
    segT = denom > 1e-8 ? (segDotOrigin - segDotDir * dirDotOrigin) / denom : 0;
  return (
    (segT = segT < 0 ? 0 : segT > 1 ? 1 : segT),
    segClosest.copy(segStart).addScaledVector(segDir, segT),
    raySphere(origin, dir, segClosest, radius, maxDist, hit)
  );
}

/**
 * 线段距离计算的临时向量（第一段方向）
 */
var segA = new THREE.Vector3();

/**
 * 线段距离计算的临时向量（第二段方向）
 */
var segB = new THREE.Vector3();

/**
 * 线段距离计算的临时向量（两段起点之差）
 */
var originDelta = new THREE.Vector3();

/**
 * 两条线段最近距离的平方（含退化情形处理），用来判定电浆弹这一小段运动轨迹是否擦过玩家胶囊
 */
export function segmentDistanceSq(aFrom, aTo, bFrom, bTo) {
  (segA.copy(aTo).sub(aFrom), segB.copy(bTo).sub(bFrom), originDelta.copy(aFrom).sub(bFrom));
  let aLenSq = segA.dot(segA),
    bLenSq = segB.dot(segB),
    bDotDelta = segB.dot(originDelta),
    paramA,
    paramB;
  if (aLenSq <= 1e-9 && bLenSq <= 1e-9) return originDelta.dot(originDelta);
  if (aLenSq <= 1e-9) ((paramA = 0), (paramB = Math.min(1, Math.max(0, bDotDelta / bLenSq))));
  else {
    let aDotDelta = segA.dot(originDelta);
    if (bLenSq <= 1e-9) ((paramB = 0), (paramA = Math.min(1, Math.max(0, -aDotDelta / aLenSq))));
    else {
      let aDotB = segA.dot(segB),
        denom = aLenSq * bLenSq - aDotB * aDotB;
      ((paramA =
        denom > 1e-9
          ? Math.min(1, Math.max(0, (aDotB * bDotDelta - aDotDelta * bLenSq) / denom))
          : 0),
        (paramB = (aDotB * paramA + bDotDelta) / bLenSq),
        paramB < 0
          ? ((paramB = 0), (paramA = Math.min(1, Math.max(0, -aDotDelta / aLenSq))))
          : paramB > 1 &&
            ((paramB = 1), (paramA = Math.min(1, Math.max(0, (aDotB - aDotDelta) / aLenSq)))));
    }
  }
  let deltaX = originDelta.x + segA.x * paramA - segB.x * paramB,
    deltaY = originDelta.y + segA.y * paramA - segB.y * paramB,
    deltaZ = originDelta.z + segA.z * paramA - segB.z * paramB;
  return deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
}
