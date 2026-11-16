// game.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import { FX_MODULE } from './effects/effects.js';

import { ex } from './misc.js';

import { materialsModule } from './render/materials/materials.js';

import { rendererModule } from './render/renderer.js';

import { weaponModule } from './weapons/weapon.js';

import { backdropModule } from './world/backdrop/backdrop.js';

import { groundModule } from './world/ground/ground.js';

import { PROPS_MODULE_EXPORTS, propsModule } from './world/props/registry.js';

/**
 * 展示场景注册表：把 ?show= 的参数名映射到各模块的 showcase 入口（材质/关卡/背景/地面/特效/武器/敌人/道具/渲染），是调参与截图的总开关
 */
export var SHOWCASE_REGISTRY = {
  mats: materialsModule,
  level: PROPS_MODULE_EXPORTS,
  backdrop: backdropModule,
  ground: groundModule,
  fx: FX_MODULE,
  weapon: weaponModule,
  enemies: ex,
  props: propsModule,
  render: rendererModule,
};
