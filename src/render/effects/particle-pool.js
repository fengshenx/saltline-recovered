// render/effects/particle-pool.js — 从 render/effects/effects.js 按职责拆出。

import { TRACER_FIELD_NAMES } from './fx-batch.js';
import * as THREE from 'three';

/**
 * 粒子标志位 1：落到地面高度时反弹并衰减
 */
export var PARTICLE_FLAG_BOUNCE = 1;

/**
 * 粒子标志位 2：触地立即回收，用于不该留在地上的火花
 */
export var PARTICLE_FLAG_KILL_ON_GROUND = 2;

/**
 * 粒子标志位 4：触地即停不再运动
 */
export var PARTICLE_FLAG_STICK = 4;

/**
 * CPU 粒子池：位置/速度/阻力/重力/风/湍流/淡入淡出/色带/拉伸全字段并行数组，可选按相机距离排序后整批推进 billboard 批次，是烟雾、尘土、火花的共同引擎
 */
export var ParticlePool = class {
  constructor(e, t) {
    ((this.cap = e), (this.sorted = t), (this.n = 0), (this.freeTop = e));
    let n = () => new Float32Array(e);
    ((this.px = n()),
      (this.py = n()),
      (this.pz = n()),
      (this.vx = n()),
      (this.vy = n()),
      (this.vz = n()),
      (this.age = n()),
      (this.life = n()),
      (this.s0 = n()),
      (this.s1 = n()),
      (this.sk = n()),
      (this.rot = n()),
      (this.rotv = n()),
      (this.r = n()),
      (this.g = n()),
      (this.b = n()),
      (this.a = n()),
      (this.drag = n()),
      (this.grav = n()),
      (this.wind = n()),
      (this.turb = n()),
      (this.seed = n()),
      (this.fin = n()),
      (this.fout = n()),
      (this.stretch = n()),
      (this.shade = n()),
      (this.key = n()),
      (this.gy = n()),
      (this.frame = new Uint8Array(e)),
      (this.mode = new Uint8Array(e)),
      (this.flags = new Uint8Array(e)),
      (this.ramp = new Uint8Array(e)),
      (this.order = new Uint16Array(e)),
      (this.free = new Uint16Array(e)));
    for (let s = 0; s < e; s++) this.free[s] = e - 1 - s;
  }
  clear() {
    ((this.n = 0), (this.freeTop = this.cap));
    for (let e = 0; e < this.cap; e++) this.free[e] = this.cap - 1 - e;
  }
  emit(e, t, n, s, o, r, a, l, c) {
    if (this.freeTop === 0) return -1;
    let u = this.free[--this.freeTop];
    return (
      (this.order[this.n++] = u),
      (this.px[u] = e),
      (this.py[u] = t),
      (this.pz[u] = n),
      (this.vx[u] = s),
      (this.vy[u] = o),
      (this.vz[u] = r),
      (this.age[u] = -1),
      (this.life[u] = a),
      (this.s0[u] = l),
      (this.s1[u] = c),
      (this.sk[u] = 2),
      (this.rot[u] = 0),
      (this.rotv[u] = 0),
      (this.r[u] = 1),
      (this.g[u] = 1),
      (this.b[u] = 1),
      (this.a[u] = 1),
      (this.drag[u] = 0),
      (this.grav[u] = 0),
      (this.wind[u] = 0),
      (this.turb[u] = 0),
      (this.seed[u] = Math.random() * 100),
      (this.fin[u] = 0),
      (this.fout[u] = 0.5),
      (this.stretch[u] = 0.02),
      (this.shade[u] = 1),
      (this.key[u] = 0),
      (this.gy[u] = 0),
      (this.frame[u] = 0),
      (this.mode[u] = 0),
      (this.flags[u] = 0),
      (this.ramp[u] = 0),
      u
    );
  }
  update(e, t, n, s, o) {
    let { px: r, py: a, pz: l, vx: c, vy: u, vz: h, age: f, life: p, order: d, flags: v } = this,
      g = n.x,
      x = n.y,
      y = n.z,
      b = 0,
      m = this.n;
    for (let A = 0; A < m; A++) {
      let _ = d[A];
      if (f[_] < 0) f[_] = 0;
      else {
        if (((f[_] += e), f[_] >= p[_])) {
          this.free[this.freeTop++] = _;
          continue;
        }
        let M = 1 - Math.exp(-this.drag[_] * e),
          E = this.wind[_];
        ((c[_] += (s.x * E - c[_]) * M),
          (u[_] += (s.y * E - u[_]) * M),
          (h[_] += (s.z * E - h[_]) * M),
          (u[_] -= this.grav[_] * e));
        let w = this.turb[_];
        if (w > 0) {
          let H = this.seed[_];
          ((c[_] += Math.sin(a[_] * 2.3 + H + o * 1.7) * w * e),
            (h[_] += Math.cos(r[_] * 1.9 + H * 1.3 + o * 1.3) * w * e),
            (u[_] += Math.sin(l[_] * 2.1 + H * 0.7 + o * 2.1) * w * 0.4 * e));
        }
        ((r[_] += c[_] * e),
          (a[_] += u[_] * e),
          (l[_] += h[_] * e),
          (this.rot[_] += this.rotv[_] * e));
        let S = v[_],
          z = this.gy[_] + 0.012;
        if (S && a[_] < z) {
          if (S & PARTICLE_FLAG_KILL_ON_GROUND) {
            this.free[this.freeTop++] = _;
            continue;
          }
          S & PARTICLE_FLAG_BOUNCE
            ? ((a[_] = z),
              u[_] < 0 &&
                ((u[_] = -u[_] * (0.25 + (this.seed[_] % 1) * 0.3)),
                (c[_] *= 0.65),
                (h[_] *= 0.65)))
            : S & PARTICLE_FLAG_STICK && ((a[_] = z), (c[_] = u[_] = h[_] = 0));
        }
      }
      if (this.sorted) {
        let M = r[_] - g,
          E = a[_] - x,
          w = l[_] - y;
        this.key[_] = M * M + E * E + w * w;
      }
      d[b++] = _;
    }
    if (((this.n = b), this.sorted && b > 1)) {
      let A = this.key;
      for (let _ = 1; _ < b; _++) {
        let M = d[_],
          E = A[M],
          w = _ - 1;
        for (; w >= 0 && A[d[w]] < E;) ((d[w + 1] = d[w]), w--);
        d[w + 1] = M;
      }
    }
    for (let A = 0; A < b; A++) {
      let _ = d[A],
        M = f[_] / p[_],
        E = 1 - M,
        w = 1 - Math.pow(E, this.sk[_]),
        S = this.s0[_] + (this.s1[_] - this.s0[_]) * w,
        z = this.a[_],
        H = this.fin[_],
        O = this.fout[_];
      if ((H > 0 && M < H && (z *= M / H), M > O)) {
        let Q = 1 - (M - O) / (1 - O);
        z *= Q * Q * (3 - 2 * Q);
      }
      let q = this.r[_],
        U = this.g[_],
        T = this.b[_],
        D = this.ramp[_];
      if (D === 1) ((q *= Math.pow(E, 0.5)), (U *= Math.pow(E, 1.4)), (T *= Math.pow(E, 3)));
      else if (D === 2) {
        let Q = 1 - Math.pow(M, 1.6),
          K = Q * Math.sqrt(Q);
        ((q *= K),
          (U *= (0.22 + 0.78 * Math.pow(Q, 1.3)) * K),
          (T *= (0.04 + 0.96 * Math.pow(Q, 3.5)) * K));
      } else if (D === 3) {
        let Q = 0.55 + 0.45 * Math.sin(o * 17 + this.seed[_] * 9);
        ((q *= Q), (U *= Q * (0.6 + 0.4 * E)), (T *= Q * E));
      }
      let C = this.mode[_],
        G = 0,
        j = 1,
        N = 0;
      if (C === 1) {
        let Q = this.stretch[_];
        ((G = c[_] * Q), (j = u[_] * Q), (N = h[_] * Q));
      }
      if (
        !t.push(
          r[_],
          a[_],
          l[_],
          S,
          G,
          j,
          N,
          this.rot[_],
          q,
          U,
          T,
          z,
          this.frame[_],
          C,
          M,
          this.shade[_],
        )
      )
        break;
    }
  }
};

