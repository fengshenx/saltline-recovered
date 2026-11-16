// app/benchmark.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

/**
 * 压测叠层：沿镜头路径自动巡航并统计帧时均值/中位/p99 与 GPU 名，把结果打到左上角文本里，供 bench 模式对比画质档位
 */
export function enableBenchmark(ctx) {
  let benchEl = document.createElement('pre');
  ((benchEl.id = 'bench'),
    (benchEl.style.cssText =
      'position:absolute;left:12px;top:12px;z-index:90;margin:0;padding:10px 12px;font:12px/1.45 "IBM Plex Mono",ui-monospace,monospace;color:#d8f0d0;background:rgba(0,0,0,.72);white-space:pre-wrap;max-width:min(560px,90vw);pointer-events:none'),
    document.getElementById('app').appendChild(benchEl));
  let gpuName = 'unknown';
  try {
    let frameDelta = ctx.renderer.getContext(),
      pathPosition = frameDelta.getExtension('WEBGL_debug_renderer_info');
    gpuName = pathPosition
      ? frameDelta.getParameter(pathPosition.UNMASKED_RENDERER_WEBGL)
      : frameDelta.getParameter(frameDelta.RENDERER);
  } catch {}
  let path =
      ctx.level.cinematicPath && ctx.level.cinematicPath.length >= 2
        ? ctx.level.cinematicPath
        : [
            {
              pos: [-32, 1.7, 6],
              look: [0, 2, 5],
            },
            {
              pos: [10, 1.7, 6],
              look: [30, 6, 0],
            },
          ],
    samples = [],
    elapsed = 0,
    lastReport = 0,
    lapSeconds = 30,
    posFrom = new THREE.Vector3(),
    posTo = new THREE.Vector3(),
    lookFrom = new THREE.Vector3(),
    lookTo = new THREE.Vector3();
  (ctx.player && (ctx.player.enabled = !1),
    (ctx.bench = {
      frame(frameDelta) {
        elapsed += frameDelta;
        let pathPosition = ((elapsed / lapSeconds) % 1) * (path.length - 1),
          pathSegment = Math.min(path.length - 2, Math.floor(pathPosition)),
          segmentT = pathPosition - pathSegment,
          easedT = segmentT * segmentT * (3 - 2 * segmentT);
        if (
          (posFrom.fromArray(path[pathSegment].pos),
          posTo.fromArray(path[pathSegment + 1].pos),
          lookFrom.fromArray(path[pathSegment].look),
          lookTo.fromArray(path[pathSegment + 1].look),
          ctx.camera.position.lerpVectors(posFrom, posTo, easedT),
          ctx.camera.lookAt(lookFrom.lerp(lookTo, easedT)),
          elapsed > 2 && samples.push(frameDelta * 1e3),
          samples.length > 3e3 && samples.shift(),
          elapsed - lastReport > 1 && samples.length > 10)
        ) {
          lastReport = elapsed;
          let sortedSamples = samples
              .slice()
              .sort((sampleLeft, sampleRight) => sampleLeft - sampleRight),
            meanFrameMs =
              sortedSamples.reduce((sampleLeft, sampleRight) => sampleLeft + sampleRight, 0) /
              sortedSamples.length,
            p99FrameMs = sortedSamples[Math.floor(sortedSamples.length * 0.99)],
            medianFrameMs = sortedSamples[sortedSamples.length >> 1],
            renderStats = ctx.render.stats ? ctx.render.stats() : {},
            drawingBufferSize = ctx.renderer.getDrawingBufferSize(new THREE.Vector2());
          benchEl.textContent = `SALTLINE BENCH  t=${elapsed.toFixed(0)}s
GPU: ${gpuName}
buffer ${drawingBufferSize.x}x${drawingBufferSize.y}  quality ${ctx.quality.name}  dpr ${window.devicePixelRatio}
frame ms avg ${meanFrameMs.toFixed(1)}  median ${medianFrameMs.toFixed(1)}  p99 ${p99FrameMs.toFixed(1)}  => ${(1e3 / meanFrameMs).toFixed(0)} fps
stats ${JSON.stringify(renderStats)}
errors ${window.__errors.length}${
            window.__errors.length
              ? `
 - ` +
                window.__errors.slice(0, 6).join(`
 - `)
              : ''
          }`;
        }
      },
    }));
}
