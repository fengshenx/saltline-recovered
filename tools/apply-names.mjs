#!/usr/bin/env node
// 反混淆流水线（阶段 2）：把分域命名表机械应用到代码上。
//
// 全部重命名都走 babel 的 scope.rename，所以引用点会同步更新、不会改到别的同名绑定，
// 行为零变更。命名表来自 extracted/names/*.json（分域并行产出），冲突在这里集中处理。
//
// 用法: node tools/apply-names.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const prettier = require('prettier');

const IN = resolve('extracted/stage1.js');
const NAMES_DIR = resolve('extracted/names');
const OUT = resolve('extracted');

//------------------------------------------------------------- 合并命名表
const merged = { symbols: new Map(), params: {}, locals: {}, conflicts: [] };

// 合并表（tools/apply-ground-truth.mjs 产出）优先：它已经解决撞名并应用了原版对照。
const mergedPath = resolve(NAMES_DIR, 'merged.json');
if (existsSync(mergedPath)) {
  const data = JSON.parse(readFileSync(mergedPath, 'utf8'));
  for (const s of data.symbols || []) {
    if (!s.compressed || !s.name) continue;
    merged.symbols.set(s.compressed, s);
  }
  Object.assign(merged.params, data.params || {});
  Object.assign(merged.locals, data.locals || {});
} else {
  for (const file of readdirSync(NAMES_DIR).filter((f) => /^[A-H]\.json$/.test(f))) {
    const data = JSON.parse(readFileSync(resolve(NAMES_DIR, file), 'utf8'));
    for (const s of data.symbols || []) {
      if (!s.compressed || !s.name) continue;
      const prev = merged.symbols.get(s.compressed);
      if (prev && prev.name !== s.name) {
        merged.conflicts.push({ compressed: s.compressed, kept: prev.name, dropped: s.name, file });
        continue;
      }
      merged.symbols.set(s.compressed, { ...s, domain: data.domain });
    }
    Object.assign(merged.params, data.params || {});
    Object.assign(merged.locals, data.locals || {});
  }
}

//------------------------------------------------------------- 解析
const code = readFileSync(IN, 'utf8');
const ast = parser.parse(code, { sourceType: 'script' });

// 顶层绑定 → 声明所在语句
const topNames = new Set();
for (const stmt of ast.program.body) {
  if (t.isVariableDeclaration(stmt)) {
    for (const d of stmt.declarations) if (t.isIdentifier(d.id)) topNames.add(d.id.name);
  } else if ((t.isFunctionDeclaration(stmt) || t.isClassDeclaration(stmt)) && stmt.id) {
    topNames.add(stmt.id.name);
  }
}

// 校验：命名表里的 compressed 必须真实存在
const unknown = [...merged.symbols.keys()].filter((n) => !topNames.has(n));
const uncovered = [...topNames].filter((n) => !merged.symbols.has(n));

//------------------------------------------------------------- 函数路径索引（按压缩名）
// 命名表里的函数既可能是 `function u_(...)`，也可能是 `var u_ = (...) => {}` 或
// `obj.u_ = function(){}`，所以名字要从父节点推断，不能只看 FunctionDeclaration.id。
const fnPaths = new Map();
const fnNameCache = new WeakMap();
const nameOfFunction = (path) => {
  const node = path.node;
  if (t.isFunctionDeclaration(node) || t.isClassDeclaration(node)) return node.id?.name || null;
  if (t.isFunctionExpression(node) && node.id) return node.id.name;
  const parent = path.parent;
  if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) return parent.id.name;
  if (t.isObjectProperty(parent) && t.isIdentifier(parent.key)) return parent.key.name;
  if (t.isClassMethod(parent) || t.isObjectMethod(parent)) {
    if (t.isIdentifier(parent.key)) return parent.key.name;
  }
  if (t.isAssignmentExpression(parent) && t.isIdentifier(parent.left)) return parent.left.name;
  return null;
};

