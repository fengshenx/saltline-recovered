#!/usr/bin/env node
// 扫描仍然残留短名（1–2 字符）局部变量的函数，产出待治理清单。
//
// 这些是阶段2 重命名时被"安全规则"主动跳过的：新名字与参数/外层绑定同名会造成遮蔽
// （真实踩过 `let x` 遮蔽参数 x 导致 TDZ）。要治理就必须看整个函数给出不冲突的名字，
// 所以这里按函数聚合，交给后续命名步骤。
//
// 用法: node tools/find-shortnames.mjs [--min-bytes 400]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const MIN_BYTES = Number(
  (process.argv.includes('--min-bytes') && process.argv[process.argv.indexOf('--min-bytes') + 1]) || 400
);

const ast = parser.parse(readFileSync(resolve('extracted/stage2.js'), 'utf8'), { sourceType: 'script' });

const isShort = (n) => n.length <= 2;
const rows = [];

const nameOf = (path) => {
  const n = path.node;
  if (t.isFunctionDeclaration(n) && n.id) return n.id.name;
  const p = path.parent;
  if (t.isVariableDeclarator(p) && t.isIdentifier(p.id)) return p.id.name;
  if (t.isObjectProperty(p) && t.isIdentifier(p.key)) return p.key.name;
  if (t.isClassMethod(p) || t.isObjectMethod(p)) return t.isIdentifier(p.key) ? p.key.name : null;
  if (t.isAssignmentExpression(p) && t.isIdentifier(p.left)) return p.left.name;
  return null;
};

traverse(ast, {
  Function(path) {
    const name = nameOf(path);
    if (!name) return;
    const code = generate(path.node).code;
    if (code.length < MIN_BYTES) return;

    const shortParams = [];
    for (const p of path.node.params) if (t.isIdentifier(p) && isShort(p.name)) shortParams.push(p.name);

    const shortLocals = new Set();
    path.traverse({
      Scopable(sub) {
        if (sub === path) return;
        for (const n of Object.keys(sub.scope.bindings)) if (isShort(n)) shortLocals.add(n);
      },
      VariableDeclarator(sub) {
        if (t.isIdentifier(sub.node.id) && isShort(sub.node.id.name)) shortLocals.add(sub.node.id.name);
      },
    });

    if (!shortParams.length && !shortLocals.size) return;
    rows.push({
      function: name,
      bytes: code.length,
      line: path.node.loc?.start.line ?? 0,
      params: path.node.params.map((p) => (t.isIdentifier(p) ? p.name : '_')),
      shortParams,
      shortLocals: [...shortLocals].sort(),
    });
  },
});

rows.sort((a, b) => b.bytes - a.bytes);
mkdirSync(resolve('extracted/shortnames'), { recursive: true });
writeFileSync(resolve('extracted/shortnames/report.json'), JSON.stringify(rows, null, 1));

const totalShort = rows.reduce((a, r) => a + r.shortLocals.length + r.shortParams.length, 0);
console.log(`仍有短名的函数 ${rows.length} 个，涉及短名绑定 ${totalShort} 个（阈值 ${MIN_BYTES} 字节）`);
console.log('\n最大的 15 个:');
for (const r of rows.slice(0, 15)) {
  console.log(
    `  ${String(r.bytes).padStart(6)}B 行${String(r.line).padStart(5)}  ${r.function.padEnd(28)} params[${r.shortParams.join(',')}] locals[${r.shortLocals.join(',')}]`
  );
}

// 按行区间切成 6 份，供并行治理
// 只治理"体量最大的那批"函数：它们占了代码行数的绝大部分，小函数里的短名对可读性影响有限。
// 每份 12 个函数并附上函数源码，代理不用再去大文件里翻。
const CHUNKS = Number((process.argv.includes('--chunks') && process.argv[process.argv.indexOf('--chunks') + 1]) || 8);
const OFFSET = Number((process.argv.includes('--offset') && process.argv[process.argv.indexOf('--offset') + 1]) || 0);
const LIMIT = Number((process.argv.includes('--limit') && process.argv[process.argv.indexOf('--limit') + 1]) || 48);
const SUFFIX = (process.argv.includes('--suffix') && process.argv[process.argv.indexOf('--suffix') + 1]) || '';
const picked = rows.slice(OFFSET, OFFSET + LIMIT);

// 重新解析拿源码（rows 里只有元数据）
const codeByFn = new Map();
traverse(ast, {
  Function(path) {
    const n = nameOf(path);
    if (n && !codeByFn.has(n)) codeByFn.set(n, generate(path.node).code);
  },
});

// 按字节做 LPT 均衡：最大的函数占 37KB，固定条数切分会让某一份爆到 300KB 以上
const buckets = Array.from({ length: CHUNKS }, () => ({ bytes: 0, items: [] }));
for (const r of picked) {
  buckets.sort((a, b) => a.bytes - b.bytes);
  buckets[0].items.push(r);
  buckets[0].bytes += r.bytes;
}
let written = 0;
buckets.forEach((b, i) => {
  if (!b.items.length) return;
  const part = b.items.map((r) => ({ ...r, code: codeByFn.get(r.function) || '' }));
  writeFileSync(resolve(`extracted/shortnames/chunk${SUFFIX}-${i + 1}.json`), JSON.stringify(part, null, 1));
  written++;
  console.log(`  chunk-${i + 1}: ${part.length} 函数 / ${(b.bytes / 1024).toFixed(0)}KB`);
});
console.log(`\n治理目标：体量最大的 ${picked.length} 个函数（共 ${rows.length} 个含短名），切成 ${written} 份`);
