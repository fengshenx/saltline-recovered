#!/usr/bin/env node
// 反混淆流水线（阶段 3）：把 stage2.js 按模块归属切分成 ES 模块。
//
// 切分依据：每个顶层符号在 naming 阶段被归到 docs/MODULES.md 的某个模块；同一 var 语句
// 里的多个符号如果跨模块，会被拆成多条声明分别归位。模块之间的依赖用自由变量分析自动
// 生成 import/export，不需要手写。
//
// 用法: node tools/split.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, relative, posix } from 'node:path';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const prettier = require('prettier');

const SRC = resolve('extracted/stage2.js');
const MAP = resolve('extracted/symbol-map.json');
const SRC_DIR = resolve('src');

// 浏览器/JS 全局：不需要 import
const GLOBALS = new Set([
  'window', 'document', 'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
  'Boolean', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'Promise', 'Set', 'Map',
  'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect', 'Intl', 'globalThis', 'undefined', 'NaN',
  'Infinity', 'isNaN', 'isFinite', 'parseFloat', 'parseInt', 'eval', 'atob', 'btoa',
  'encodeURIComponent', 'decodeURIComponent', 'structuredClone', 'queueMicrotask',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'fetch', 'performance', 'navigator', 'location',
  'localStorage', 'sessionStorage', 'crypto', 'matchMedia', 'devicePixelRatio', 'innerWidth',
  'innerHeight', 'screen', 'history', 'addEventListener', 'removeEventListener', 'alert',
  'ArrayBuffer', 'DataView', 'Float32Array', 'Float64Array', 'Int8Array', 'Uint8Array',
  'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'BigInt',
  'TextDecoder', 'TextEncoder', 'URL', 'URLSearchParams', 'Blob', 'Image', 'ImageData',
  'OffscreenCanvas', 'Audio', 'AudioContext', 'webkitAudioContext', 'AudioBuffer',
  'HTMLImageElement', 'HTMLCanvasElement', 'HTMLElement', 'Element', 'Node', 'Event',
  'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'TouchEvent', 'Gamepad',
  'DOMParser', 'XMLSerializer', 'Path2D', 'WebGLRenderingContext', 'WebGL2RenderingContext',
]);

//------------------------------------------------------------- 输入
const code = readFileSync(SRC, 'utf8');
const map = JSON.parse(readFileSync(MAP, 'utf8'));
const metaByName = new Map(map.filter((m) => m.name).map((m) => [m.name, m]));

const ast = parser.parse(code, { sourceType: 'script', attachComment: true });
let programPath = null;
traverse(ast, { Program(p) { programPath = p; } });
const programScope = programPath.scope;

// 记下每条语句在原始 bundle 里的位置：ESM 的求值顺序由依赖图决定，而原 bundle 是书写顺序，
// 两者不同会让 `var X = f(Y)` 读到未初始化的 Y。构建时（tools/link.mjs）按这个 order 重新排。
const orderOf = new WeakMap();
ast.program.body.forEach((stmt, idx) => orderOf.set(stmt, idx));

//------------------------------------------------------------- 语句 → 模块
const declaredNames = (stmt) => {
  if (t.isVariableDeclaration(stmt)) {
    return stmt.declarations.filter((d) => t.isIdentifier(d.id)).map((d) => d.id.name);
  }
  if ((t.isFunctionDeclaration(stmt) || t.isClassDeclaration(stmt)) && stmt.id) return [stmt.id.name];
  return [];
};

// 先把多声明 var 拆开（stage2 已拆过，这里兜底）
const body = [];
for (const stmt of ast.program.body) {
  if (t.isVariableDeclaration(stmt) && stmt.declarations.length > 1) {
    for (const d of stmt.declarations) body.push(t.variableDeclaration(stmt.kind, [d]));
  } else body.push(stmt);
}
ast.program.body = body;

// 归属覆盖：three 类型别名被几何/数学/实体多个模块在顶层初始化时使用，留在 assets/geometry.js
// 会和 core/math.js 形成循环依赖（求值时 undefined），所以固定在零依赖的 core/three-types.js。
const MODULE_OVERRIDE = {
  Vec3: 'src/core/three-types.js',
  Quat: 'src/core/three-types.js',
  Mat4: 'src/core/three-types.js',
};

