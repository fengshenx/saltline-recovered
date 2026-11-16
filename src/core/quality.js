// core/quality.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import { QUALITY_PRESETS } from './config.js';

/**
 * 启动时的画质裁决：显式预设名优先；其次按 UA/触屏尺寸判移动端降到 low；再用 WEBGL_debug_renderer_info 的 GPU 串识别软渲染与移动 GPU 降为 medium，其余给 high
 */
export function chooseQuality(presetName) {
  if (presetName && QUALITY_PRESETS[presetName])
    return {
      ...QUALITY_PRESETS[presetName],
    };
  if (
    /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900)
  )
    return {
      ...QUALITY_PRESETS.low,
    };
  let gpuName = '';
  try {
    let probeCanvas = document.createElement('canvas'),
      glCtx = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (glCtx) {
      let debugInfo = glCtx.getExtension('WEBGL_debug_renderer_info');
      gpuName = String(
        debugInfo
          ? glCtx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
          : glCtx.getParameter(glCtx.RENDERER),
      );
      let loseCtx = glCtx.getExtension('WEBGL_lose_context');
      loseCtx && loseCtx.loseContext();
    }
  } catch {}
  return {
    ...(/SwiftShader|llvmpipe|Software|Mali|Adreno|PowerVR/i.test(gpuName) ||
    (/Intel/i.test(gpuName) && !/Arc/i.test(gpuName))
      ? QUALITY_PRESETS.medium
      : QUALITY_PRESETS.high),
  };
}

/**
 * 创建指定宽高的离屏 canvas，是所有程序化贴花/文字的绘制画布入口
 */
export function createCanvas(width, height) {
  let t = document.createElement('canvas');
  return ((t.width = width), (t.height = height), t);
}
