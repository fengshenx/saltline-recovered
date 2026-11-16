// app/boot-screen.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

/**
 * 启动遮罩元素（#boot），进度走完后加 done 类再隐藏，避免白屏闪烁
 */
export var bootScreenEl = document.getElementById('boot');

/**
 * 启动遮罩上的状态文案节点，逐阶段显示当前在做什么
 */
var bootMessageEl = document.getElementById('boot-msg');

/**
 * 启动遮罩上的进度条填充节点
 */
var bootProgressEl = document.getElementById('boot-fill');

/**
 * 把控制权让给浏览器一帧（setTimeout 0），让启动进度条真的能重绘，否则同步阻塞的初始化阶段进度条会卡住不动
 */
var yieldToPaint = () => new Promise((i) => setTimeout(i, 0));

/**
 * 更新启动文案与进度并按需让出一帧，是 boot 序列里每个阶段之间的标准停顿点
 */
export async function setBootProgress(message, progress) {
  (bootMessageEl && (bootMessageEl.textContent = message),
    bootProgressEl && (bootProgressEl.style.width = Math.round(progress * 100) + '%'),
    await yieldToPaint());
}
