// audio/synthesis.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

/**
 * mulberry32 变体的 32 位种子随机数发生器；音效烘焙用固定种子，保证同一配方每次生成的波形逐采样一致（可复现、可跨 session 缓存）。
 */
export function createSeededRandom(seed) {
  let rngState = seed >>> 0;
  return () => {
    ((rngState |= 0), (rngState = (rngState + 1831565813) | 0));
    let mixedVal = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    return (
      (mixedVal = (mixedVal + Math.imul(mixedVal ^ (mixedVal >>> 7), 61 | mixedVal)) ^ mixedVal),
      ((mixedVal ^ (mixedVal >>> 14)) >>> 0) / 4294967296
    );
  };
}

/**
 * 2π 常量；音频合成按弧度累加相位，所有波形都用频率乘它换算，避免各处重复写 Math.PI 乘 2。
 */
export var TAU = Math.PI * 2;

/**
 * FNV-1a 字符串哈希：把配方名映射成稳定种子，让每个音效的随机细节在每次启动时都相同，玩家听不出机器随机。
 */
export function fnv1aHash(str) {
  let e = 2166136261;
  for (let t = 0; t < str.length; t++) ((e ^= str.charCodeAt(t)), (e = Math.imul(e, 16777619)));
  return e >>> 0;
}

/**
 * 按采样率乘时长分配 Float32Array 缓冲（最少 1 个采样防 0 长度），是全套离线合成器的统一内存入口。
 */
export var allocSamples = (sr, seconds) => new Float32Array(Math.max(1, Math.round(sr * seconds)));

/**
 * 在 [min,max] 区间取随机数，用于时长、频率、增益的轻微抖动，使同一音效多次触发不会听出重复。
 */
export var randBetween = (rand, min, max) => min + (max - min) * rand();

/**
 * MIDI 音高转频率（A4=440、69 号键）；音乐与提示音都按音名谱写，便于各层共用一个和声空间。
 */
export var midiToFreq = (midiNote) => 440 * Math.pow(2, (midiNote - 69) / 12);

/**
 * 生成 [-1,1] 白噪声缓冲，是所有噪声类音效（脚步、冲击、风、雨、爆炸）的底料。
 */
export function makeWhiteNoise(sr, seconds, rand) {
  let n = allocSamples(sr, seconds);
  for (let s = 0; s < n.length; s++) n[s] = rand() * 2 - 1;
  return n;
}

/**
 * 按 RBJ cookbook 算出低通/高通/带通的 5 个双二阶系数；合成器不用运行时 BiquadFilter，而是在烘焙阶段离线滤波，省下每条声音的音频线程开销。
 */
export function biquadCoeffs(type, cutoffHz, qFactor, sampleRate) {
  let omega = (TAU * Math.max(10, Math.min(cutoffHz, sampleRate * 0.47))) / sampleRate,
    cosOmega = Math.cos(omega),
    sinOmega = Math.sin(omega),
    alpha = sinOmega / (2 * qFactor),
    b0,
    c,
    b2,
    h = 1 + alpha,
    f = -2 * cosOmega,
    a2 = 1 - alpha;
  return (
    type === 'lp'
      ? ((b0 = (1 - cosOmega) / 2), (c = 1 - cosOmega), (b2 = b0))
      : type === 'hp'
        ? ((b0 = (1 + cosOmega) / 2), (c = -(1 + cosOmega)), (b2 = b0))
        : ((b0 = alpha), (c = 0), (b2 = -alpha)),
    [b0 / h, c / h, b2 / h, f / h, a2 / h]
  );
}

/**
 * 对整段缓冲做一次固定截止频率的双二阶滤波（转置直接 II 型），用于音色定型。
 */
export function applyBiquad(buf, type, cutoffHz, resonance, sampleRate) {
  let [b0, r, b2, l, a2] = biquadCoeffs(type, cutoffHz, resonance, sampleRate),
    u = 0,
    z2 = 0;
  for (let sampleIdx = 0; sampleIdx < buf.length; sampleIdx++) {
    let inputSample = buf[sampleIdx],
      outSample = b0 * inputSample + u;
    ((u = r * inputSample - l * outSample + z2),
      (z2 = b2 * inputSample - a2 * outSample),
      (buf[sampleIdx] = outSample));
  }
  return buf;
}

