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
      addBox(_, M, E = {}) {
        let w = toVector3(_),
          S = toVector3(M),
          z = {
            min: new THREE.Vector3(Math.min(w.x, S.x), Math.min(w.y, S.y), Math.min(w.z, S.z)),
            max: new THREE.Vector3(Math.max(w.x, S.x), Math.max(w.y, S.y), Math.max(w.z, S.z)),
            surface: E.surface || 'concrete',
            tag: E.tag || '',
            noNav: !!E.noNav,
            bulletOnly: !!E.bulletOnly,
            playerOnly: !!E.playerOnly,
          };
        return (boxes.push(z), (gridDirty = !0), z);
      },
      removeBox(_) {
        let M = boxes.indexOf(_);
        M >= 0 && (boxes.splice(M, 1), (gridDirty = !0));
      },
      build() {
        buildGrid();
      },
      raycast(_, M, E = 500) {
        let w = E,
          S = null,
          z = -1,
          H = 0,
          O = 0,
          q = _.x,
          U = _.y,
          T = _.z,
          D = M.x,
          C = M.y,
          G = M.z;
        if (C < -1e-6) {
          let F = (WORLD_BOUNDS.groundY - U) / C;
          if (F > 0 && F < w)
            if (q + D * F <= WORLD_BOUNDS.quayX) ((w = F), (O = 1));
            else {
              let ne = (WORLD_BOUNDS.seaY - U) / C;
              ne > 0 && ne < w && ((w = ne), (O = 2));
            }
        }
        let j = D === 0 ? 1 / 0 : 1 / D,
          N = C === 0 ? 1 / 0 : 1 / C,
          Q = G === 0 ? 1 / 0 : 1 / G;
        for (let F = 0; F < boxes.length; F++) {
          let X = boxes[F];
          if (X.playerOnly) continue;
          let ne = 0,
            re = w,
            $ = -1,
            ue = 0,
            me,
            ee;
          if (D !== 0) {
            ((me = (X.min.x - q) * j), (ee = (X.max.x - q) * j));
            let B = -1;
            if (me > ee) {
              let P = me;
              ((me = ee), (ee = P), (B = 1));
            }
            if ((me > ne && ((ne = me), ($ = 0), (ue = B)), ee < re && (re = ee), ne > re))
              continue;
          } else if (q < X.min.x || q > X.max.x) continue;
          if (C !== 0) {
            ((me = (X.min.y - U) * N), (ee = (X.max.y - U) * N));
            let B = -1;
            if (me > ee) {
              let P = me;
              ((me = ee), (ee = P), (B = 1));
            }
            if ((me > ne && ((ne = me), ($ = 1), (ue = B)), ee < re && (re = ee), ne > re))
              continue;
          } else if (U < X.min.y || U > X.max.y) continue;
          if (G !== 0) {
            ((me = (X.min.z - T) * Q), (ee = (X.max.z - T) * Q));
            let B = -1;
            if (me > ee) {
              let P = me;
              ((me = ee), (ee = P), (B = 1));
            }
            if ((me > ne && ((ne = me), ($ = 2), (ue = B)), ee < re && (re = ee), ne > re))
              continue;
          } else if (T < X.min.z || T > X.max.z) continue;
          $ < 0 || ((w = ne), (S = X), (z = $), (H = ue), (O = 0));
        }
        if (!S && !O) return null;
        let K = new THREE.Vector3(q + D * w, U + C * w, T + G * w);
        if (O)
          return {
            dist: w,
            point: K,
            normal: new THREE.Vector3(0, 1, 0),
            surface:
              O === 2
                ? 'water'
                : app.level && app.level.groundSurfaceAt
                  ? app.level.groundSurfaceAt(K.x, K.z)
                  : 'concrete',
            box: null,
          };
        let ie = new THREE.Vector3();
        return (
          ie.setComponent(z, H),
          {
            dist: w,
            point: K,
            normal: ie,
            surface: S.surface,
            box: S,
          }
        );
      },
      lineOfSight(_, M) {
        tmpDir.subVectors(M, _);
        let E = tmpDir.length();
        return E < 1e-4 ? !0 : (tmpDir.multiplyScalar(1 / E), !world.raycast(_, tmpDir, E - 0.05));
      },
      groundHeight(_, M, E = 50) {
        let w = _ <= WORLD_BOUNDS.quayX ? WORLD_BOUNDS.groundY : WORLD_BOUNDS.seaY;
        for (let S = 0; S < boxes.length; S++) {
          let z = boxes[S];
          z.bulletOnly ||
            (_ >= z.min.x &&
              _ <= z.max.x &&
              M >= z.min.z &&
              M <= z.max.z &&
              z.max.y <= E &&
              z.max.y > w &&
              (w = z.max.y));
        }
        return w;
      },
      moveCapsule(_, M, E, w = 0.32, S = 1.8, z = !0) {
        let H = {
            onGround: !1,
            hitWall: !1,
            hitCeil: !1,
            surface: 'concrete',
          },
          O = M.x * E,
          q = M.z * E,
          U = Math.max(1, Math.ceil(Math.hypot(O, q) / (w * 0.6))),
          T = _.y;
        for (let K = 0; K < U; K++) {
          ((_.x += O / U), (_.z += q / U));
          for (let ie = 0; ie < 3; ie++) {
            let F = !1;
            for (let X = 0; X < boxes.length; X++) {
              let ne = boxes[X];
              if (
                ne.bulletOnly ||
                ne.max.y <= _.y + (z ? STEP_HEIGHT : 0.08) ||
                ne.min.y >= _.y + S
              )
                continue;
              let re = Math.max(ne.min.x, Math.min(ne.max.x, _.x)),
                $ = Math.max(ne.min.z, Math.min(ne.max.z, _.z)),
                ue = _.x - re,
                me = _.z - $,
                ee = ue * ue + me * me;
              if (!(ee >= w * w)) {
                if (ee > 1e-10) {
                  let B = Math.sqrt(ee),
                    P = w - B;
                  ((ue /= B), (me /= B), (_.x += ue * P), (_.z += me * P));
                  let V = M.x * ue + M.z * me;
                  V < 0 && ((M.x -= ue * V), (M.z -= me * V));
                } else {
                  let B = _.x - ne.min.x,
                    P = ne.max.x - _.x,
                    V = _.z - ne.min.z,
                    Y = ne.max.z - _.z,
                    L = Math.min(B, P, V, Y);
                  L === B
                    ? ((_.x = ne.min.x - w), M.x > 0 && (M.x = 0))
                    : L === P
                      ? ((_.x = ne.max.x + w), M.x < 0 && (M.x = 0))
                      : L === V
                        ? ((_.z = ne.min.z - w), M.z > 0 && (M.z = 0))
                        : ((_.z = ne.max.z + w), M.z < 0 && (M.z = 0));
                }
                ((F = !0), (H.hitWall = !0));
              }
            }
            if (!F) break;
          }
        }
        let D = _.y + M.y * E,
          C = w * 0.7,
          G = _.x <= WORLD_BOUNDS.quayX + C ? WORLD_BOUNDS.groundY : -50,
          j = null,
          N = 1 / 0,
          Q = T + (z ? STEP_HEIGHT : 0.08) + 1e-4;
        for (let K = 0; K < boxes.length; K++) {
          let ie = boxes[K];
          ie.bulletOnly ||
            _.x + C < ie.min.x ||
            _.x - C > ie.max.x ||
            _.z + C < ie.min.z ||
            _.z - C > ie.max.z ||
            (ie.max.y <= Q && ie.max.y > G && ((G = ie.max.y), (j = ie.surface)),
            ie.min.y >= T + S - 0.05 && ie.min.y < N && (N = ie.min.y));
        }
        return (
          M.y > 0 && D + S > N
            ? ((_.y = N - S), (M.y = 0), (H.hitCeil = !0))
            : D <= G
              ? ((_.y = G), M.y < 0 && (M.y = 0), (H.onGround = !0))
              : z && M.y <= 0 && D - G < STEP_HEIGHT
                ? ((_.y = G), (M.y = 0), (H.onGround = !0))
                : (_.y = D),
          H.onGround &&
            (H.surface =
              j ||
              (app.level && app.level.groundSurfaceAt
                ? app.level.groundSurfaceAt(_.x, _.z)
                : 'concrete')),
          H
        );
      },
      nav: {
        cell: NAV_CELL_SIZE,
        isWalkable(_, M) {
          ensureGrid();
          let E = cellIndexAt(_, M);
          return E >= 0 && !blocked[E];
        },
        findPath(_, M) {
          ensureGrid();
          let E = nearestOpenCell(_.x, _.z),
            w = nearestOpenCell(M.x, M.z);
          if (E < 0 || w < 0) return null;
          if (E === w) return [new THREE.Vector3(M.x, 0, M.z)];
          let S = findPathCells(E, w);
          if (!S) return null;
          let z = [],
            H = 0;
          for (; H < S.length - 1;) {
            let O = H + 1;
            for (let q = S.length - 1; q > H + 1; q--)
              if (hasGridLine(S[H], S[q])) {
                O = q;
                break;
              }
            (z.push(cellCenterAt(S[O])), (H = O));
          }
          return (cellIndexAt(M.x, M.z) === w && z.length && z[z.length - 1].set(M.x, 0, M.z), z);
        },
        randomPoint(_, M) {
          ensureGrid();
          for (let w = 0; w < 24; w++) {
            let S = Math.random() * 6.2832,
              z = Math.sqrt(Math.random()) * M,
              H = _.x + Math.cos(S) * z,
              O = _.z + Math.sin(S) * z,
              q = cellIndexAt(H, O);
            if (q >= 0 && !blocked[q]) return new THREE.Vector3(H, 0, O);
          }
          let E = nearestOpenCell(_.x, _.z);
          return E >= 0 ? cellCenterAt(E) : new THREE.Vector3(_.x, 0, _.z);
        },
        clearLine(_, M) {
          ensureGrid();
          let E = cellIndexAt(_.x, _.z),
            w = cellIndexAt(M.x, M.z);
          return E >= 0 && w >= 0 && hasGridLine(E, w);
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
