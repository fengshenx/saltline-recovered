// core/config.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

/**
 * 港口堆场的世界边界与高程基准：可玩区 x∈[-40,40]、z∈[-30,30]，含地面高度 0、海平面 -1.6 与码头前沿 X=30，物理阻挡、地面高度查询与海水/陆地区分都以此为准
 */
export var WORLD_BOUNDS = {
  min: new THREE.Vector3(-40, 0, -30),
  max: new THREE.Vector3(40, 30, 30),
  groundY: 0,
  seaY: -1.6,
  quayX: 30,
};

/**
 * 黄昏低角度太阳参数（归一化方向、暖橙色、强度 9）：天空着色器、平行光、体积光与阴影相机共用同一方向来源，改动即全局生效
 */
export var SUN = {
  dir: new THREE.Vector3(0.916, 0.225, 0.331).normalize(),
  color: new THREE.Color(1, 0.72, 0.42),
  intensity: 9,
};

/**
 * 天空与雾的统一色板：天顶、向日地平、背日地平、雾色四项，天空 GLSL、体积光环境项与场景 fog 都从这里取色，保证远景色调一致
 */
export var SKY_COLORS = {
  zenith: new THREE.Color(0.055, 0.085, 0.13),
  horizon: new THREE.Color(0.95, 0.55, 0.28),
  horizonAway: new THREE.Color(0.16, 0.22, 0.3),
  fog: new THREE.Color(0.42, 0.47, 0.52),
};

/**
 * 玩家与相机的尺寸规格：站立眼高 1.68 / 蹲下 1.05、胶囊半径 0.32 / 身高 1.8、世界相机 FOV 74；视图模型用窄 FOV 54，避免手部透视畸变
 */
export var PLAYER_SPEC = {
  eye: 1.68,
  crouchEye: 1.05,
  radius: 0.32,
  height: 1.8,
  fov: 74,
  viewFov: 54,
};

/**
 * 世界渲染层（three 默认层 0）：世界相机只渲这一层，把视图模型隔离到另一层，从而用两套近平面/FOV 各渲一遍再叠合
 */
export var LAYER_WORLD = 0;

/**
 * 视图模型专用渲染层：挂在相机上的枪械/手臂只被 0.01 近平面、FOV 54 的视图模型相机渲染，防止武器穿模与近裁剪裁掉
 */
export var LAYER_VIEWMODEL = 1;

/**
 * 五档画质预设表（test/low/medium/high/ultra）：每档给出渲染缩放、MSAA、阴影贴图与纹理尺寸、体积光步数，以及 AO/平面反射/泛光/运动模糊/雨量开关与强度，是全部画质门禁的唯一数据源
 */
export var QUALITY_PRESETS = {
  test: {
    name: 'test',
    scale: 1,
    msaa: 0,
    shadow: 1024,
    tex: 256,
    volSteps: 10,
    ao: !0,
    planar: 0.5,
    bloom: !0,
    motionBlur: !1,
    rain: 0.4,
  },
  low: {
    name: 'low',
    scale: 0.7,
    msaa: 0,
    shadow: 2048,
    tex: 512,
    volSteps: 12,
    ao: !1,
    planar: 0,
    bloom: !0,
    motionBlur: !1,
    rain: 0.5,
  },
  medium: {
    name: 'medium',
    scale: 0.85,
    msaa: 2,
    shadow: 2048,
    tex: 1024,
    volSteps: 16,
    ao: !0,
    planar: 0.5,
    bloom: !0,
    motionBlur: !1,
    rain: 0.8,
  },
  high: {
    name: 'high',
    scale: 1,
    msaa: 4,
    shadow: 4096,
    tex: 1024,
    volSteps: 24,
    ao: !0,
    planar: 0.5,
    bloom: !0,
    motionBlur: !0,
    rain: 1,
  },
  ultra: {
    name: 'ultra',
    scale: 1,
    msaa: 4,
    shadow: 4096,
    tex: 2048,
    volSteps: 40,
    ao: !0,
    planar: 1,
    bloom: !0,
    motionBlur: !0,
    rain: 1,
  },
};

/**
 * 玩家运动与镜头手感的总调参表（38 项）：速度/加速度/重力/跳跃缓冲/蹲伏高度/步伐摆动/ADS 倍率/后坐力与镜头抖动曲线，玩家控制器只读不改
 */
export var PLAYER_TUNING = {
  walk: 3.8,
  sprint: 6.4,
  crouch: 1.9,
  ads: 2.4,
  accelGround: 34,
  decelGround: 26,
  accelAir: 9,
  gravity: 21,
  jumpApex: 1,
  coyote: 0.12,
  jumpBuffer: 0.13,
  standHeight: PLAYER_SPEC.height,
  crouchHeight: 1.15,
  eyeRate: 11,
  stride: {
    walk: 1.55,
    sprint: 2.1,
    crouch: 1.05,
  },
  bobY: 0.024,
  bobX: 0.013,
  bobSprint: 1.9,
  bobAds: 0.22,
  rollStrafe: 0.02,
  landDip: 0.36,
  landDipMax: 0.2,
  fovSprint: 6,
  fovAds: 52,
  adsLook: 0.6,
  regenDelay: 4,
  regenRate: 25,
  recoilKeep: 0.35,
  recoilApply: 34,
  recoilRecover: 6.5,
  recoilHold: 0.09,
  shakeDecay: 1.7,
  shakePitch: 0.03,
  shakeYaw: 0.03,
  shakeRoll: 0.045,
  pitchLimit: 1.5,
};
