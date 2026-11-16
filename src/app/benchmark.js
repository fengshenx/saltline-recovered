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
    let frameDt = ctx.renderer.getContext(),
      pathProgress = frameDt.getExtension('WEBGL_debug_renderer_info');
    gpuName = pathProgress
      ? frameDt.getParameter(pathProgress.UNMASKED_RENDERER_WEBGL)
      : frameDt.getParameter(frameDt.RENDERER);
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
      frame(f) {
        elapsed += f;
        let p = ((elapsed / lapSeconds) % 1) * (path.length - 1),
          d = Math.min(path.length - 2, Math.floor(p)),
          v = p - d,
          g = v * v * (3 - 2 * v);
        if (
          (posFrom.fromArray(path[d].pos),
          posTo.fromArray(path[d + 1].pos),
          lookFrom.fromArray(path[d].look),
          lookTo.fromArray(path[d + 1].look),
          ctx.camera.position.lerpVectors(posFrom, posTo, g),
          ctx.camera.lookAt(lookFrom.lerp(lookTo, g)),
          elapsed > 2 && samples.push(f * 1e3),
          samples.length > 3e3 && samples.shift(),
          elapsed - lastReport > 1 && samples.length > 10)
        ) {
          lastReport = elapsed;
          let x = samples.slice().sort((M, E) => M - E),
            y = x.reduce((M, E) => M + E, 0) / x.length,
            b = x[Math.floor(x.length * 0.99)],
            m = x[x.length >> 1],
            A = ctx.render.stats ? ctx.render.stats() : {},
            _ = ctx.renderer.getDrawingBufferSize(new THREE.Vector2());
          benchEl.textContent = `SALTLINE BENCH  t=${elapsed.toFixed(0)}s
GPU: ${gpuName}
buffer ${_.x}x${_.y}  quality ${ctx.quality.name}  dpr ${window.devicePixelRatio}
frame ms avg ${y.toFixed(1)}  median ${m.toFixed(1)}  p99 ${b.toFixed(1)}  => ${(1e3 / y).toFixed(0)} fps
stats ${JSON.stringify(A)}
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
