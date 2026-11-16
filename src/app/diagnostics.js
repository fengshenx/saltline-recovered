// app/diagnostics.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

/**
 * 致命错误兜底：把启动失败原因写进页面上的 #fatal 区块并记到 window.__fatal，保证黑屏时用户仍能看到原因
 */
export function showFatalError(error) {
  ((window.__fatal = String(error)), console.error('[fatal] ' + error));
  let fatalEl = document.getElementById('fatal');
  (fatalEl ||
    ((fatalEl = document.createElement('div')),
    (fatalEl.id = 'fatal'),
    document.getElementById('app').appendChild(fatalEl)),
    (fatalEl.textContent = 'Saltline could not start: ' + error));
}
