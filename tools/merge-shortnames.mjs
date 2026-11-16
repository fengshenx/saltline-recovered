#!/usr/bin/env node
// 把代理产出的局部变量命名（extracted/shortnames/resolved-*.json）合并进命名表。
//
// 代理按"函数当前名 → 旧短名 → 新名"输出，而命名表以压缩函数名索引，这里做一次反查。
// 冲突不在这里判断：tools/apply-names.mjs 的 scope 检查（同作用域 + 祖先作用域）会兜底，
// 有冲突的映射会被跳过并记入报告。
//
// 用法: node tools/merge-shortnames.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const NAMES = resolve('extracted/names/merged.json');
const DIR = resolve('extracted/shortnames');

const merged = JSON.parse(readFileSync(NAMES, 'utf8'));
const byName = new Map();
for (const s of merged.symbols) if (!byName.has(s.name)) byName.set(s.name, s.compressed);

const resolved = new Map(); // compressed -> {old: new}
let files = 0;
let pairs = 0;
const unresolvedFns = [];

for (const f of readdirSync(DIR).filter((x) => /^resolved2?-\d+\.json$/.test(x))) {
  const data = JSON.parse(readFileSync(resolve(DIR, f), 'utf8'));
  files++;
  for (const [fnName, mapping] of Object.entries(data)) {
    if (!mapping || typeof mapping !== 'object') continue;
    // 顶层函数用压缩名反查；对象方法/嵌套函数的名字是属性名（不参与压缩），直接用
    const compressed = byName.get(fnName) || fnName;
    const bucket = resolved.get(compressed) || {};
    // 同一函数内不许两个短名映射到同一个新名
    const used = new Set(Object.values(bucket));
    for (const [oldName, newName] of Object.entries(mapping)) {
      if (!oldName || !newName || oldName === newName) continue;
      if (used.has(newName)) continue;
      bucket[oldName] = newName;
      used.add(newName);
      pairs++;
    }
    resolved.set(compressed, bucket);
  }
}

merged.locals = merged.locals || {};
let fns = 0;
for (const [compressed, mapping] of resolved) {
  merged.locals[compressed] = { ...(merged.locals[compressed] || {}), ...mapping };
  fns++;
}
writeFileSync(NAMES, JSON.stringify(merged, null, 1));

console.log(`合并 ${files} 份，覆盖 ${fns} 个函数，新增映射 ${pairs} 条`);
if (unresolvedFns.length) console.log(`函数名对不上（${unresolvedFns.length}）: ${unresolvedFns.slice(0, 8).join(', ')}`);
