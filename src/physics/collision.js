// physics/collision.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { WORLD_BOUNDS } from '../core/config.js';

/**
 * 可跨越高度（台阶容差）0.42m：胶囊推挤与导航可走格判定共用，改它会同时改变玩家能走上什么和 AI 认为哪里可走
 */
var STEP_HEIGHT = 0.42;

/**
 * 导航网格的格子边长 0.5m：寻路精度与内存/构建开销的折中
 */
var NAV_CELL_SIZE = 0.5;

/**
 * 导航网格在世界 X 上的起点 -40（世界边界），网格索引与世界坐标的换算基准
 */
var NAV_MIN_X = -40;

/**
 * 导航网格在世界 X 上的终点 31（码头前沿附近），与 NAV_MIN_X 一起决定列数
 */
var NAV_MAX_X = 31;

/**
 * 导航网格在世界 Z 上的起点 -32
 */
var NAV_MIN_Z = -32;

/**
 * 导航网格在世界 Z 上的终点 30
 */
var NAV_MAX_Z = 30;

/**
 * 导航网格列数，由 (NAV_MAX_X - NAV_MIN_X) / NAV_CELL_SIZE 取整得出，所有网格数组按它做行主序索引
 */
var NAV_COLS = Math.round((NAV_MAX_X - NAV_MIN_X) / NAV_CELL_SIZE);

/**
 * 导航网格行数，由 (NAV_MAX_Z - NAV_MIN_Z) / NAV_CELL_SIZE 取整得出
 */
var NAV_ROWS = Math.round((NAV_MAX_Z - NAV_MIN_Z) / NAV_CELL_SIZE);

/**
 * 障碍物在导航网格上的额外外扩 0.5m（相当于代理半径）：让 AI 不会贴着墙走、路径不必再做后处理偏移
 */
var NAV_CLEARANCE = 0.5;

/**
 * 创建碰撞与导航世界：AABB 盒集合 + 射线（区分地面/海水/盒面与表面材质）+ 视线遮挡 + 地面高度查询 + 胶囊分轴推挤移动 + 格子 A* 寻路，是玩家、敌人与子弹共用的物理底座
 */