/**
 * 扫频版双二阶滤波：每 32 采样重算系数并可多趟通过，实现随时间滑动的共振峰与扫频包络（爆炸、鞭击、风声都靠它）。
 */
export function applySweptBiquad(buf, type, cutoff, qParam, sampleRate, passes = 1) {
  let bufLen = buf.length;
  for (let passIdx = 0; passIdx < passes; passIdx++) {
    let l = 0,
      z2 = 0,
      coeffs = null;
    passIdx > 0 && ((l = applySweptBiquad.z1), (z2 = applySweptBiquad.z2));
    let writeBuf = passIdx === passes - 1 ? buf : null;
    for (let sIdx = 0; sIdx < bufLen; sIdx++) {
      (sIdx & 31) === 0 &&
        (coeffs = biquadCoeffs(
          type,
          cutoff(sIdx / bufLen),
          typeof qParam == 'function' ? qParam(sIdx / bufLen) : qParam,
          sampleRate,
        ));
      let inSample = buf[sIdx],
        outSample = coeffs[0] * inSample + l;
      ((l = coeffs[1] * inSample - coeffs[3] * outSample + z2),
        (z2 = coeffs[2] * inSample - coeffs[4] * outSample),
        writeBuf && (writeBuf[sIdx] = outSample));
    }
    ((applySweptBiquad.z1 = l), (applySweptBiquad.z2 = z2));
  }
  return buf;
}

/**
 * 生成指数频率滑音函数（fromHz 到 toHz，可加曲线度），给扫频滤波与循环噪声提供随时间变化的调制曲线。
 */
export var makeExpSweep =
  (fromHz, toHz, t = 1) =>
  (n) =>
    fromHz * Math.pow(toHz / fromHz, Math.pow(n, t));

/**
 * 按传入的随时间函数逐点乘包络，做衰减、起伏与淡入淡出调制。
 */
export function applyEnvelope(buf, sr, env) {
  for (let n = 0; n < buf.length; n++) buf[n] *= env(n / sr);
  return buf;
}

/**
 * 生成指数起音加指数衰减的包络函数（可选 attack 期），是大部分敲击类音效共用的时间形状。
 */
export var makeDecayEnv = (decay, e = 0) =>
  e > 0 ? (t) => (1 - Math.exp(-t / e)) * Math.exp(-t / decay) : (t) => Math.exp(-t / decay);

/**
 * 把一段缓冲按时间偏移与增益叠加进目标缓冲，是配方分层拼装的唯一基本操作（越界自动裁掉）。
 */
export function mixBufferAt(dest, src, offsetSec, gain, sampleRate) {
  let offsetSamples = Math.round(offsetSec * sampleRate),
    copyLen = Math.min(src.length, dest.length - offsetSamples);
  for (let sampIdx = Math.max(0, -offsetSamples); sampIdx < copyLen; sampIdx++)
    dest[offsetSamples + sampIdx] += src[sampIdx] * gain;
  return dest;
}

/**
 * 同 mixBufferAt 但按环形回绕写入，用于把短音色撒满整条循环缓冲（雨滴、鼓组、连击纹理）。
 */
export function mixBufferWrapped(dest, src, offsetSec, gain, sampleRate) {
  let destLen = dest.length,
    writeIdx = Math.round(offsetSec * sampleRate) % destLen;
  writeIdx < 0 && (writeIdx += destLen);
  for (let srcIdx = 0; srcIdx < src.length; srcIdx++)
    ((dest[writeIdx] += src[srcIdx] * gain), ++writeIdx >= destLen && (writeIdx = 0));
  return dest;
}

/**
 * 求缓冲峰值绝对值，用于归一化到配方声明的 peak，保证同一音效的不同变体响度一致。
 */
export function peakAmplitude(buf) {
  let e = 0;
  for (let t = 0; t < buf.length; t++) {
    let n = Math.abs(buf[t]);
    n > e && (e = n);
  }
  return e;
}

/**
 * 整段缓冲就地乘增益，用于归一化与收尾电平微调。
 */
export function scaleBuffer(buf, gain) {
  for (let t = 0; t < buf.length; t++) buf[t] *= gain;
  return buf;
}

/**
 * tanh 归一化软削波：给偏粗糙的音效加谐波并限幅，避免直接硬 clipping 产生刺耳失真。
 */
