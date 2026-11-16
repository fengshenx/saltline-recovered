// content/backdrop/geometry.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { mergeGeometries } from '../../assets/procedural/geometry.js';

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
  ((blinkMat.onBeforeCompile = (sourceGeo) => {
    ((sourceGeo.uniforms.uTime = timeUniform),
      (sourceGeo.vertexShader =
        `attribute vec3 blink;
uniform float uTime;
varying float vBlink;
` +
        sourceGeo.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
 float bph = fract(uTime / max(blink.x, 0.001) + blink.y);
 vBlink = blink.x <= 0.0 ? 1.0 : mix(0.02, 1.0, smoothstep(0.0, 0.06, bph) * (1.0 - smoothstep(blink.z, blink.z + 0.12, bph)));`,
        )),
      (sourceGeo.fragmentShader =
        `varying float vBlink;
` +
        sourceGeo.fragmentShader.replace(
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
    add(sourceGeo, colorRgb, periodSec = 0, phase = 0, duty = 0.5) {
      if (!sourceGeo) return;
      let flatGeo = sourceGeo.index ? sourceGeo.toNonIndexed() : sourceGeo,
        vertexCount = flatGeo.attributes.position.count,
        colorBuf = new Float32Array(vertexCount * 3),
        blinkBuf = new Float32Array(vertexCount * 3);
      for (let vertIdx = 0; vertIdx < vertexCount; vertIdx++)
        ((colorBuf[vertIdx * 3] = colorRgb[0]),
          (colorBuf[vertIdx * 3 + 1] = colorRgb[1]),
          (colorBuf[vertIdx * 3 + 2] = colorRgb[2]),
          (blinkBuf[vertIdx * 3] = periodSec),
          (blinkBuf[vertIdx * 3 + 1] = phase),
          (blinkBuf[vertIdx * 3 + 2] = duty));
      let blinkGeo = new THREE.BufferGeometry();
      (blinkGeo.setAttribute('position', flatGeo.attributes.position),
        blinkGeo.setAttribute('color', new THREE.BufferAttribute(colorBuf, 3)),
        blinkGeo.setAttribute('blink', new THREE.BufferAttribute(blinkBuf, 3)),
        geometryList.push(blinkGeo));
    },
    build() {
      if (!geometryList.length) return null;
      let sourceGeo = new THREE.Mesh(mergeGeometries(geometryList.splice(0), !1), blinkMat);
      return ((sourceGeo.castShadow = !1), (sourceGeo.receiveShadow = !1), sourceGeo);
    },
  };
}
