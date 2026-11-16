// core/fallbacks.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

/**
 * 共享空函数：所有 stub 模块的方法都指向它，使缺失子系统时的调用路径仍然安全可执行
 */
export var noop = () => {};

/**
 * 子系统 stub 工厂表（ground/backdrop/fx/audio/weapon/enemies/hud/mats）：每个工厂返回一份形状与真模块一致的最小替身，模块加载失败或 showcase 模式下整局仍能跑起来
 */
export var FALLBACKS = {
  ground: () => ({
    stub: !0,
    update: noop,
    wetnessAt: () => 0.5,
    isPuddle: () => !1,
  }),
  backdrop: () => ({
    stub: !0,
    update: noop,
  }),
  fx: () => ({
    stub: !0,
    update: noop,
    muzzleFlash: noop,
    tracer: noop,
    impact: noop,
    sparks: noop,
    smoke: noop,
    explosion: noop,
    debris: noop,
    shell: noop,
    decal: noop,
    dust: noop,
    clear: noop,
    splash: noop,
    addEmitter: () => ({
      stop: noop,
      setPos: noop,
    }),
  }),
  audio: () => {
    let i = {
      setPos: noop,
      setGain: noop,
      setPitch: noop,
      stop: noop,
    };
    return {
      stub: !0,
      update: noop,
      resume: noop,
      play: noop,
      loop: () => i,
      setIntensity: noop,
      setInterior: noop,
      setVolume: noop,
      setPaused: noop,
    };
  },
  weapon: () => ({
    stub: !0,
    update: noop,
    reset: noop,
    setVisible: noop,
    ammo: 30,
    magSize: 30,
    reserve: 120,
    state: 'idle',
    name: 'KR-7',
    ads: 0,
    spread: 0.01,
  }),
  enemies: () => ({
    stub: !0,
    list: [],
    update: noop,
    spawn: () => null,
    raycast: () => null,
    aliveCount: () => 0,
    clear: noop,
    alert: noop,
  }),
  hud: () => ({
    stub: !0,
    update: noop,
    show: noop,
    setObjective: noop,
    message: noop,
    hitmarker: noop,
  }),
  mats: () => {
    let materialCache = new Map();
    return {
      stub: !0,
      get: (t) => (
        materialCache.has(t) ||
          materialCache.set(
            t,
            new THREE.MeshStandardMaterial({
              color: 7829367,
              roughness: 0.7,
            }),
          ),
        materialCache.get(t)
      ),
      emissive: (t = 16777215, n = 4) =>
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(t).multiplyScalar(n),
        }),
      names: [],
      decal: () => ({
        material: new THREE.MeshBasicMaterial({
          transparent: !0,
          opacity: 0,
        }),
        aspect: 1,
      }),
      label: () => ({
        material: new THREE.MeshBasicMaterial({
          transparent: !0,
          opacity: 0,
        }),
        aspect: 4,
      }),
      uniforms: {
        wet: {
          value: 1,
        },
      },
      update: noop,
    };
  },
};