let programPath = null;
traverse(ast, {
  Program(path) {
    programPath = path;
  },
  'Function'(path) {
    const name = nameOfFunction(path);
    if (!name) return;
    fnNameCache.set(path.node, name);
    if (!fnPaths.has(name)) fnPaths.set(name, path);
  },
});

//------------------------------------------------------------- 重命名
const renamed = { top: 0, params: 0, locals: 0, skipped: [] };

// 安全规则：新名字不能与任何祖先作用域（含参数、外层 let/const）的绑定同名。
// 否则子作用域的声明会遮蔽外层名字，而原代码在该声明之前对外层名字的引用
// 会变成 TDZ 访问（真实踩过：`let x = ...` 遮蔽了参数 x）。
const bindingNamesOf = (scope) => {
  const names = new Set();
  let s = scope;
  while (s) {
    for (const n of Object.keys(s.bindings)) names.add(n);
    s = s.parent;
  }
  return names;
};

// 函数体内出现的所有绑定名（含嵌套块里的 let/const）。
// 注意 scope.getAllBindings() 只覆盖当前 + 祖先作用域，不含子作用域，
// 所以必须显式遍历子 Scopable，否则参数改名会遮蔽块内同名局部变量。
const allBindingNamesIn = (fnPath) => {
  const names = new Set(Object.keys(fnPath.scope.bindings));
  fnPath.traverse({
    Scopable(p) {
      for (const n of Object.keys(p.scope.bindings)) names.add(n);
    },
  });
  return names;
};

// 1) 参数与局部（用压缩名索引，必须在顶层重命名之前做）
for (const [compressedFn, params] of Object.entries(merged.params)) {
  const fnPath = fnPaths.get(compressedFn);
  if (!fnPath) { renamed.skipped.push(`params:${compressedFn}(未找到函数)`); continue; }
  const fnParams = fnPath.node.params;
  if (params.length !== fnParams.length) {
    renamed.skipped.push(`params:${compressedFn}(参数个数 ${fnParams.length} != ${params.length})`);
    continue;
  }
  const namesInBody = allBindingNamesIn(fnPath);
  params.forEach((newName, idx) => {
    const p = fnParams[idx];
    if (!t.isIdentifier(p) || !newName || p.name === newName) return;
    if (namesInBody.has(newName)) {
      renamed.skipped.push(`params:${compressedFn}.${p.name}->${newName}(函数内已有同名绑定)`);
      return;
    }
    fnPath.scope.rename(p.name, newName);
    renamed.params++;
  });
}

// 局部变量：先一遍收集"哪个作用域里的哪个绑定要改名"，再统一执行。
// （早期版本对每个 (函数, 变量) 各做一次子树遍历，几百次递归把工具跑成了分钟级。）
const renameJobs = [];
traverse(ast, {
  Scopable(path) {
    const owner = path.isFunction()
      ? fnNameCache.get(path.node)
      : fnNameCache.get(path.getFunctionParent()?.node);
    if (!owner) return;
    const mapping = merged.locals[owner];
    if (!mapping) return;
    for (const [oldName, newName] of Object.entries(mapping)) {
      if (!oldName || !newName || oldName === newName) continue;
      if (path.scope.hasOwnBinding(oldName)) {
        renameJobs.push({ scope: path.scope, oldName, newName, owner });
      }
    }
  },
});

for (const job of renameJobs) {
  if (job.scope.hasOwnBinding(job.newName)) {
    renamed.skipped.push(`locals:${job.owner}.${job.oldName}->${job.newName}(同作用域已有)`);
    continue;
  }
  // 祖先作用域已有该名字：改名会遮蔽祖先绑定，导致原本指向祖先的引用变成 TDZ
  const ancestry = bindingNamesOf(job.scope.parent);
  if (ancestry.has(job.newName)) {
    renamed.skipped.push(`locals:${job.owner}.${job.oldName}->${job.newName}(与祖先绑定同名)`);
    continue;
  }
  job.scope.rename(job.oldName, job.newName);
  renamed.locals++;
}

