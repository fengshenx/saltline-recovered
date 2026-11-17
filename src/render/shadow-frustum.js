// render/shadow-frustum.js — 平行光阴影相机与太阳方向的对齐：把场景包围盒投到光空间定正交范围。

import * as THREE from 'three';

import { SUN } from '../core/config.js';

export /**
 * 把平行光阴影相机对到太阳方向并贴合场景：沿光轴 lookAt 区域中点，把两组包围盒的 8 个角投到光空间取 min/max 定正交范围，第二组（更高更远）的角只用来收紧近平面以免楼顶被裁
 */
function fitSunShadowFrustum(sunLight, boundsMin, boundsMax, casterMin, casterMax) {
  let sunDir = SUN.dir.clone().normalize(),
    focusCenter = boundsMin.clone().add(boundsMax).multiplyScalar(0.5);
  (sunLight.target.position.copy(focusCenter),
    sunLight.position.copy(focusCenter).addScaledVector(sunDir, 200),
    sunLight.updateMatrixWorld(!0),
    sunLight.target.updateMatrixWorld(!0));
  let lightMatrix = new THREE.Matrix4().lookAt(
    sunLight.position,
    focusCenter,
    new THREE.Vector3(0, 1, 0),
  );
  (lightMatrix.setPosition(sunLight.position), lightMatrix.invert());
  let cornerPoint = new THREE.Vector3(),
    minX = 1 / 0,
    maxX = -1 / 0,
    minY = 1 / 0,
    maxY = -1 / 0,
    minZ = 1 / 0,
    maxZ = -1 / 0,
    forEachCorner = (y, b, eachCorner) => {
      for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++)
        (cornerPoint
          .set(
            cornerIndex & 1 ? b.x : y.x,
            cornerIndex & 2 ? b.y : y.y,
            cornerIndex & 4 ? b.z : y.z,
          )
          .applyMatrix4(lightMatrix),
          eachCorner(cornerPoint));
    };
  (forEachCorner(boundsMin, boundsMax, (corner) => {
    ((minX = Math.min(minX, corner.x)),
      (maxX = Math.max(maxX, corner.x)),
      (minY = Math.min(minY, corner.y)),
      (maxY = Math.max(maxY, corner.y)),
      (minZ = Math.min(minZ, -corner.z)),
      (maxZ = Math.max(maxZ, -corner.z)));
  }),
    forEachCorner(casterMin, casterMax, (corner) => {
      minZ = Math.min(minZ, -corner.z);
    }));
  let shadowCam = sunLight.shadow.camera,
    frustumPad = 1;
  return (
    (shadowCam.left = minX - frustumPad),
    (shadowCam.right = maxX + frustumPad),
    (shadowCam.bottom = minY - frustumPad),
    (shadowCam.top = maxY + frustumPad),
    (shadowCam.near = Math.max(1, minZ - 4)),
    (shadowCam.far = maxZ + 4),
    shadowCam.updateProjectionMatrix(),
    {
      width: shadowCam.right - shadowCam.left,
      height: shadowCam.top - shadowCam.bottom,
      depth: shadowCam.far - shadowCam.near,
    }
  );
}
