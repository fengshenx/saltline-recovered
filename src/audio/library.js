// audio/library.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import { MUSIC_TIMING } from './music.js';

import {
  TAU,
  allocSamples,
  applyBiquad,
  applyEnvelope,
  applySweptBiquad,
  biquadCoeffs,
  fadeBufferEdges,
  fnv1aHash,
  makeDecayEnv,
  makeExpSweep,
  makeFilteredLoop,
  makeFilteredNoise,
  makeGrainBurst,
  makeModalResonance,
  makePitchGlide,
  makeSeamlessLoop,
  makeSweptSine,
  makeWhiteNoise,
  midiToFreq,
  mixBufferAt,
  mixBufferWrapped,
  peakAmplitude,
  quantizeTo,
  randBetween,
  scaleBuffer,
  softClip,
  sumLayers,
} from './synthesis.js';

import { ao } from '../misc.js';

/**
 * pac9 步枪单发配方：爆音、低频冲击、机件撞击与尾腔共鸣分层叠加，4 个变体靠微失谐和共振峰偏移区分，避免连发听起来像循环。
 */
function synthRifleShot(sampleRate, rand, variant) {
  let pitchRatio = [1, 0.955, 1.045, 0.985][variant & 3],
    brightnessScale = [1, 1.12, 0.9, 1.05][variant & 3],
    outBuffer = allocSamples(sampleRate, 0.32);
  (mixBufferAt(
    outBuffer,
    makeFilteredNoise(sampleRate, rand, 0.012, 0.0011, {
      hp: 2600 * brightnessScale,
    }),
    0,
    2.6,
    sampleRate,
  ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.02, 0.003, {
        hp: 1200,
        lp: 8e3,
      }),
      2e-4,
      1.2,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeSweptSine(sampleRate, 0.11, 160 * pitchRatio, 45 * pitchRatio, 0.024, 0.03, 0.003),
      0,
      0.62,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.22, 0.03, {
        hp: 300 * pitchRatio,
        lp: 2500 * pitchRatio * brightnessScale,
        att: 0.0012,
      }),
      0,
      1.5,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.09, 0.016, {
        bp: 760 * pitchRatio,
        q: 2.2,
        att: 0.001,
      }),
      0,
      0.9,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.16, 0.04, {
        hp: 4800,
      }),
      0.001,
      0.34,
      sampleRate,
    ));
  let mechDelay = 0.035 + (variant - 1.5) * 0.0015;
  return (
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.05,
        [
          [2150 * pitchRatio, 0.007, 1],
          [3420 * pitchRatio, 0.006, 0.7],
          [5230, 0.004, 0.5],
          [880 * pitchRatio, 0.012, 0.5],
        ],
        rand,
      ),
      mechDelay,
      0.26,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.012, 0.002, {
        bp: 3100,
        q: 1.2,
      }),
      mechDelay,
      0.3,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.05,
        [
          [1780 * pitchRatio, 0.008, 1],
          [2890 * pitchRatio, 0.006, 0.6],
          [640 * pitchRatio, 0.02, 0.5],
        ],
        rand,
      ),
      mechDelay + 0.027,
      0.17,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.01, 0.002, {
        bp: 2400,
        q: 1.2,
      }),
      mechDelay + 0.027,
      0.16,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.2,
        [
          [712 * pitchRatio, 0.05, 1],
          [1466 * pitchRatio, 0.03, 0.4],
        ],
        rand,
      ),
      mechDelay + 0.03,
      0.035,
      sampleRate,
    ),
    softClip(scaleBuffer(outBuffer, 0.46), 1.5)
  );
}

/**
 * 步枪尾音（室外开阔反射）配方：多组共振峰加延迟高通噪声模拟港口建筑回响，产出 2 个变体交替使用。
 */
function synthRifleTailOutdoor(sampleRate, rand, indoor) {
  let buildVariant = (hissLoop) => {
      let bpLoop = ao(hissLoop),
        bufLen = allocSamples(sampleRate, 1.55),
        mixBuf = indoor
          ? [
              [0.058, 0.5, 4200],
              [0.097, 0.4, 3300],
              [0.139, 0.28, 2500],
              [0.176, 0.2, 1900],
              [0.262, 0.1, 1300],
            ]
          : [
              [0.066, 0.52, 4600],
              [0.088, 0.34, 3600],
              [0.124, 0.3, 2700],
              [0.169, 0.22, 2e3],
              [0.231, 0.12, 1400],
            ];
      for (let [dropPos, dropLen, dropAmp] of mixBuf)
        mixBufferAt(
          bufLen,
          makeFilteredNoise(sampleRate, bpLoop, 0.09, 0.016, {
            hp: 420,
            lp: dropAmp,
          }),
          dropPos + randBetween(bpLoop, -0.004, 0.004),
          dropLen * randBetween(bpLoop, 0.8, 1.1),
          sampleRate,
        );
      let dropBuf = makeWhiteNoise(sampleRate, 1.5, bpLoop);
      (applySweptBiquad(dropBuf, 'lp', makeExpSweep(3400, 380, 0.6), 0.6, sampleRate),
        applyBiquad(dropBuf, 'hp', 130, 0.7, sampleRate),
        mixBufferAt(
          bufLen,
          applyEnvelope(dropBuf, sampleRate, makeDecayEnv(0.3, 0.05)),
          0.03,
          0.55,
          sampleRate,
        ));
      let workBuf = makeWhiteNoise(sampleRate, 1.2, bpLoop);
      return (
        applyBiquad(workBuf, 'lp', 150, 0.7, sampleRate),
        mixBufferAt(
          bufLen,
          applyEnvelope(workBuf, sampleRate, makeDecayEnv(0.26, 0.03)),
          0.02,
          0.9,
          sampleRate,
        ),
        bufLen
      );
    },
    baseSeed = Math.floor(rand() * 1e9);
  return [buildVariant(baseSeed), buildVariant(baseSeed + 77)];
}

/**
 * 步枪尾音（室内近距离）配方：更短更闷的多重反射，逐段叠加谐波峰模拟近墙回弹；用生成器分帧烘焙以免阻塞主线程。
 */
function* synthRifleTailIndoor(sampleRate, rand, indoor) {
  let buildTail = function* (hissLoop) {
      let bpLoop = ao(hissLoop),
        bufLen = allocSamples(sampleRate, 2.3),
        mixBuf = makeWhiteNoise(sampleRate, 2.25, bpLoop);
      (applySweptBiquad(mixBuf, 'lp', makeExpSweep(2400, 260, 0.5), 0.7, sampleRate),
        mixBufferAt(
          bufLen,
          applyEnvelope(mixBuf, sampleRate, makeDecayEnv(0.42, 0.012)),
          0.008,
          0.6,
          sampleRate,
        ));
      for (let [workBuf, dropPos] of [
        [54, 1],
        [81, 0.8],
        [117, 0.6],
        [163, 0.45],
        [228, 0.3],
      ]) {
        let dropLen = makeWhiteNoise(sampleRate, 2.2, bpLoop);
        (applyBiquad(dropLen, 'bp', workBuf * (indoor ? 1.06 : 1), 9, sampleRate),
          mixBufferAt(
            bufLen,
            applyEnvelope(dropLen, sampleRate, makeDecayEnv(0.5, 0.02)),
            0.01,
            dropPos * 2.4,
            sampleRate,
          ),
          yield);
      }
      let dropBuf = indoor ? 0.051 : 0.044;
      for (let workBuf = 1; workBuf < 9; workBuf++)
        mixBufferAt(
          bufLen,
          makeFilteredNoise(sampleRate, bpLoop, 0.05, 0.009, {
            hp: 500,
            lp: 3800 / (1 + workBuf * 0.35),
          }),
          dropBuf * workBuf + randBetween(bpLoop, -0.003, 0.003),
          0.42 * Math.pow(0.74, workBuf),
          sampleRate,
        );
      return bufLen;
    },
    seed = Math.floor(rand() * 1e9);
  return [yield* buildTail(seed), yield* buildTail(seed + 131)];
}

/**
 * 空仓击锤声：高频机件咔哒加低频枪身空响，是弹匣打空时唯一的反馈。
 */
function synthRifleDryFire(sampleRate, rand) {
  let buffer = allocSamples(sampleRate, 0.13);
  return (
    mixBufferAt(
      buffer,
      makeModalResonance(
        sampleRate,
        0.05,
        [
          [2840, 0.004, 1],
          [4130, 0.004, 0.7],
          [6320, 0.003, 0.5],
          [1210, 0.008, 0.4],
        ],
        rand,
      ),
      0,
      0.7,
      sampleRate,
    ),
    mixBufferAt(
      buffer,
      makeFilteredNoise(sampleRate, rand, 0.006, 0.0012, {
        hp: 2e3,
      }),
      0,
      0.6,
      sampleRate,
    ),
    mixBufferAt(
      buffer,
      makeModalResonance(
        sampleRate,
        0.08,
        [
          [930, 0.018, 1],
          [1870, 0.012, 0.5],
        ],
        rand,
      ),
      0.016,
      0.16,
      sampleRate,
    ),
    mixBufferAt(
      buffer,
      makeFilteredNoise(sampleRate, rand, 0.004, 0.001, {
        hp: 3e3,
      }),
      0.018,
      0.2,
      sampleRate,
    ),
    buffer
  );
}

/**
 * 带通噪声扫频加梳状幅度起伏的金属滑动声，作为换弹时弹匣与枪机摩擦的共用底层音色。
 */
function synthMechanicalSlide(sr, rand, seconds, fromHz, toHz, ripple) {
  let buf = makeWhiteNoise(sr, seconds, rand);
  applySweptBiquad(buf, 'bp', makeExpSweep(fromHz, toHz), 1.6, sr);
  let env = 0.5,
    target = 0.5;
  for (let sampleIdx = 0; sampleIdx < buf.length; sampleIdx++) {
    (sampleIdx % Math.round(sr / ripple) === 0 && (target = 0.25 + rand() * 0.75),
      (env += (target - env) * 0.02));
    let progress = sampleIdx / buf.length;
    buf[sampleIdx] *= env * Math.sin(Math.PI * Math.pow(progress, 0.7));
  }
  return buf;
}

/**
 * 退弹匣：锁扣金属撞击、弹匣滑出与空腔共鸣，让换弹动作听得出阶段。
 */
function synthMagOut(sampleRate, rand) {
  let outBuffer = allocSamples(sampleRate, 0.46);
  return (
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.03,
        [
          [3300, 0.004, 1],
          [5100, 0.003, 0.6],
        ],
        rand,
      ),
      0.004,
      0.45,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.005, 0.001, {
        hp: 2500,
      }),
      0.004,
      0.35,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      synthMechanicalSlide(sampleRate, rand, 0.17, 1700, 3400, 190),
      0.03,
      0.5,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.06, 0.012, {
        lp: 950,
      }),
      0.2,
      0.8,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.12,
        [
          [415, 0.03, 1],
          [1140, 0.018, 0.6],
          [2290, 0.01, 0.4],
          [3470, 0.006, 0.25],
        ],
        rand,
      ),
      0.2,
      0.42,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.08, 0.02, {
        bp: 2600,
        q: 0.8,
      }),
      0.215,
      0.14,
      sampleRate,
    ),
    outBuffer
  );
}

/**
 * 插弹匣：滑动摩擦、到位锁扣与余震，与退弹匣音色区分以便玩家判断换弹进度。
 */
function synthMagIn(sampleRate, rand) {
  let outBuffer = allocSamples(sampleRate, 0.5);
  return (
    mixBufferAt(
      outBuffer,
      synthMechanicalSlide(sampleRate, rand, 0.14, 1250, 2900, 240),
      0,
      0.55,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.03,
        [
          [2600, 0.004, 1],
          [4300, 0.003, 0.5],
        ],
        rand,
      ),
      0.05,
      0.2,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeSweptSine(sampleRate, 0.07, 190, 88, 0.02, 0.022),
      0.15,
      0.8,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.05, 0.008, {
        lp: 1600,
      }),
      0.15,
      0.8,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.1,
        [
          [655, 0.024, 1],
          [1710, 0.014, 0.6],
          [3120, 0.008, 0.4],
        ],
        rand,
      ),
      0.15,
      0.4,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.04,
        [
          [3650, 0.005, 1],
          [5600, 0.004, 0.6],
          [2100, 0.007, 0.5],
        ],
        rand,
      ),
      0.187,
      0.42,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.005, 0.001, {
        hp: 3e3,
      }),
      0.187,
      0.36,
      sampleRate,
    ),
    outBuffer
  );
}

/**
 * 拉推枪机：金属刮擦、到位撞击与尾部弹簧余响，收尾换弹动作。
 */
function synthBoltCycle(sampleRate, rand) {
  let outBuffer = allocSamples(sampleRate, 0.38);
  (mixBufferAt(
    outBuffer,
    makeModalResonance(
      sampleRate,
      0.03,
      [
        [2900, 0.005, 1],
        [4600, 0.004, 0.6],
      ],
      rand,
    ),
    0,
    0.3,
    sampleRate,
  ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.03, 0.01, {
        bp: 2200,
        q: 0.8,
      }),
      0.004,
      0.25,
      sampleRate,
    ));
  let hitAt = 0.03;
  return (
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.02, 0.004, {
        hp: 1200,
      }),
      hitAt,
      1,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeSweptSine(sampleRate, 0.06, 230, 105, 0.012, 0.018),
      hitAt,
      0.8,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.15,
        [
          [1310, 0.03, 1],
          [2460, 0.024, 0.8],
          [3920, 0.016, 0.6],
          [5640, 0.01, 0.45],
          [7900, 0.006, 0.3],
        ],
        rand,
      ),
      hitAt,
      0.36,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.3,
        [
          [722, 0.075, 1],
          [1451, 0.05, 0.35],
        ],
        rand,
      ),
      hitAt + 0.002,
      0.1,
      sampleRate,
    ),
    softClip(outBuffer, 1.3)
  );
}

/**
 * 弹壳落地弹跳：多次高频金属小撞击，强度与音高逐次衰减，反馈地面材质与距离感。
 */
