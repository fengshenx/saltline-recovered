// audio/music.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

/**
 * 音乐节拍约定：100 BPM、2.4 秒一小节、8 小节循环、32kHz 采样；所有音乐配方都按它排布，保证叠加各层严格对拍。
 */
export var MUSIC_TIMING = {
  bpm: 100,
  bar: 2.4,
  loopBars: 8,
  sr: 32e3,
};
