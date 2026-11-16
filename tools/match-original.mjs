#!/usr/bin/env node
// 用外部反推版本（_refs/fps3ademo-saltline，可选，本仓库不含）作 ground truth，为还原后的符号建立对应关系。
//
// 两个来源都来自同一个 bundle，所以函数体里的字符串字面量、关键数字常量是完全一致的
// （局部变量名不同不影响）。这里用指纹相似度为每个"我的符号"找原版对应符号，从而同时得到：
//   1. 更贴近原作者的命名（原版已语义化的那 374 个导出）
//   2. 原作者的文件边界（原版 65 个模块的职责划分）
// 原版自己仍保留短名的地方（如 i3/s3/l3/pm），匹配到后保留我方命名（更可读）。
//
// 用法: node tools/match-original.mjs [--ref ../../_refs/fps3ademo-saltline]
// 缺省路径不存在时会提示 clone 命令；不跑这一步也能正常构建，只是命名对齐度低一些。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join, relative } from 'node:path';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

const REF = resolve(process.argv.includes('--ref')
  ? process.argv[process.argv.indexOf('--ref') + 1]
  : resolve('..', '..', '_refs', 'fps3ademo-saltline'));

if (!existsSync(REF)) {
  console.error(`找不到原版仓库: ${REF}\n先 clone: git clone --depth 1 https://github.com/realskyrin/fps3ademo-saltline.git ../../_refs/fps3ademo-saltline`);
  process.exit(1);
}

//------------------------------------------------------------- 指纹
// 只看"语义稳定"的部分：字符串字面量 + 关键数字。变量名会被忽略。
const SHORT = /^[a-z_$.]{0,3}$/i;

function fingerprint(node) {
  const strings = new Set();
  const numbers = new Set();
  const props = new Set();
  const wrapper = t.file(t.program([t.cloneNode(node, true, true)]));
  traverse(wrapper, {
    StringLiteral(p) {
      const v = p.node.value;
      if (v.length >= 4 && !SHORT.test(v)) strings.add(v);
    },
    // GLSL 与多行模板都在这：取静态片段（跳过 ${} 表达式）的开头做指纹
    TemplateLiteral(p) {
      const raw = p.node.quasis.map((q) => q.value.raw).join('\u0000');
      if (raw.length >= 8) strings.add(raw.slice(0, 300));
    },
    NumericLiteral(p) {
      const v = p.node.value;
      if (Math.abs(v) >= 0.001 && v !== 0 && v !== 1 && v !== 2) numbers.add(String(v));
    },
    MemberExpression(p) {
      if (!p.node.computed && t.isIdentifier(p.node.property)) props.add(p.node.property.name);
    },
  });
  return { strings, numbers, props };
}

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

// 指纹相似度：字符串权重最高（同一份数据/提示语），数字次之，属性名最弱
const score = (a, b) => {
  const s = jaccard(a.strings, b.strings);
  const n = jaccard(a.numbers, b.numbers);
  const p = jaccard(a.props, b.props);
  const shared = [...a.strings].filter((x) => b.strings.has(x)).length;
  return { score: s * 0.6 + n * 0.25 + p * 0.15, shared };
};

//------------------------------------------------------------- 收集原版导出
const collectTopLevel = (ast) => {
  const out = [];
  for (const node of ast.program.body) {
    let decl = node;
    if (t.isExportNamedDeclaration(node) && node.declaration) decl = node.declaration;
    const names = [];
    if (t.isVariableDeclaration(decl)) {
      for (const d of decl.declarations) if (t.isIdentifier(d.id)) names.push(d.id.name);
    } else if ((t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) && decl.id) {
      names.push(decl.id.name);
    }
    if (names.length) out.push({ names, node: decl });
    // export { a, b } 形式：把导出名如实记下（定义可能在同一 AST 里）
    if (t.isExportNamedDeclaration(node) && !node.declaration && node.specifiers.length) {
      for (const s of node.specifiers) {
        if (t.isExportSpecifier(s)) out.push({ names: [s.exported.name], node: null });
      }
    }
  }
  return out;
};

const refSymbols = [];
const walkRef = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { walkRef(p); continue; }
    if (!e.name.endsWith('.js')) continue;
    const rel = relative(REF, p).split('\\').join('/');
    if (rel.includes('vendor/')) continue; // three.js 本体不参与匹配
    const ast = parser.parse(readFileSync(p, 'utf8'), { sourceType: 'module' });
    for (const entry of collectTopLevel(ast)) {
      if (!entry.node) continue;
      const kind = t.isFunctionDeclaration(entry.node) ? 'fn' : t.isClassDeclaration(entry.node) ? 'cls' : 'data';
      for (const name of entry.names) {
        refSymbols.push({ name, file: rel, kind, fp: fingerprint(entry.node) });
      }
    }
  }
};
walkRef(join(REF, 'src'));

//------------------------------------------------------------- 收集我的符号
const mineAst = parser.parse(readFileSync(resolve('extracted/stage2.js'), 'utf8'), { sourceType: 'script' });
const mineSymbols = [];
for (const node of mineAst.program.body) {
  const names = [];
  if (t.isVariableDeclaration(node)) {
    for (const d of node.declarations) if (t.isIdentifier(d.id)) names.push(d.id.name);
  } else if ((t.isFunctionDeclaration(node) || t.isClassDeclaration(node)) && node.id) {
    names.push(node.id.name);
  }
  if (!names.length) continue;
  const kind = t.isFunctionDeclaration(node) ? 'fn' : t.isClassDeclaration(node) ? 'cls' : 'data';
  for (const name of names) mineSymbols.push({ name, kind, fp: fingerprint(node), node });
}