function synthShellBounce(sampleRate, rand, variant) {
  let outBuffer = allocSamples(sampleRate, 0.55),
    pitchScale = [1, 1.09, 0.93][variant % 3],
    offsetSec = 0,
    gain = 1,
    bounceCount = 2 + (variant !== 1 ? 1 : 0);
  for (let bounceIndex = 0; bounceIndex < bounceCount; bounceIndex++) {
    let pitch = pitchScale * randBetween(rand, 0.96, 1.05);
    (mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.22,
        [
          [4180 * pitch, randBetween(rand, 0.03, 0.055), 1],
          [6830 * pitch, 0.03, 0.7],
          [9760 * pitch, 0.02, 0.5],
          [11900 * pitch, 0.012, 0.3],
          [2470 * pitch, 0.012, 0.3],
        ],
        rand,
      ),
      offsetSec,
      gain * 0.5,
      sampleRate,
    ),
      mixBufferAt(
        outBuffer,
        makeFilteredNoise(sampleRate, rand, 0.004, 8e-4, {
          hp: 3500,
        }),
        offsetSec,
        gain * 0.5,
        sampleRate,
      ),
      (offsetSec += randBetween(rand, 0.085, 0.15) * (bounceIndex ? 0.75 : 1)),
      (gain *= randBetween(rand, 0.45, 0.62)));
  }
  return outBuffer;
}

/**
 * 混凝土脚步：低频脚步冲量加随机砂砾摩擦层，是最常听到的移动反馈。
 */
function synthStepConcrete(sr, rand, variant) {
  let buf = allocSamples(sr, 0.3),
    pitchScale = [1, 1.07, 0.94, 1.03][variant & 3];
  (mixBufferAt(
    buf,
    makeSweptSine(sr, 0.06, 112 * pitchScale, 58 * pitchScale, 0.018, 0.02, 0.002),
    0,
    0.75,
    sr,
  ),
    mixBufferAt(
      buf,
      makeFilteredNoise(sr, rand, 0.06, 0.016, {
        lp: 720 * pitchScale,
      }),
      0,
      0.9,
      sr,
    ),
    mixBufferAt(
      buf,
      makeFilteredNoise(sr, rand, 0.1, 0.028, {
        bp: 2500 * pitchScale,
        q: 0.7,
        att: 0.004,
      }),
      0.012,
      0.22,
      sr,
    ));
  let gravelNoise = makeFilteredNoise(sr, rand, 0.2, 0.05, {
      hp: 3800,
      att: 0.01,
    }),
    grainGain = 1;
  for (let sampleIdx = 0; sampleIdx < gravelNoise.length; sampleIdx++)
    (sampleIdx % 70 === 0 && (grainGain = 0.3 + rand() * 0.7),
      (gravelNoise[sampleIdx] *= grainGain));
  return (mixBufferAt(buf, gravelNoise, 0.02, 0.16, sr), buf);
}

/**
 * 脚步通用内核：落地冲量加颗粒摩擦，按 scale 调软硬与湿度，供水面脚步和击水复用。
 */
function synthFootstepKernel(sampleRate, rand, seconds, scale) {
  let outBuffer = allocSamples(sampleRate, seconds),
    noiseBuf = makeWhiteNoise(sampleRate, seconds * 0.9, rand);
  (applySweptBiquad(noiseBuf, 'bp', makeExpSweep(1500, 520), 0.8, sampleRate),
    mixBufferAt(
      outBuffer,
      applyEnvelope(noiseBuf, sampleRate, makeDecayEnv(0.085 * scale, 0.007)),
      0,
      0.9,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, seconds * 0.8, 0.07 * scale, {
        hp: 3e3,
        att: 0.012,
      }),
      0.01,
      0.25,
      sampleRate,
    ));
  let gritCount = Math.round(5 * scale);
  for (let gritIndex = 0; gritIndex < gritCount; gritIndex++) {
    let gritFreq = randBetween(rand, 500, 1700);
    mixBufferAt(
      outBuffer,
      makePitchGlide(
        sampleRate,
        randBetween(rand, 0.008, 0.02),
        gritFreq,
        gritFreq * randBetween(rand, 1.3, 1.9),
      ),
      randBetween(rand, 0.03, seconds * 0.6),
      randBetween(rand, 0.1, 0.3),
      sampleRate,
    );
  }
  return outBuffer;
}

/**
 * 踩水脚步：脚步内核加水层拍击与气泡细节，走过积水时切换到此音色。
 */
function synthStepWater(sr, rand, variant) {
  let n = synthFootstepKernel(sr, rand, 0.46, 1 + variant * 0.08);
  return (mixBufferAt(n, makeSweptSine(sr, 0.06, 100, 55, 0.02, 0.02, 0.002), 0, 0.5, sr), n);
}

/**
 * 金属格栅与钢板脚步：脚步内核加板面共振余音，区分甲板与水泥地。
 */
function synthStepMetal(sampleRate, rand, variant) {
  let outBuffer = allocSamples(sampleRate, 0.38),
    pitchScale = [1, 1.08, 0.92][variant % 3];
  return (
    mixBufferAt(
      outBuffer,
      makeSweptSine(sampleRate, 0.06, 120, 62, 0.018, 0.02, 0.002),
      0,
      0.6,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.04, 0.008, {
        lp: 2400,
      }),
      0,
      0.6,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.36,
        [
          [178 * pitchScale, 0.09, 1],
          [412 * pitchScale, 0.075, 0.8],
          [733 * pitchScale, 0.06, 0.55],
          [1214 * pitchScale, 0.045, 0.4],
          [1958 * pitchScale, 0.03, 0.3],
          [3130 * pitchScale, 0.016, 0.18],
        ],
        rand,
      ),
      0.001,
      0.3,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.08, 0.02, {
        bp: 3e3,
        q: 0.8,
        att: 0.003,
      }),
      0.01,
      0.1,
      sampleRate,
    ),
    outBuffer
  );
}

/**
 * 落地：低频冲击、装备杂音与多个高频撞击点，按下落速度决定响度。
 */
function synthLand(sampleRate, rand) {
  let outBuffer = allocSamples(sampleRate, 0.45);
  (mixBufferAt(
    outBuffer,
    makeSweptSine(sampleRate, 0.14, 124, 44, 0.03, 0.045, 0.002),
    0,
    1,
    sampleRate,
  ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.14, 0.035, {
        lp: 520,
      }),
      0,
      1,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.2, 0.06, {
        bp: 1500,
        q: 0.7,
        att: 0.01,
      }),
      0.01,
      0.16,
      sampleRate,
    ));
  for (let impactAt of [0.022, 0.05, 0.088])
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.012, 0.003, {
        bp: randBetween(rand, 2200, 4200),
        q: 2,
      }),
      impactAt,
      randBetween(rand, 0.1, 0.22),
      sampleRate,
    );
  return (
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.2, 0.05, {
        hp: 3500,
        att: 0.01,
      }),
      0.015,
      0.1,
      sampleRate,
    ),
    softClip(outBuffer, 1.2)
  );
}

/**
 * 起跳：短促的衣物摩擦与蹬地声，与落地声成对出现才有重量感。
 */
function synthJump(sampleRate, rand) {
  let outBuffer = allocSamples(sampleRate, 0.26);
  return (
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.2, 0.05, {
        bp: 900,
        q: 0.7,
        att: 0.02,
      }),
      0,
      0.6,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.1, 0.025, {
        bp: 2600,
        q: 0.8,
        att: 0.004,
      }),
      0.005,
      0.35,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeSweptSine(sampleRate, 0.05, 95, 60, 0.02, 0.018, 0.003),
      0,
      0.4,
      sampleRate,
    ),
    outBuffer
  );
}

/**
 * 玩家受伤：闷钝的低频肉体冲击，配合画面受击与低通滤镜传达受伤程度。
 */
function synthHurt(sampleRate, rand) {
  let outBuf = allocSamples(sampleRate, 0.5);
  return (
    mixBufferAt(
      outBuf,
      makeSweptSine(sampleRate, 0.25, 92, 38, 0.04, 0.06, 0.0015),
      0,
      1.1,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.2, 0.04, {
        lp: 320,
      }),
      0,
      1.2,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.06, 0.01, {
        bp: 820,
        q: 1,
      }),
      0,
      0.55,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.03, 0.004, {
        hp: 1800,
        lp: 5e3,
      }),
      0,
      0.2,
      sampleRate,
    ),
    softClip(outBuf, 1.6)
  );
}

/**
 * 爆炸后耳鸣：三个近 4kHz 正弦缓慢衰减，短暂提示听力受损并强化爆炸冲击。
 */
function synthEarRing(sampleRate) {
  let outBuffer = allocSamples(sampleRate, 2.4);
  for (let sampleIdx = 0; sampleIdx < outBuffer.length; sampleIdx++) {
    let sampleTime = sampleIdx / sampleRate;
    outBuffer[sampleIdx] =
      (Math.sin(TAU * 3150 * sampleTime) +
        0.7 * Math.sin(TAU * 4013 * sampleTime + 1) +
        0.35 * Math.sin(TAU * 5310 * sampleTime + 2)) *
      (1 - Math.exp(-sampleTime / 0.12)) *
      Math.exp(-sampleTime / 0.55);
  }
  return outBuffer;
}

/**
 * 金属弹着：非谐和（1.58 倍频程堆叠）模态共振簇，刻意不平整才像真实钢板。
 */
function synthImpactMetal(sampleRate, rand, variant) {
  let outBuffer = allocSamples(sampleRate, 0.5),
    baseFreq = [640, 880, 745][variant % 3] * randBetween(rand, 0.97, 1.03);
  return (
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.015, 0.003, {
        hp: 1500,
      }),
      0,
      1,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.04, 0.008, {
        lp: 1800,
      }),
      0,
      0.6,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.48,
        [1, 1.58, 2.24, 2.92, 3.71, 4.93, 6.31, 8.1].map((r, a) => [
          baseFreq * r,
          0.13 / (1 + a * 0.55),
          1 / (1 + a * 0.5),
        ]),
        rand,
      ),
      5e-4,
      0.42,
      sampleRate,
    ),
    outBuffer
  );
}

/**
 * 混凝土弹着：钝闷的中频冲击加粉尘颗粒噪点，是非金属表面的默认弹着音。
 */
function synthImpactConcrete(sampleRate, rand, variant) {
  let outBuffer = allocSamples(sampleRate, 0.36),
    variantScale = [1, 1.1, 0.9][variant % 3];
  return (
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.06, 0.013, {
        lp: 950 * variantScale,
      }),
      0,
      1.1,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeSweptSine(sampleRate, 0.05, 150 * variantScale, 70, 0.012, 0.016),
      0,
      0.6,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.012, 0.002, {
        hp: 2e3,
      }),
      0,
      0.6,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeFilteredNoise(sampleRate, rand, 0.12, 0.024, {
        bp: 3500 * variantScale,
        q: 0.7,
      }),
      0.003,
      0.3,
      sampleRate,
    ),
    mixBufferAt(
      outBuffer,
      makeGrainBurst(sampleRate, rand, 0.34, 16, {
        from: 0.03,
        fall: 1.8,
        hp: 1800,
        ampFall: 0.1,
      }),
      0,
      0.35,
      sampleRate,
    ),
    outBuffer
  );
}

/**
 * 木质弹着：中频木腔共振加碎屑颗粒，听起来比混凝土更空。
 */
function synthImpactWood(sampleRate, rand, variant) {
  let buffer = allocSamples(sampleRate, 0.26),
    pitchScale = variant ? 1.14 : 1;
  return (
    mixBufferAt(
      buffer,
      makeModalResonance(
        sampleRate,
        0.2,
        [
          [238 * pitchScale, 0.03, 1],
          [512 * pitchScale, 0.022, 0.8],
          [893 * pitchScale, 0.016, 0.6],
          [1410 * pitchScale, 0.01, 0.4],
        ],
        rand,
      ),
      0,
      0.6,
      sampleRate,
    ),
    mixBufferAt(
      buffer,
      makeFilteredNoise(sampleRate, rand, 0.03, 0.006, {
        lp: 2100,
      }),
      0,
      0.8,
      sampleRate,
    ),
    mixBufferAt(
      buffer,
      makeFilteredNoise(sampleRate, rand, 0.01, 0.002, {
        hp: 3e3,
      }),
      0,
      0.5,
      sampleRate,
    ),
    mixBufferAt(
      buffer,
      makeGrainBurst(sampleRate, rand, 0.2, 6, {
        from: 0.01,
        fall: 2,
        bp: 2600,
        q: 1.5,
      }),
      0,
      0.3,
      sampleRate,
    ),
    buffer
  );
}

/**
 * 水面弹着：水花飞溅加快速衰减的低频拍击，命中积水或海面时使用。
 */
function synthImpactWater(sr, rand, variant) {
  let n = synthFootstepKernel(sr, rand, 0.5, 0.8 + variant * 0.2);
  return (mixBufferAt(n, makePitchGlide(sr, 0.035, 420, 1150), 0, 0.5, sr), n);
}

/**
 * 命中敌人：湿润软组织的闷击加低频冲击，让玩家闭眼也能分辨是否打中。
 */
function synthImpactFlesh(sampleRate, rand, variant) {
  let outBuf = allocSamples(sampleRate, 0.3),
    pitchScale = [1, 1.12, 0.9][variant % 3];
  (mixBufferAt(
    outBuf,
    makeFilteredNoise(sampleRate, rand, 0.03, 0.007, {
      hp: 4e3,
    }),
    0,
    0.9,
    sampleRate,
  ),
    mixBufferAt(
      outBuf,
      makeModalResonance(
        sampleRate,
        0.12,
        [
          [2920 * pitchScale, 0.022, 1],
          [4730 * pitchScale, 0.018, 0.8],
          [7310 * pitchScale, 0.012, 0.6],
          [1180 * pitchScale, 0.03, 0.5],
        ],
        rand,
      ),
      0,
      0.4,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.05, 0.012, {
        bp: 320 * pitchScale,
        q: 1.5,
      }),
      0,
      0.9,
      sampleRate,
    ));
  let tickBuf = makeWhiteNoise(sampleRate, 0.06, rand);
  applyBiquad(tickBuf, 'bp', 2400, 1, sampleRate);
  for (let sampIdx = 0; sampIdx < tickBuf.length; sampIdx++) {
    let timeSec = sampIdx / sampleRate;
    tickBuf[sampIdx] *= (Math.sin(TAU * 118 * timeSec) > 0.2 ? 1 : 0.1) * Math.exp(-timeSec / 0.02);
  }
  return (
    mixBufferAt(outBuf, tickBuf, 0.004, 0.5, sampleRate),
    mixBufferAt(
      outBuf,
      makeGrainBurst(sampleRate, rand, 0.28, 10, {
        from: 0.02,
        fall: 1.6,
        hp: 5e3,
        ampFall: 0.08,
      }),
      0,
      0.3,
      sampleRate,
    ),
    outBuf
  );
}