// shader 常量的归属在命名阶段被写成 `shaders/xxx.glsl`，但一个 .glsl 里可能有多条常量，
// text loader 只有 default export，所以统一落成同名 .js 模块壳（内容仍是纯 GLSL 字符串）。
const moduleOf = (name) =>
  MODULE_OVERRIDE[name] ||
  (metaByName.get(name)?.module || null)?.replace(/\.glsl$/, '.js') ||
  null;
const groups = new Map(); // modulePath -> [stmt]
const declaredIn = new Map(); // symbol -> modulePath
const unassigned = [];

// 第一遍：只登记"符号 → 模块"，为后面的引用投票提供依据
for (const stmt of ast.program.body) {
  for (const n of declaredNames(stmt)) {
    const m = moduleOf(n);
    if (m) declaredIn.set(n, m);
  }
}

const INIT_ORDER = 'src/init-order.js';
const ENTRY = 'src/index.js';

// 原 bundle 是按书写顺序求值的一整段代码；ES 模块的求值顺序由依赖图决定，两者不同。
// 所以顶层"执行语句"（注册道具、给命名空间挂 getter、装配循环）不能散在各模块里，
// 否则会读到还没赋值的 var。这里把它们按原始顺序集中到 init-order.js，由入口最后执行。
const isDeclStmt = (stmt) =>
  t.isVariableDeclaration(stmt) || t.isFunctionDeclaration(stmt) || t.isClassDeclaration(stmt);

const isBootCall = (stmt) =>
  t.isExpressionStatement(stmt) &&
  t.isCallExpression(stmt.expression) &&
  t.isMemberExpression(stmt.expression.callee) &&
  t.isIdentifier(stmt.expression.callee.property, { name: 'catch' });

const referencedModules = (stmt) => {
  const votes = new Map();
  const wrapper = t.file(t.program([t.cloneNode(stmt, true, true)]));
  traverse(wrapper, {
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return;
      const m = declaredIn.get(path.node.name);
      if (m) votes.set(m, (votes.get(m) || 0) + 1);
    },
  });
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
};

// 第二遍：归属
for (const stmt of ast.program.body) {
  const names = declaredNames(stmt);
  let mod = null;
  if (isDeclStmt(stmt)) {
    for (const n of names) {
      const m = declaredIn.get(n);
      if (m) { mod = m; break; }
    }
    if (!mod) mod = referencedModules(stmt);
  } else if (isBootCall(stmt)) {
    mod = ENTRY;
  } else {
    mod = INIT_ORDER;
  }
  if (!mod) {
    mod = 'src/misc.js';
    if (names.length) unassigned.push(...names);
  }
  if (!groups.has(mod)) groups.set(mod, []);
  groups.get(mod).push(stmt);
  for (const n of names) declaredIn.set(n, mod);
}

//------------------------------------------------------------- 自由变量 → 依赖
const depModules = new Map(); // module -> Map(symbol -> fromModule)
const exportedSymbols = new Set();

for (const [mod, stmts] of groups) {
  const deps = new Map();
  for (const stmt of stmts) {
    const wrapper = t.file(t.program([stmt]));
    traverse(wrapper, {
      Identifier(path) {
        if (!path.isReferencedIdentifier()) return;
        const name = path.node.name;
        if (name === 'THREE' || GLOBALS.has(name)) return;
        if (declaredIn.has(name)) {
          const from = declaredIn.get(name);
          if (from !== mod) deps.set(name, from);
          return;
        }
        // 该语句自己声明的局部不算依赖
        if (programScope.hasBinding(name)) {
          const from = declaredIn.get(name);
          if (from && from !== mod) deps.set(name, from);
          return;
        }
        if (mod !== 'src/misc.js') deps.set(name, '?unresolved');
      },
    });
  }
  if (deps.size) depModules.set(mod, deps);
  for (const [name] of deps) exportedSymbols.add(name);
}