//------------------------------------------------------------- 贪心匹配
const candidates = [];
for (const mine of mineSymbols) {
  for (const ref of refSymbols) {
    const r = score(mine.fp, ref.fp);
    // shared 少的（小工具函数）靠高分兜：完全同构的允许 shared>=1
    if (r.shared < 2 && r.score < 0.9) continue;
    if (r.score < 0.45) continue;
    candidates.push({ mine: mine.name, ref: ref.name, file: ref.file, ...r });
  }
}
candidates.sort((a, b) => b.score - a.score);

const usedMine = new Set();
const usedRef = new Set();
const matches = [];
for (const c of candidates) {
  if (usedMine.has(c.mine) || usedRef.has(c.ref)) continue;
  usedMine.add(c.mine);
  usedRef.add(c.ref);
  matches.push(c);
}

// 原版仍是短名（<=3 字符）的，不采用它的名字，只借它的文件边界
const isShort = (n) => n.length <= 3;
const plan = matches.map((m) => ({
  mine: m.mine,
  ref: m.ref,
  adoptName: !isShort(m.ref) ? m.ref : m.mine,
  module: `src/${m.file.replace(/^src\//, '')}`,
  score: +m.score.toFixed(3),
  shared: m.shared,
}));

writeFileSync(resolve('extracted/original-map.json'), JSON.stringify(plan, null, 1));

//------------------------------------------------------------- 文件级归属
// 原版有一半符号仍是短名（i3/s3/l3/pm），逐符号匹配覆盖不到；但一个模块里的字符集
// （材质名、道具名、GLSL token）高度集中在同一文件，所以用"我的符号 → 原版文件"的
// 召回率来定归属，比逐符号可靠得多。
const refFiles = new Map();
for (const s of refSymbols) {
  if (!refFiles.has(s.file)) refFiles.set(s.file, { strings: new Set(), numbers: new Set(), kinds: new Set() });
  const f = refFiles.get(s.file);
  f.kinds.add(s.kind);
  for (const x of s.fp.strings) f.strings.add(x);
  for (const x of s.fp.numbers) f.numbers.add(x);
}

const recall = (mine, set) => {
  if (!mine.size) return 0;
  let hit = 0;
  for (const x of mine) if (set.has(x)) hit++;
  return hit / mine.size;
};

// 原版导出名 → 文件（唯一时才算），用于"名字完全相同"的直接归属
const refNameToFile = new Map();
for (const s of refSymbols) {
  if (refNameToFile.has(s.name)) refNameToFile.set(s.name, null); // 重名，放弃
  else refNameToFile.set(s.name, s.file);
}

const filePlan = [];
const how = { name: 0, fingerprint: 0 };
for (const mine of mineSymbols) {
  const exact = refNameToFile.get(mine.name);
  if (exact) {
    filePlan.push({ mine: mine.name, file: `src/${exact.replace(/^src\//, '')}`, score: 1, by: 'name' });
    how.name++;
    continue;
  }
  let best = null;
  // 字符串少于 3 个的小符号（常量、小工具）命中一个就会把 recall 顶成 1，属于假高分，
  // 直接跳过，交给 tools/apply-ground-truth.mjs 的模块映射表兜底。
  if (mine.fp.strings.size >= 3) {
    for (const [file, fp] of refFiles) {
      // 只用字符串指纹：数字在大文件里几乎必然"碰巧命中"（实测把 NAV_CELL_SIZE 归到了
      // audio/audio.js），字符串（材质名、道具名、GLSL token、事件名）才是可靠信号。
      let hits = 0;
      for (const x of mine.fp.strings) if (fp.strings.has(x)) hits++;
      if (hits < 3) continue;
      const sRecall = hits / mine.fp.strings.size;
      const precision = fp.strings.size ? hits / fp.strings.size : 0;
      const f1 = sRecall + precision ? (2 * sRecall * precision) / (sRecall + precision) : 0;
      const v = f1 + (fp.kinds.has(mine.kind) ? 0.05 : 0);
      if (!best || v > best.score) best = { file, score: v };
    }
  }
  if (best && best.score >= 0.5) {
    filePlan.push({ mine: mine.name, file: `src/${best.file.replace(/^src\//, '')}`, score: +best.score.toFixed(3), by: 'fingerprint' });
    how.fingerprint++;
  }
}
writeFileSync(resolve('extracted/original-filemap.json'), JSON.stringify(filePlan, null, 1));

const adopted = plan.filter((p) => p.adoptName === p.ref).length;
const byModule = new Map();
for (const p of filePlan) byModule.set(p.file, (byModule.get(p.file) || 0) + 1);

console.log(`原版符号 ${refSymbols.length} / 我的符号 ${mineSymbols.length}`);
console.log(`符号级匹配 ${plan.length}（采用原版命名 ${adopted}，其余原版是短名只借边界）`);
console.log(`文件级归属 ${filePlan.length}/${mineSymbols.length}（名字 ${how.name} / 指纹 ${how.fingerprint}），覆盖原版模块 ${byModule.size} 个`);
console.log('\n归属最多的原版模块:');
for (const [f, c] of [...byModule].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(c).padStart(3)}  ${f}`);
console.log('\n高置信符号匹配样例:');
for (const p of plan.filter((p) => p.score >= 0.8).slice(0, 10)) {
  console.log(`  ${p.mine} → ${p.ref}  (${p.score}, ${p.module})`);
}
