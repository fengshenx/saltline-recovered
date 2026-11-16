#!/usr/bin/env node
// 反混淆流水线（阶段 1）：把 esbuild 压缩后的游戏代码还原成可读形式。
//
// 阶段 1 做两件事：
//   1. three.js 内部符号 → THREE.* 公开名（映射来自 bundle 自己的 `br(lt,{...})` 导出表）
//   2. 用 prettier 按 100 列重新排版
// 命名与注释由后续阶段完成（见 tools/names.json、src/）。
//
// 用法: node tools/deobfuscate.mjs [--stage1]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const prettier = require('prettier');

const SRC = resolve('input/saltline.original.html');
const OUT = resolve('extracted');

//------------------------------------------------------------- 源
const html = readFileSync(SRC, 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

// 应用区起点：three.js 之后的第一处游戏配置（世界边界 oi）
const APP_MARK = 'groundY:0,seaY';
const appStart = js.lastIndexOf('var ', js.indexOf(APP_MARK));
if (appStart < 0) throw new Error('未定位到应用区起点');
// 应用区是从 IIFE 函数体中间截出来的，末尾要去掉外层 IIFE 的收尾 `})();`
const appSrc = js.slice(appStart).replace(/\}\)\(\);\s*$/, '');

//------------------------------------------------------------- three 导出表
const mapPath = resolve(OUT, 'three-export-map.json');
if (!existsSync(mapPath)) throw new Error('缺少 three-export-map.json，先运行 tools/extract.mjs');
// 表是 public -> internal（来自 `br(lt,{Public:()=>internal})`），这里反过来用
const threeExportMap = JSON.parse(readFileSync(mapPath, 'utf8'));
const threeMap = {};
for (const [publicName, internal] of Object.entries(threeExportMap)) threeMap[internal] = publicName;
threeMap.lt = '__NAMESPACE__';

//------------------------------------------------------------- 解析
const ast = parser.parse(appSrc, {
  sourceType: 'script',
  errorRecovery: false,
});

//------------------------------------------------------------- three 符号还原
const unmapped = new Map(); // name -> count
const mapped = new Set();
let replaced = 0;

traverse(ast, {
  Identifier(path) {
    if (!path.isReferencedIdentifier()) return;
    const name = path.node.name;
    if (path.scope.hasBinding(name)) return;
    if (!Object.prototype.hasOwnProperty.call(threeMap, name)) {
      unmapped.set(name, (unmapped.get(name) || 0) + 1);
      return;
    }
    const pub = threeMap[name];
    if (pub === '__NAMESPACE__') {
      path.replaceWith(t.identifier('THREE'));
    } else {
      path.replaceWith(t.memberExpression(t.identifier('THREE'), t.identifier(pub)));
    }
    mapped.add(name);
    replaced++;
  },
});

//------------------------------------------------------------- esbuild helper 展开
// br(A, { k: () => v }) 是 esbuild 的 __export，用来给命名空间对象挂 getter。
// 展开成 Object.defineProperties 保留惰性求值语义（应用里有 var 在 br 之后才赋值的情况）。
let exportExpanded = 0;
traverse(ast, {
  CallExpression(path) {
    const { callee, arguments: args } = path.node;
    if (!t.isIdentifier(callee, { name: 'br' }) || args.length !== 2) return;
    if (!t.isObjectExpression(args[1])) return;
    const props = args[1].properties.map((p) =>
      t.objectProperty(p.key, t.objectExpression([
        t.objectProperty(t.identifier('get'), p.value),
        t.objectProperty(t.identifier('enumerable'), t.booleanLiteral(true)),
      ]))
    );
    path.replaceWith(
      t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('defineProperties')), [
        args[0],
        t.objectExpression(props),
      ])
    );
    exportExpanded++;
  },
});

//------------------------------------------------------------- 顶层符号清单
// 供阶段 2 的人工/模型命名：名字 + 字节大小 + 代码摘要 + 线索（字符串/属性）
const topBindings = [];
for (const stmt of ast.program.body) {
  const names = [];
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations) if (t.isIdentifier(d.id)) names.push(d.id.name);
  } else if ((stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') && stmt.id) {
    names.push(stmt.id.name);
  }
  if (!names.length) continue;
  const snippet = generate(stmt).code;
  const strings = [...snippet.matchAll(/(["'])((?:\\.|(?!\1).){4,60})\1/g)]
    .map((m) => m[2])
    .filter((s) => /[a-zA-Z]{3}/.test(s) && !s.includes('THREE.'))
    .slice(0, 8);
  const props = [...new Set([...snippet.matchAll(/this\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]))].slice(0, 12);
  topBindings.push({
    names,
    bytes: snippet.length,
    kind: stmt.type,
    async: !!stmt.async,
    strings,
    props,
    head: snippet.slice(0, 160).replace(/\s+/g, ' '),
  });
}
writeFileSync(resolve(OUT, 'symbols.json'), JSON.stringify(topBindings, null, 1));

//------------------------------------------------------------- 输出
const code = generate(ast, { comments: true, compact: false, jsescOption: { minimal: true } }).code;
writeFileSync(resolve(OUT, 'stage1.raw.js'), code);

const pretty = await prettier.format(code, {
  parser: 'babel',
  printWidth: 100,
  singleQuote: true,
  semi: true,
});
writeFileSync(resolve(OUT, 'stage1.js'), pretty);

const unmappedSorted = [...unmapped.entries()].filter(([n]) => !mapped.has(n)).sort((a, b) => b[1] - a[1]);
const report = [
  '# 反混淆报告（阶段 1）',
  '',
  `应用区: ${appStart}..${js.length} (${appSrc.length} 字节)`,
  `three 符号还原: ${mapped.size} 个符号 / ${replaced} 处引用`,
  `输出: stage1.js ${pretty.length} 字节 / ${pretty.split('\n').length} 行`,
  '',
  '## 未映射的自由标识符（按引用次数）',
  '',
  '这些是既非本地声明、也不在 three 导出表里的名字：浏览器全局 API、或 three 内部非导出符号。',
  '',
  '| name | refs |',
  '|---|---|',
  ...unmappedSorted.map(([n, c]) => `| \`${n}\` | ${c} |`),
].join('\n');
writeFileSync(resolve(OUT, 'STAGE1-REPORT.md'), report);

console.log(`three 符号还原 ${mapped.size} 个 / ${replaced} 处`);
console.log(`未映射自由标识符 ${unmappedSorted.length} 种`);
console.log(`stage1.js: ${(pretty.length / 1024).toFixed(0)}KB / ${pretty.split('\n').length} 行`);
console.log('前三:', unmappedSorted.slice(0, 12).map(([n, c]) => `${n}(${c})`).join(' '));
