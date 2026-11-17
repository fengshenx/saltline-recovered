// render/shaders/post/common.js — 从 render/postprocessing.js 拆出的后处理着色器常量；纯 GLSL 字符串，跨文件引用靠 src/.manifest.json 的 order 保证求值顺序。



/**
 * 以字符串形式注入后处理的原始深度阈值：小于它的像素视为贴近近平面（视图模型/贴脸面），跳过 AO、体积光与运动模糊，避免极近处白采样并产生脏边
 */
export var GLSL_RAW_DEPTH_NEAR_EPS = '0.05';

/**
 * 线性深度版的近距阈值（单位米）：半分辨率深度图上小于它的像素直接判为无遮蔽/无体积，AO 与体积光共同遵循
 */
export var GLSL_LINEAR_DEPTH_NEAR_EPS = '0.05';

/**
 * 全屏几何的顶点着色器：直接透传 position.xy 与 uv，配合预置的全屏三角省掉矩阵运算
 */
export var SALTLINE_POST_VERT =
  'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/**
 * 后处理公共前缀：交错梯度噪声 ign（每像素旋转抖动）、hash12 与亮度 luma，被几乎所有 pass 拼在片元开头，保证抖动与亮度定义一致
 */
export var SALTLINE_POST_COMMON = `
varying vec2 vUv;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/**
 * 曝光取值片段：把手动曝光与 1×1 自适应亮度纹理按 key/限幅混合成 slExposure()，grade、streak 与 composite 共用同一条曝光曲线以防前后不一致
 */
export var SALTLINE_EXPOSURE_GLSL = `
uniform sampler2D tAdapt; uniform float uExposure, uKey, uMinE, uMaxE, uAuto;
float slExposure(){ float a = texture2D(tAdapt, vec2(0.5)).r; return uExposure * mix(1.0, clamp(pow(uKey / max(a, 1e-4), 0.85), uMinE, uMaxE), uAuto); }
`;