export function softClip(buf, drive) {
  let t = 1 / Math.tanh(drive);
  for (let n = 0; n < buf.length; n++) buf[n] = Math.tanh(buf[n] * drive) * t;
  return buf;
}

/**
 * 给缓冲首尾加淡入淡出，消除一次性音效起止的咔哒声；循环音效必须跳过此步否则破坏接缝。
 */
export function fadeBufferEdges(buf, sampleRate, fadeIn, fadeOut) {
  let fadeInSamples = Math.min(buf.length >> 1, Math.round(fadeIn * sampleRate)),
    fadeOutSamples = Math.min(buf.length >> 1, Math.round(fadeOut * sampleRate));
  for (let sampleIdx = 0; sampleIdx < fadeInSamples; sampleIdx++)
    buf[sampleIdx] *= sampleIdx / fadeInSamples;
  for (let sampleIdx = 0; sampleIdx < fadeOutSamples; sampleIdx++) {
    let rampGain = sampleIdx / fadeOutSamples;
    buf[buf.length - 1 - sampleIdx] *= rampGain * rampGain;
  }
  return buf;
}

/**
 * 通用滤波噪声加包络发生器：可配高通/低通/带通与起音时间，是冲击、脚步、雨、爆炸等配方的基础层。
 */
export function makeFilteredNoise(sampleRate, rand, seconds, decay, filtOpts = {}) {
  let noiseBuf = makeWhiteNoise(sampleRate, seconds, rand);
  (filtOpts.hp && applyBiquad(noiseBuf, 'hp', filtOpts.hp, 0.707, sampleRate),
    filtOpts.lp && applyBiquad(noiseBuf, 'lp', filtOpts.lp, 0.707, sampleRate),
    filtOpts.bp && applyBiquad(noiseBuf, 'bp', filtOpts.bp, filtOpts.q || 1, sampleRate),
    applyEnvelope(noiseBuf, sampleRate, makeDecayEnv(decay, filtOpts.att || 0)));
  let peakAmp = peakAmplitude(noiseBuf);
  return peakAmp > 0 ? scaleBuffer(noiseBuf, 1 / peakAmp) : noiseBuf;
}

/**
 * 扫频正弦冲击（起止频率、扫频速度、衰减、起音可调），给低频闷响与机械撞击提供实体感。
 */
export function makeSweptSine(
  sampleRate,
  seconds,
  fromHz,
  toHz,
  sweepTau,
  decayTau,
  attackTau = 6e-4,
) {
  let outBuf = allocSamples(sampleRate, seconds),
    phase = 0;
  for (let sIdx = 0; sIdx < outBuf.length; sIdx++) {
    let tSec = sIdx / sampleRate;
    ((phase += (TAU * (toHz + (fromHz - toHz) * Math.exp(-tSec / sweepTau))) / sampleRate),
      (outBuf[sIdx] =
        Math.sin(phase) * Math.exp(-tSec / decayTau) * (1 - Math.exp(-tSec / attackTau))));
  }
  return outBuf;
}

/**
 * 带指数滑音的正弦（可加正弦窗），用于哨音、掠弹、金属余音这类音高变化明显的短音。
 */
export function makePitchGlide(sr, seconds, fromHz, toHz, s = !0) {
  let buf = allocSamples(sr, seconds),
    phase = 0,
    len = buf.length;
  for (let sampleIdx = 0; sampleIdx < len; sampleIdx++) {
    let tNorm = sampleIdx / len;
    ((phase += (TAU * fromHz * Math.pow(toHz / fromHz, tNorm)) / sr),
      (buf[sampleIdx] = Math.sin(phase) * (s ? Math.sin(Math.PI * tNorm) : 1)));
  }
  return buf;
}

/**
 * 模态共振合成：把 [频率, 衰减, 幅度] 列表叠成指数衰减的正弦簇，模拟金属板、墙面、木箱等物体的固有振动。
 */