/**
 * 玻璃弹着：随机高频碎片的密集簇，表现玻璃瞬时脆裂。
 */
function synthImpactGlass(sampleRate, rand) {
  let outBuf = allocSamples(sampleRate, 0.45);
  mixBufferAt(
    outBuf,
    makeFilteredNoise(sampleRate, rand, 0.01, 0.002, {
      hp: 2500,
    }),
    0,
    1,
    sampleRate,
  );
  for (let shardIdx = 0; shardIdx < 9; shardIdx++) {
    let shardHz = randBetween(rand, 3200, 9500);
    mixBufferAt(
      outBuf,
      makeModalResonance(
        sampleRate,
        0.1,
        [
          [shardHz, randBetween(rand, 0.01, 0.03), 1],
          [shardHz * 1.47, 0.01, 0.5],
        ],
        rand,
      ),
      Math.pow(rand(), 2) * 0.3,
      randBetween(rand, 0.1, 0.35),
      sampleRate,
    );
  }
  return outBuf;
}

/**
 * 子弹掠过耳边：频率快速下坠的共振啸叫，用于敌方子弹近失的方向提示（引擎按弹道最近距离触发）。
 */
function synthWhiz(sampleRate, rand, variant) {
  let whizBuf = allocSamples(sampleRate, 0.75),
    freqStart = [3300, 2700, 3900][variant % 3],
    freqEnd = [820, 1100, 700][variant % 3],
    phase = 0,
    airNoise = makeWhiteNoise(sampleRate, 0.75, rand);
  for (let sampleIdx = 0; sampleIdx < whizBuf.length; sampleIdx++) {
    let timeSec = sampleIdx / sampleRate,
      instFreq = freqEnd + (freqStart - freqEnd) * Math.exp(-timeSec / 0.16),
      wobble = 1 + 0.035 * Math.sin(TAU * (18 + 30 * timeSec) * timeSec);
    ((phase += (TAU * instFreq * wobble) / sampleRate),
      (whizBuf[sampleIdx] =
        (Math.sin(phase) + 0.3 * Math.sin(2 * phase)) *
        (1 - Math.exp(-timeSec / 0.004)) *
        Math.exp(-timeSec / 0.19)));
  }
  return (
    applySweptBiquad(
      airNoise,
      'bp',
      (l) => freqEnd + (freqStart - freqEnd) * Math.exp((-l * 0.75) / 0.16),
      6,
      sampleRate,
    ),
    mixBufferAt(
      whizBuf,
      applyEnvelope(airNoise, sampleRate, makeDecayEnv(0.15, 0.003)),
      0,
      1.6,
      sampleRate,
    ),
    mixBufferAt(
      whizBuf,
      makeFilteredNoise(sampleRate, rand, 0.01, 0.002, {
        hp: 2500,
      }),
      0,
      0.7,
      sampleRate,
    ),
    whizBuf
  );
}

/**
 * 跳弹：带通扫频尖啸加尾部爆裂，表现子弹擦过金属或混凝土后的反弹。
 */
function synthRicochet(sampleRate, rand, variant) {
  let outBuf = allocSamples(sampleRate, 0.3),
    whistleBuf = makeWhiteNoise(sampleRate, 0.28, rand),
    startHz = [5200, 4300, 6100][variant % 3],
    endHz = [1300, 1e3, 1700][variant % 3];
  applySweptBiquad(whistleBuf, 'bp', makeExpSweep(startHz, endHz, 0.8), 3.5, sampleRate);
  for (let sIdx = 0; sIdx < whistleBuf.length; sIdx++) {
    let envArg = (sIdx / sampleRate - 0.05) / (sIdx / sampleRate < 0.05 ? 0.018 : 0.05);
    whistleBuf[sIdx] *= Math.exp(-envArg * envArg);
  }
  (mixBufferAt(outBuf, whistleBuf, 0, 1, sampleRate),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.006, 8e-4, {
        hp: 3e3,
      }),
      0.048,
      0.25,
      sampleRate,
    ));
  let glideTone = makePitchGlide(sampleRate, 0.2, startHz * 0.5, endHz * 0.6);
  return (mixBufferAt(outBuf, glideTone, 0, 0.03, sampleRate), outBuf);
}

/**
 * 海鸥无人机旋翼循环：多组非谐和低频噪声做幅度调制再叠 46Hz 摆动，作为持续飞行的环境声源。
 */
function* synthGullRotor(sampleRate, rand) {
  let bufLen = sampleRate * 2,
    outBuf = new Float32Array(bufLen),
    partials = [
      [184, 2.5],
      [207.5, 3.5],
      [233, 2],
      [258.5, 4.5],
    ];
  for (let [partFreq, partAmp] of partials) {
    let freqQ = quantizeTo(partFreq, 2),
      ampQ = quantizeTo(partAmp, 2),
      phaseA = rand() * TAU,
      phaseB = rand() * TAU;
    for (let sIdx = 0; sIdx < bufLen; sIdx++) {
      let tSec = sIdx / sampleRate,
        phaseArg = TAU * freqQ * tSec + phaseA;
      outBuf[sIdx] +=
        (Math.sin(phaseArg) +
          0.5 * Math.sin(2 * phaseArg + 1) +
          0.3 * Math.sin(3 * phaseArg + 2) +
          0.16 * Math.sin(4 * phaseArg) +
          0.08 * Math.sin(6 * phaseArg)) *
        (0.72 + 0.28 * Math.sin(TAU * ampQ * tSec + phaseB)) *
        0.25;
    }
    yield;
  }
  let rotorLoop = makeFilteredLoop(
      sampleRate,
      2,
      rand,
      (l) => {
        (applyBiquad(l, 'hp', 1100, 0.7, sampleRate), applyBiquad(l, 'lp', 5200, 0.7, sampleRate));
      },
      0.25,
    ),
    wobbleHz = quantizeTo(46, 2);
  for (let partFreq = 0; partFreq < bufLen; partFreq++)
    outBuf[partFreq] +=
      rotorLoop[partFreq] *
      (0.55 + 0.45 * Math.sin((TAU * wobbleHz * partFreq) / sampleRate)) *
      0.5;
  return outBuf;
}

/**
 * 猎犬机器人伺服循环：电机基频加谐波、62Hz 机械摆动与带通哨声，作为地面敌人的持续移动声源。
 */
function synthHoundServo(sampleRate, rand) {
  let bufLen = sampleRate * 2,
    outBuf = new Float32Array(bufLen);
  for (let sIdx = 0; sIdx < bufLen; sIdx++) {
    let tSec = sIdx / sampleRate,
      pitchMod = 1.1 * Math.sin(TAU * 0.5 * tSec) + 0.5 * Math.sin(TAU * 1.5 * tSec + 1),
      phase = TAU * 310 * tSec + pitchMod,
      ampMod = 0.7 + 0.3 * Math.sin(TAU * 1.5 * tSec),
      sampleVal =
        (Math.sin(phase) +
          0.45 * Math.sin(2 * phase + pitchMod) +
          0.2 * Math.sin(4 * phase + 0.5)) *
        0.3 *
        ampMod,
      swayPhase = TAU * 62 * tSec;
    ((sampleVal +=
      (Math.sin(swayPhase) +
        0.5 * Math.sin(2 * swayPhase) +
        0.33 * Math.sin(3 * swayPhase) +
        0.2 * Math.sin(5 * swayPhase)) *
      0.28),
      (outBuf[sIdx] = sampleVal));
  }
  let whistleLoop = makeFilteredLoop(
    sampleRate,
    2,
    rand,
    (r) => {
      (applyBiquad(r, 'hp', 2800, 0.7, sampleRate), applyBiquad(r, 'lp', 7e3, 0.7, sampleRate));
    },
    0.25,
  );
  for (let sIdx = 0; sIdx < bufLen; sIdx++)
    outBuf[sIdx] +=
      whistleLoop[sIdx] * 0.12 * (0.6 + 0.4 * Math.sin((TAU * 1.5 * sIdx) / sampleRate + 2));
  return outBuf;
}

/**
 * 中继节点嗡鸣循环：50Hz 基频的方波式谐波加高频电流啸叫，靠听感提示玩家接近任务目标。
 */
function synthRelayHum(sampleRate, rand) {
  let frameLen = sampleRate * 2,
    outBuf = new Float32Array(frameLen);
  for (let sampIdx = 0; sampIdx < frameLen; sampIdx++) {
    let timeSec = sampIdx / sampleRate,
      basePhase = TAU * 50 * timeSec;
    outBuf[sampIdx] =
      (Math.sin(basePhase) * 0.5 +
        Math.sin(2 * basePhase + 0.4) +
        0.5 * Math.sin(3 * basePhase + 1) +
        0.3 * Math.sin(4 * basePhase) +
        0.22 * Math.sin(6 * basePhase + 2) +
        0.12 * Math.sin(10 * basePhase)) *
        0.3 *
        (0.9 + 0.1 * Math.sin(TAU * 0.5 * timeSec)) +
      Math.sin(TAU * 4100 * timeSec) * 0.012 * (0.6 + 0.4 * Math.sin(TAU * 1 * timeSec)) +
      Math.sin(TAU * 1250 * timeSec + 0.6 * Math.sin(TAU * 2 * timeSec)) * 0.02;
  }
  let buzzLoop = makeFilteredLoop(
    sampleRate,
    2,
    rand,
    (r) => applyBiquad(r, 'bp', 2100, 1.2, sampleRate),
    0.25,
  );
  for (let sampIdx = 0; sampIdx < frameLen; sampIdx++)
    outBuf[sampIdx] +=
      buzzLoop[sampIdx] *
      0.16 *
      Math.pow(0.5 + 0.5 * Math.sin((TAU * 100 * sampIdx) / sampleRate), 3);
  return outBuf;
}

/**
 * 海鸥无人机开火：高频电流爆裂加机械扫尾，与猎犬火力形成清晰的音色区分。
 */
function synthGullFire(sr, rand, variant) {
  let buf = allocSamples(sr, 0.3),
    pitchScale = variant ? 1.07 : 1,
    phase = 0;
  mixBufferAt(
    buf,
    makeFilteredNoise(sr, rand, 0.008, 0.0012, {
      hp: 3200,
    }),
    0,
    1.1,
    sr,
  );
  let chirpBuf = allocSamples(sr, 0.12);
  for (let sampleIdx = 0; sampleIdx < chirpBuf.length; sampleIdx++) {
    let tSec = sampleIdx / sr,
      freq = (380 + 620 * Math.exp(-tSec / 0.018)) * pitchScale;
    phase += freq / sr;
    let sawWave = 2 * (phase - Math.floor(phase)) - 1;
    chirpBuf[sampleIdx] =
      (sawWave + 0.5 * Math.sign(Math.sin(TAU * phase * 2.02))) * Math.exp(-tSec / 0.024);
  }
  return (
    applyBiquad(chirpBuf, 'bp', 1500 * pitchScale, 0.9, sr),
    mixBufferAt(buf, chirpBuf, 0, 1.5, sr),
    mixBufferAt(
      buf,
      makeFilteredNoise(sr, rand, 0.08, 0.014, {
        bp: 2400 * pitchScale,
        q: 1.4,
      }),
      0,
      0.7,
      sr,
    ),
    mixBufferAt(buf, makeSweptSine(sr, 0.05, 240, 120, 0.012, 0.014), 0, 0.5, sr),
    mixBufferAt(
      buf,
      makeModalResonance(
        sr,
        0.05,
        [
          [3400 * pitchScale, 0.006, 1],
          [5200, 0.005, 0.6],
          [1900, 0.008, 0.5],
        ],
        rand,
      ),
      0.021,
      0.2,
      sr,
    ),
    mixBufferAt(
      buf,
      makeFilteredNoise(sr, rand, 0.15, 0.04, {
        hp: 6e3,
      }),
      0.002,
      0.1,
      sr,
    ),
    softClip(scaleBuffer(buf, 0.6), 1.6)
  );
}

/**
 * 猎犬开火：更低沉厚重的能量爆发加机械后坐，威胁感强于海鸥，用于危险等级提示。
 */
function synthHoundFire(sampleRate, rand, variant) {
  let outBuf = allocSamples(sampleRate, 0.48),
    pitchScale = variant ? 0.94 : 1;
  return (
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.012, 0.002, {
        hp: 1500,
        lp: 6e3,
      }),
      0,
      0.7,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeSweptSine(sampleRate, 0.3, 112 * pitchScale, 37 * pitchScale, 0.035, 0.07),
      0,
      1.4,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.3, 0.045, {
        hp: 90,
        lp: 900 * pitchScale,
      }),
      0,
      1.2,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.12, 0.024, {
        bp: 420 * pitchScale,
        q: 1.6,
      }),
      0,
      1.2,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeModalResonance(
        sampleRate,
        0.12,
        [
          [310 * pitchScale, 0.03, 1],
          [642 * pitchScale, 0.022, 0.7],
          [985 * pitchScale, 0.016, 0.5],
          [2200, 0.006, 0.3],
        ],
        rand,
      ),
      0.055,
      0.3,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.02, 0.004, {
        bp: 1800,
        q: 1,
      }),
      0.055,
      0.25,
      sampleRate,
    ),
    softClip(scaleBuffer(outBuf, 0.42), 1.8)
  );
}

/**
 * 猎犬踏步：金属腿落地、伺服摩擦与低频躯体震动，也复用于近战挥击。
 */
