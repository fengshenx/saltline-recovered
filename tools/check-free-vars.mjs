#!/usr/bin/env node
// 静态检查：列出每个模块中引用了但既未 import 也未本地声明、也不属于全局白名单的名字。
// 假 ESM 靠单文件全局作用域掩盖这类漏引；真 ESM 下它们是运行期 ReferenceError。
// 用法: node tools/check-free-vars.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

const SRC = resolve('src');
const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
};
walk(SRC);

const GLOBALS = new Set(
  (
    'document,window,console,location,navigator,performance,requestAnimationFrame,setTimeout,setInterval,' +
    'clearTimeout,clearInterval,cancelAnimationFrame,THREE,Math,Object,Array,JSON,String,Number,Boolean,' +
    'Date,Map,Set,WeakMap,WeakSet,Float32Array,Float64Array,Uint8Array,Uint8ClampedArray,Uint16Array,' +
    'Uint32Array,Int8Array,Int16Array,Int32Array,BigInt64Array,BigUint64Array,ArrayBuffer,DataView,' +
    'Error,TypeError,RangeError,SyntaxError,EvalError,Promise,Symbol,undefined,globalThis,self,' +
    'localStorage,sessionStorage,requestIdleCallback,cancelIdleCallback,devicePixelRatio,innerWidth,' +
    'innerHeight,outerWidth,outerHeight,Intl,RegExp,Function,Proxy,Reflect,BigInt,structuredClone,' +
    'queueMicrotask,TextDecoder,TextEncoder,URL,URLSearchParams,Blob,File,fetch,AudioContext,' +
    'OffscreenCanvas,Image,DOMParser,XMLHttpRequest,OfflineAudioContext,screen,atob,btoa,escape,unescape,isNaN,isFinite,parseInt,' +
    'parseFloat,decodeURI,decodeURIComponent,encodeURI,encodeURIComponent,NaN,Infinity,ErrorEvent,' +
    'CustomEvent,Event,addEventListener,removeEventListener,dispatchEvent,getComputedStyle,matchMedia,' +
    'createImageBitmap,scheduler,arguments'
  ).split(','),
);

const report = new Map();
for (const file of files) {
  const rel = file.split('saltline-recovered/')[1];
  const ast = parser.parse(readFileSync(file, 'utf8'), { sourceType: 'module' });
  const missing = new Map();
  traverse(ast, {
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (GLOBALS.has(name)) return;
      if (path.scope.getBinding(name)) return;
      // 排除纯类型位置的引用（本项目无 TS，仅防御 JSX/类型误报）
      if (!missing.has(name)) {
        const loc = path.node.loc.start;
        missing.set(name, `${rel}:${loc.line}`);
      }
    },
  });
  if (missing.size) report.set(rel, missing);
}

if (!report.size) {
  console.log('OK：所有引用的名字都有本地声明或 import');
} else {
  console.log(`发现未绑定引用（${[...report.values()].reduce((a, m) => a + m.size, 0)} 个名字，跨 ${report.size} 个文件）：`);
  for (const [rel, missing] of report) {
    console.log(`\n${rel}`);
    for (const [name, loc] of missing) console.log(`  ${name}  (${loc})`);
  }
}