/**
 * 曳光弹池：把每发子弹的线段按弹速推进，画成亮核加淡拖尾的两段加色光带，首帧随机跳跃避免同步
 */
export var TracerPool = class {
  constructor(e = 48) {
    ((this.cap = e), (this.n = 0));
    let t = () => new Float32Array(e);
    ((this.fx = t()),
      (this.fy = t()),
      (this.fz = t()),
      (this.dx = t()),
      (this.dy = t()),
      (this.dz = t()),
      (this.dist = t()),
      (this.speed = t()),
      (this.trav = t()),
      (this.len = t()),
      (this.width = t()),
      (this.r = t()),
      (this.g = t()),
      (this.b = t()),
      (this.frames = new Uint8Array(e)));
  }
  clear() {
    this.n = 0;
  }
  add(e, t, n, s, o, r, a) {
    let l = this.n;
    l >= this.cap ? (l = 0) : this.n++;
    let c = t.x - e.x,
      u = t.y - e.y,
      h = t.z - e.z,
      f = Math.sqrt(c * c + u * u + h * h);
    if (f < 0.001) {
      l === this.n - 1 && this.n--;
      return;
    }
    ((this.fx[l] = e.x),
      (this.fy[l] = e.y),
      (this.fz[l] = e.z),
      (this.dx[l] = c / f),
      (this.dy[l] = u / f),
      (this.dz[l] = h / f),
      (this.dist[l] = f),
      (this.speed[l] = r),
      (this.trav[l] = 0),
      (this.len[l] = Math.min(Math.max(r * 0.022, 2), 7)),
      (this.width[l] = a),
      (this.r[l] = n),
      (this.g[l] = s),
      (this.b[l] = o),
      (this.frames[l] = 0));
  }
  update(e, t, n, s) {
    let o = this.n;
    for (let r = 0; r < o; r++) {
      let a = this.speed[r],
        l = this.dist[r],
        c = this.len[r];
      this.frames[r] === 0
        ? (this.trav[r] = Math.min(l, a * Math.max(e, 0.008) * (0.35 + Math.random() * 0.4)))
        : (this.trav[r] += a * e);
      let u = Math.min(this.trav[r], l),
        h = Math.max(0, this.trav[r] - c);
      if (h >= l) {
        if (this.frames[r] >= 2) {
          if ((o--, r !== o)) {
            for (let E of TRACER_FIELD_NAMES) this[E][r] = this[E][o];
            this.frames[r] = this.frames[o];
          }
          r--;
          continue;
        }
        ((h = Math.max(0, l - c * 0.5)), (u = l));
      }
      this.frames[r] = Math.min(250, this.frames[r] + 1);
      let f = (u + h) * 0.5,
        p = Math.max(u - h, 0.05),
        d = this.dx[r],
        v = this.dy[r],
        g = this.dz[r],
        x = this.width[r],
        y = this.fx[r] + d * f,
        b = this.fy[r] + v * f,
        m = this.fz[r] + g * f,
        A = this.r[r],
        _ = this.g[r],
        M = this.b[r];
      (t.push(y, b, m, x, d * p, v * p, g * p, 0, A, _, M, 1, n, 1, 0, 5),
        t.push(
          y,
          b,
          m,
          x * 6,
          d * p * 1.05,
          v * p * 1.05,
          g * p * 1.05,
          0,
          A * 0.04,
          _ * 0.032,
          M * 0.028,
          1,
          n,
          1,
          0,
          28,
        ),
        t.push(
          this.fx[r] + d * u,
          this.fy[r] + v * u,
          this.fz[r] + g * u,
          x * 5,
          0,
          1,
          0,
          0,
          A * 0.2,
          _ * 0.16,
          M * 0.12,
          1,
          s,
          0,
          0,
          1,
        ));
    }
    this.n = o;
  }
};

/**
 * fx 模块统一的随机源引用，集中一处便于替换成可复现的伪随机
 */
export var fxRandom = Math.random;

/**
 * 区间随机数，特效参数抖动统一走它以便将来换成种子随机
 */
export var randRange = (min, max) => min + (max - min) * Math.random();

/**
 * fx 系统复用的临时向量 A，供 emit 系列避免每帧分配
 */
export var FX_SCRATCH_VEC_A = new THREE.Vector3();

/**
 * fx 系统复用的临时向量 B（方向类）
 */
export var FX_SCRATCH_VEC_B = new THREE.Vector3();

/**
 * fx 系统复用的临时向量 C
 */
export var FX_SCRATCH_VEC_C = new THREE.Vector3();

/**
 * fx 系统复用的临时向量 D
 */
export var FX_SCRATCH_VEC_D = new THREE.Vector3();

/**
 * fx 系统复用的临时向量 E
 */
export var FX_SCRATCH_VEC_E = new THREE.Vector3();

/**
 * fx 系统复用的临时向量 F
 */
export var FX_SCRATCH_VEC_F = new THREE.Vector3();