function synthHoundStep(sampleRate, rand, variant) {
  let stepBuf = allocSamples(sampleRate, 0.42),
    pitchMul = [1, 1.07, 0.93][variant % 3];
  mixBufferAt(
    stepBuf,
    makePitchGlide(sampleRate, 0.035, 920 * pitchMul, 610 * pitchMul),
    0,
    0.06,
    sampleRate,
  );
  let strikeAt = 0.03;
  return (
    mixBufferAt(
      stepBuf,
      makeSweptSine(sampleRate, 0.2, 84 * pitchMul, 41, 0.03, 0.05, 0.002),
      strikeAt,
      1.1,
      sampleRate,
    ),
    mixBufferAt(
      stepBuf,
      makeFilteredNoise(sampleRate, rand, 0.12, 0.03, {
        lp: 360,
      }),
      strikeAt,
      1.1,
      sampleRate,
    ),
    mixBufferAt(
      stepBuf,
      makeFilteredNoise(sampleRate, rand, 0.03, 0.006, {
        lp: 2600,
        hp: 500,
      }),
      strikeAt,
      0.4,
      sampleRate,
    ),
    mixBufferAt(
      stepBuf,
      makeModalResonance(
        sampleRate,
        0.12,
        [
          [522 * pitchMul, 0.026, 1],
          [1133 * pitchMul, 0.02, 0.7],
          [1871 * pitchMul, 0.014, 0.5],
          [3040 * pitchMul, 0.008, 0.3],
        ],
        rand,
      ),
      strikeAt,
      0.2,
      sampleRate,
    ),
    mixBufferAt(
      stepBuf,
      makeFilteredNoise(sampleRate, rand, 0.14, 0.04, {
        hp: 3e3,
        att: 0.006,
      }),
      strikeAt + 0.01,
      0.06,
      sampleRate,
    ),
    softClip(stepBuf, 1.5)
  );
}

/**
 * 海鸥被击落：谐波簇断电下坠加多段撞击，表现空中解体的多声部坠落。
 */
function synthGullDie(sampleRate, rand) {
  let fallBuf = allocSamples(sampleRate, 1.5),
    phases = [0, 0, 0, 0];
  mixBufferAt(
    fallBuf,
    makeFilteredNoise(sampleRate, rand, 0.02, 0.004, {
      hp: 2500,
    }),
    0,
    0.9,
    sampleRate,
  );
  let partialFreqs = [184, 207, 233, 258];
  for (let sampleIdx = 0; sampleIdx < Math.round(1.1 * sampleRate); sampleIdx++) {
    let timeSec = sampleIdx / sampleRate,
      fallPitch =
        Math.pow(0.16, timeSec / 1) * (1 + 0.06 * Math.sin(TAU * (9 - 5 * timeSec) * timeSec)),
      harmSum = 0;
    for (let partialIdx = 0; partialIdx < 4; partialIdx++)
      ((phases[partialIdx] += (TAU * partialFreqs[partialIdx] * fallPitch) / sampleRate),
        (harmSum +=
          Math.sin(phases[partialIdx]) +
          0.5 * Math.sin(2 * phases[partialIdx]) +
          0.3 * Math.sin(3 * phases[partialIdx])));
    let flutter = 0.6 + 0.4 * Math.sign(Math.sin(TAU * (26 - 16 * timeSec) * timeSec));
    fallBuf[sampleIdx] +=
      harmSum * 0.16 * flutter * Math.exp(-timeSec / 0.55) * (1 - Math.exp(-timeSec / 0.01));
  }
  let tailNoise = makeWhiteNoise(sampleRate, 1, rand);
  (applySweptBiquad(tailNoise, 'bp', makeExpSweep(3200, 500), 1, sampleRate),
    mixBufferAt(
      fallBuf,
      applyEnvelope(tailNoise, sampleRate, makeDecayEnv(0.35, 0.01)),
      0,
      0.3,
      sampleRate,
    ));
  let impactAt = 0.72;
  return (
    mixBufferAt(
      fallBuf,
      makeFilteredNoise(sampleRate, rand, 0.2, 0.035, {
        lp: 3e3,
      }),
      impactAt,
      1,
      sampleRate,
    ),
    mixBufferAt(
      fallBuf,
      makeSweptSine(sampleRate, 0.12, 130, 55, 0.02, 0.035),
      impactAt,
      0.8,
      sampleRate,
    ),
    mixBufferAt(
      fallBuf,
      makeModalResonance(
        sampleRate,
        0.4,
        [
          [705, 0.07, 1],
          [1490, 0.05, 0.7],
          [2610, 0.035, 0.5],
          [4020, 0.02, 0.3],
        ],
        rand,
      ),
      impactAt,
      0.28,
      sampleRate,
    ),
    mixBufferAt(
      fallBuf,
      makeGrainBurst(sampleRate, rand, 0.7, 26, {
        from: 0.02,
        fall: 1.7,
        hp: 1500,
        ampFall: 0.2,
        maxLen: 0.008,
      }),
      impactAt,
      0.5,
      sampleRate,
    ),
    mixBufferAt(
      fallBuf,
      makeModalResonance(
        sampleRate,
        0.2,
        [
          [1900, 0.03, 1],
          [3350, 0.02, 0.6],
        ],
        rand,
      ),
      impactAt + 0.19,
      0.14,
      sampleRate,
    ),
    softClip(fallBuf, 1.4)
  );
}

/**
 * 猎犬被击毁：电机减速停车、多段金属撞击与液压泄气，宣告地面威胁解除。
 */
function synthHoundDie(sampleRate, rand) {
  let outBuf = allocSamples(sampleRate, 1.9),
    motorPhase = 0,
    whinePhase = 0,
    motorBuf = allocSamples(sampleRate, 1.3);
  for (let sampIdx = 0; sampIdx < motorBuf.length; sampIdx++) {
    let timeSec = sampIdx / sampleRate,
      motorHz = 30 + 112 * Math.pow(1 - timeSec / 1.3, 1.6);
    ((motorPhase += motorHz / sampleRate),
      (whinePhase += (180 + 1050 * Math.exp(-timeSec / 0.3)) / sampleRate),
      (motorBuf[sampIdx] =
        (2 * (motorPhase - Math.floor(motorPhase)) - 1) *
          (1 - Math.exp(-timeSec / 0.02)) *
          Math.pow(1 - timeSec / 1.3, 0.7) +
        Math.sin(TAU * whinePhase) * 0.25 * Math.exp(-timeSec / 0.4)));
  }
  (applySweptBiquad(motorBuf, 'lp', makeExpSweep(1100, 160), 2.5, sampleRate),
    mixBufferAt(outBuf, motorBuf, 0, 0.55, sampleRate),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.03, 0.006, {
        hp: 2e3,
      }),
      0,
      0.5,
      sampleRate,
    ));
  for (let [sampIdx, timeSec, motorHz] of [
    [0.62, 1, 1],
    [0.84, 0.75, 1.22],
    [0.98, 0.5, 0.86],
    [1.17, 0.42, 1.4],
    [1.33, 0.22, 1.1],
  ])
    (mixBufferAt(
      outBuf,
      makeSweptSine(sampleRate, 0.1, 105 * motorHz, 48, 0.02, 0.035),
      sampIdx,
      timeSec * 0.9,
      sampleRate,
    ),
      mixBufferAt(
        outBuf,
        makeFilteredNoise(sampleRate, rand, 0.08, 0.016, {
          lp: 2400,
        }),
        sampIdx,
        timeSec * 0.8,
        sampleRate,
      ),
      mixBufferAt(
        outBuf,
        makeModalResonance(
          sampleRate,
          0.3,
          [
            [388 * motorHz, 0.07, 1],
            [861 * motorHz, 0.05, 0.7],
            [1540 * motorHz, 0.035, 0.5],
            [2750 * motorHz, 0.02, 0.35],
          ],
          rand,
        ),
        sampIdx,
        timeSec * 0.3,
        sampleRate,
      ));
  return (
    mixBufferAt(
      outBuf,
      makeGrainBurst(sampleRate, rand, 1, 22, {
        from: 0,
        fall: 1.2,
        hp: 1800,
        ampFall: 0.4,
        maxLen: 0.007,
      }),
      0.62,
      0.3,
      sampleRate,
    ),
    softClip(scaleBuffer(outBuf, 0.55), 1.5)
  );
}

/**
 * 警报：双振荡器颤音加 FM 抖动，用于敌人发现玩家与任务提示，提供两种音高变体区分敌人类型。
 */
function synthAlert(sampleRate, rand, variant) {
  let buffer = allocSamples(sampleRate, 0.52),
    baseFreq = variant ? 622 : 1320,
    octaveFreq = baseFreq * 1.4142,
    phase = 0,
    writeTone = (l, c, u, h) => {
      let f = Math.round(c * sampleRate),
        p = Math.round(l * sampleRate);
      for (let d = 0; d < f; d++) {
        let v = d / f,
          g = d / sampleRate;
        phase += (TAU * u * (1 + h * v)) / sampleRate;
        let x = Math.sin(phase + 1.6 * Math.sin(phase * 0.25) + 0.4 * Math.sin(TAU * 71 * g));
        buffer[p + d] +=
          Math.tanh(x * 2.2) *
          Math.min(1, d / (0.004 * sampleRate), (f - d) / (0.012 * sampleRate));
      }
    };
  return (
    writeTone(0, 0.09, baseFreq, 0),
    writeTone(0.12, 0.17, octaveFreq, -0.05),
    variant && writeTone(0.3, 0.2, baseFreq * 0.5, 0.5),
    applyBiquad(buffer, 'bp', variant ? 1100 : 2100, 0.6, sampleRate),
    mixBufferAt(
      buffer,
      makeFilteredNoise(sampleRate, rand, 0.4, 0.2, {
        hp: 4e3,
        att: 0.02,
      }),
      0,
      0.03,
      sampleRate,
    ),
    buffer
  );
}

/**
 * 敌人攻击预警：上扬的噪声与音高扫描，给玩家留出躲避窗口，是公平性的听觉保障。
 */
function synthTelegraph(sampleRate, rand, variant) {
  let outBuffer = allocSamples(sampleRate, 0.6),
    sampleCount = outBuffer.length,
    riseTime = 0.55,
    phaseA = 0,
    phaseB = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    let timeSec = sampleIndex / sampleRate,
      riseEnv = Math.min(1, timeSec / riseTime),
      envGain =
        Math.pow(riseEnv, 1.4) * (timeSec < riseTime ? 1 : Math.exp(-(timeSec - riseTime) / 0.008));
    if (variant) {
      ((phaseA += (170 + 380 * riseEnv * riseEnv) / sampleRate),
        (phaseB += (680 + 900 * riseEnv) / sampleRate));
      let sawWave = 2 * (phaseA - Math.floor(phaseA)) - 1;
      outBuffer[sampleIndex] =
        (sawWave * (0.7 + 0.3 * Math.sin(TAU * 38 * timeSec)) + 0.35 * Math.sin(TAU * phaseB)) *
        envGain;
    } else
      ((phaseA += (620 + 1900 * riseEnv * riseEnv * riseEnv) / sampleRate),
        (phaseB += ((1240 + 3800 * riseEnv * riseEnv * riseEnv) * 1.003) / sampleRate),
        (outBuffer[sampleIndex] =
          (Math.sin(TAU * phaseA) +
            0.4 * Math.sin(TAU * phaseB) +
            0.25 * Math.sign(Math.sin(TAU * phaseA * 0.5))) *
          envGain *
          (0.8 + 0.2 * Math.sin(TAU * (20 + 60 * riseEnv) * timeSec))));
  }
  (applyBiquad(outBuffer, 'lp', variant ? 2600 : 7e3, 0.7, sampleRate),
    applyBiquad(outBuffer, 'hp', variant ? 120 : 400, 0.7, sampleRate));
  let resonanceCount = variant ? 7 : 5;
  for (let sampleIndex = 0; sampleIndex < resonanceCount; sampleIndex++) {
    let timeSec = riseTime * Math.sqrt(sampleIndex / resonanceCount);
    mixBufferAt(
      outBuffer,
      makeModalResonance(
        sampleRate,
        0.03,
        [
          [variant ? 1500 : 3800, 0.004, 1],
          [variant ? 2600 : 6100, 0.003, 0.6],
        ],
        rand,
      ),
      timeSec,
      0.12 + (0.2 * sampleIndex) / resonanceCount,
      sampleRate,
    );
  }
  return outBuffer;
}

/**
 * 爆炸：低频冲击、长尾轰鸣与碎石颗粒分层，是所有音效中最响的一档，按爆炸尺寸缩放。
 */
function synthExplosion(sampleRate, rand, variant) {
  let blastBuf = allocSamples(sampleRate, 3),
    sizeScale = variant ? 0.9 : 1;
  (mixBufferAt(
    blastBuf,
    makeFilteredNoise(sampleRate, rand, 0.03, 0.006, {
      hp: 1500,
    }),
    0,
    1.8,
    sampleRate,
  ),
    mixBufferAt(
      blastBuf,
      makeSweptSine(sampleRate, 1.6, 96 * sizeScale, 27, 0.16, 0.36, 0.001),
      0,
      0.85,
      sampleRate,
    ));
  let crashNoise = makeWhiteNoise(sampleRate, 1.6, rand);
  (applySweptBiquad(crashNoise, 'lp', makeExpSweep(2800, 260, 0.5), 0.7, sampleRate),
    mixBufferAt(
      blastBuf,
      applyEnvelope(crashNoise, sampleRate, makeDecayEnv(0.26, 0.002)),
      0,
      3.2,
      sampleRate,
    ));
  let rumbleNoise = makeWhiteNoise(sampleRate, 2.6, rand);
  (applyBiquad(rumbleNoise, 'lp', 120, 0.7, sampleRate),
    mixBufferAt(
      blastBuf,
      applyEnvelope(rumbleNoise, sampleRate, makeDecayEnv(0.7, 0.03)),
      0,
      2.2,
      sampleRate,
    ),
    mixBufferAt(
      blastBuf,
      makeFilteredNoise(sampleRate, rand, 0.5, 0.09, {
        bp: 520 * sizeScale,
        q: 1.2,
      }),
      0,
      1.3,
      sampleRate,
    ),
    mixBufferAt(
      blastBuf,
      makeGrainBurst(sampleRate, rand, 2.5, 120, {
        from: 0.25,
        fall: 1.5,
        hp: 1500,
        lp: 9e3,
        ampFall: 0.8,
        maxLen: 0.01,
      }),
      0,
      0.5,
      sampleRate,
    ));
  for (let rumbleIdx = 0; rumbleIdx < 7; rumbleIdx++) {
    let modalFreq = randBetween(rand, 900, 3600);
    mixBufferAt(
      blastBuf,
      makeModalResonance(
        sampleRate,
        0.2,
        [
          [modalFreq, randBetween(rand, 0.02, 0.06), 1],
          [modalFreq * 1.61, 0.02, 0.5],
        ],
        rand,
      ),
      randBetween(rand, 0.4, 1.9),
      randBetween(rand, 0.03, 0.09),
      sampleRate,
    );
  }
  return softClip(scaleBuffer(blastBuf, 0.36), 1.7);
}