export function createPhysics(app) {
  let boxes = [],
    gridDirty = !0,
    blocked = new Uint8Array(NAV_COLS * NAV_ROWS),
    tmpDir = new THREE.Vector3(),
    world = {
      boxes: boxes,
      bounds: {
        min: WORLD_BOUNDS.min.clone(),
        max: WORLD_BOUNDS.max.clone(),
      },
      addBox(startPoint, rangeEnd, limitValue = {}) {
        let maxDistance = toVector3(startPoint),
          hitBoxRef = toVector3(rangeEnd),
          boxRecord = {
            min: new THREE.Vector3(
              Math.min(maxDistance.x, hitBoxRef.x),
              Math.min(maxDistance.y, hitBoxRef.y),
              Math.min(maxDistance.z, hitBoxRef.z),
            ),
            max: new THREE.Vector3(
              Math.max(maxDistance.x, hitBoxRef.x),
              Math.max(maxDistance.y, hitBoxRef.y),
              Math.max(maxDistance.z, hitBoxRef.z),
            ),
            surface: limitValue.surface || 'concrete',
            tag: limitValue.tag || '',
            noNav: !!limitValue.noNav,
            bulletOnly: !!limitValue.bulletOnly,
            playerOnly: !!limitValue.playerOnly,
          };
        return (boxes.push(boxRecord), (gridDirty = !0), boxRecord);
      },
      removeBox(startPoint) {
        let rangeEnd = boxes.indexOf(startPoint);
        rangeEnd >= 0 && (boxes.splice(rangeEnd, 1), (gridDirty = !0));
      },
      build() {
        buildGrid();
      },
      raycast(startPoint, rangeEnd, limitValue = 500) {
        let maxDistance = limitValue,
          hitBoxRef = null,
          boxRecord = -1,
          normalSign = 0,
          surfaceKind = 0,
          rayOriginX = startPoint.x,
          rayOriginY = startPoint.y,
          rayOriginZ = startPoint.z,
          probeDeltaX = rangeEnd.x,
          probeDeltaY = rangeEnd.y,
          probeDeltaZ = rangeEnd.z;
        if (probeDeltaY < -1e-6) {
          let hitTime = (WORLD_BOUNDS.groundY - rayOriginY) / probeDeltaY;
          if (hitTime > 0 && hitTime < maxDistance)
            if (rayOriginX + probeDeltaX * hitTime <= WORLD_BOUNDS.quayX)
              ((maxDistance = hitTime), (surfaceKind = 1));
            else {
              let axisLeave = (WORLD_BOUNDS.seaY - rayOriginY) / probeDeltaY;
              axisLeave > 0 &&
                axisLeave < maxDistance &&
                ((maxDistance = axisLeave), (surfaceKind = 2));
            }
        }
        let invDirX = probeDeltaX === 0 ? 1 / 0 : 1 / probeDeltaX,
          invDirY = probeDeltaY === 0 ? 1 / 0 : 1 / probeDeltaY,
          invDirZ = probeDeltaZ === 0 ? 1 / 0 : 1 / probeDeltaZ;
        for (let hitTime = 0; hitTime < boxes.length; hitTime++) {
          let boxCandidate = boxes[hitTime];
          if (boxCandidate.playerOnly) continue;
          let axisLeave = 0,
            tExitLimit = maxDistance,
            hitFaceAxis = -1,
            closestXOffset = 0,
            axisEnter,
            distSq;
          if (probeDeltaX !== 0) {
            ((axisEnter = (boxCandidate.min.x - rayOriginX) * invDirX),
              (distSq = (boxCandidate.max.x - rayOriginX) * invDirX));
            let faceOffsetMin = -1;
            if (axisEnter > distSq) {
              let pushDepth = axisEnter;
              ((axisEnter = distSq), (distSq = pushDepth), (faceOffsetMin = 1));
            }
            if (
              (axisEnter > axisLeave &&
                ((axisLeave = axisEnter), (hitFaceAxis = 0), (closestXOffset = faceOffsetMin)),
              distSq < tExitLimit && (tExitLimit = distSq),
              axisLeave > tExitLimit)
            )
              continue;
          } else if (rayOriginX < boxCandidate.min.x || rayOriginX > boxCandidate.max.x) continue;
          if (probeDeltaY !== 0) {
            ((axisEnter = (boxCandidate.min.y - rayOriginY) * invDirY),
              (distSq = (boxCandidate.max.y - rayOriginY) * invDirY));
            let faceOffsetMin = -1;
            if (axisEnter > distSq) {
              let pushDepth = axisEnter;
              ((axisEnter = distSq), (distSq = pushDepth), (faceOffsetMin = 1));
            }
            if (
              (axisEnter > axisLeave &&
                ((axisLeave = axisEnter), (hitFaceAxis = 1), (closestXOffset = faceOffsetMin)),
              distSq < tExitLimit && (tExitLimit = distSq),
              axisLeave > tExitLimit)
            )
              continue;
          } else if (rayOriginY < boxCandidate.min.y || rayOriginY > boxCandidate.max.y) continue;
          if (probeDeltaZ !== 0) {
            ((axisEnter = (boxCandidate.min.z - rayOriginZ) * invDirZ),
              (distSq = (boxCandidate.max.z - rayOriginZ) * invDirZ));
            let faceOffsetMin = -1;
            if (axisEnter > distSq) {
              let pushDepth = axisEnter;
              ((axisEnter = distSq), (distSq = pushDepth), (faceOffsetMin = 1));
            }
            if (
              (axisEnter > axisLeave &&
                ((axisLeave = axisEnter), (hitFaceAxis = 2), (closestXOffset = faceOffsetMin)),
              distSq < tExitLimit && (tExitLimit = distSq),
              axisLeave > tExitLimit)
            )
              continue;
          } else if (rayOriginZ < boxCandidate.min.z || rayOriginZ > boxCandidate.max.z) continue;
          hitFaceAxis < 0 ||
            ((maxDistance = axisLeave),
            (hitBoxRef = boxCandidate),
            (boxRecord = hitFaceAxis),
            (normalSign = closestXOffset),
            (surfaceKind = 0));
        }
        if (!hitBoxRef && !surfaceKind) return null;
        let hitPointVec = new THREE.Vector3(
          rayOriginX + probeDeltaX * maxDistance,
          rayOriginY + probeDeltaY * maxDistance,
          rayOriginZ + probeDeltaZ * maxDistance,
        );
        if (surfaceKind)
          return {
            dist: maxDistance,
            point: hitPointVec,
            normal: new THREE.Vector3(0, 1, 0),
            surface:
              surfaceKind === 2
                ? 'water'
                : app.level && app.level.groundSurfaceAt
                  ? app.level.groundSurfaceAt(hitPointVec.x, hitPointVec.z)
                  : 'concrete',
            box: null,
          };
        let boxRef = new THREE.Vector3();
        return (
          boxRef.setComponent(boxRecord, normalSign),
          {
            dist: maxDistance,
            point: hitPointVec,
            normal: boxRef,
            surface: hitBoxRef.surface,
            box: hitBoxRef,
          }
        );
      },
      lineOfSight(startPoint, rangeEnd) {
        tmpDir.subVectors(rangeEnd, startPoint);
        let limitValue = tmpDir.length();
        return limitValue < 1e-4
          ? !0
          : (tmpDir.multiplyScalar(1 / limitValue),
            !world.raycast(startPoint, tmpDir, limitValue - 0.05));
      },
      groundHeight(startPoint, rangeEnd, limitValue = 50) {
        let maxDistance =
          startPoint <= WORLD_BOUNDS.quayX ? WORLD_BOUNDS.groundY : WORLD_BOUNDS.seaY;
        for (let hitBoxRef = 0; hitBoxRef < boxes.length; hitBoxRef++) {
          let boxRecord = boxes[hitBoxRef];
          boxRecord.bulletOnly ||
            (startPoint >= boxRecord.min.x &&
              startPoint <= boxRecord.max.x &&
              rangeEnd >= boxRecord.min.z &&
              rangeEnd <= boxRecord.max.z &&
              boxRecord.max.y <= limitValue &&
              boxRecord.max.y > maxDistance &&
              (maxDistance = boxRecord.max.y));
        }
        return maxDistance;
      },
      moveCapsule(
        startPoint,
        rangeEnd,
        limitValue,
        maxDistance = 0.32,
        hitBoxRef = 1.8,
        boxRecord = !0,
      ) {
        let normalSign = {
            onGround: !1,
            hitWall: !1,
            hitCeil: !1,
            surface: 'concrete',
          },
          surfaceKind = rangeEnd.x * limitValue,
          rayOriginX = rangeEnd.z * limitValue,
          rayOriginY = Math.max(
            1,
            Math.ceil(Math.hypot(surfaceKind, rayOriginX) / (maxDistance * 0.6)),
          ),
          rayOriginZ = startPoint.y;
        for (let hitPointVec = 0; hitPointVec < rayOriginY; hitPointVec++) {
          ((startPoint.x += surfaceKind / rayOriginY), (startPoint.z += rayOriginX / rayOriginY));
          for (let boxRef = 0; boxRef < 3; boxRef++) {
            let hitTime = !1;
            for (let boxCandidate = 0; boxCandidate < boxes.length; boxCandidate++) {
              let axisLeave = boxes[boxCandidate];
              if (
                axisLeave.bulletOnly ||
                axisLeave.max.y <= startPoint.y + (boxRecord ? STEP_HEIGHT : 0.08) ||
                axisLeave.min.y >= startPoint.y + hitBoxRef
              )
                continue;
              let tExitLimit = Math.max(axisLeave.min.x, Math.min(axisLeave.max.x, startPoint.x)),
                hitFaceAxis = Math.max(axisLeave.min.z, Math.min(axisLeave.max.z, startPoint.z)),
                closestXOffset = startPoint.x - tExitLimit,
                axisEnter = startPoint.z - hitFaceAxis,
                distSq = closestXOffset * closestXOffset + axisEnter * axisEnter;
              if (!(distSq >= maxDistance * maxDistance)) {
                if (distSq > 1e-10) {
                  let faceOffsetMin = Math.sqrt(distSq),
                    pushDepth = maxDistance - faceOffsetMin;
                  ((closestXOffset /= faceOffsetMin),
                    (axisEnter /= faceOffsetMin),
                    (startPoint.x += closestXOffset * pushDepth),
                    (startPoint.z += axisEnter * pushDepth));
                  let velocityAlongNormal = rangeEnd.x * closestXOffset + rangeEnd.z * axisEnter;
                  velocityAlongNormal < 0 &&
                    ((rangeEnd.x -= closestXOffset * velocityAlongNormal),
                    (rangeEnd.z -= axisEnter * velocityAlongNormal));
                } else {
                  let faceOffsetMin = startPoint.x - axisLeave.min.x,
                    pushDepth = axisLeave.max.x - startPoint.x,
                    velocityAlongNormal = startPoint.z - axisLeave.min.z,
                    faceSpanMax = axisLeave.max.z - startPoint.z,
                    nearestSideDist = Math.min(
                      faceOffsetMin,
                      pushDepth,
                      velocityAlongNormal,
                      faceSpanMax,
                    );
                  nearestSideDist === faceOffsetMin
                    ? ((startPoint.x = axisLeave.min.x - maxDistance),
                      rangeEnd.x > 0 && (rangeEnd.x = 0))
                    : nearestSideDist === pushDepth
                      ? ((startPoint.x = axisLeave.max.x + maxDistance),
                        rangeEnd.x < 0 && (rangeEnd.x = 0))
                      : nearestSideDist === velocityAlongNormal
                        ? ((startPoint.z = axisLeave.min.z - maxDistance),
                          rangeEnd.z > 0 && (rangeEnd.z = 0))
                        : ((startPoint.z = axisLeave.max.z + maxDistance),
                          rangeEnd.z < 0 && (rangeEnd.z = 0));
                }
                ((hitTime = !0), (normalSign.hitWall = !0));
              }
            }
            if (!hitTime) break;
          }
        }
        let probeDeltaX = startPoint.y + rangeEnd.y * limitValue,
          probeDeltaY = maxDistance * 0.7,
          probeDeltaZ =
            startPoint.x <= WORLD_BOUNDS.quayX + probeDeltaY ? WORLD_BOUNDS.groundY : -50,
          invDirX = null,
          invDirY = 1 / 0,
          invDirZ = rayOriginZ + (boxRecord ? STEP_HEIGHT : 0.08) + 1e-4;
        for (let hitPointVec = 0; hitPointVec < boxes.length; hitPointVec++) {
          let boxRef = boxes[hitPointVec];
          boxRef.bulletOnly ||
            startPoint.x + probeDeltaY < boxRef.min.x ||
            startPoint.x - probeDeltaY > boxRef.max.x ||
            startPoint.z + probeDeltaY < boxRef.min.z ||
            startPoint.z - probeDeltaY > boxRef.max.z ||
            (boxRef.max.y <= invDirZ &&
              boxRef.max.y > probeDeltaZ &&
              ((probeDeltaZ = boxRef.max.y), (invDirX = boxRef.surface)),
            boxRef.min.y >= rayOriginZ + hitBoxRef - 0.05 &&
              boxRef.min.y < invDirY &&
              (invDirY = boxRef.min.y));
        }
        return (
          rangeEnd.y > 0 && probeDeltaX + hitBoxRef > invDirY
            ? ((startPoint.y = invDirY - hitBoxRef), (rangeEnd.y = 0), (normalSign.hitCeil = !0))
            : probeDeltaX <= probeDeltaZ
              ? ((startPoint.y = probeDeltaZ),
                rangeEnd.y < 0 && (rangeEnd.y = 0),
                (normalSign.onGround = !0))
              : boxRecord && rangeEnd.y <= 0 && probeDeltaX - probeDeltaZ < STEP_HEIGHT
                ? ((startPoint.y = probeDeltaZ), (rangeEnd.y = 0), (normalSign.onGround = !0))
                : (startPoint.y = probeDeltaX),
          normalSign.onGround &&
            (normalSign.surface =
              invDirX ||
              (app.level && app.level.groundSurfaceAt
                ? app.level.groundSurfaceAt(startPoint.x, startPoint.z)
                : 'concrete')),
          normalSign
        );
      },
      nav: {
        cell: NAV_CELL_SIZE,
        isWalkable(startPoint, rangeEnd) {
          ensureGrid();
          let limitValue = cellIndexAt(startPoint, rangeEnd);
          return limitValue >= 0 && !blocked[limitValue];
        },
        findPath(startPoint, rangeEnd) {
          ensureGrid();
          let limitValue = nearestOpenCell(startPoint.x, startPoint.z),
            maxDistance = nearestOpenCell(rangeEnd.x, rangeEnd.z);
          if (limitValue < 0 || maxDistance < 0) return null;
          if (limitValue === maxDistance) return [new THREE.Vector3(rangeEnd.x, 0, rangeEnd.z)];
          let hitBoxRef = findPathCells(limitValue, maxDistance);
          if (!hitBoxRef) return null;
          let boxRecord = [],
            normalSign = 0;
          for (; normalSign < hitBoxRef.length - 1;) {
            let surfaceKind = normalSign + 1;
            for (let rayOriginX = hitBoxRef.length - 1; rayOriginX > normalSign + 1; rayOriginX--)
              if (hasGridLine(hitBoxRef[normalSign], hitBoxRef[rayOriginX])) {
                surfaceKind = rayOriginX;
                break;
              }
            (boxRecord.push(cellCenterAt(hitBoxRef[surfaceKind])), (normalSign = surfaceKind));
          }
          return (
            cellIndexAt(rangeEnd.x, rangeEnd.z) === maxDistance &&
              boxRecord.length &&
              boxRecord[boxRecord.length - 1].set(rangeEnd.x, 0, rangeEnd.z),
            boxRecord
          );
        },
        randomPoint(startPoint, rangeEnd) {
          ensureGrid();
          for (let maxDistance = 0; maxDistance < 24; maxDistance++) {
            let hitBoxRef = Math.random() * 6.2832,
              boxRecord = Math.sqrt(Math.random()) * rangeEnd,
              normalSign = startPoint.x + Math.cos(hitBoxRef) * boxRecord,
              surfaceKind = startPoint.z + Math.sin(hitBoxRef) * boxRecord,
              rayOriginX = cellIndexAt(normalSign, surfaceKind);
            if (rayOriginX >= 0 && !blocked[rayOriginX])
              return new THREE.Vector3(normalSign, 0, surfaceKind);
          }
          let limitValue = nearestOpenCell(startPoint.x, startPoint.z);
          return limitValue >= 0
            ? cellCenterAt(limitValue)
            : new THREE.Vector3(startPoint.x, 0, startPoint.z);
        },
        clearLine(startPoint, rangeEnd) {
          ensureGrid();
          let limitValue = cellIndexAt(startPoint.x, startPoint.z),
            maxDistance = cellIndexAt(rangeEnd.x, rangeEnd.z);
          return limitValue >= 0 && maxDistance >= 0 && hasGridLine(limitValue, maxDistance);
        },
        _grid: () => (
          ensureGrid(),
          {
            blocked: blocked,
            w: NAV_COLS,
            h: NAV_ROWS,
            minX: NAV_MIN_X,
            minZ: NAV_MIN_Z,
            cell: NAV_CELL_SIZE,
          }
        ),
      },
    };
  function ensureGrid() {
    gridDirty && buildGrid();
  }
  function buildGrid() {
    ((blocked = new Uint8Array(NAV_COLS * NAV_ROWS)), (gridDirty = !1));
    for (let _ of boxes) {
      if (_.noNav || _.bulletOnly || _.max.y < STEP_HEIGHT + 0.05 || _.min.y > 1.5) continue;
      let M = Math.max(0, Math.floor((_.min.x - NAV_CLEARANCE - NAV_MIN_X) / NAV_CELL_SIZE)),
        E = Math.min(
          NAV_COLS - 1,
          Math.floor((_.max.x + NAV_CLEARANCE - NAV_MIN_X) / NAV_CELL_SIZE),
        ),
        w = Math.max(0, Math.floor((_.min.z - NAV_CLEARANCE - NAV_MIN_Z) / NAV_CELL_SIZE)),
        S = Math.min(
          NAV_ROWS - 1,
          Math.floor((_.max.z + NAV_CLEARANCE - NAV_MIN_Z) / NAV_CELL_SIZE),
        );
      for (let z = w; z <= S; z++) for (let H = M; H <= E; H++) blocked[z * NAV_COLS + H] = 1;
    }
    for (let _ = 0; _ < NAV_ROWS; _++)
      for (let M = 0; M < NAV_COLS; M++)
        (NAV_MIN_X + (M + 0.5) * NAV_CELL_SIZE > WORLD_BOUNDS.quayX - NAV_CLEARANCE ||
          M === 0 ||
          _ === 0 ||
          M === NAV_COLS - 1 ||
          _ === NAV_ROWS - 1) &&
          (blocked[_ * NAV_COLS + M] = 1);
  }
  function cellIndexAt(_, M) {
    let E = Math.floor((_ - NAV_MIN_X) / NAV_CELL_SIZE),
      w = Math.floor((M - NAV_MIN_Z) / NAV_CELL_SIZE);
    return E < 0 || w < 0 || E >= NAV_COLS || w >= NAV_ROWS ? -1 : w * NAV_COLS + E;
  }
  function cellCenterAt(_) {
    return new THREE.Vector3(
      NAV_MIN_X + ((_ % NAV_COLS) + 0.5) * NAV_CELL_SIZE,
      0,
      NAV_MIN_Z + (Math.floor(_ / NAV_COLS) + 0.5) * NAV_CELL_SIZE,
    );
  }
  function nearestOpenCell(_, M) {
    let E = Math.floor((_ - NAV_MIN_X) / NAV_CELL_SIZE),
      w = Math.floor((M - NAV_MIN_Z) / NAV_CELL_SIZE);
    if (
      ((E = Math.max(0, Math.min(NAV_COLS - 1, E))),
      (w = Math.max(0, Math.min(NAV_ROWS - 1, w))),
      !blocked[w * NAV_COLS + E])
    )
      return w * NAV_COLS + E;
    for (let S = 1; S <= 12; S++) {
      let z = -1,
        H = 1e9;
      for (let O = -S; O <= S; O++)
        for (let q = -S; q <= S; q++) {
          if (Math.max(Math.abs(q), Math.abs(O)) !== S) continue;
          let U = E + q,
            T = w + O;
          if (!(U < 0 || T < 0 || U >= NAV_COLS || T >= NAV_ROWS) && !blocked[T * NAV_COLS + U]) {
            let D = q * q + O * O;
            D < H && ((H = D), (z = T * NAV_COLS + U));
          }
        }
      if (z >= 0) return z;
    }
    return -1;
  }
  function hasGridLine(_, M) {
    let E = _ % NAV_COLS,
      w = Math.floor(_ / NAV_COLS),
      S = M % NAV_COLS,
      z = Math.floor(M / NAV_COLS),
      H = Math.abs(S - E),
      O = Math.abs(z - w),
      q = E < S ? 1 : -1,
      U = w < z ? 1 : -1,
      T = H - O;
    for (let D = 0; D < 600; D++) {
      if (blocked[w * NAV_COLS + E]) return !1;
      if (E === S && w === z) return !0;
      let C = 2 * T;
      if (C > -O && C < H) {
        if (blocked[w * NAV_COLS + E + q] || blocked[(w + U) * NAV_COLS + E]) return !1;
        ((T += H - O), (E += q), (w += U));
      } else C > -O ? ((T -= O), (E += q)) : ((T += H), (w += U));
    }
    return !1;
  }
  let gCost = new Float32Array(NAV_COLS * NAV_ROWS),
    cameFrom = new Int32Array(NAV_COLS * NAV_ROWS),
    gStamp = new Uint32Array(NAV_COLS * NAV_ROWS),
    closedStamp = new Uint32Array(NAV_COLS * NAV_ROWS),
    searchGen = 0,
    heapNode = [],
    heapCost = [];
  function heapPush(angle, length) {
    let strokeW = heapNode.length;
    for (heapNode.push(angle), heapCost.push(length); strokeW > 0;) {
      let branchDepth = (strokeW - 1) >> 1;
      if (heapCost[branchDepth] <= length) break;
      ((heapNode[strokeW] = heapNode[branchDepth]),
        (heapCost[strokeW] = heapCost[branchDepth]),
        (strokeW = branchDepth));
    }
    ((heapNode[strokeW] = angle), (heapCost[strokeW] = length));
  }
  function heapPop() {
    let _ = heapNode[0],
      M = heapNode.pop(),
      E = heapCost.pop(),
      w = heapNode.length;
    if (w) {
      let S = 0;
      for (;;) {
        let z = 2 * S + 1;
        if (z >= w || (z + 1 < w && heapCost[z + 1] < heapCost[z] && z++, heapCost[z] >= E)) break;
        ((heapNode[S] = heapNode[z]), (heapCost[S] = heapCost[z]), (S = z));
      }
      ((heapNode[S] = M), (heapCost[S] = E));
    }
    return _;
  }
  function findPathCells(_, M) {
    (searchGen++, (heapNode.length = 0), (heapCost.length = 0));
    let E = M % NAV_COLS,
      w = Math.floor(M / NAV_COLS),
      S = (O) => {
        let q = Math.abs((O % NAV_COLS) - E),
          U = Math.abs(Math.floor(O / NAV_COLS) - w);
        return q + U + (1.4142 - 2) * Math.min(q, U);
      };
    ((gCost[_] = 0), (gStamp[_] = searchGen), (cameFrom[_] = -1), heapPush(_, S(_)));
    let z = 0;
    for (; heapNode.length;) {
      let O = heapPop();
      if (O === M) break;
      if (closedStamp[O] === searchGen) continue;
      if (((closedStamp[O] = searchGen), ++z > 9e3)) return null;
      let q = O % NAV_COLS,
        U = Math.floor(O / NAV_COLS);
      for (let T = -1; T <= 1; T++)
        for (let D = -1; D <= 1; D++) {
          if (!D && !T) continue;
          let C = q + D,
            G = U + T;
          if (C < 0 || G < 0 || C >= NAV_COLS || G >= NAV_ROWS) continue;
          let j = G * NAV_COLS + C;
          if (
            blocked[j] ||
            closedStamp[j] === searchGen ||
            (D && T && (blocked[U * NAV_COLS + C] || blocked[G * NAV_COLS + q]))
          )
            continue;
          let N = gCost[O] + (D && T ? 1.4142 : 1);
          (gStamp[j] !== searchGen || N < gCost[j]) &&
            ((gCost[j] = N), (gStamp[j] = searchGen), (cameFrom[j] = O), heapPush(j, N + S(j)));
        }
    }
    if (gStamp[M] !== searchGen) return null;
    let H = [];
    for (let O = M; O !== -1; O = cameFrom[O]) H.push(O);
    return (H.reverse(), H);
  }
  return world;
}

/**
 * 把 Vector3 或 [x,y,z] 统一成新的 Vector3 副本，让 addBox 同时接受两种写法且不持有外部引用
 */
function toVector3(value) {
  return value.isVector3 ? value.clone() : new THREE.Vector3(value[0], value[1], value[2]);
}
