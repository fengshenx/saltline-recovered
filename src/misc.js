// misc.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

export function $a(seed) {
  let rngState = ((seed | 0) * 2654435761) | 0;
  return () => {
    rngState = (rngState + 1831565813) | 0;
    let mixed = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    return (
      (mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed),
      ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
    );
  };
}

var uR = Math.PI;

export var ts = uR / 2;

export var _b = (edge0, edge1, value) => {
  let n = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return n * n * (3 - 2 * n);
};

export var So = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export var Ei = new THREE.Vector3(0, 1, 0);

export function ao(seed) {
  let rngState = seed >>> 0;
  return () => {
    ((rngState |= 0), (rngState = (rngState + 1831565813) | 0));
    let mixedVal = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    return (
      (mixedVal = (mixedVal + Math.imul(mixedVal ^ (mixedVal >>> 7), 61 | mixedVal)) ^ mixedVal),
      ((mixedVal ^ (mixedVal >>> 14)) >>> 0) / 4294967296
    );
  };
}

export var pi = (value, min, max) => Math.min(max, Math.max(min, value));

export var Pv = (from, to, value) => {
  let n = pi((value - from) / (to - from), 0, 1);
  return n * n * (3 - 2 * n);
};

export var im = (x, y, z) => {
  let n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
};

export var y_ = new THREE.Euler();

export var um = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export var ex = {};

export var va = Math.PI / 2;

export var LC = new THREE.Vector3(1, 1, 1);

export var bl = (value, min, max) => (value < min ? min : value > max ? max : value);
