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
// ?check=<prop> 道具接合检查：取每个子 mesh 的世界包围盒，用并查集合并相交的部件，
// 簇数 > 1 说明有部件悬空（原 bundle 没有任何几何连通性校验，这里补上）
window.__checkProp = function (name, tol) {
  var T = window.__G && window.__G.THREE;
  if (!T || !window.__G.props) return { error: 'props 未加载' };
  var root;
  try {
    root = window.__G.props.build(name, { seed: 7 });
  } catch (e) {
    return { error: 'build 失败: ' + ((e && e.message) || e) };
  }
  root.updateMatrixWorld(true);
  var pads = tol === undefined ? 0.01 : tol;
  var boxes = [];
  root.traverse(function (o) {
    if (!o.isMesh) return;
    var b = new T.Box3().setFromObject(o);
    boxes.push({ name: (o.material && o.material.name) || '?', box: b, c: b.getCenter(new T.Vector3()) });
  });
  var parent = boxes.map(function (_, i) { return i; });
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
  for (var i = 0; i < boxes.length; i++)
    for (var j = i + 1; j < boxes.length; j++) {
      var a = boxes[i].box.clone().expandByScalar(pads),
        b = boxes[j].box.clone().expandByScalar(pads);
      if (a.intersectsBox(b)) union(i, j);
    }
  var groups = {};
  boxes.forEach(function (bx, i) { var r = find(i); (groups[r] = groups[r] || []).push(bx); });
  var clusters = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.length - a.length; });
  var orphan = [];
  for (var c = 1; c < clusters.length; c++)
    orphan.push(clusters[c].map(function (bx) {
      return bx.name + '@(' + bx.c.x.toFixed(2) + ',' + bx.c.y.toFixed(2) + ',' + bx.c.z.toFixed(2) + ')';
    }));
  var bb = new T.Box3().setFromObject(root), sz = bb.getSize(new T.Vector3());
  return {
    prop: name,
    parts: boxes.length,
    clusters: clusters.length,
    ok: clusters.length === 1,
    orphan: orphan,
    bounds: [+sz.x.toFixed(2), +sz.y.toFixed(2), +sz.z.toFixed(2)],
  };
};

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
    stub: window.__G ? Object.keys(window.__G).filter(function (k) {
      var v = window.__G[k];
      return v && typeof v === 'object' && v.stub;
    }).join(',') : null,
    renderer: window.__G && window.__G.renderer ? (window.__G.renderer.constructor && window.__G.renderer.constructor.name) : null,
    hasLoop: !!(window.__G && window.__G.renderer && typeof window.__G.renderer.setAnimationLoop === 'function'),
    state: window.__G && window.__G.game ? window.__G.game.state : null,
    propCheck: (function () {
      var m = /[?&]check=([^&]+)/.exec(location.search);
      if (!m || !window.__checkProp) return null;
      var r = window.__checkProp(decodeURIComponent(m[1]));
      return r && r.error ? r : { ok: r.ok, parts: r.parts, clusters: r.clusters, bounds: r.bounds, orphan: r.ok ? undefined : r.orphan };
    })(),
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
