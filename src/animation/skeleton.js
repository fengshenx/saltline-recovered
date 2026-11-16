// animation/skeleton.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

/**
 * 把 Rig.build 的产物实例化成 THREE 场景对象：建 Bone 层级、SkinnedMesh、Skeleton，并手工写入包围球/包围盒以免蒙皮动画时被视锥剔除；extra 用于挂不参与蒙皮的附加网格（螺旋桨盘、探照锥）
 */
export function buildSkinnedRig(
  def,
  materials,
  {
    castShadow: castShadowOn = !0,
    receiveShadow: receiveShadowOn = !0,
    radius: boundRadius = 1.5,
    center: centerPoint = [0, 0.5, 0],
    extra: extraRig = null,
  } = {},
) {
  let boneList = def.bones.map((p) => {
    let d = new THREE.Bone();
    return ((d.name = p.name), d.position.set(p.local[0], p.local[1], p.local[2]), d);
  });
  def.bones.forEach((p, d) => {
    p.parent >= 0 && boneList[p.parent].add(boneList[d]);
  });
  let rigGroup = new THREE.Group(),
    skinMesh = new THREE.SkinnedMesh(
      def.geometry,
      def.slots.map((p) => materials[p]),
    );
  ((skinMesh.castShadow = castShadowOn),
    (skinMesh.receiveShadow = receiveShadowOn),
    rigGroup.add(skinMesh),
    def.bones.forEach((p, d) => {
      p.parent < 0 && skinMesh.add(boneList[d]);
    }),
    rigGroup.updateMatrixWorld(!0));
  let skeleton = new THREE.Skeleton(boneList);
  (skinMesh.bind(skeleton),
    (skinMesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(centerPoint[0], centerPoint[1], centerPoint[2]),
      boundRadius,
    )),
    (skinMesh.boundingBox = new THREE.Box3(
      new THREE.Vector3(
        centerPoint[0] - boundRadius,
        centerPoint[1] - boundRadius,
        centerPoint[2] - boundRadius,
      ),
      new THREE.Vector3(
        centerPoint[0] + boundRadius,
        centerPoint[1] + boundRadius,
        centerPoint[2] + boundRadius,
      ),
    )));
  let boneMap = {};
  boneList.forEach((p) => {
    boneMap[p.name] = p;
  });
  let rigResult = {
    group: rigGroup,
    mesh: skinMesh,
    bones: boneMap,
    skeleton: skeleton,
    extraMesh: null,
  };
  if (extraRig) {
    let boneDef = new THREE.SkinnedMesh(
      extraRig.def.geometry,
      extraRig.def.slots.map((d) => materials[d]),
    );
    ((boneDef.castShadow = !1),
      (boneDef.receiveShadow = !1),
      (boneDef.renderOrder = 5),
      rigGroup.add(boneDef),
      boneDef.updateMatrixWorld(!0),
      boneDef.bind(skeleton, skinMesh.bindMatrix),
      (boneDef.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(centerPoint[0], centerPoint[1], centerPoint[2]),
        extraRig.radius || boundRadius,
      )),
      (boneDef.boundingBox = new THREE.Box3().setFromCenterAndSize(
        boneDef.boundingSphere.center,
        new THREE.Vector3(1, 1, 1).multiplyScalar(2 * (extraRig.radius || boundRadius)),
      )),
      (rigResult.extraMesh = boneDef));
  }
  return rigResult;
}

/**
 * 四足机器的两段式腿 IK 解析：由髋部到落足点的差向量反解髋开合角、大腿与小腿角，并把可达距离限幅到腿长范围内，保证脚不打滑也不穿透
 */
export function solveLegIK(out, localX, localY, localZ, side, coxa, thigh, shin) {
  let planarSq = localX * localX + localY * localY,
    horizDist = Math.sqrt(Math.max(planarSq - coxa * coxa, 1e-6));
  ((out.abd = Math.atan2(localY, localX) - Math.atan2(-horizDist, side * coxa)),
    out.abd > Math.PI ? (out.abd -= 2 * Math.PI) : out.abd < -Math.PI && (out.abd += 2 * Math.PI));
  let reachDist = Math.hypot(horizDist, localZ),
    maxReach = (thigh + shin) * 0.995,
    minReach = Math.abs(thigh - shin) + 0.03;
  ((out.reach = reachDist / (thigh + shin)),
    reachDist > maxReach ? (reachDist = maxReach) : reachDist < minReach && (reachDist = minReach));
  let elevation = Math.atan2(localZ, horizDist),
    hipCos = (thigh * thigh + reachDist * reachDist - shin * shin) / (2 * thigh * reachDist),
    kneeCos = (thigh * thigh + shin * shin - reachDist * reachDist) / (2 * thigh * shin),
    hipAngle = Math.acos(hipCos < -1 ? -1 : hipCos > 1 ? 1 : hipCos),
    kneeAngle = Math.acos(kneeCos < -1 ? -1 : kneeCos > 1 ? 1 : kneeCos);
  return ((out.hip = hipAngle - elevation), (out.knee = -(Math.PI - kneeAngle)), out);
}
