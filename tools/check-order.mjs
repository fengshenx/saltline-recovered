#!/usr/bin/env node
// 顺序审计：解析 dist 产物（未 minify 的 IIFE bundle），对每个顶层 var/函数声明建立
// 「赋值语句序号」，再扫全部顶层立即求值语句（var 初始化器 + 表达式语句）里的标识符引用，
// 报出「引用位置早于赋值位置」的名字——即求值时会读到 undefined 的静默漂移。
// 用法: node tools/check-order.mjs [bundle路径，默认 dist/saltline.esm.html]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

const file = process.argv[2] || 'build/esm-bundle.js';
const raw = readFileSync(file, 'utf8');
const code = file.endsWith('.html')
  ? (() => {
      const open = raw.indexOf('<script>');
      const close = raw.indexOf('</script>', open);
      return raw.slice(open + 8, close);
    })()
  : raw;
const ast = parser.parse(code, { sourceType: 'script' });

let stmts = ast.program.body;
// esbuild IIFE 产物：整个包是一条 (() => { ... })() —— 进入函数体取真正的顶层语句
if (stmts.length === 1 && t.isExpressionStatement(stmts[0]) && t.isCallExpression(stmts[0].expression)) {
  const callee = stmts[0].expression.callee;
  if (t.isArrowFunctionExpression(callee) || t.isFunctionExpression(callee))
    stmts = callee.body.body;
}
const GLOBALS = new Set(
  ('document,window,console,location,navigator,performance,THREE,Math,Object,Array,JSON,' +
    'String,Number,Boolean,Date,Map,Set,WeakMap,Float32Array,Float64Array,Uint8Array,' +
    'Uint8ClampedArray,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,ArrayBuffer,' +
    'DataView,Error,TypeError,RangeError,Promise,Symbol,undefined,globalThis,self,' +
    'localStorage,setTimeout,setInterval,clearTimeout,clearInterval,requestAnimationFrame,' +
    'cancelAnimationFrame,devicePixelRatio,innerWidth,innerHeight,Intl,RegExp,Function,' +
    'Proxy,Reflect,BigInt,structuredClone,queueMicrotask,TextDecoder,TextEncoder,URL,Blob,' +
    'fetch,AudioContext,OffscreenCanvas,Image,atob,btoa,isNaN,isFinite,parseInt,parseFloat,' +
    'NaN,Infinity,arguments')
    .split(','),
);

// name -> 赋值语句序号（首个非提升赋值；var X = fn 也在其中）
const definedAt = new Map();
const isFnDecl = new Set();
stmts.forEach((s, i) => {
  if (t.isFunctionDeclaration(s) && s.id) {
    definedAt.set(s.id.name, i); // 函数声明整体提升，安全
    isFnDecl.add(s.id.name);
    return;
  }
  if (t.isVariableDeclaration(s)) {
    for (const d of s.declarations) {
      if (!t.isIdentifier(d.id)) continue;
      if (d.init && !definedAt.has(d.id.name)) definedAt.set(d.id.name, i);
      else if (!d.init && !definedAt.has(d.id.name)) definedAt.set(d.id.name, Infinity); // 声明未赋值
    }
  }
});

const findings = [];
// 手写遍历收集引用（traverse 手搓 File 节点不可靠）
const collectRefs = (node, refs) => {
  if (!node || typeof node.type !== 'string') return;
  // 函数体子树整体跳过：箭头/getter thunk 只在调用时求值（如 __export 的 () => NAME）
  if (t.isFunction(node) || t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) return;
  if (t.isIdentifier(node)) {
    const parent = node.__parent, key = node.__key;
    const isPropKey =
      parent &&
      ((t.isMemberExpression(parent) && key === 'property' && !parent.computed) ||
        (t.isObjectProperty(parent) && key === 'key' && !parent.computed) ||
        (t.isObjectMethod(parent) && key === 'key' && !parent.computed));
    const isBinding =
      parent &&
      ((t.isVariableDeclarator(parent) && key === 'id') ||
        (t.isFunctionDeclaration(parent) && key === 'id') ||
        (t.isFunction(parent) && key === 'params'));
    if (!isPropKey && !isBinding) refs.push(node);
  }
  for (const k of Object.keys(node)) {
    if (['loc', 'start', 'end', 'leadingComments', 'trailingComments', 'innerComments', 'range', '__parent', '__key'].includes(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) { if (c && typeof c.type === 'string') { c.__parent = node; c.__key = k; } collectRefs(c, refs); }
    else if (v && typeof v.type === 'string') { v.__parent = node; v.__key = k; collectRefs(v, refs); }
  }
};
stmts.forEach((s, i) => {
  // 只审计顶层立即求值：表达式语句 + var 声明的初始化器（排除函数体——那是运行期）
  const eagerNodes = [];
  if (t.isExpressionStatement(s)) eagerNodes.push(s.expression);
  if (t.isVariableDeclaration(s))
    for (const d of s.declarations) if (d.init) eagerNodes.push(d.init);
  if (!eagerNodes.length) return;
  for (const node of eagerNodes) {
    const refs = [];
    collectRefs(node, refs);
    for (const r of refs) {
      const name = r.name;
      if (GLOBALS.has(name) || isFnDecl.has(name)) continue;
      const def = definedAt.get(name);
      if (def === undefined || def === Infinity) continue;
      if (def > i) findings.push({ name, useStmt: i, defStmt: def, line: r.loc?.start.line });
    }
  }
});

// 同一名字可能多次命中，按 (name) 聚合
const agg = new Map();
for (const f of findings) if (!agg.has(f.name)) agg.set(f.name, f);
if (!agg.size) {
  console.log('OK：没有「顶层引用早于赋值」的名字');
} else {
  console.log(`发现 ${agg.size} 个在赋值前被顶层求值引用的名字：`);
  for (const [name, f] of agg)
    console.log(`  ${name}  使用语句#${f.useStmt}(bundle 行${f.line})  赋值语句#${f.defStmt}`);
}
