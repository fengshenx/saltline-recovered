#!/usr/bin/env node
// 从 saltline.original.html 中切分/提取结构。输入是 esbuild 打包后的单文件，无 sourcemap，
// 所以这里只能按语法边界切分（顶层语句 + 模板字符串），供后续人工反混淆。
//
// 用法: node tools/extract.mjs [--src input/saltline.original.html] [--out extracted]
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const SRC = resolve(getArg('src', 'input/saltline.original.html'));
const OUT = resolve(getArg('out', 'extracted'));

const html = readFileSync(SRC, 'utf8');
const jsStart = html.indexOf('<script>') + '<script>'.length;
const jsEnd = html.lastIndexOf('</script>');
const js = html.slice(jsStart, jsEnd);

//------------------------------------------------------------- scanner
// 单遍扫描：记录顶层语句边界与所有模板字符串字面量范围。
// 字符串由 esbuild 原样保留（不压缩内容），所以 GLSL 在这里是完整可用的。
//
// 注意：整个脚本是一个 IIFE —— `(()=>{ ... })();`，所以"顶层"= IIFE 函数体内部的第一层，
// 括号基准深度 base 从函数体的第一个 `{` 算起，而不是文件级的 0。
function findBodyStart(js) {
  const m = js.match(/^\s*\(?\s*\(?\s*(?:\)\s*=>|function\s*\([^)]*\))\s*\{\s*/);
  if (!m) throw new Error('未找到 IIFE 函数体');
  return m[0].length;
}

function scan(js, startAt, base) {
  const stmts = [];      // { start, end }
  const templates = [];  // { start, end, contentStart, contentEnd }
  let i = startAt, n = js.length, start = startAt, depth = base, prev = '';

  const readString = (quote) => {
    // 返回结束位置（指向闭合引号之后），并处理模板内嵌 ${...}
    const opens = i;
    i++;
    while (i < n) {
      const c = js[i];
      if (c === '\\') { i += 2; continue; }
      if (c === quote) { i++; break; }
      if (quote === '`' && c === '$' && js[i + 1] === '{') {
        i += 2;
        let d = 1;
        while (i < n && d > 0) {
          const ch = js[i];
          if (ch === '\\') { i += 2; continue; }
          if (ch === '"' || ch === "'" || ch === '`') { readString(ch); continue; }
          if (ch === '{') d++;
          else if (ch === '}') d--;
          i++;
        }
        continue;
      }
      i++;
    }
    if (quote === '`') templates.push({ open: opens, contentStart: opens + 1, contentEnd: i - 1 });
  };

  while (i < n) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') {
      const nl = js.indexOf('\n', i);
      i = nl < 0 ? n : nl;
      continue;
    }
    if (c === '/' && js[i + 1] === '*') {
      const close = js.indexOf('*/', i + 2);
      i = close < 0 ? n : close + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { readString(c); prev = c; continue; }
    // 正则字面量：前一个有效字符暗示表达式开头
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      i++;
      let inClass = false;
      while (i < n) {
        const ch = js[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { i++; break; }
        i++;
      }
      while (i < n && /[a-z]/.test(js[i])) i++;
      prev = '/';
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === base) { stmts.push({ start, end: i + 1 }); start = i + 1; }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  if (start < n) stmts.push({ start, end: n });
  return { stmts, templates };
}

const { stmts, templates } = scan(js);

//------------------------------------------------------------- statements
const stmtRows = stmts.map((s, idx) => {
  const text = js.slice(s.start, s.end);
  return {
    n: idx,
    offset: s.start,
    length: s.end - s.start,
    head: text.slice(0, 90).replace(/\s+/g, ' '),
    glsl: /\bvoid\s+main\b/.test(text),
  };
});

//------------------------------------------------------------- shaders
// 命名规则：向上找最近的赋值左侧标识符（var x= / x.y= / x["y"]=）
function nameFor(offset) {
  const before = js.slice(Math.max(0, offset - 400), offset);
  const pats = [
    /([A-Za-z_$][\w$]*)\s*=\s*$/,                            // var x = `...`  /  x = `...`
    /([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*=\s*$/,   // tn.asphalt = `...`
    /([A-Za-z_$][\w$]*)\s*\[\s*["']([^"']+)["']\s*\]\s*=\s*$/, // T["x"] = `...`
    /([A-Za-z_$][\w$]*)\s*:\s*$/,                            // { foo: `...` }
  ];
  let last = null;
  for (const p of pats) {
    const re = new RegExp(p.source, 'g');
    let m;
    while ((m = re.exec(before))) last = m[2] ? `${m[1]}.${m[2]}` : m[1];
  }
  return last;
}

const isGlsl = (t) => /\bvoid\s+main\b|\bgl_FragColor\b|precision\s+highp\s+float/.test(t);

const shaderRows = [];
const seen = new Set();
for (const t of templates) {
  const body = js.slice(t.contentStart, t.contentEnd);
  if (body.length < 120 || !isGlsl(body)) continue;
  const name = nameFor(t.open) || 'anonymous';
  const kind = /\bgl_FragColor\b|out\s+vec4\s+o\b|gl_FragData/.test(body) ? 'frag' : 'vert';
  let slug = `${name}`.replace(/^\$/, '').replace(/[^\w.]+/g, '_');
  let file = `${slug}.glsl`;
  let k = 2;
  while (seen.has(file)) file = `${slug}_${k++}.glsl`;
  seen.add(file);
  shaderRows.push({ file, kind, bytes: body.length, offset: t.contentStart, body });
}

//------------------------------------------------------------- write
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'segments'), { recursive: true });
mkdirSync(join(OUT, 'shaders'), { recursive: true });

for (const r of stmtRows) {
  const text = js.slice(r.offset, r.offset + r.length);
  const name = String(r.n).padStart(4, '0');
  writeFileSync(join(OUT, 'segments', `${name}_${String(r.offset).padStart(7, '0')}.js`), text + '\n');
}

for (const s of shaderRows) {
  writeFileSync(join(OUT, 'shaders', s.file), s.body.trimEnd() + '\n');
}

writeFileSync(join(OUT, 'segments.json'), JSON.stringify(stmtRows, null, 1));
writeFileSync(
  join(OUT, 'shaders.json'),
  JSON.stringify(shaderRows.map(({ body, ...m }) => m), null, 1)
);

const index = [
  `# extracted index`,
  ``,
  `来源: ${SRC}`,
  `JS 区: ${js.length} 字节，顶层语句 ${stmtRows.length} 条，GLSL 块 ${shaderRows.length} 个`,
  ``,
  `## 顶层语句`,
  ``,
  `| n | offset | bytes | glsl | head |`,
  `|---|---|---|---|---|`,
  ...stmtRows.map(
    (r) => `| ${r.n} | ${r.offset} | ${r.length} | ${r.glsl ? 'Y' : ''} | \`${r.head.replace(/\|/g, '\\|')}\` |`
  ),
  ``,
  `## GLSL`,
  ``,
  `| file | kind | bytes | offset |`,
  `|---|---|---|---|`,
  ...shaderRows.map((s) => `| ${s.file} | ${s.kind} | ${s.bytes} | ${s.offset} |`),
].join('\n');
writeFileSync(join(OUT, 'INDEX.md'), index);

const glslBytes = shaderRows.reduce((a, s) => a + s.bytes, 0);
console.log(`语句 ${stmtRows.length} 条 / ${js.length} 字节`);
console.log(`GLSL ${shaderRows.length} 块 / ${glslBytes} 字节 (${((glslBytes / js.length) * 100).toFixed(1)}%)`);
console.log(`输出 -> ${OUT}`);