/**
 * 中继节点被切断：电流爆音、断续方波与金属崩解，标志任务目标完成的瞬时反馈。
 */
function synthRelayCut(sampleRate, rand) {
  let outBuf = allocSamples(sampleRate, 1.7);
  mixBufferAt(
    outBuf,
    makeFilteredNoise(sampleRate, rand, 0.01, 0.002, {
      hp: 2500,
    }),
    0,
    1,
    sampleRate,
  );
  let buzzBuf = makeWhiteNoise(sampleRate, 0.5, rand);
  applyBiquad(buzzBuf, 'bp', 3e3, 0.8, sampleRate);
  let gateOpen = 1;
  for (let sampleIdx = 0; sampleIdx < buzzBuf.length; sampleIdx++) {
    let timeSec = sampleIdx / sampleRate;
    (sampleIdx % 220 === 0 && (gateOpen = rand() < 0.55 + 0.4 * (1 - timeSec / 0.5) ? 1 : 0),
      (buzzBuf[sampleIdx] =
        (buzzBuf[sampleIdx] * (Math.sin(TAU * 100 * timeSec) > -0.2 ? 1 : 0.15) +
          0.35 * Math.sign(Math.sin(TAU * 100 * timeSec)) * (rand() - 0.3)) *
        gateOpen *
        Math.exp(-timeSec / 0.3)));
  }
  mixBufferAt(outBuf, buzzBuf, 0.005, 0.8, sampleRate);
  let toneBuf = allocSamples(sampleRate, 1.25),
    phaseLow = 0,
    phaseSweep = 0;
  for (let sampleIdx = 0; sampleIdx < toneBuf.length; sampleIdx++) {
    let timeSec = sampleIdx / sampleRate,
      glideMul = Math.pow(0.22, timeSec / 1.2);
    ((phaseLow += (TAU * 100 * glideMul) / sampleRate),
      (phaseSweep += (TAU * (150 + 1900 * Math.pow(1 - timeSec / 1.25, 2.2))) / sampleRate),
      (toneBuf[sampleIdx] =
        ((Math.sin(phaseLow) +
          0.6 * Math.sin(2 * phaseLow) +
          0.4 * Math.sin(3 * phaseLow) +
          0.25 * Math.sin(5 * phaseLow)) *
          0.5 +
          Math.sin(phaseSweep) * 0.22) *
        Math.pow(1 - timeSec / 1.25, 1.2) *
        (1 - Math.exp(-timeSec / 0.03))));
  }
  return (
    mixBufferAt(outBuf, toneBuf, 0.4, 0.8, sampleRate),
    mixBufferAt(outBuf, makeSweptSine(sampleRate, 0.12, 140, 60, 0.03, 0.04), 0.4, 0.5, sampleRate),
    softClip(outBuf, 1.3)
  );
}

/**
 * 雷声：低频隆隆叠加随机位置的爆裂包络，室内变体更闷；用生成器分帧烘焙长缓冲。
 */
function* synthThunder(sampleRate, rand, variant) {
  let outBuffer = allocSamples(sampleRate, 6.5),
    noiseBuf = makeWhiteNoise(sampleRate, 6.4, rand);
  (yield,
    applySweptBiquad(noiseBuf, 'lp', makeExpSweep(variant ? 520 : 380, 70, 0.6), 0.7, sampleRate),
    yield);
  let bursts = [];
  for (let burstIdx = 0; burstIdx < 9; burstIdx++)
    bursts.push([
      randBetween(rand, 0.05, 3.6),
      randBetween(rand, 0.12, 0.5),
      randBetween(rand, 0.4, 1),
    ]);
  for (let burstIdx = 0; burstIdx < noiseBuf.length; burstIdx++) {
    let sampleTime = burstIdx / sampleRate,
      burstSum = 0;
    for (let [burstAt, burstWidth, burstGain] of bursts) {
      let burstPhase = (sampleTime - burstAt) / burstWidth;
      burstSum += burstGain * Math.exp(-burstPhase * burstPhase);
    }
    noiseBuf[burstIdx] *=
      (0.25 + burstSum) * Math.exp(-sampleTime / 1.9) * (1 - Math.exp(-sampleTime / 0.05));
  }
  (mixBufferAt(outBuffer, noiseBuf, 0, 1, sampleRate), yield);
  let tailNoise = makeWhiteNoise(sampleRate, 6, rand);
  return (
    applyBiquad(tailNoise, 'bp', 48, 1.2, sampleRate),
    mixBufferAt(
      outBuffer,
      applyEnvelope(tailNoise, sampleRate, makeDecayEnv(2, 0.2)),
      0.05,
      3,
      sampleRate,
    ),
    variant &&
      mixBufferAt(
        outBuffer,
        makeFilteredNoise(sampleRate, rand, 0.3, 0.06, {
          hp: 300,
          lp: 2500,
        }),
        0.02,
        0.25,
        sampleRate,
      ),
    outBuffer
  );
}

/**
 * 雾笛的 7 阶谐波幅度序列（0、1、0.435、0.268…），衰减刻意陡峭以模拟大型空气号筒的音色。
 */
var FOGHORN_PARTIALS = [0, 1, 0.435, 0.268, 0.19, 0.145, 0.116, 0.097];

/**
 * 雾笛：以 92.5Hz 为基频按 FOGHORN_PARTIALS 叠加谐波，加缓慢起落包络，作为远方船只的环境点缀。
 */
function synthFoghorn(sampleRate, rand) {
  let outBuffer = allocSamples(sampleRate, 5),
    sampleCount = outBuffer.length;
  for (let sampleIdx = 0; sampleIdx < sampleCount; sampleIdx++) {
    let sampleTime = sampleIdx / sampleRate,
      pitchWobble = 0.0025 * Math.sin(TAU * 4.3 * sampleTime),
      fogEnv =
        Math.min(1, sampleTime / 0.45) *
        Math.min(1, (5 - sampleTime) / 1.5) *
        (sampleTime < 3.2 ? 1 : Math.exp(-(sampleTime - 3.2) / 0.7)),
      hornSum = 0;
    for (let harmonicIdx = 1; harmonicIdx <= 7; harmonicIdx++)
      hornSum +=
        Math.sin(TAU * 92.5 * harmonicIdx * sampleTime * (1 + pitchWobble) + harmonicIdx) *
        FOGHORN_PARTIALS[harmonicIdx];
    for (let harmonicIdx = 1; harmonicIdx <= 4; harmonicIdx++)
      hornSum +=
        0.45 *
        Math.sin(TAU * 138.6 * harmonicIdx * sampleTime + harmonicIdx * 2) *
        FOGHORN_PARTIALS[harmonicIdx];
    outBuffer[sampleIdx] = hornSum * fogEnv;
  }
  return (applyBiquad(outBuffer, 'lp', 520, 0.7, sampleRate), outBuffer);
}

/**
 * 海鸥叫声：频率滑动的谐波簇重复 3 到 4 次，是港口场景最具标识性的环境音。
 */
function synthGullCry(sampleRate, rand, variant) {
  let outBuffer = allocSamples(sampleRate, 1.4),
    cryCount = variant ? 3 : 4,
    writeSec = 0.02;
  for (let cryIndex = 0; cryIndex < cryCount; cryIndex++) {
    let cryDuration = randBetween(rand, 0.17, 0.26) * (variant ? 1.4 : 1),
      cryLength = Math.round(cryDuration * sampleRate),
      startSample = Math.round(writeSec * sampleRate),
      baseFreq = (variant ? 1250 : 1550) * (1 - cryIndex * 0.04),
      phase = 0;
    for (
      let sampleIndex = 0;
      sampleIndex < cryLength && startSample + sampleIndex < outBuffer.length;
      sampleIndex++
    ) {
      let progress = sampleIndex / cryLength,
        instFreq =
          baseFreq * (1 + 0.55 * Math.sin(Math.PI * Math.pow(progress, 0.6)) - 0.25 * progress);
      phase += (TAU * instFreq) / sampleRate;
      let vibrato = 1 + 0.3 * Math.sin((TAU * 63 * sampleIndex) / sampleRate);
      outBuffer[startSample + sampleIndex] +=
        (Math.sin(phase) +
          0.6 * Math.sin(2 * phase + 0.5) +
          0.35 * Math.sin(3 * phase) +
          0.15 * Math.sin(4 * phase)) *
        vibrato *
        Math.pow(Math.sin(Math.PI * progress), 0.7) *
        (1 - cryIndex * 0.14);
    }
    writeSec += cryDuration + randBetween(rand, 0.05, 0.12);
  }
  return (applyBiquad(outBuffer, 'lp', 4200, 0.7, sampleRate), outBuffer);
}

/**
 * 缆绳敲击桅杆：金属杆被绳端反复撞击的共振，用来填补风吹码头的细节空隙。
 */
function synthHalyard(sampleRate, rand, variant) {
  let clangBuf = allocSamples(sampleRate, 1.1),
    pitchMul = variant ? 1.19 : 1,
    hitAt = 0.01,
    hitCount = variant ? 3 : 4;
  for (let hitIdx = 0; hitIdx < hitCount; hitIdx++)
    (mixBufferAt(
      clangBuf,
      makeModalResonance(
        sampleRate,
        0.5,
        [
          [2310 * pitchMul, randBetween(rand, 0.06, 0.13), 1],
          [3740 * pitchMul, 0.07, 0.7],
          [5910 * pitchMul, 0.04, 0.5],
          [8130 * pitchMul, 0.025, 0.3],
          [1012 * pitchMul, 0.03, 0.3],
        ],
        rand,
      ),
      hitAt,
      randBetween(rand, 0.35, 1),
      sampleRate,
    ),
      mixBufferAt(
        clangBuf,
        makeFilteredNoise(sampleRate, rand, 0.004, 0.001, {
          hp: 3e3,
        }),
        hitAt,
        0.3,
        sampleRate,
      ),
      (hitAt += randBetween(rand, 0.09, 0.26)));
  return clangBuf;
}

/**
 * 集装箱受撞：超低频箱体共鸣加多道回声，用于远处吊装作业的偶发巨响。
 */
function synthContainerBang(sampleRate, rand) {
  let outBuffer = allocSamples(sampleRate, 2.8),
    bangBuffer = allocSamples(sampleRate, 2.2);
  return (
    mixBufferAt(
      bangBuffer,
      makeModalResonance(
        sampleRate,
        2.2,
        [
          [47, 0.7, 1],
          [77, 0.55, 0.9],
          [121, 0.4, 0.7],
          [163, 0.3, 0.5],
          [214, 0.22, 0.4],
          [330, 0.12, 0.25],
        ],
        rand,
      ),
      0,
      0.5,
      sampleRate,
    ),
    mixBufferAt(
      bangBuffer,
      makeFilteredNoise(sampleRate, rand, 0.5, 0.11, {
        lp: 420,
      }),
      0,
      1,
      sampleRate,
    ),
    mixBufferAt(outBuffer, bangBuffer, 0, 1, sampleRate),
    mixBufferAt(outBuffer, bangBuffer, 0.36, 0.3, sampleRate),
    mixBufferAt(outBuffer, bangBuffer, 0.61, 0.12, sampleRate),
    outBuffer
  );
}

/**
 * UI 点击：极短高频咔哒，保证菜单反馈干脆且不吵。
 */
function synthUiClick(sampleRate, rand) {
  let outBuf = allocSamples(sampleRate, 0.09);
  return (
    mixBufferAt(
      outBuf,
      makeModalResonance(
        sampleRate,
        0.08,
        [
          [1820, 0.009, 1],
          [2730, 0.007, 0.6],
          [640, 0.012, 0.5],
        ],
        rand,
      ),
      0,
      1,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.004, 0.001, {
        hp: 2500,
      }),
      0,
      0.5,
      sampleRate,
    ),
    outBuf
  );
}

/**
 * UI 悬停：更轻更短的高频点缀，避免频繁悬停累积成噪声。
 */
function synthUiHover(sr, rand) {
  let t = allocSamples(sr, 0.06);
  return (
    mixBufferAt(
      t,
      makeModalResonance(
        sr,
        0.05,
        [
          [3200, 0.008, 1],
          [4800, 0.005, 0.3],
        ],
        rand,
      ),
      0,
      1,
      sr,
    ),
    t
  );
}

/**
 * 室外雨声循环：带通噪声铺底加随机雨滴颗粒与低频隆隆，用生成器分帧烘焙以避免启动卡顿。
 */
function* synthRain(sampleRate, rand) {
  let makeLayer = function* (rnd) {
    let hissLoop = makeFilteredLoop(sampleRate, 6, rnd, (u) => {
      (applyBiquad(u, 'hp', 900, 0.6, sampleRate), applyBiquad(u, 'lp', 8500, 0.6, sampleRate));
    });
    yield;
    let bpLoop = makeFilteredLoop(sampleRate, 6, rnd, (u) => {
        applyBiquad(u, 'bp', 420, 0.5, sampleRate);
      }),
      bufLen = hissLoop.length,
      mixBuf = sumLayers(bufLen, [hissLoop, 0.5], [bpLoop, 0.75]),
      dropBuf = new Float32Array(bufLen);
    for (let workBuf = 0; workBuf < 1020; workBuf++) {
      let dropPos = Math.floor(rnd() * bufLen),
        dropLen = Math.round(randBetween(rnd, 6e-4, 0.003) * sampleRate),
        dropAmp = Math.pow(rnd(), 3) * 1.6 + 0.15;
      for (let d = 0; d < dropLen; d++)
        ((dropBuf[dropPos] += (rnd() * 2 - 1) * dropAmp * Math.exp((-5 * d) / dropLen)),
          ++dropPos >= bufLen && (dropPos = 0));
    }
    (yield, applySweptBiquad(dropBuf, 'hp', () => 2200, 0.7, sampleRate, 2), yield);
    for (let workBuf = 0; workBuf < 30; workBuf++) {
      let dropPos = randBetween(rnd, 700, 2100);
      mixBufferWrapped(
        dropBuf,
        makePitchGlide(sampleRate, randBetween(rnd, 0.008, 0.02), dropPos, dropPos * 1.7),
        rnd() * 6,
        randBetween(rnd, 0.08, 0.3),
        sampleRate,
      );
    }
    for (let workBuf = 0; workBuf < bufLen; workBuf++) mixBuf[workBuf] += dropBuf[workBuf] * 0.55;
    return mixBuf;
  };
  return [
    yield* makeLayer(ao(Math.floor(rand() * 1e9))),
    yield* makeLayer(ao(Math.floor(rand() * 1e9))),
  ];
}