//------------------------------------------------------------- 生成文件
rmSync(SRC_DIR, { recursive: true, force: true });
const banner = (mod) => {
  const tag = mod.replace(/^src\//, '');
  return `// ${tag} — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。`;
};

const relImport = (from, to) => {
  const r = posix.relative(posix.dirname(from.replace(/^src\//, '')), to.replace(/^src\//, ''));
  return r.startsWith('.') ? r : `./${r}`;
};

const stats = [];
for (const [mod, stmts] of groups) {
  const out = [];
  const usesTHREE = new Set();
  const deps = depModules.get(mod) || new Map();
  const byFrom = new Map();
  for (const [name, from] of deps) {
    if (from === '?unresolved') continue;
    if (!byFrom.has(from)) byFrom.set(from, []);
    byFrom.get(from).push(name);
  }
  // 是否用到 THREE
  for (const stmt of stmts) {
    const wrapper = t.file(t.program([stmt]));
    traverse(wrapper, {
      Identifier(path) {
        if (path.isReferencedIdentifier() && path.node.name === 'THREE') usesTHREE.add('THREE');
      },
    });
  }

  if (usesTHREE.size) out.push(`import * as THREE from 'three';`);
  for (const [from, names] of [...byFrom].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`import { ${[...new Set(names)].sort().join(', ')} } from '${relImport(mod, from)}';`);
  }
  // 入口先跑装配语句（原始书写顺序），再调用启动函数
  if (mod === ENTRY) out.push(`import '${relImport(mod, INIT_ORDER)}';`);
  out.push('');

  // 注释不用 babel 的注释附着（拆语句时容易串位），而是从符号表按名字重新注入；
  // export 也用字符串前缀，避免 generate 出 `export /** doc */ function` 这种形态。
  for (const stmt of stmts) {
    const names = declaredNames(stmt);
    const docName = names.find((n) => metaByName.get(n)?.doc);
    const isExported = names.some((n) => exportedSymbols.has(n));
    const declLike =
      t.isVariableDeclaration(stmt) || t.isFunctionDeclaration(stmt) || t.isClassDeclaration(stmt);
    let block = '';
    if (docName) {
      block += `/**\n * ${metaByName.get(docName).doc.replace(/\n+/g, ' ')}\n */\n`;
    }
    block +=
      (isExported && declLike ? 'export ' : '') +
      generate(stmt, { comments: false, jsescOption: { minimal: true } }).code;
    out.push(block);
  }

  let text = `${banner(mod)}\n\n${out.join('\n\n')}\n`;
  try {
    text = await prettier.format(text, { parser: 'babel', printWidth: 100, singleQuote: true });
  } catch (e) {
    text += `\n// prettier failed: ${e.message}\n`;
  }
  const full = resolve(SRC_DIR, mod.replace(/^src\//, ''));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
  stats.push({ mod, bytes: text.length, lines: text.split('\n').length, stmts: stmts.length, deps: deps.size });
}

writeFileSync(
  resolve(SRC_DIR, '.manifest.json'),
  JSON.stringify(
    [...groups.entries()].flatMap(([mod, stmts]) =>
      stmts.map((s) => ({ mod, names: declaredNames(s), order: orderOf.get(s) ?? 1e9 }))
    ),
    null,
    1
  )
);

writeFileSync(
  resolve('extracted/SPLIT-REPORT.md'),
  [
    '# 切分报告',
    '',
    `模块 ${stats.length} 个，顶层语句 ${stats.reduce((a, s) => a + s.stmts, 0)} 条`,
    '',
    '| 模块 | 行 | 字节 | 语句 | 依赖 |',
    '|---|---|---|---|---|',
    ...stats.sort((a, b) => a.mod.localeCompare(b.mod)).map((s) => `| ${s.mod} | ${s.lines} | ${s.bytes} | ${s.stmts} | ${s.deps} |`),
    '',
    `未归类的顶层符号（${unassigned.length}）: ${unassigned.join(' ') || '无'}`,
  ].join('\n')
);

console.log(`模块 ${stats.length} 个 / 语句 ${stats.reduce((a, s) => a + s.stmts, 0)} 条`);
console.log(`未归类符号 ${unassigned.length}`);
for (const s of stats.sort((a, b) => b.bytes - a.bytes).slice(0, 12)) {
  console.log(`  ${s.mod.padEnd(34)} ${String(s.lines).padStart(6)} 行 ${String(s.stmts).padStart(3)} 语句 ${String(s.deps).padStart(3)} 依赖`);
}
