#!/usr/bin/env node
// 真 ESM 试验构建：跳过 link.mjs，esbuild 直接以 src/index.js 为入口按模块求值顺序打包。
// 用于暴露隐式求值依赖（假 ESM 靠 link.mjs 的 order 兜底的部分）。
//
// 用法: node tools/build-esm.mjs [--dev]
import esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const dev = process.argv.includes('--dev');
const SHELL = 'input/saltline.original.html';

const result = await esbuild.build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  charset: 'ascii',
  legalComments: 'none',
  minify: false,
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
if (location.search.indexOf('auto=1') >= 0) {
  setTimeout(function () {
    var btn = [].slice.call(document.querySelectorAll('button')).filter(function (b) {
      return /DEPLOY/i.test(b.textContent || '');
    })[0];
    if (btn) btn.click();
  }, 2500);
}
var wantDiag = /[?&](diag=1|check=)/.test(location.search);
setInterval(function () {
  var d = document.getElementById('diag');
  if (!d || !wantDiag) return;
  d.style.display = 'block';
  d.textContent = JSON.stringify({
    ready: window.__ready,
    frames: window.__frames,
    fatal: window.__fatal,
    errors: (window.__errors || []).slice(0, 5),
  }, null, 1);
}, 1000);
</script>`
  : '';

const html =
  shell.slice(0, open) + diagHead + '<script>\n' + js + '\n</script>' + diagTail + shell.slice(close);
writeFileSync('dist/saltline.esm.html', html);
console.log(`dist/saltline.esm.html  ${(html.length / 1024).toFixed(0)}KB  (js ${(js.length / 1024).toFixed(0)}KB)`);
