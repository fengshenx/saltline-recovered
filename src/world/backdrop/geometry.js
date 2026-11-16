// world/backdrop/geometry.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { mergeGeometries } from '../../core/geometry.js';

/**
 * 把所有闪烁灯具收进一批（顶点属性记录周期/相位），用固定着色器统一驱动明灭，避免几十个独立灯对象
 */
export function createBlinkerBatch() {
  let timeUniform = {
      value: 0,
    },
    blinkMat = new THREE.MeshBasicMaterial({
      vertexColors: !0,
      fog: !1,
    });
  ((blinkMat.onBeforeCompile = (n) => {
    ((n.uniforms.uTime = timeUniform),
      (n.vertexShader =
        `attribute vec3 blink;
uniform float uTime;
varying float vBlink;
` +
        n.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
 float bph = fract(uTime / max(blink.x, 0.001) + blink.y);
 vBlink = blink.x <= 0.0 ? 1.0 : mix(0.02, 1.0, smoothstep(0.0, 0.06, bph) * (1.0 - smoothstep(blink.z, blink.z + 0.12, bph)));`,
        )),
      (n.fragmentShader =
        `varying float vBlink;
` +
        n.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
 diffuseColor.rgb *= vBlink;`,
        )));
  }),
    (blinkMat.customProgramCacheKey = () => 'saltline-blink'));
  let geometryList = [];
  return {
    uTime: timeUniform,
    mat: blinkMat,
    add(n, s, o = 0, r = 0, a = 0.5) {
      if (!n) return;
      let l = n.index ? n.toNonIndexed() : n,
        c = l.attributes.position.count,
        u = new Float32Array(c * 3),
        h = new Float32Array(c * 3);
      for (let p = 0; p < c; p++)
        ((u[p * 3] = s[0]),
          (u[p * 3 + 1] = s[1]),
          (u[p * 3 + 2] = s[2]),
          (h[p * 3] = o),
          (h[p * 3 + 1] = r),
          (h[p * 3 + 2] = a));
      let f = new THREE.BufferGeometry();
      (f.setAttribute('position', l.attributes.position),
        f.setAttribute('color', new THREE.BufferAttribute(u, 3)),
        f.setAttribute('blink', new THREE.BufferAttribute(h, 3)),
        geometryList.push(f));
    },
    build() {
      if (!geometryList.length) return null;
      let n = new THREE.Mesh(mergeGeometries(geometryList.splice(0), !1), blinkMat);
      return ((n.castShadow = !1), (n.receiveShadow = !1), n);
    },
  };
}