export function makeModalResonance(sampleRate, seconds, partials, rand) {
  let modeBuf = allocSamples(sampleRate, seconds);
  for (let [partFreq, partDecay, partAmp] of partials) {
    if (partFreq > sampleRate * 0.46) continue;
    let omega = (TAU * partFreq) / sampleRate,
      phase0 = rand ? rand() * TAU : 0,
      decayMul = Math.exp(-1 / (partDecay * sampleRate)),
      amp = partAmp;
    for (
      let sampleIdx = 0;
      sampleIdx < modeBuf.length &&
      ((modeBuf[sampleIdx] += Math.sin(omega * sampleIdx + phase0) * amp),
      (amp *= decayMul),
      !(amp < 1e-5));
      sampleIdx++
    );
  }
  let fadeLen = Math.min(modeBuf.length, Math.round(4e-4 * sampleRate));
  for (let partFreq = 0; partFreq < fadeLen; partFreq++) modeBuf[partFreq] *= partFreq / fadeLen;
  return modeBuf;
}

/**
 * 颗粒噪声爆破：沿时间轴随机撒短噪声颗粒并衰减，用于布料摩擦、碎屑、震动等不规则质感。
 */
export function makeGrainBurst(sampleRate, rand, seconds, grains, opts = {}) {
  let grainBuf = allocSamples(sampleRate, seconds),
    startSec = opts.from || 0,
    fallPow = opts.fall || 1;
  for (let grainIdx = 0; grainIdx < grains; grainIdx++) {
    let grainAtSec = startSec + (seconds - startSec - 0.02) * Math.pow(rand(), fallPow),
      grainStart = Math.round(grainAtSec * sampleRate),
      grainLen = Math.round(
        randBetween(rand, opts.minLen || 0.001, opts.maxLen || 0.004) * sampleRate,
      ),
      grainAmp =
        randBetween(rand, 0.2, 1) * (opts.ampFall ? Math.exp(-grainAtSec / opts.ampFall) : 1);
    for (
      let sampleOffset = 0;
      sampleOffset < grainLen && grainStart + sampleOffset < grainBuf.length;
      sampleOffset++
    )
      grainBuf[grainStart + sampleOffset] +=
        (rand() * 2 - 1) * grainAmp * Math.exp((-4 * sampleOffset) / grainLen);
  }
  return (
    opts.hp && applyBiquad(grainBuf, 'hp', opts.hp, 0.707, sampleRate),
    opts.lp && applyBiquad(grainBuf, 'lp', opts.lp, 0.707, sampleRate),
    opts.bp && applyBiquad(grainBuf, 'bp', opts.bp, opts.q || 1, sampleRate),
    grainBuf
  );
}

/**
 * 把缓冲尾部交叉淡入头部，产出无缝循环；雨、风、海、伺服等循环音都靠它消除接缝咔哒。
 */
export function makeSeamlessLoop(buf, loopLen, cosine) {
  let fadeSamples = buf.length - loopLen,
    outBuffer = new Float32Array(loopLen);
  outBuffer.set(buf.subarray(0, loopLen));
  for (let fadeIndex = 0; fadeIndex < fadeSamples; fadeIndex++) {
    let fadePos = (fadeIndex + 0.5) / fadeSamples,
      headGain = cosine ? Math.sin((fadePos * Math.PI) / 2) : fadePos,
      tailGain = cosine ? Math.cos((fadePos * Math.PI) / 2) : 1 - fadePos;
    outBuffer[fadeIndex] = buf[fadeIndex] * headGain + buf[loopLen + fadeIndex] * tailGain;
  }
  return outBuffer;
}

/**
 * 带余量的噪声经滤波后交叉淡化成无缝循环，是环境与机械循环音的统一生成入口。
 */
export function makeFilteredLoop(sr, seconds, rand, shape, s = 0.4) {
  let o = makeWhiteNoise(sr, seconds + s, rand);
  return (shape(o), makeSeamlessLoop(o, Math.round(sr * seconds), !0));
}

/**
 * 把若干 [缓冲, 增益] 层等长相加成一层，用于把多个合成层压成单条样本交给播放层。
 */
export function sumLayers(length, ...e) {
  let t = new Float32Array(length);
  for (let [n, s] of e) for (let o = 0; o < Math.min(length, n.length); o++) t[o] += n[o] * s;
  return t;
}

/**
 * 把数值量化到 1/step 精度，让扫频与鼓点频率落在稳定栅格上，避免浮点尾数造成不同机器上的音色漂移。
 */
export var quantizeTo = (value, step) => Math.round(value * step) / step;
