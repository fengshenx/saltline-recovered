// app/showcase.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import { backdropModule } from '../content/backdrop/backdrop.js';

import { groundModule } from '../content/ground/ground.js';

import { PROPS_MODULE_EXPORTS, propsModule } from '../content/props/registry.js';

import { weaponModule } from '../gameplay/weapons/weapon.js';

import { ex } from '../misc.js';

import { FX_MODULE } from '../render/effects/effects.js';

import { materialsModule } from '../render/materials/materials.js';

import { rendererModule } from '../render/renderer.js';

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
