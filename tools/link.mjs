#!/usr/bin/env node
// 链接器：把 src/ 的模块拼成一个按原始书写顺序求值的单文件入口。
//
// 为什么不用 esbuild 的 ESM 打包：原 bundle 是"一个 IIFE 里顺序执行的一大段代码"，
// 大量 `var X = f(Y)` 依赖严格的书写顺序；ES 模块的求值顺序由依赖图决定，遇到循环依赖
// 就会读到还没赋值的 var。这里按 split 记录的原始 order 重新排列语句，恢复原有语义，
// 而 src/ 仍然是正常的 import/export 结构（可编辑、IDE 可分析）。
//
// 输出 build/bundle.js，再由 tools/build.mjs 交给 esbuild 打包 three 与压缩。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join, relative } from 'node:path';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const SRC = resolve('src');
const OUT = resolve('build/bundle.js');

const declaredNames = (node) => {
  if (t.isVariableDeclaration(node)) {
    return node.declarations.filter((d) => t.isIdentifier(d.id)).map((d) => d.id.name);
  }
  if ((t.isFunctionDeclaration(node) || t.isClassDeclaration(node)) && node.id) return [node.id.name];
  return [];
};

const manifest = JSON.parse(readFileSync(join(SRC, '.manifest.json'), 'utf8'));

//------------------------------------------------------------- 读所有模块
const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
};
walk(SRC);

const buckets = new Map(); // mod(相对 src 的 'src/x.js') -> { named: Map, anon: [] }
// 外部包 import 原先被固定写成只保留 three，声明用的包（如 three-bvh-csg）会被丢掉，这里按需重建
const externalImports = new Map();
const rebuildImport = (node) => {
  const defaultBinding = [];
  const namespaceBinding = [];
  const namedBindings = [];
  for (const spec of node.specifiers) {
    if (t.isImportDefaultSpecifier(spec)) defaultBinding.push(spec.local.name);
    else if (t.isImportNamespaceSpecifier(spec)) namespaceBinding.push(`* as ${spec.local.name}`);
    else
      namedBindings.push(
        spec.imported.name === spec.local.name
          ? spec.imported.name
          : `${spec.imported.name} as ${spec.local.name}`,
      );
  }
  const clause = [
    defaultBinding[0],
    namespaceBinding[0],
    namedBindings.length ? `{ ${namedBindings.join(', ')} }` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `import ${clause} from '${node.source.value}';`;
};
for (const file of files) {
  const rel = relative(resolve('.'), file).split('\\').join('/');
  const ast = parser.parse(readFileSync(file, 'utf8'), { sourceType: 'module' });
  const bucket = { named: new Map(), anon: [], leftover: [] };
  for (const node of ast.program.body) {
    let stmt = node;
    if (t.isImportDeclaration(node)) {
      if (!node.source.value.startsWith('.'))
        externalImports.set(node.source.value, rebuildImport(node));
      continue;
    }
    if (t.isExportAllDeclaration(node)) continue;
    if (t.isExportNamedDeclaration(node)) {
      if (!node.declaration) continue; // export { a, b } 之类
      stmt = node.declaration;
    }
    const names = declaredNames(stmt);
    if (names.length) {
      for (const n of names) bucket.named.set(n, stmt);
    } else {
      bucket.anon.push(stmt);
    }
    bucket.leftover.push(stmt);
  }
  buckets.set(rel, bucket);
}

//------------------------------------------------------------- 按 order 重排
const ordered = [];
const used = new Set();
let matched = 0;
const sorted = [...manifest].sort((a, b) => a.order - b.order);
for (const entry of sorted) {
  const bucket = buckets.get(entry.mod);
  if (!bucket) continue;
  let stmt = null;
  if (entry.names.length) {
    for (const n of entry.names) {
      const s = bucket.named.get(n);
      if (s && !used.has(s)) { stmt = s; bucket.named.delete(n); break; }
    }
  } else if (bucket.anon.length) {
    stmt = bucket.anon.shift();
  }
  if (stmt && !used.has(stmt)) { ordered.push(stmt); used.add(stmt); matched++; }
}

// 用户新增的语句（manifest 里没有）：按模块顺序附在末尾，保证不会凭空消失
const extra = [];
for (const [, bucket] of buckets) {
  for (const s of bucket.leftover) if (!used.has(s)) extra.push(s);
}
if (extra.length) ordered.push(...extra);

//------------------------------------------------------------- 输出
const chunks = ordered.map((node) =>
  generate(node, { comments: true, jsescOption: { minimal: true } }).code
);

const code = `// 由 tools/link.mjs 生成——不要直接编辑，改 src/ 后跑 npm run build。
// 语句顺序 = 原始 bundle 的书写顺序（src/.manifest.json 记录），保证 var 初始化顺序不变。
${[...externalImports.entries()]
  .sort(([a], [b]) => (a === 'three' ? -1 : b === 'three' ? 1 : a.localeCompare(b)))
  .map(([, line]) => line)
  .join('\n')}

${chunks.join('\n\n')}
`;

mkdirSync(resolve('build'), { recursive: true });
writeFileSync(OUT, code);

console.log(
  `build/bundle.js  ${ordered.length} 条语句（manifest ${sorted.length}，新增 ${extra.length}）`
);
if (matched !== sorted.length) console.log(`未匹配到的 manifest 条目 ${sorted.length - matched}`);
