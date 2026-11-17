// content/backdrop/gulls.js — 从 content/backdrop/sky.js 拆出（原文件名为 sky 但内容是海港天际线与海鸥，与 render/sky.js 的天空同名易混）。

import { createSeededRng } from '../../core/random.js';
import * as THREE from 'three';

/**
 * 用顶点属性驱动的海鸥群：每只鸟的盘旋参数存在 aOrbit/aPar 里，由顶点着色器算位置与拍翅，一次 draw call 就有一群会飞的海鸥
 */
export function createGullFlock(ctx, uTime, gullCount = 12) {
  let rng = createSeededRng(5521),
    wingPositions = [],
    orbitAttr = [],
    flapAttr = [];
  for (let shaderObject = 0; shaderObject < gullCount; shaderObject++) {
    let orbitCenter =
        shaderObject % 3 === 0
          ? [54 + rng() * 30, 9 + rng() * 14, -4 + rng() * 56]
          : [16 + rng() * 26, 33 + rng() * 12, -14 + rng() * 28],
      orbitRadius = 9 + rng() * 16,
      orbitSpeed = (0.16 + rng() * 0.16) * (rng() > 0.5 ? 1 : -1),
      phaseOffset = rng() * 6.283,
      flapRate = 5 + rng() * 3,
      wingVerts = [
        [0.15, 0, 0, 0],
        [-0.13, 0, 0, 0],
        [-0.24, 0, 0.8, 1],
        [0.15, 0, 0, 0],
        [-0.24, 0, -0.8, 1],
        [-0.13, 0, 0, 0],
      ];
    for (let wingVertex of wingVerts)
      (wingPositions.push(wingVertex[0], wingVertex[1] - 60, wingVertex[2]),
        orbitAttr.push(orbitCenter[0], orbitCenter[1], orbitCenter[2], orbitRadius),
        flapAttr.push(orbitSpeed, phaseOffset, flapRate, wingVertex[3]));
  }
  let gullGeo = new THREE.BufferGeometry();
  (gullGeo.setAttribute('position', new THREE.Float32BufferAttribute(wingPositions, 3)),
    gullGeo.setAttribute('aOrbit', new THREE.Float32BufferAttribute(orbitAttr, 4)),
    gullGeo.setAttribute('aPar', new THREE.Float32BufferAttribute(flapAttr, 4)));
  let gullMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.2, 0.21, 0.23),
    side: THREE.DoubleSide,
    fog: !1,
  });
  ((gullMat.onBeforeCompile = (shaderObject) => {
    ((shaderObject.uniforms.uTime = uTime),
      (shaderObject.vertexShader =
        `attribute vec4 aOrbit;
attribute vec4 aPar;
uniform float uTime;
` +
        shaderObject.vertexShader.replace(
          '#include <begin_vertex>',
          `
      float ga = aPar.y + uTime * aPar.x;
      float gdir = sign(aPar.x);
      vec3 gfw = vec3(-sin(ga), 0.0, cos(ga)) * gdir;
      vec3 grt = vec3(gfw.z, 0.0, -gfw.x);
      vec3 gl = position + vec3(0.0, 60.0, 0.0);
      float glide = smoothstep(-0.2, 0.5, sin(uTime * 0.31 + aPar.y * 3.0));
      float gflap = sin(uTime * aPar.z + aPar.y * 7.0) * mix(0.12, 0.55, glide) + 0.18;
      gl.y += aPar.w * gflap * abs(gl.z);
      gl.z *= mix(1.0, 0.86, aPar.w * abs(gflap));
      vec3 gc = aOrbit.xyz + vec3(cos(ga), 0.0, sin(ga)) * aOrbit.w + vec3(0.0, sin(ga * 0.7 + aPar.y) * 2.2 + sin(uTime * 0.23 + aPar.y) * 1.5, 0.0);
      vec3 transformed = gc + gfw * gl.x + grt * gl.z + vec3(0.0, gl.y - 0.3 * gdir * gl.z, 0.0);`,
        )));
  }),
    (gullMat.customProgramCacheKey = () => 'saltline-gulls'));
  let gullMesh = new THREE.Mesh(gullGeo, gullMat);
  return (
    (gullMesh.frustumCulled = !1),
    (gullMesh.castShadow = !1),
    (gullMesh.receiveShadow = !1),
    (gullMesh.name = 'gulls'),
    gullMesh
  );
}
