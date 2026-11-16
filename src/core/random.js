// core/random.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

/**
 * mulberry32 系种子随机数：附带 range/int/pick/sign 与 fork（派生子流），让关卡布置、涂鸦与噪声在给定种子下可复现
 */
export function createRng(seedValue = 1337) {
  let rngState = seedValue >>> 0,
    nextRandom = () => {
      ((rngState |= 0), (rngState = (rngState + 1831565813) | 0));
      let mixedHash = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
      return (
        (mixedHash =
          (mixedHash + Math.imul(mixedHash ^ (mixedHash >>> 7), 61 | mixedHash)) ^ mixedHash),
        ((mixedHash ^ (mixedHash >>> 14)) >>> 0) / 4294967296
      );
    };
  return (
    (nextRandom.range = (mixValue, rangeMax) => mixValue + (rangeMax - mixValue) * nextRandom()),
    (nextRandom.int = (mixValue, rangeMax) =>
      Math.floor(mixValue + (rangeMax - mixValue + 1) * nextRandom())),
    (nextRandom.pick = (mixValue) => mixValue[Math.floor(nextRandom() * mixValue.length)]),
    (nextRandom.sign = () => (nextRandom() < 0.5 ? -1 : 1)),
    (nextRandom.fork = () => createRng(Math.floor(nextRandom() * 4294967296))),
    nextRandom
  );
}

/**
 * 经典 sin 点乘取小数的三维哈希，用于给顶点颜色加确定性噪声，同一坐标永远同一值
 */
export function hash3(x, y, z) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  return ((n = Math.imul(n ^ (n >>> 13), 1274126177)), ((n ^ (n >>> 16)) >>> 0) / 4294967295);
}

/**
 * 线性同余伪随机数发生器工厂；同种子必得同序列，保证程序化场景每次生成一致
 */
export function createSeededRng(seed) {
  let e = seed >>> 0;
  return () => ((e = (Math.imul(e, 1664525) + 1013904223) >>> 0), e / 4294967296);
}

/**
 * 二维整数哈希，取 [0,1) 值；船体分块配色、锈斑分布按它在同坐标下稳定复现
 */
export var hash2 = (a, b) => {
  let t = Math.imul(a + 31, 374761393) ^ Math.imul(b + 17, 668265263);
  return ((t = Math.imul(t ^ (t >>> 13), 1274126177)), ((t ^ (t >>> 16)) >>> 0) / 4294967295);
};

/**
 * 整数版三维哈希（先取整再混算），地形噪声的格点值来源
 */
export function hashInt3(x, y, seed) {
  let n =
    Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  return ((n = Math.imul(n ^ (n >>> 13), 1274126177)), ((n ^ (n >>> 16)) >>> 0) / 4294967296);
}

/**
 * 生成带 4096 项置换表的值噪声：出 noise/fbm/rnd 三件，让同一张程序化纹理里噪声采样与随机序列共享可复现的种子
 */
export function createValueNoise(seed) {
  let permTable = new Float32Array(4096),
    rngState = seed >>> 0,
    nextRandom = () => {
      ((rngState |= 0), (rngState = (rngState + 1831565813) | 0));
      let l = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
      return (
        (l = (l + Math.imul(l ^ (l >>> 7), 61 | l)) ^ l),
        ((l ^ (l >>> 14)) >>> 0) / 4294967296
      );
    };
  for (let noiseX = 0; noiseX < 4096; noiseX++) permTable[noiseX] = nextRandom();
  let r = (l, c) => {
    let u = Math.floor(l),
      h = Math.floor(c),
      f = l - u,
      p = c - h;
    ((f = f * f * (3 - 2 * f)), (p = p * p * (3 - 2 * p)));
    let d = u & 63,
      v = (u + 1) & 63,
      g = (h & 63) * 64,
      x = ((h + 1) & 63) * 64,
      y = permTable[g + d],
      b = permTable[g + v],
      m = permTable[x + d],
      A = permTable[x + v];
    return y + (b - y) * f + (m - y + (y - b - m + A) * f) * p;
  };
  return {
    noise: r,
    fbm: (l, c, u = 4) => {
      let h = 0,
        f = 0.5,
        p = 0;
      for (let d = 0; d < u; d++)
        ((h += r(l, c) * f), (p += f), (l = l * 2.03 + 17.1), (c = c * 2.03 + 9.7), (f *= 0.5));
      return h / p;
    },
    rnd: nextRandom,
  };
}

/**
 * 一维确定性哈希，给腕带每一圈做随机色差
 */
export var hash1 = (n) => {
  let e = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return e - Math.floor(e);
};