// 2) 顶层符号（program scope，引用点全量同步）
for (const [compressed, meta] of merged.symbols) {
  if (!topNames.has(compressed)) continue;
  if (!meta.name || compressed === meta.name) continue;
  if (programPath.scope.hasOwnBinding(meta.name)) {
    renamed.skipped.push(`top:${compressed}->${meta.name}(名称已占用)`);
    continue;
  }
  programPath.scope.rename(compressed, meta.name);
  renamed.top++;
}

//------------------------------------------------------------- 拆分多 declarator 的 var
// 便于按模块归属切分、也便于给每个符号单独挂 JSDoc
const newBody = [];
for (const stmt of ast.program.body) {
  if (t.isVariableDeclaration(stmt) && stmt.declarations.length > 1) {
    for (const d of stmt.declarations) {
      newBody.push(t.variableDeclaration(stmt.kind, [d]));
    }
  } else {
    newBody.push(stmt);
  }
}
ast.program.body = newBody;

//------------------------------------------------------------- 注入 JSDoc
const nameByCompressed = new Map([...merged.symbols].map(([c, m]) => [c, m]));
const docByName = new Map([...merged.symbols.values()].map((m) => [m.name, m]));
let documented = 0;
for (const stmt of ast.program.body) {
  let target = null;
  if (t.isVariableDeclaration(stmt) && stmt.declarations.length === 1 && t.isIdentifier(stmt.declarations[0].id)) {
    target = stmt.declarations[0].id.name;
  } else if ((t.isFunctionDeclaration(stmt) || t.isClassDeclaration(stmt)) && stmt.id) {
    target = stmt.id.name;
  }
  if (!target) continue;
  const meta = docByName.get(target) || nameByCompressed.get(target);
  if (!meta || !meta.doc) continue;
  const text = `*\n * ${meta.doc.replace(/\n+/g, ' ')}\n * @module-ref ${meta.module || ''}\n `;
  t.addComment(stmt, 'leading', text, false);
  documented++;
}

//------------------------------------------------------------- 输出
const outCode = generate(ast, { comments: true, compact: false, jsescOption: { minimal: true } }).code;
const pretty = await prettier.format(outCode, {
  parser: 'babel',
  printWidth: 100,
  singleQuote: true,
  semi: true,
});
writeFileSync(resolve(OUT, 'stage2.js'), pretty);
writeFileSync(
  resolve(OUT, 'symbol-map.json'),
  JSON.stringify(
    [...merged.symbols.entries()].map(([compressed, m]) => ({ compressed, ...m })),
    null,
    1
  )
);

const report = [
  '# 反混淆报告（阶段 2：命名）',
  '',
  `顶层重命名 ${renamed.top} / 参数 ${renamed.params} / 局部绑定 ${renamed.locals}`,
  `JSDoc 注入 ${documented} 处`,
  `输出 stage2.js ${(pretty.length / 1024).toFixed(0)}KB / ${pretty.split('\n').length} 行`,
  '',
  `命名表未覆盖的顶层符号（${uncovered.length}）: ${uncovered.slice(0, 40).join(' ') || '无'}`,
  '',
  `命名表里不存在的压缩名（${unknown.length}）: ${unknown.slice(0, 40).join(' ') || '无'}`,
  '',
  `跨域命名冲突（${merged.conflicts.length}）:`,
  ...merged.conflicts.map((c) => `- ${c.compressed}: 保留 ${c.kept}，丢弃 ${c.dropped}（${c.file}）`),
  '',
  `跳过的重命名（${renamed.skipped.length}）:`,
  ...renamed.skipped.slice(0, 60).map((s) => `- ${s}`),
].join('\n');
writeFileSync(resolve(OUT, 'STAGE2-REPORT.md'), report);

console.log(`顶层 ${renamed.top} / 参数 ${renamed.params} / 局部 ${renamed.locals}；JSDoc ${documented}`);
console.log(`未覆盖顶层 ${uncovered.length}；未知名 ${unknown.length}；冲突 ${merged.conflicts.length}；跳过 ${renamed.skipped.length}`);
console.log(`stage2.js ${(pretty.length / 1024).toFixed(0)}KB / ${pretty.split('\n').length} 行`);
