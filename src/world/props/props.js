// world/props/props.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { boxGeometry, createShadowMesh } from '../../core/geometry.js';

import { PROP_GENERATORS, PROP_SIZES } from './registry.js';

/**
 * 道具工厂对象：暴露 names/has/build 三个入口，build 优先调用已注册生成器，抛错或未注册时退化为带尺寸与碰撞盒的占位方块，保证关卡布置不因缺道具而崩
 */
export function createProps(ctx) {
  return {
    names: () => Object.keys(PROP_SIZES),
    has: (e) => !!PROP_SIZES[e],
    build(e, t = {}) {
      if (PROP_GENERATORS[e])
        try {
          let o = PROP_GENERATORS[e](ctx, t);
          if (o) return ((o.userData.prop = e), o);
        } catch (o) {
          console.error(`[props] builder "${e}" threw`, o);
        }
      let n = PROP_SIZES[e] || [1, 1, 1, 'concrete', 'concrete'];
      PROP_SIZES[e] || console.warn(`[props] unknown prop "${e}"`);
      let s = new THREE.Group();
      return (
        s.add(createShadowMesh(boxGeometry(n[0], n[1], n[2], 'bottom'), ctx.mats.get(n[3]))),
        (s.userData.colliders = [
          {
            min: [-n[0] / 2, 0, -n[2] / 2],
            max: [n[0] / 2, n[1], n[2] / 2],
            surface: n[4],
          },
        ]),
        (s.userData.size = [n[0], n[1], n[2]]),
        (s.userData.prop = e),
        s
      );
    },
  };
}

/**
 * 道具陈列预览：把注册表里的道具按行排进场景（每行不超过 26 单位宽），返回相机位置与注视点，用于截图/调试素材
 */
export function showcaseProps(ctx) {
  let nameList = ctx.params.names ? ctx.params.names.split(',') : Object.keys(PROP_SIZES),
    cursorX = 0,
    rowZ = 0,
    rowDepthMax = 0,
    maxX = 0;
  for (let propName of nameList) {
    let propObj = ctx.props.build(propName, {
        seed: 7,
        doors: propName.startsWith('container') ? 0.6 : 0,
      }),
      propSize = propObj.userData.size || PROP_SIZES[propName] || [1, 1, 1];
    (cursorX + propSize[0] > 26 && ((cursorX = 0), (rowZ += rowDepthMax + 1.5), (rowDepthMax = 0)),
      propObj.position.set(cursorX + propSize[0] / 2, 0, rowZ),
      ctx.scene.add(propObj),
      (cursorX += propSize[0] + 1),
      (rowDepthMax = Math.max(rowDepthMax, propSize[2])),
      (maxX = Math.max(maxX, cursorX)));
  }
  let centerX = Math.min(maxX, 26) / 2;
  return {
    cam: [centerX - 4, 2.2, rowZ + rowDepthMax + 6],
    target: [centerX, 1, rowZ / 2],
  };
}