/**
 * 室内雨声循环：屋顶雨点加衰减滴落，与室外雨层按室内系数交叉淡化，实现进出仓库的平滑过渡。
 */
function* synthRainInterior(sampleRate, rand) {
  let makeLayer = function* (rnd) {
    let hissLoop = makeFilteredLoop(sampleRate, 6, rnd, (c) => {
        (applyBiquad(c, 'lp', 1300, 0.6, sampleRate), applyBiquad(c, 'hp', 110, 0.7, sampleRate));
      }),
      bpLoop = hissLoop.length,
      bufLen = new Float32Array(bpLoop);
    for (let dropBuf = 0; dropBuf < 1560; dropBuf++)
      bufLen[Math.floor(rnd() * bpLoop)] += (rnd() * 2 - 1) * (0.2 + Math.pow(rnd(), 4) * 3);
    let mixBuf = sumLayers(bpLoop, [hissLoop, 0.8]);
    for (let [dropBuf, workBuf, dropPos] of [
      [1820, 14, 1],
      [2740, 16, 0.8],
      [4150, 18, 0.6],
      [6200, 14, 0.35],
      [940, 8, 0.7],
    ]) {
      let dropLen = Float32Array.from(bufLen);
      applySweptBiquad(dropLen, 'bp', () => dropBuf, workBuf, sampleRate, 2);
      for (let dropAmp = 0; dropAmp < bpLoop; dropAmp++)
        mixBuf[dropAmp] += dropLen[dropAmp] * dropPos * 5;
      yield;
    }
    for (let dropBuf = 0; dropBuf < 4; dropBuf++) {
      let workBuf = randBetween(rnd, 900, 1600);
      mixBufferWrapped(
        mixBuf,
        makePitchGlide(sampleRate, 0.014, workBuf, workBuf * 1.8),
        rnd() * 6,
        0.25,
        sampleRate,
      );
    }
    return mixBuf;
  };
  return [
    yield* makeLayer(ao(Math.floor(rand() * 1e9))),
    yield* makeLayer(ao(Math.floor(rand() * 1e9))),
  ];
}

/**
 * 风循环：带通噪声的截止频率按 8 秒周期摆动，配合引擎的阵风曲线产生自然起伏。
 */
function synthWind(sr, rand) {
  let windBuf = makeWhiteNoise(sr, 8.5, rand),
    gustBuf = Float32Array.from(windBuf);
  (applySweptBiquad(
    windBuf,
    'bp',
    (r) => {
      let a = r * 8.5;
      return 380 + 190 * Math.sin((TAU * a) / 8) + 90 * Math.sin((TAU * a) / 2.667 + 1);
    },
    1.3,
    sr,
  ),
    applySweptBiquad(
      gustBuf,
      'bp',
      (r) => {
        let a = r * 8.5;
        return 1350 + 260 * Math.sin((TAU * a) / 4 + 2);
      },
      9,
      sr,
    ));
  for (let bufIdx = 0; bufIdx < windBuf.length; bufIdx++) {
    let tSec = bufIdx / sr;
    windBuf[bufIdx] =
      windBuf[bufIdx] * (0.7 + 0.3 * Math.sin((TAU * tSec) / 8 + 0.5)) +
      gustBuf[bufIdx] * 0.22 * Math.pow(0.5 + 0.5 * Math.sin((TAU * tSec) / 4 + 1), 2);
  }
  return makeSeamlessLoop(windBuf, sr * 8, !0);
}

/**
 * 海浪循环：低频涌动加周期性拍岸峰值，作为整个港口场景的空间底噪。
 */
function* synthSea(sampleRate, rand) {
  let seaBuf = makeWhiteNoise(sampleRate, 8.5, rand),
    hissBuf = makeWhiteNoise(sampleRate, 8 + 0.5, rand),
    sprayBuf = makeWhiteNoise(sampleRate, 8 + 0.5, rand);
  (yield,
    applyBiquad(seaBuf, 'lp', 1100, 0.6, sampleRate),
    applyBiquad(seaBuf, 'hp', 70, 0.7, sampleRate),
    applyBiquad(hissBuf, 'hp', 2400, 0.7, sampleRate),
    applyBiquad(sprayBuf, 'bp', 520, 1.2, sampleRate),
    yield);
  for (let sIdx = 0; sIdx < seaBuf.length; sIdx++) {
    let tSec = sIdx / sampleRate,
      cyclePos = (tSec % 4) / 4,
      swellEnv = Math.pow(0.5 - 0.5 * Math.cos(TAU * cyclePos), 1.5),
      splashEnv = Math.exp(-Math.pow((cyclePos - 0.5) / 0.05, 2)),
      hissEnv = Math.exp(-Math.pow((cyclePos - 0.68) / 0.16, 2)),
      beatEnv = 0.5 - 0.5 * Math.cos((TAU * ((tSec + 1.3) % 2.667)) / 2.667);
    seaBuf[sIdx] =
      seaBuf[sIdx] * (0.3 + 0.7 * swellEnv + 0.25 * beatEnv) +
      sprayBuf[sIdx] * splashEnv * 1.8 +
      hissBuf[sIdx] * hissEnv * 0.35;
  }
  return makeSeamlessLoop(seaBuf, sampleRate * 8, !0);
}

/**
 * 4 段和声进行（根音 MIDI 号、音阶度数、低音偏移各 5 项），音乐各层共用同一套走向，叠加时才不会撞音。
 */
var CHORD_PROGRESSIONS = [
  {
    root: 38,
    tones: [0, 3, 7, 12, 10],
    base: 50,
  },
  {
    root: 34,
    tones: [0, 4, 7, 12, 11],
    base: 46,
  },
  {
    root: 31,
    tones: [0, 3, 7, 12, 10],
    base: 43,
  },
  {
    root: 33,
    tones: [0, 5, 7, 12, 10],
    base: 45,
  },
];

/**
 * 三振荡器微失谐的贝斯拨弦：起音-保持-释放三段包络，是音乐低频与 ost 层的骨架音色。
 */
function synthBassPluck(sampleRate, freq, hold, attack, release, detune, rand) {
  let sampleCount = Math.round((hold + release) * sampleRate),
    pluckBuf = new Float32Array(sampleCount),
    phases = [rand(), rand(), rand()],
    oscDetunes = [1 - detune, 1, 1 + detune * 1.1];
  for (let sampleIdx = 0; sampleIdx < sampleCount; sampleIdx++) {
    let timeSec = sampleIdx / sampleRate,
      sawSum = 0;
    for (let oscIdx = 0; oscIdx < 3; oscIdx++)
      ((phases[oscIdx] += (freq * oscDetunes[oscIdx]) / sampleRate),
        (phases[oscIdx] -= Math.floor(phases[oscIdx])),
        (sawSum += 2 * phases[oscIdx] - 1));
    let env =
      timeSec < hold
        ? 1 - Math.exp(-timeSec / attack)
        : (1 - Math.exp(-hold / attack)) * Math.exp(-(timeSec - hold) / (release * 0.3));
    pluckBuf[sampleIdx] = sawSum * env * 0.33;
  }
  return (fadeBufferEdges(pluckBuf, sampleRate, 0, 0.1), pluckBuf);
}

/**
 * 音乐持续低音层：每小节触发拨弦并铺超低八度，最后用动态低通扫一遍，提供不断线的底噪。
 */
function* synthMusicDrone(sr, rand) {
  let loopDur = MUSIC_TIMING.bar * 8,
    sampleCount = Math.round(loopDur * sr),
    layerGen = function* (materialName) {
      let r = new Float32Array(sampleCount);
      for (let a = 0; a < 4; a++) {
        let l = CHORD_PROGRESSIONS[a],
          c = a * 4.8;
        for (let [u, h] of [
          [0, 1],
          [7, 0.6],
          [12, 0.5],
          [l.tones[1] + 12, 0.28],
        ])
          (mixBufferWrapped(
            r,
            synthBassPluck(sr, midiToFreq(l.root + u), 4.6, 1.3, 1.8, 0.0035, materialName),
            c - 0.5,
            h * 0.3,
            sr,
          ),
            yield);
      }
      return (
        mixBufferWrapped(
          r,
          synthBassPluck(sr, midiToFreq(26), loopDur - 0.2, 2.5, 0.2, 0.002, materialName),
          0.1,
          0.16,
          sr,
        ),
        yield,
        applySweptBiquad(
          r,
          'lp',
          (a) => 560 + 300 * Math.sin(TAU * a * 2) + 120 * Math.sin(TAU * a * 5 + 1),
          0.9,
          sr,
          2,
        ),
        yield,
        r
      );
    };
  return [
    yield* layerGen(ao(Math.floor(rand() * 1e9))),
    yield* layerGen(ao(Math.floor(rand() * 1e9))),
  ];
}

/**
 * 音乐打击音：带共振低通扫频的噪声短打，按音高与亮度参数派生出鼓组的不同音色。
 */
function synthPercHit(sampleRate, freq, edge) {
  let sampleCount = Math.round(0.42 * sampleRate),
    outBuffer = new Float32Array(sampleCount),
    phase1 = 0,
    phase2 = 0,
    lpState1 = 0,
    lpState2 = 0,
    lpCoef = 0;
  for (let sampleIdx = 0; sampleIdx < sampleCount; sampleIdx++) {
    let sampleTime = sampleIdx / sampleRate;
    ((phase1 += freq / sampleRate),
      (phase1 -= Math.floor(phase1)),
      (phase2 += (freq * 0.5) / sampleRate),
      (phase2 -= Math.floor(phase2)));
    let oscValue = 2 * phase1 - 1 + 0.4 * (phase2 < 0.5 ? 1 : -1);
    ((sampleIdx & 15) === 0 &&
      (lpCoef =
        1 - Math.exp((-TAU * (300 + 2600 * edge * Math.exp(-sampleTime / 0.06))) / sampleRate)),
      (lpState1 += (oscValue - lpState1) * lpCoef),
      (lpState2 += (lpState1 - lpState2) * lpCoef),
      (outBuffer[sampleIdx] =
        lpState2 * Math.exp(-sampleTime / 0.1) * Math.min(1, sampleIdx / 40)));
  }
  return fadeBufferEdges(outBuffer, sampleRate, 0, 0.03);
}

/**
 * 音乐主节奏层：16 步音序在和弦内音间行走并带半拍补点，构成可无缝循环的港口工业律动。
 */
function* synthMusicOst(sampleRate) {
  let totalSeconds = MUSIC_TIMING.bar * 8,
    outBuffer = new Float32Array(Math.round(totalSeconds * sampleRate)),
    chordToneIndex = [0, 0, 2, 0, 1, 0, 2, 0, 3, 0, 2, 0, 1, 0, 4, 2],
    stepGain = [1, 0.45, 0.7, 0.45, 0.85, 0.45, 0.7, 0.5, 1, 0.45, 0.7, 0.45, 0.85, 0.5, 0.8, 0.6];
  for (let stepIndex = 0; stepIndex < 128; stepIndex++) {
    let chord = CHORD_PROGRESSIONS[(stepIndex >> 5) & 3],
      beatIndex = stepIndex & 15,
      hitSample = synthPercHit(
        sampleRate,
        midiToFreq(chord.base + chord.tones[chordToneIndex[beatIndex]]),
        stepGain[beatIndex],
      );
    (mixBufferWrapped(
      outBuffer,
      hitSample,
      stepIndex * 0.15,
      0.5 * (0.5 + 0.5 * stepGain[beatIndex]),
      sampleRate,
    ),
      mixBufferWrapped(outBuffer, hitSample, stepIndex * 0.15 + 0.45, 0.14, sampleRate),
      (stepIndex & 7) === 7 && (yield));
  }
  return outBuffer;
}

/**
 * 音乐打击层：4 小节循环的底鼓、军鼓与沙锤编排，负责推进节奏并给出重拍。
 */
function* synthMusicPerc(sampleRate, rand) {
  let loopSeconds = MUSIC_TIMING.bar * 4,
    mixedBuffer = new Float32Array(Math.round(loopSeconds * sampleRate)),
    makeKick = () =>
      sumLayers(
        Math.round(0.9 * sampleRate),
        [makeSweptSine(sampleRate, 0.9, 74, 34, 0.07, 0.24, 0.002), 1],
        [
          makeFilteredNoise(sampleRate, rand, 0.4, 0.07, {
            lp: 240,
          }),
          1.2,
        ],
        [
          makeFilteredNoise(sampleRate, rand, 0.05, 0.008, {
            bp: 1400,
            q: 0.8,
          }),
          0.25,
        ],
      ),
    makeTom = (a) =>
      sumLayers(
        Math.round(0.5 * sampleRate),
        [makeSweptSine(sampleRate, 0.5, a, a * 0.55, 0.05, 0.12, 0.002), 1],
        [
          makeFilteredNoise(sampleRate, rand, 0.1, 0.02, {
            lp: 600,
          }),
          0.5,
        ],
      ),
    makeShaker = (a) =>
      makeFilteredNoise(sampleRate, rand, 0.06, 0.008 + a * 0.01, {
        hp: 6500,
      });
  for (let barIndex = 0; barIndex < 4; barIndex++) {
    let barStart = barIndex * 2.4;
    (mixBufferWrapped(mixedBuffer, makeKick(), barStart, 1, sampleRate),
      mixBufferWrapped(mixedBuffer, makeTom(104), barStart + 1.5, 0.55, sampleRate),
      barIndex % 2 === 1 &&
        mixBufferWrapped(mixedBuffer, makeKick(), barStart + 2.1, 0.6, sampleRate));
    for (let stepIndex = 0; stepIndex < 16; stepIndex++)
      mixBufferWrapped(
        mixedBuffer,
        makeShaker(stepIndex % 4 === 2 ? 1 : 0),
        barStart + stepIndex * 0.15,
        stepIndex % 4 === 2 ? 0.34 : stepIndex % 2 ? 0.11 : 0.2,
        sampleRate,
      );
    yield;
  }
  for (let [barIndex, barStart] of [
    [12, 120],
    [13, 104],
    [14, 88],
    [15, 74],
  ])
    mixBufferWrapped(mixedBuffer, makeTom(barStart), 7.2 + barIndex * 0.15, 0.6, sampleRate);
  return softClip(mixedBuffer, 1.3);
}

