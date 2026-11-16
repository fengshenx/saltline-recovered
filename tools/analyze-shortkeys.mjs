#!/usr/bin/env node
// 短字段名可行性分析（只读）。
//
// 反混淆后残留的 1–2 字符标识符里，有一大类不是变量而是**对象字面量的键**：
//   { px: 0, py: 0, pz: 0 }、{ v: sfxRecipe, k: sfxName }、{ g: gainNode(0) }
// 这类键改名要保证所有读写点同步，跨模块的还要保证数据结构契约不变。
//
// 本脚本统计每个短键名的定义点、读取点与涉及模块，用于判断哪些能局部改、哪些不能。
// 输出 extracted/shortkeys/report.json
//
// 用法: node tools/analyze-shortkeys.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SRC = resolve('src');
const OUT = resolve('extracted/shortkeys');

const isShort = (n) => typeof n === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]?$/.test(n);
const keyNameOf = (k) =>
  k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : null;

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(SRC);

const keys = new Map();
const touch = (name) => {
  if (!keys.has(name)) keys.set(name, { name, defs: [], reads: [], modules: new Set() });
  return keys.get(name);
};

for (const file of files) {
  const mod = relative(resolve('.'), file);
  const ast = parser.parse(readFileSync(file, 'utf8'), { sourceType: 'module' });
  traverse(ast, {
    ObjectProperty(path) {
      // 解构里的 property 不计入定义（那是读取）
      if (path.parentPath.isObjectPattern() || path.node.computed) return;
      const name = keyNameOf(path.node.key);
      if (!name || !isShort(name)) return;
      const rec = touch(name);
      rec.defs.push({ mod, line: path.node.loc?.start.line ?? 0, shorthand: !!path.node.shorthand });
      rec.modules.add(mod);
    },
    ObjectPattern(path) {
      for (const prop of path.node.properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed) continue;
        const name = keyNameOf(prop.key);
        if (!name || !isShort(name)) continue;
        const rec = touch(name);
        rec.reads.push({ mod, line: prop.loc?.start.line ?? 0, destructured: true });
        rec.modules.add(mod);
      }
    },
    MemberExpression(path) {
      if (path.node.computed) return;
      const p = path.node.property;
      if (p.type !== 'Identifier' || !isShort(p.name)) return;
      const rec = touch(p.name);
      rec.reads.push({ mod, line: path.node.loc?.start.line ?? 0 });
      rec.modules.add(mod);
    },
  });
}

const rows = [...keys.values()]
  .map((r) => ({
    name: r.name,
    defs: r.defs.length,
    reads: r.reads.length,
    moduleCount: r.modules.size,
    modules: [...r.modules].sort(),
    shorthandDefs: r.defs.filter((d) => d.shorthand).length,
    defSites: r.defs.slice(0, 6),
    readSites: r.reads.slice(0, 6),
  }))
  .sort((a, b) => b.defs + b.reads - (a.defs + a.reads));

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(rows, null, 1));

const single = rows.filter((r) => r.moduleCount === 1);
const multi = rows.filter((r) => r.moduleCount > 1);
const line = (r) =>
  `  ${r.name.padEnd(4)} defs ${String(r.defs).padStart(4)} reads ${String(r.reads).padStart(5)}  ` +
  `${r.moduleCount === 1 ? r.modules[0].replace(/^src\//, '') : r.moduleCount + ' 模块'}`;

console.log(`扫描 ${files.length} 个模块，短键名 ${rows.length} 个（单模块 ${single.length} / 跨模块 ${multi.length}）`);
console.log('\n—— 跨模块使用（改名需全局一致，风险最高）');
for (const r of multi.slice(0, 25)) console.log(line(r));
console.log('\n—— 单模块使用（可局部改）');
for (const r of single.slice(0, 20)) console.log(line(r));
