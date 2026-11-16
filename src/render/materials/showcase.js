// render/materials/showcase.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { createTiledPlane, createTiledSphere } from '../../assets/procedural/geometry.js';

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
    matNames = onlyList ? onlyList.filter((materialKey) => materialKey !== 'decals') : mats.names,
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
  matNames.forEach((materialKey, columnIndex) => {
    let posX = ((columnIndex % cols) - (cols - 1) / 2) * spacingX,
      posY = -Math.floor(columnIndex / cols) * rowGap,
      materialRef = mats.get(
        materialKey,
        materialKey.startsWith('glass') || materialKey === 'chainlink'
          ? {
              doubleSide: !0,
            }
          : {},
      );
    (addMesh(wallGeo, materialRef, posX, 0.76, posY),
      addMesh(floorGeo, materialRef, posX, 0.012, posY + 1.1),
      addMesh(
        sphereGeo,
        TRIPLANAR_MATERIALS.has(materialKey)
          ? mats.get(materialKey, {
              triplanar: !0,
            })
          : materialRef,
        posX,
        0.46,
        posY + 1.25,
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
    let materialKey = onlyList && !matNames.length ? 0 : rowWidth / 2 + 5.5,
      columnIndex = 8.4,
      posX = 3.3,
      posY = addMesh(
        createTiledPlane(columnIndex, posX),
        mats.get('paint_blue'),
        materialKey,
        posX / 2,
        -1,
      ),
      materialRef = addMesh(
        createTiledPlane(columnIndex, posX),
        mats.get('concrete'),
        materialKey,
        posX / 2,
        -1.01,
      );
    materialRef.position.x += columnIndex;
    let tileMesh = mats.decalNames,
      cursorX = -columnIndex / 2 + 0.25,
      cursorY = posX - 0.75,
      decalH = 0.62,
      placeDecal = (z, H, O) => {
        let q = H * z.aspect;
        if (cursorX + q > columnIndex * 1.5 - 0.2) return;
        cursorX < columnIndex / 2 &&
          cursorX + q > columnIndex / 2 - 0.15 &&
          (cursorX = columnIndex / 2 + 0.25);
        let U = new THREE.Mesh(new THREE.PlaneGeometry(q, H), z.material);
        (U.position.set(materialKey + cursorX + q / 2, cursorY + H / 2, -0.996),
          (U.renderOrder = 2),
          group.add(U),
          (cursorX += q + 0.14));
      };
    ([tileMesh.slice(0, 9), tileMesh.slice(9, 17), tileMesh.slice(17)].forEach(
      (decalSpec, decalHeight) => {
        ((cursorX = -columnIndex / 2 + 0.25),
          (cursorY = posX - 0.75 - decalHeight * 0.78),
          decalSpec.forEach((decalName) => placeDecal(mats.decal(decalName), decalH)));
      },
    ),
      (cursorX = -columnIndex / 2 + 0.25),
      (cursorY = posX - 0.75 - 3 * 0.78 - 0.05),
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
        ((camPos = [columnIndex / 2, 1.7, 7.2]), (camTarget = [columnIndex / 2, 1.6, -1])));
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