/**
 * 单音铜管：脉冲串经动态低通与起落包络，是 brass 层的发声单元。
 */
function synthBrassNote(sampleRate, freq, seconds) {
  let sampleCount = Math.round(seconds * sampleRate),
    noteBuf = new Float32Array(sampleCount),
    phaseA = 0,
    phaseB = 0,
    filtZ1 = 0,
    filtZ2 = 0,
    lpCoeffs = null;
  for (let sampleIdx = 0; sampleIdx < sampleCount; sampleIdx++) {
    let timeSec = sampleIdx / sampleRate,
      normT = sampleIdx / sampleCount,
      env = Math.pow(Math.sin(Math.PI * Math.pow(normT, 0.8)), 1.5),
      vibrato = 1 + 0.004 * Math.sin(TAU * 5.1 * timeSec) * Math.min(1, timeSec);
    ((phaseA += (freq * vibrato) / sampleRate),
      (phaseA -= Math.floor(phaseA)),
      (phaseB += (freq * 1.004 * vibrato) / sampleRate),
      (phaseB -= Math.floor(phaseB)),
      (sampleIdx & 31) === 0 &&
        (lpCoeffs = biquadCoeffs('lp', 240 + 1700 * env * env, 1.1, sampleRate)));
    let sawMix = 2 * phaseA - 1 + (2 * phaseB - 1),
      lpOut = lpCoeffs[0] * sawMix + filtZ1;
    ((filtZ1 = lpCoeffs[1] * sawMix - lpCoeffs[3] * lpOut + filtZ2),
      (filtZ2 = lpCoeffs[2] * sawMix - lpCoeffs[4] * lpOut),
      (noteBuf[sampleIdx] = lpOut * env * 0.5));
  }
  return noteBuf;
}

/**
 * 音乐铜管层：四段和声按八度与五度铺开，营造类似雾号的沉稳港口和声。
 */
function* synthMusicBrass(sampleRate) {
  let totalSeconds = MUSIC_TIMING.bar * 8,
    outBuffer = new Float32Array(Math.round(totalSeconds * sampleRate));
  for (let chordIndex = 0; chordIndex < 4; chordIndex++) {
    let chord = CHORD_PROGRESSIONS[chordIndex];
    for (let [semitoneOffset, layerGain] of [
      [12, 1],
      [19, 0.7],
      [24 + chord.tones[1], 0.5],
      [24, 0.4],
    ])
      (mixBufferWrapped(
        outBuffer,
        synthBrassNote(sampleRate, midiToFreq(chord.root + semitoneOffset), 4.7),
        chordIndex * 4.8 + 0.05,
        layerGain * 0.3,
        sampleRate,
      ),
        yield);
  }
  return outBuffer;
}

/**
 * 钟铃音：基频加整数倍泛音并整体指数衰减，用于任务提示旋律与 motif 层。
 */
function synthBellTone(sampleRate, freq, seconds) {
  let buffer = makeModalResonance(sampleRate, seconds, [
      [freq, seconds * 0.3, 1],
      [freq * 2.003, seconds * 0.18, 0.4],
      [freq * 3.01, seconds * 0.1, 0.18],
      [freq * 4.2, seconds * 0.05, 0.1],
      [freq * 0.5, seconds * 0.3, 0.25],
    ]),
    attackSamples = Math.round(0.006 * sampleRate);
  for (let sampIdx = 0; sampIdx < attackSamples; sampIdx++)
    buffer[sampIdx] *= sampIdx / attackSamples;
  return fadeBufferEdges(buffer, sampleRate, 0, 0.2);
}

/**
 * 音乐动机层：两小节一组的铃音短句，是整个循环里最容易被记住的旋律钩子。
 */
function* synthMusicMotif(sampleRate) {
  let loopSec = MUSIC_TIMING.bar * 8,
    outBuf = new Float32Array(Math.round(loopSec * sampleRate)),
    playNote = (rnd, hissLoop, bpLoop) => {
      let bufLen = synthBellTone(sampleRate, midiToFreq(hissLoop), 3.2);
      (mixBufferWrapped(outBuf, bufLen, rnd, bpLoop, sampleRate),
        mixBufferWrapped(outBuf, bufLen, rnd + 0.45, bpLoop * 0.28, sampleRate),
        mixBufferWrapped(outBuf, bufLen, rnd + 0.9, bpLoop * 0.1, sampleRate));
    };
  for (let [startSec, midiNote] of [
    [0, 62],
    [0.9, 69],
    [1.8, 70],
    [3, 65],
  ])
    (playNote(startSec, midiNote, 0.5), yield);
  for (let [startSec, midiNote] of [
    [0, 62],
    [0.9, 69],
    [1.8, 72],
    [3, 67],
  ])
    (playNote(9.6 + startSec, midiNote, 0.42), yield);
  return outBuf;
}

/**
 * 完成单个目标的提示音：铃音、噪声打击与拨弦对位的小动机，用音乐语言而非蜂鸣报告进度。
 */
function* synthObjectiveSting(sampleRate) {
  let buffer = allocSamples(sampleRate, 2.8);
  ([57, 62, 65, 69].forEach((t, n) => {
    (mixBufferAt(
      buffer,
      synthBellTone(sampleRate, midiToFreq(t), 1.6),
      n * 0.15,
      0.45 + n * 0.08,
      sampleRate,
    ),
      mixBufferAt(buffer, synthPercHit(sampleRate, midiToFreq(t), 1), n * 0.15, 0.3, sampleRate));
  }),
    mixBufferAt(
      buffer,
      makeSweptSine(sampleRate, 0.8, 73.4, 36.7, 0.1, 0.25, 0.002),
      0.45,
      0.7,
      sampleRate,
    ));
  for (let midiNote of [50, 57, 62, 64])
    (mixBufferAt(
      buffer,
      synthBrassNote(sampleRate, midiToFreq(midiNote), 2.2),
      0.45,
      0.14,
      sampleRate,
    ),
      yield);
  return buffer;
}

/**
 * 全部目标完成的提示音：更长的上行动机与多重和弦，情绪强度高于单目标完成。
 */
function* synthObjectiveAllSting(sampleRate) {
  let outBuffer = allocSamples(sampleRate, 4.2);
  (mixBufferAt(
    outBuffer,
    makeSweptSine(sampleRate, 1, 73.4, 36.7, 0.1, 0.3, 0.002),
    0,
    0.9,
    sampleRate,
  ),
    mixBufferAt(
      outBuffer,
      makeSweptSine(sampleRate, 1, 73.4, 36.7, 0.1, 0.3, 0.002),
      0.6,
      0.7,
      sampleRate,
    ));
  for (let midiNote of [50, 57, 62, 65])
    (mixBufferAt(
      outBuffer,
      synthBrassNote(sampleRate, midiToFreq(midiNote), 1.5),
      0,
      0.16,
      sampleRate,
    ),
      yield);
  for (let midiNote of [48, 55, 60, 64])
    (mixBufferAt(
      outBuffer,
      synthBrassNote(sampleRate, midiToFreq(midiNote), 1.4),
      0.6,
      0.16,
      sampleRate,
    ),
      yield);
  for (let midiNote of [50, 57, 62, 65, 69])
    (mixBufferAt(
      outBuffer,
      synthBrassNote(sampleRate, midiToFreq(midiNote), 2.9),
      1.2,
      0.17,
      sampleRate,
    ),
      yield);
  return (
    [62, 65, 69, 74].forEach((t, n) =>
      mixBufferAt(
        outBuffer,
        synthBellTone(sampleRate, midiToFreq(t), 2),
        1.2 + n * 0.15,
        0.4,
        sampleRate,
      ),
    ),
    outBuffer
  );
}

/**
 * 通关结算提示音：完整和弦齐奏加尾声铃音，为整段任务收束。
 */
function* synthCompleteSting(sr) {
  let buf = allocSamples(sr, 6);
  mixBufferAt(buf, makeSweptSine(sr, 1.4, 73.4, 36.7, 0.15, 0.4, 0.003), 0, 0.9, sr);
  for (let [midiNote, amp] of [
    [38, 1],
    [50, 0.8],
    [57, 0.7],
    [62, 0.7],
    [66, 0.7],
    [69, 0.5],
  ])
    (mixBufferAt(buf, synthBrassNote(sr, midiToFreq(midiNote), 5.6), 0, 0.14 * amp, sr), yield);
  return (
    [62, 66, 69, 74, 78, 81].forEach((t, n) => {
      (mixBufferAt(buf, synthBellTone(sr, midiToFreq(t), 3), 0.3 + n * 0.3, 0.42, sr),
        mixBufferAt(buf, synthBellTone(sr, midiToFreq(t), 3), 0.75 + n * 0.3, 0.12, sr));
    }),
    buf
  );
}

/**
 * 死亡提示音：低频下坠、失谐三重奏与炸裂噪声，宣告失败但刻意不刺耳。
 */
function synthDeathSting(sampleRate, rand) {
  let outBuf = allocSamples(sampleRate, 3.8),
    bufLen = outBuf.length,
    phases = [0, 0, 0];
  for (let sIdx = 0; sIdx < bufLen; sIdx++) {
    let tSec = sIdx / sampleRate,
      envAmp = Math.pow(2, -1.1 * Math.pow(tSec / 3.8, 0.7)),
      mixVal = 0;
    ([73.42, 110, 146.83].forEach((c, u) => {
      ((phases[u] += (c * envAmp * (1 + u * 0.002)) / sampleRate),
        (phases[u] -= Math.floor(phases[u])),
        (mixVal += (2 * phases[u] - 1) * (u === 1 ? 0.6 : 1)));
    }),
      (outBuf[sIdx] = mixVal * 0.3 * Math.pow(1 - tSec / 3.8, 1.3) * (1 - Math.exp(-tSec / 0.01))));
  }
  return (
    applySweptBiquad(outBuf, 'lp', makeExpSweep(1500, 110, 0.7), 1.2, sampleRate),
    mixBufferAt(
      outBuf,
      makeSweptSine(sampleRate, 1.2, 82, 30, 0.12, 0.35, 0.002),
      0,
      1,
      sampleRate,
    ),
    mixBufferAt(
      outBuf,
      makeFilteredNoise(sampleRate, rand, 0.3, 0.06, {
        lp: 300,
      }),
      0,
      0.8,
      sampleRate,
    ),
    outBuf
  );
}

/**
 * 室外卷积混响脉冲响应：早反射稀疏、尾音渐薄，给开阔港口空间回响；产出 2 个变体供随机切换。
 */
function synthImpulseOutdoor(sampleRate, rand) {
  let makeIr = (mixedHash, s) => {
    let o = allocSamples(sampleRate, 1.4),
      r = [
        [0.062, 0.55],
        [0.089, 0.42],
        [0.118, 0.36],
        [0.151, 0.26],
        [0.178, 0.2],
        [0.243, 0.1],
      ];
    for (let [l, c] of r)
      mixBufferAt(
        o,
        makeFilteredNoise(sampleRate, mixedHash, 0.01, 0.0018, {
          hp: 700,
          lp: 5500,
        }),
        l * (s ? 1.07 : 0.96) + randBetween(mixedHash, 0, 0.006),
        c * randBetween(mixedHash, 0.6, 1.15),
        sampleRate,
      );
    let a = makeWhiteNoise(sampleRate, 1.3, mixedHash);
    return (
      applyBiquad(a, 'hp', 300, 0.7, sampleRate),
      applySweptBiquad(a, 'lp', makeExpSweep(6e3, 900, 0.6), 0.7, sampleRate),
      mixBufferAt(
        o,
        applyEnvelope(a, sampleRate, makeDecayEnv(0.27, 0.04)),
        0.04,
        0.045,
        sampleRate,
      ),
      o
    );
  };
  return [makeIr(ao(Math.floor(rand() * 1e9)), 0), makeIr(ao(Math.floor(rand() * 1e9)), 1)];
}

/**
 * 仓库棚内卷积混响脉冲响应：反射更密、衰减更快，配合室内系数在两组卷积器之间交叉淡化。
 */
function synthImpulseShed(sampleRate, rand) {
  let buildImpulse = (mixedHash, s) => {
    let o = allocSamples(sampleRate, 2.2),
      r = makeWhiteNoise(sampleRate, 2.18, mixedHash);
    (applySweptBiquad(r, 'lp', makeExpSweep(5200, 650, 0.5), 0.7, sampleRate),
      mixBufferAt(
        o,
        applyEnvelope(r, sampleRate, makeDecayEnv(0.33, 0.006)),
        0.012,
        0.3,
        sampleRate,
      ));
    let a = makeWhiteNoise(sampleRate, 2.1, mixedHash);
    (applyBiquad(a, 'lp', 260, 0.7, sampleRate),
      mixBufferAt(
        o,
        applyEnvelope(a, sampleRate, makeDecayEnv(0.4, 0.01)),
        0.012,
        0.5,
        sampleRate,
      ));
    for (let [l, c] of [
      [0.018, 0.7],
      [0.031, 0.55],
      [0.047, 0.45],
      [0.093, 0.3],
      [0.139, 0.2],
    ])
      mixBufferAt(
        o,
        makeFilteredNoise(sampleRate, mixedHash, 0.008, 0.0015, {
          lp: 4500,
        }),
        l * (s ? 1.09 : 0.95),
        c,
        sampleRate,
      );
    return o;
  };
  return [
    buildImpulse(ao(Math.floor(rand() * 1e9)), 0),
    buildImpulse(ao(Math.floor(rand() * 1e9)), 1),
  ];
}

/**
 * 44.1kHz 采样率：留给枪械、冲击、玻璃等需要高频细节的音效。
 */
var SAMPLE_RATE_44K = 44100;

/**
 * 32kHz 采样率：脚步、UI、循环环境与大部分音乐层，在细节与内存之间折中。
 */
var SAMPLE_RATE_32K = 32e3;

/**
 * 22.05kHz 采样率：以低频为主的长音（雷、雾笛、海、风、耳鸣），显著省内存。
 */
var SAMPLE_RATE_22K = 22050;

/**
 * 57 条音效配方表：每条声明生成函数、变体数、采样率、目标峰值、所属总线、并发上限、优先级，以及可选的空间化参考距离、rolloff、循环、音乐、卷积脉冲等标记，是音频引擎唯一的音效真源。
 */
