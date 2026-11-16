// render/materials/showcase.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { createTiledPlane, createTiledSphere } from '../../core/geometry.js';

/**
 * 用世界坐标三平面投影的材质名集合：枪械、手套、装甲、橡胶这些小件没有合理 uv，改三平面采样可避免贴图拉伸与接缝
 */
var TRIPLANAR_MATERIALS = new Set([
  'gunmetal',
  'anodized_black',
  'polymer_black',
  'polymer_tan',
  'rubber',
  'carbon',
  'glove_fabric',
  'armor_white',
  'armor_orange',
]);

/**
 * 材质展示场景：把 SURFACE_LIB 的每种材质铺成墙板/地面/球三件套（小球体额外走三平面以验证该路径），另立一面墙贴出全部贴花、标牌与数字，用于人工比对材质与贴花质量
 */
export function showcaseMaterials(app) {
  let mats = app.mats,
    group = new THREE.Group();
  app.scene.add(group);
  let onlyList = app.params.only ? String(app.params.only).split(',').filter(Boolean) : null,
    showDecals = !onlyList || onlyList.includes('decals'),
    matNames = onlyList ? onlyList.filter((g) => g !== 'decals') : mats.names,
    cols = onlyList ? Math.max(1, matNames.length) : 10,
    spacingX = 1.9,
    rowGap = 3.6,
    sphereGeo = createTiledSphere(0.42),
    wallGeo = createTiledPlane(1.5, 1.5),
    floorGeo = createTiledPlane(1.5, 1.5).rotateX(-Math.PI / 2),
    addMesh = (g, x, y, b, m) => {
      let A = new THREE.Mesh(g, x);
      return (A.position.set(y, b, m), (A.castShadow = A.receiveShadow = !0), group.add(A), A);
    };
  matNames.forEach((g, x) => {
    let y = ((x % cols) - (cols - 1) / 2) * spacingX,
      b = -Math.floor(x / cols) * rowGap,
      m = mats.get(
        g,
        g.startsWith('glass') || g === 'chainlink'
          ? {
              doubleSide: !0,
            }
          : {},
      );
    (addMesh(wallGeo, m, y, 0.76, b),
      addMesh(floorGeo, m, y, 0.012, b + 1.1),
      addMesh(
        sphereGeo,
        TRIPLANAR_MATERIALS.has(g)
          ? mats.get(g, {
              triplanar: !0,
            })
          : m,
        y,
        0.46,
        b + 1.25,
      ));
  });
  let camPos,
    camTarget,
    rowWidth = cols * spacingX;
  if (
    (onlyList && matNames.length
      ? ((camPos = [0.25 * rowWidth, 1.5, 2.6 + rowWidth * 0.42]), (camTarget = [0, 0.62, 0.5]))
      : ((camPos = [0, 9.5, 12]), (camTarget = [0, 0, -7])),
    showDecals)
  ) {
    let matName = onlyList && !matNames.length ? 0 : rowWidth / 2 + 5.5,
      colIdx = 8.4,
      xPos = 3.3,
      rowZ = addMesh(createTiledPlane(colIdx, xPos), mats.get('paint_blue'), matName, xPos / 2, -1),
      surfaceMat = addMesh(
        createTiledPlane(colIdx, xPos),
        mats.get('concrete'),
        matName,
        xPos / 2,
        -1.01,
      );
    surfaceMat.position.x += colIdx;
    let meshObj = mats.decalNames,
      cursorX = -colIdx / 2 + 0.25,
      cursorY = xPos - 0.75,
      decalH = 0.62,
      placeDecal = (z, H, O) => {
        let q = H * z.aspect;
        if (cursorX + q > colIdx * 1.5 - 0.2) return;
        cursorX < colIdx / 2 && cursorX + q > colIdx / 2 - 0.15 && (cursorX = colIdx / 2 + 0.25);
        let U = new THREE.Mesh(new THREE.PlaneGeometry(q, H), z.material);
        (U.position.set(matName + cursorX + q / 2, cursorY + H / 2, -0.996),
          (U.renderOrder = 2),
          group.add(U),
          (cursorX += q + 0.14));
      };
    ([meshObj.slice(0, 9), meshObj.slice(9, 17), meshObj.slice(17)].forEach((z, H) => {
      ((cursorX = -colIdx / 2 + 0.25),
        (cursorY = xPos - 0.75 - H * 0.78),
        z.forEach((O) => placeDecal(mats.decal(O), decalH)));
    }),
      (cursorX = -colIdx / 2 + 0.25),
      (cursorY = xPos - 0.75 - 3 * 0.78 - 0.05),
      placeDecal(
        mats.label('SALTLINE TERMINAL  B4-0271', {
          color: 'white',
        }),
        0.3,
      ),
      placeDecal(
        mats.label('MAX GROSS 30480 KG', {
          color: 'yellow',
          distress: 0.6,
        }),
        0.22,
      ),
      placeDecal(
        mats.label('DANGER', {
          color: 'red',
          distress: 0.2,
        }),
        0.3,
      ),
      placeDecal(
        mats.label('KEEP CLEAR', {
          color: 'black',
          font: 'sans',
        }),
        0.25,
      ),
      placeDecal(mats.number(4), 0.3),
      placeDecal(mats.number(7), 0.3),
      onlyList &&
        !matNames.length &&
        ((camPos = [colIdx / 2, 1.7, 7.2]), (camTarget = [colIdx / 2, 1.6, -1])));
  }
  return (
    app.params.wet !== void 0 && (mats.uniforms.wet.value = +app.params.wet),
    console.log('[mats] ' + JSON.stringify(mats.stats())),
    {
      cam: camPos,
      target: camTarget,
      update() {},
    }
  );
}
