# saltline-recovered

> 项目: saltline-recovered
> 类型: 工程
> 状态: active
> 最后活动: 2026-11-16
> 摘要: 把 Saltline 单文件 3D 游戏（esbuild 压缩产物）反混淆还原为可维护的模块化源码工程，并重建出等价可运行产物

## 这是什么

`input/saltline.original.html` 是一个 1.4MB 的单文件浏览器 FPS（港口终端、切断三处 relay、
Gulls/Hounds 两类敌人），JS 区是 esbuild `--bundle --format=iife --minify` 产物，无 sourcemap。

本项目把它还原成人可读、可继续维护的工程：真名函数与参数、868 条 JSDoc、GLSL 独立成模块、
three.js 换成 npm 依赖。`src/` 改完能重新构建成单文件，行为与原版一致。

命名与文件边界部分对齐了一个外部反推版本（网友从 Claude Artifact 反推，本仓库不含）。要复现这一步，
自行 `git clone --depth 1 https://github.com/realskyrin/fps3ademo-saltline.git ../../_refs/fps3ademo-saltline`
后跑 `node tools/match-original.mjs`。该参考本身也是半还原的（约一半符号仍是短名），只作参考不作权威；
不跑这一步也能正常构建。

## 来源与版权

`input/saltline.original.html` 不是本项目原创，是他人制作的浏览器游戏的发布产物。本项目做的是**语义还原**
（把压缩 bundle 展开成可读源码），不改变、不新增游戏内容，全部逻辑、美术与音效仍源自原作品，版权归原作者。

因此本仓库保持 private。要公开请先确认原作品的授权状态——完整源码公开相当于替代了原作者的发布物。
`dist/saltline.html` 双击即可在浏览器打开游玩，无需本地服务器（three.js 已打包在内，仅字体走 Google Fonts）。

## 状态

- [x] 归档原件、确认构建链（esbuild 0.28 + IIFE + charset=ascii + legal-comments=none）
- [x] `tools/extract.mjs`：语法边界切分（顶层语句 / 模板字符串 / GLSL，GLSL 76 块 85KB）
- [x] 阶段1 `tools/deobfuscate.mjs`：three 内部符号还原（90 符号 / 788 处）、`__export` 展开、排版
- [x] 阶段2 命名：8 域并行 → 顶层 851 / 参数 993 / 局部 1,979 / JSDoc 868
- [x] 阶段3 `tools/split.mjs`：按归属切成 ES 模块，import/export 自动生成
- [x] 对照参考仓库：`tools/match-original.mjs` + `tools/apply-ground-truth.mjs`
      → 命名同名 374 中的 81 个（22%），文件边界对齐到 66 个模块（参考为 65）
- [x] 撞名收口：`_i/Pb/u_` 三处跨域命名冲突（`_i` 采纳参考仓库的 `registerProp`）
- [x] `structures.js`（6,155 行）按构件拆成 `world/backdrop/{cranes,ships,sky,geometry}` +
      `world/level/buildings.js`；`assets/props/*` 36 个细文件收回 `world/props/*-builders.js`
- [x] 短名治理两轮（16 个子代理）：局部绑定 1,979 → 4,214（新增生效 2,235 条）
- [x] 构建链 `tools/link.mjs` + `tools/build.mjs`：按原始求值顺序链接，esbuild 打回单文件
- [ ] 剩余短名：339 个函数 / 3,475 个绑定（多为深层嵌套作用域与匿名回调参数）
- [ ] 前台会话下的游戏内截图回归（当前环境为后台标签页，rAF 被浏览器暂停）

## 规模对照

| | 原件 | 还原后 | 参考仓库 |
|---|---|---|---|
| 形态 | 单 HTML 压缩 bundle | 66 个 ES 模块 + 10 个工具 | 65 个模块 + vendor |
| JS 行数 | 6,200（45% 是 GLSL） | 51,272 | 45,154 |
| 重新压缩体积 | 1,424,460 B | 1,391,000 B（−2.3%） | — |

## 目录

```
input/      原件（只读）
tools/      extract → deobfuscate → apply-names → split → link → build
            match-original / apply-ground-truth / find-shortnames / merge-shortnames
extracted/  stage1/stage2 反混淆稿、符号表、分域命名、ground-truth 映射、短名分片、报告
src/        还原后的模块化源码（改这里）
dist/       saltline.html（生产）/ saltline.dev.html（带启动诊断，支持 ?autostart=1）
docs/       RECOVERY.md 还原方法 · MODULES.md 模块契约
```

## 命令

```bash
npm run build        # src/ → dist/saltline.html（压缩，1.39MB）
npm run build:dev    # 带诊断块：每秒刷新 __ready/__frames/__fatal/stub 列表到页面
npm run pipeline     # 反混淆全流程（deob → apply → split → build）
```

本地看效果：`python3 -m http.server 8766` 后打开 `/dist/saltline.html`，
调试用 `/dist/saltline.dev.html?autostart=1`（跳过标题直接开局）。

## 下一步

补剩余短名：`node tools/find-shortnames.mjs --offset 0 --limit 48` 看分布，
用 `extracted/shortnames/chunk*.json` 派发治理，结果经 `tools/merge-shortnames.mjs` 合并。