export var SFX_RECIPES = {
  rifle_shot: {
    gen: synthRifleShot,
    n: 4,
    sr: SAMPLE_RATE_44K,
    peak: 0.97,
    bus: 'near',
    max: 5,
    pri: 9,
    boot: 1,
  },
  rifle_tail_out: {
    gen: synthRifleTailOutdoor,
    n: 2,
    sr: SAMPLE_RATE_32K,
    peak: 0.5,
    bus: 'dry',
    max: 3,
    pri: 8,
    boot: 1,
  },
  rifle_tail_in: {
    gen: synthRifleTailIndoor,
    n: 2,
    sr: SAMPLE_RATE_32K,
    peak: 0.62,
    bus: 'dry',
    max: 3,
    pri: 8,
    boot: 1,
  },
  rifle_dry: {
    gen: synthRifleDryFire,
    n: 1,
    sr: SAMPLE_RATE_44K,
    peak: 0.5,
    bus: 'near',
    max: 2,
    pri: 6,
    boot: 1,
  },
  reload_magout: {
    gen: synthMagOut,
    n: 1,
    sr: SAMPLE_RATE_44K,
    peak: 0.6,
    bus: 'near',
    max: 2,
    pri: 6,
  },
  reload_magin: {
    gen: synthMagIn,
    n: 1,
    sr: SAMPLE_RATE_44K,
    peak: 0.65,
    bus: 'near',
    max: 2,
    pri: 6,
  },
  reload_bolt: {
    gen: synthBoltCycle,
    n: 1,
    sr: SAMPLE_RATE_44K,
    peak: 0.8,
    bus: 'near',
    max: 2,
    pri: 6,
  },
  shell_bounce: {
    gen: synthShellBounce,
    n: 3,
    sr: SAMPLE_RATE_44K,
    peak: 0.3,
    bus: 'world',
    max: 4,
    pri: 1,
    ref: 2,
    roll: 1,
  },
  step_concrete: {
    gen: synthStepConcrete,
    n: 4,
    sr: SAMPLE_RATE_32K,
    peak: 0.45,
    bus: 'near',
    max: 3,
    pri: 3,
    boot: 1,
  },
  step_water: {
    gen: synthStepWater,
    n: 3,
    sr: SAMPLE_RATE_32K,
    peak: 0.5,
    bus: 'near',
    max: 3,
    pri: 3,
    boot: 1,
  },
  step_metal: {
    gen: synthStepMetal,
    n: 3,
    sr: SAMPLE_RATE_32K,
    peak: 0.5,
    bus: 'near',
    max: 3,
    pri: 3,
    boot: 1,
  },
  land: {
    gen: synthLand,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.7,
    bus: 'near',
    max: 2,
    pri: 4,
  },
  jump: {
    gen: synthJump,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.35,
    bus: 'near',
    max: 2,
    pri: 3,
  },
  hurt: {
    gen: synthHurt,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.85,
    bus: 'dry',
    max: 2,
    pri: 8,
  },
  ear_ring: {
    gen: synthEarRing,
    n: 1,
    sr: SAMPLE_RATE_22K,
    peak: 0.2,
    bus: 'dry',
    max: 1,
    pri: 5,
  },
  impact_metal: {
    gen: synthImpactMetal,
    n: 3,
    sr: SAMPLE_RATE_44K,
    peak: 0.7,
    bus: 'world',
    max: 4,
    pri: 4,
    ref: 4,
    roll: 0.7,
  },
  impact_concrete: {
    gen: synthImpactConcrete,
    n: 3,
    sr: SAMPLE_RATE_44K,
    peak: 0.7,
    bus: 'world',
    max: 4,
    pri: 4,
    ref: 4,
    roll: 0.7,
  },
  impact_wood: {
    gen: synthImpactWood,
    n: 2,
    sr: SAMPLE_RATE_44K,
    peak: 0.7,
    bus: 'world',
    max: 3,
    pri: 4,
    ref: 4,
    roll: 0.7,
  },
  impact_water: {
    gen: synthImpactWater,
    n: 2,
    sr: SAMPLE_RATE_32K,
    peak: 0.6,
    bus: 'world',
    max: 3,
    pri: 4,
    ref: 4,
    roll: 0.7,
  },
  impact_enemy: {
    gen: synthImpactFlesh,
    n: 3,
    sr: SAMPLE_RATE_44K,
    peak: 0.75,
    bus: 'world',
    max: 4,
    pri: 5,
    ref: 5,
    roll: 0.6,
  },
  impact_glass: {
    gen: synthImpactGlass,
    n: 1,
    sr: SAMPLE_RATE_44K,
    peak: 0.6,
    bus: 'world',
    max: 2,
    pri: 4,
    ref: 4,
    roll: 0.7,
  },
  whiz: {
    gen: synthRicochet,
    n: 3,
    sr: SAMPLE_RATE_44K,
    peak: 0.5,
    bus: 'world',
    max: 3,
    pri: 5,
    ref: 2.5,
    roll: 0.6,
  },
  ricochet: {
    gen: synthWhiz,
    n: 3,
    sr: SAMPLE_RATE_44K,
    peak: 0.4,
    bus: 'world',
    max: 2,
    pri: 3,
    ref: 5,
    roll: 0.6,
  },
  gull_fire: {
    gen: synthGullFire,
    n: 2,
    sr: SAMPLE_RATE_44K,
    peak: 0.85,
    bus: 'world',
    max: 5,
    pri: 7,
    ref: 7,
    roll: 0.55,
  },
  hound_fire: {
    gen: synthHoundFire,
    n: 2,
    sr: SAMPLE_RATE_44K,
    peak: 0.95,
    bus: 'world',
    max: 5,
    pri: 7,
    ref: 8,
    roll: 0.5,
  },
  hound_step: {
    gen: synthHoundStep,
    n: 3,
    sr: SAMPLE_RATE_32K,
    peak: 0.7,
    bus: 'world',
    max: 4,
    pri: 3,
    ref: 5,
    roll: 0.8,
  },
  gull_die: {
    gen: synthGullDie,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.85,
    bus: 'world',
    max: 3,
    pri: 7,
    ref: 7,
    roll: 0.5,
  },
  hound_die: {
    gen: synthHoundDie,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.9,
    bus: 'world',
    max: 3,
    pri: 7,
    ref: 7,
    roll: 0.5,
  },
  telegraph: {
    gen: synthTelegraph,
    n: 2,
    sr: SAMPLE_RATE_32K,
    peak: 0.42,
    bus: 'world',
    max: 4,
    pri: 6,
    ref: 6,
    roll: 0.6,
  },
  alert: {
    gen: synthAlert,
    n: 2,
    sr: SAMPLE_RATE_32K,
    peak: 0.5,
    bus: 'world',
    max: 3,
    pri: 6,
    ref: 8,
    roll: 0.5,
  },
  explosion: {
    gen: synthExplosion,
    n: 2,
    sr: SAMPLE_RATE_44K,
    peak: 0.97,
    bus: 'world',
    max: 3,
    pri: 10,
    ref: 12,
    roll: 0.5,
  },
  relay_cut: {
    gen: synthRelayCut,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.75,
    bus: 'world',
    max: 2,
    pri: 8,
    ref: 6,
    roll: 0.5,
  },
  thunder: {
    gen: synthThunder,
    n: 2,
    sr: SAMPLE_RATE_22K,
    peak: 0.8,
    bus: 'dry',
    max: 2,
    pri: 6,
  },
  foghorn: {
    gen: synthFoghorn,
    n: 1,
    sr: SAMPLE_RATE_22K,
    peak: 0.5,
    bus: 'world',
    max: 1,
    pri: 2,
  },
  gull_cry: {
    gen: synthGullCry,
    n: 2,
    sr: SAMPLE_RATE_22K,
    peak: 0.4,
    bus: 'world',
    max: 2,
    pri: 1,
  },
  halyard: {
    gen: synthHalyard,
    n: 2,
    sr: SAMPLE_RATE_32K,
    peak: 0.3,
    bus: 'world',
    max: 2,
    pri: 1,
  },
  container_bang: {
    gen: synthContainerBang,
    n: 1,
    sr: SAMPLE_RATE_22K,
    peak: 0.6,
    bus: 'world',
    max: 1,
    pri: 2,
  },
  ui_click: {
    gen: synthUiClick,
    n: 1,
    sr: SAMPLE_RATE_44K,
    peak: 0.3,
    bus: 'dry',
    max: 2,
    pri: 9,
  },
  ui_hover: {
    gen: synthUiHover,
    n: 1,
    sr: SAMPLE_RATE_44K,
    peak: 0.12,
    bus: 'dry',
    max: 2,
    pri: 9,
  },
  objective: {
    gen: synthObjectiveSting,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.6,
    bus: 'music',
    max: 1,
    pri: 9,
  },
  objective_all: {
    gen: synthObjectiveAllSting,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.65,
    bus: 'music',
    max: 1,
    pri: 9,
  },
  complete: {
    gen: synthCompleteSting,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.7,
    bus: 'music',
    max: 1,
    pri: 9,
  },
  death: {
    gen: synthDeathSting,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.75,
    bus: 'music',
    max: 1,
    pri: 9,
  },
  gull_rotor: {
    gen: synthGullRotor,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.6,
    loop: 1,
    ref: 5,
    roll: 0.9,
  },
  hound_servo: {
    gen: synthHoundServo,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.42,
    loop: 1,
    ref: 4,
    roll: 1,
  },
  relay_hum: {
    gen: synthRelayHum,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.4,
    loop: 1,
    ref: 2.5,
    roll: 1.4,
  },
  rain: {
    gen: synthRain,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.5,
    loop: 1,
  },
  rain_interior: {
    gen: synthRainInterior,
    n: 1,
    sr: SAMPLE_RATE_32K,
    peak: 0.7,
    loop: 1,
  },
  wind: {
    gen: synthWind,
    n: 1,
    sr: SAMPLE_RATE_22K,
    peak: 0.5,
    loop: 1,
  },
  sea: {
    gen: synthSea,
    n: 1,
    sr: SAMPLE_RATE_22K,
    peak: 0.5,
    loop: 1,
    ref: 10,
    roll: 0.6,
  },
  music_drone: {
    gen: synthMusicDrone,
    n: 1,
    sr: MUSIC_TIMING.sr,
    peak: 0.5,
    loop: 1,
    music: 1,
  },
  music_ost: {
    gen: synthMusicOst,
    n: 1,
    sr: MUSIC_TIMING.sr,
    peak: 0.45,
    loop: 1,
    music: 1,
  },
  music_perc: {
    gen: synthMusicPerc,
    n: 1,
    sr: MUSIC_TIMING.sr,
    peak: 0.7,
    loop: 1,
    music: 1,
  },
  music_brass: {
    gen: synthMusicBrass,
    n: 1,
    sr: MUSIC_TIMING.sr,
    peak: 0.45,
    loop: 1,
    music: 1,
  },
  music_motif: {
    gen: synthMusicMotif,
    n: 1,
    sr: MUSIC_TIMING.sr,
    peak: 0.45,
    loop: 1,
    music: 1,
  },
  ir_outdoor: {
    gen: synthImpulseOutdoor,
    n: 1,
    sr: SAMPLE_RATE_44K,
    peak: 0.9,
    ir: 1,
  },
  ir_shed: {
    gen: synthImpulseShed,
    n: 1,
    sr: SAMPLE_RATE_44K,
    peak: 0.9,
    ir: 1,
  },
};

/**
 * 语义名到配方名的别名表，让调用方可以说 step、impact、extraction 而不必记住具体配方名。
 */
export var SFX_ALIASES = {
  step: 'step_concrete',
  impact: 'impact_concrete',
  hurt: 'hurt',
  objective_done: 'objective',
  extraction: 'complete',
  enemy_alert: 'alert',
};

/**
 * 判断生成器返回值是迭代器还是成品缓冲：渐进式烘焙的长音效用生成器分帧让出主线程，其余一次跑完。
 */
var isIterator = (value) => value && typeof value.next == 'function';

/**
 * 把配方产出定型：非循环音效加首尾淡变、按声明峰值归一化，返回采样率、声道缓冲与循环标记，供引擎直接构造 AudioBuffer。
 */
function finalizeSample(recipe, channels, sampleRate) {
  let chBuffers = Array.isArray(channels) ? channels : [channels];
  if (!recipe.loop)
    for (let chBuffer of chBuffers)
      fadeBufferEdges(chBuffer, sampleRate, recipe.ir ? 0 : 3e-4, recipe.ir ? 0.05 : 0.012);
  let peakLevel = 0;
  for (let chBuffer of chBuffers) peakLevel = Math.max(peakLevel, peakAmplitude(chBuffer));
  let normGain = peakLevel > 0 ? recipe.peak / peakLevel : 1;
  for (let chBuffer of chBuffers) scaleBuffer(chBuffer, normGain);
  return {
    sr: sampleRate,
    ch: chBuffers,
    loop: !!recipe.loop,
  };
}

/**
 * 同步烘焙一条配方（指定变体与采样率）：若配方是生成器则强制跑完，用于启动阶段一次性补齐的短音效。
 */
export function bakeSfxBuffer(name, variantReq = 0, sampleRateIn) {
  let recipe = SFX_RECIPES[name];
  if (!recipe) return null;
  let sampleRate = sampleRateIn || recipe.sr,
    variantIndex = variantReq % recipe.n,
    rawBuffer = recipe.gen(sampleRate, ao(fnv1aHash(name) + variantIndex * 7919), variantIndex);
  if (isIterator(rawBuffer)) {
    let iterStep;
    do iterStep = rawBuffer.next();
    while (!iterStep.done);
    rawBuffer = iterStep.value;
  }
  return finalizeSample(recipe, rawBuffer, sampleRate);
}

/**
 * 渐进式烘焙句柄：每次 step() 只推进生成器一帧，未完成返回 null，供启动期用时间切片烘焙长缓冲而不阻塞首帧。
 */
export function createSfxBaker(name, variant = 0, sampleRate) {
  let recipe = SFX_RECIPES[name];
  if (!recipe) return null;
  let rate = sampleRate || recipe.sr,
    variantIdx = variant % recipe.n,
    generator = recipe.gen(rate, ao(fnv1aHash(name) + variantIdx * 7919), variantIdx),
    baked = null;
  return {
    step() {
      if (baked) return baked;
      if (isIterator(generator)) {
        let l = generator.next();
        if (!l.done) return null;
        generator = l.value;
      }
      return (baked = finalizeSample(recipe, generator, rate));
    },
  };
}
