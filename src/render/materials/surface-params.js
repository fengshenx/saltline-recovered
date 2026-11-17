// surface-params.js — 材质规格的参数预设与工厂，零依赖。
// 从 materials.js 下沉：catalog.js 顶层立即调用 makeSurfaceSpec 构造 SURFACE_LIB，
// 而 materials ↔ catalog 互相 import；参数表独立成叶子模块后，catalog 求值时它们必定就绪。

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
