#!/usr/bin/env node
// 重新构建：把 src/ 打包回单文件 HTML。
// 外壳（head / CSS / DOM 骨架）沿用原件，只替换 <script> 里的内容——UI 样式与 HUD 骨架
// 本来就是手写未压缩的，没必要重构。
//
// 用法: node tools/build.mjs [--minify]
import './link.mjs';
import esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const minify = process.argv.includes('--minify');
const dev = process.argv.includes('--dev');
const SHELL = 'input/saltline.original.html';

const result = await esbuild.build({
  entryPoints: ['build/bundle.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  charset: 'ascii',
  legalComments: 'none',
  minify,
  write: false,
  logLevel: 'warning',
  loader: { '.glsl': 'text' },
  outdir: 'dist',
});

const js = result.outputFiles[0].text;
const shell = readFileSync(SHELL, 'utf8');
const open = shell.indexOf('<script>');
const close = shell.lastIndexOf('</script>') + '</script>'.length;
if (open < 0 || close < open) throw new Error('外壳里没找到 <script> 区块');

// dev 诊断块：把启动期状态与致命错误堆栈写进 DOM，方便无头环境通过快照读取。
// 只在 --dev 时注入，正式产物不含。捕获脚本必须在游戏脚本之前注册，否则拿不到启动期异常。
const diagHead = dev
  ? `<script>
window.addEventListener('error', function (e) {
  window.__fatal = (window.__fatal || '') + '\\n[uncaught] ' + ((e.error && e.error.stack) || e.message);
});
window.addEventListener('unhandledrejection', function (e) {
  window.__fatal = (window.__fatal || '') + '\\n[rejection] ' + ((e.reason && e.reason.stack) || e.reason);
});
</script>`
  : '';

const diagTail = dev
  ? `<pre id="diag" style="position:fixed;left:0;bottom:0;max-width:100%;max-height:60%;overflow:auto;font:11px/1.3 monospace;color:#f66;background:#000c;z-index:9999;margin:0;padding:8px;white-space:pre-wrap">DIAG...</pre>
<script>
// ?auto=1 时自动点 DEPLOY：无头环境里按钮可能落在固定容器视口外，点不到
if (location.search.indexOf('auto=1') >= 0) {
  setTimeout(function () {
    var btn = [].slice.call(document.querySelectorAll('button')).filter(function (b) {
      return /DEPLOY/i.test(b.textContent || '');
    })[0];
    if (btn) btn.click();
  }, 2500);
}
setInterval(function () {
  var d = document.getElementById('diag');
  if (!d) return;
  d.textContent = JSON.stringify({
    ready: window.__ready,
    frames: window.__frames,
    fatal: window.__fatal,
    errors: (window.__errors || []).slice(0, 5),
    stub: window.__G ? Object.keys(window.__G).filter(function (k) {
      var v = window.__G[k];
      return v && typeof v === 'object' && v.stub;
    }).join(',') : null,
    renderer: window.__G && window.__G.renderer ? (window.__G.renderer.constructor && window.__G.renderer.constructor.name) : null,
    hasLoop: !!(window.__G && window.__G.renderer && typeof window.__G.renderer.setAnimationLoop === 'function'),
    state: window.__G && window.__G.game ? window.__G.game.state : null,
    modules: window.__G ? Object.keys(window.__G).filter(function (k) {
      return window.__G[k] && typeof window.__G[k] === 'object';
    }).join(',') : null
  }, null, 1);
}, 1000);
</script>`
  : '';

const html =
  shell.slice(0, open) + diagHead + '<script>\n' + js + '\n</script>' + diagTail + shell.slice(close);

mkdirSync('dist', { recursive: true });
const outFile = dev ? 'dist/saltline.dev.html' : 'dist/saltline.html';
writeFileSync(outFile, html);
console.log(`${outFile}  ${(html.length / 1024).toFixed(0)}KB  (js ${(js.length / 1024).toFixed(0)}KB, minify=${minify})`);
