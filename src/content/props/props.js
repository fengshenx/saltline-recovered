// content/props/props.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { boxGeometry, createShadowMesh } from '../../assets/procedural/geometry.js';

import { PROP_GENERATORS, PROP_SIZES } from './registry.js';

/**
 * 道具工厂对象：暴露 names/has/build 三个入口，build 优先调用已注册生成器，抛错或未注册时退化为带尺寸与碰撞盒的占位方块，保证关卡布置不因缺道具而崩
 */
export function createProps(ctx) {
  return {
    names: () => Object.keys(PROP_SIZES),
    has: (e) => !!PROP_SIZES[e],
    build(propName, buildOpts = {}) {
      if (PROP_GENERATORS[propName])
        try {
          let builtProp = PROP_GENERATORS[propName](ctx, buildOpts);
          if (builtProp) return ((builtProp.userData.prop = propName), builtProp);
        } catch (builtProp) {
          console.error(`[props] builder "${propName}" threw`, builtProp);
        }
      let sizeSpec = PROP_SIZES[propName] || [1, 1, 1, 'concrete', 'concrete'];
      PROP_SIZES[propName] || console.warn(`[props] unknown prop "${propName}"`);
      let fallbackGroup = new THREE.Group();
      return (
        fallbackGroup.add(
          createShadowMesh(
            boxGeometry(sizeSpec[0], sizeSpec[1], sizeSpec[2], 'bottom'),
            ctx.mats.get(sizeSpec[3]),
          ),
        ),
        (fallbackGroup.userData.colliders = [
          {
            min: [-sizeSpec[0] / 2, 0, -sizeSpec[2] / 2],
            max: [sizeSpec[0] / 2, sizeSpec[1], sizeSpec[2] / 2],
            surface: sizeSpec[4],
          },
        ]),
        (fallbackGroup.userData.size = [sizeSpec[0], sizeSpec[1], sizeSpec[2]]),
        (fallbackGroup.userData.prop = propName),
        fallbackGroup
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
