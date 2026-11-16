// core/three-types.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

/**
 * THREE.Vector3 的短别名，只在本段几何/手套生成函数里用，减少调用冗长
 */
export var Vec3 = THREE.Vector3;

/**
 * THREE.Quaternion 的短别名，供手指朝向与袖管对齐计算使用
 */
export var Quat = THREE.Quaternion;

/**
 * THREE.Matrix4 的短别名，袖口矩阵拼接用
 */
export var Mat4 = THREE.Matrix4;
