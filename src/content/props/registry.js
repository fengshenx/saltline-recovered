// content/props/registry.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

/**
 * 道具模块的导出命名空间（PROP_SIZES/create/register/showcase 四个惰性 getter），在启动时作为 app.props 挂到上下文上
 */
export var propsModule = {};

/**
 * 38 种道具的尺寸与材质表：[宽, 高, 深, 主材质名, 物理/音效材质类]，关卡布置、物理盒与脚步材质都从这里取值，是道具几何尺寸的唯一真源
 */
export var PROP_SIZES = {
  container20: [6.06, 2.59, 2.44, 'paint_red', 'metal'],
  container40: [12.19, 2.59, 2.44, 'paint_blue', 'metal'],
  container40hc: [12.19, 2.9, 2.44, 'paint_green', 'metal'],
  jersey_barrier: [3, 0.81, 0.6, 'concrete', 'concrete'],
  light_mast: [0.5, 14, 0.5, 'steel_galv', 'metal'],
  fence_panel: [3, 2.4, 0.08, 'chainlink', 'metal'],
  guard_booth: [2.6, 2.7, 2.2, 'paint_white', 'metal'],
  gate_arm: [5, 1.1, 0.3, 'hazard_stripes', 'metal'],
  bollard_mooring: [0.7, 0.6, 0.7, 'steel_dark', 'metal'],
  bollard_post: [0.17, 1, 0.17, 'paint_yellow', 'metal'],
  relay_node: [1.2, 2.4, 0.8, 'paint_grey', 'metal'],
  shelf_rack: [2.7, 4.2, 1.1, 'paint_orange', 'metal'],
  stairs_metal: [3, 2.6, 1, 'diamond_plate', 'metal'],
  catwalk: [3, 1.1, 1.2, 'diamond_plate', 'metal'],
  reefer_unit: [0.5, 2.3, 2.3, 'paint_white', 'metal'],
  barrel: [0.6, 0.9, 0.6, 'paint_blue', 'metal'],
  pallet: [1.2, 0.144, 1, 'wood_pallet', 'wood'],
  pallet_stack: [1.2, 1.15, 1, 'wood_pallet', 'wood'],
  crate_wood: [1.1, 1, 0.9, 'wood_pallet', 'wood'],
  crate_stack: [1.2, 1.9, 1, 'wood_pallet', 'wood'],
  ibc_tote: [1.2, 1.16, 1, 'plastic_grey', 'metal'],
  forklift: [3.4, 2.2, 1.25, 'paint_yellow', 'metal'],
  cable_reel: [1.3, 1.3, 0.8, 'wood_dark', 'wood'],
  hand_truck: [0.52, 1.32, 0.5, 'paint_yellow', 'metal'],
  abandoned_sedan: [1.8, 1.44, 4.4, 'paint_red', 'metal'],
  tire_stack: [0.8, 1, 0.8, 'tire', 'rubber'],
  dumpster: [1.9, 1.35, 1.1, 'paint_green', 'metal'],
  generator: [2.2, 1.4, 1, 'paint_yellow', 'metal'],
  jerry_can: [0.35, 0.47, 0.17, 'paint_green', 'metal'],
  traffic_cone: [0.36, 0.7, 0.36, 'plastic_red', 'rubber'],
  gas_cylinders: [0.9, 1.6, 0.5, 'steel_dark', 'metal'],
  tarp_cargo: [2.4, 1.5, 1.4, 'tarp', 'dirt'],
  sandbags: [2, 0.9, 0.6, 'tarp', 'dirt'],
  toolbox_cart: [0.9, 0.95, 0.5, 'plastic_red', 'metal'],
  floodlight_stand: [1, 2.2, 1, 'paint_yellow', 'metal'],
  cardboard_boxes: [1, 0.8, 0.8, 'cardboard', 'wood'],
  pipe_stack: [6, 0.9, 1.2, 'steel_rust', 'metal'],
  sign_post: [0.6, 2.4, 0.08, 'paint_white', 'metal'],
};

/**
 * 道具名到生成函数的注册表，由 registerProp 填充；与 PROP_SIZES 的键必须一致，否则 create 会报警并退回占位盒
 */
export var PROP_GENERATORS = {};

/**
 * 把某个道具名对应的生成函数写进私有注册表，供工厂 build() 按名调度；未注册的道具会退化成占位方块
 */
export function registerPropBuilder(propName, builder) {
  PROP_GENERATORS[propName] = builder;
}

/**
 * 取道具注册表里的 [宽,高,深] 前三项，尺寸缺失时的统一读数口径
 */
export var getPropSize3 = (propName) => PROP_SIZES[propName].slice(0, 3);

/**
 * 与 getPropSize3 完全等价的重复实现（打包按模块边界复制），供后半段道具生成器读取尺寸
 */
export var getPropSize3Later = (propName) => PROP_SIZES[propName].slice(0, 3);

/**
 * 道具几何缓存：同 key 的整件道具只生成一次，后续一律 clone，是堆场大量重复道具不卡的关键
 */
var ASSEMBLER_GEOMETRY_CACHE = new Map();

/**
 * 按 key 取缓存的道具并深拷贝，未命中时调用工厂生成后缓存
 */
export function buildCachedPropClone(key, factory) {
  let t = ASSEMBLER_GEOMETRY_CACHE.get(key);
  return (t || ((t = factory()), ASSEMBLER_GEOMETRY_CACHE.set(key, t)), t.clone(!0));
}

/**
 * 第二组道具模块的导出命名空间（create→C1 主工厂、showcase→mR 陈列预览），与前半段的 $g 同一约定，供自由变量分析生成 import/export
 */
export var PROPS_MODULE_EXPORTS = {};
