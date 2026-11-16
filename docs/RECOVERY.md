# 还原方法与结果

## 起点与结论

`input/saltline.original.html` 是 esbuild `--bundle --format=iife --minify` 的产物：168 万字符的 JS
包在一个 IIFE 里，标识符被压成 1–3 个字母，无 sourcemap。所以**无法逐字还原**，只能做语义还原：

| 维度 | 原件 | 还原后 |
|---|---|---|
| 形态 | 单 HTML，一个压缩 bundle | 66 个 ES 模块 + 10 个工具脚本 |
| JS 行数 | 6,200 行（其中 45% 是 GLSL） | 51,272 行 |
| 函数名 | `Ty` `Hg` `dm` | `createRenderer` `createWeapon` `startGame` |
| 变量名 | `i` `e` `t` `n` | `opts` `scene` `seed` `dt` + 4,214 个局部绑定 |
| 注释 | 无 | 868 条 JSDoc（写意图与约束） |
| three.js | 内联在 bundle 里（约 690KB） | npm `three@0.180.0` 依赖 |
| 重新压缩后 | 1,424,460 字节 | 1,391,000 字节（−2.3%，差异来自未消除的短名与注释） |

行为已验证：`dist/saltline.html` 打开后正常进标题画面、点 DEPLOY 进入第一人称关卡，
HUD、无线电、武器视图模型、道具堆场、雨/湿地反射全部工作，`window.__fatal === null`。

## 流水线

```
input/saltline.original.html
  │ tools/extract.mjs        语法边界切分（顶层语句 / 模板字符串 / GLSL）→ extracted/
  │ tools/deobfuscate.mjs    阶段1：three 内部符号 → THREE.*（90 个符号 788 处），
  │                          esbuild __export helper 展开，prettier 排版   → extracted/stage1.js
  │ （8 个子代理分域命名）     顶层符号 + 参数 + 局部变量 + JSDoc          → extracted/names/A-H.json
  │ tools/apply-names.mjs    阶段2：babel scope-aware 重命名（零行为变更）  → extracted/stage2.js
  │ tools/split.mjs          阶段3：按归属切成 ES 模块 + 自动 import/export → src/
  │ tools/link.mjs           按原始书写顺序拼接（见下"为什么不用 ESM 打包"）→ build/bundle.js
  │ tools/build.mjs          esbuild 打包 three + 注入原始 HTML 外壳       → dist/
```

### three.js 为什么能整个换掉

bundle 开头有 `br(lt,{ACESFilmicToneMapping:()=>xc, ...})` —— 这是 esbuild 生成的
**导出表**，422 条 `公开名 → 内部符号` 映射。有了它，应用代码里所有 `xc`、`W`、`Qe` 都能翻回
`THREE.ACESFilmicToneMapping`、`THREE.Vector3`、`THREE.Mesh`，于是 three 那 690KB 可以整段丢弃，
用 npm 包替代。这一步把需要人工还原的代码量砍掉一半。

### 为什么不用 esbuild 的 ESM 打包

原 bundle 是"一个 IIFE 里从上到下顺序执行的一大段代码"，大量 `var X = f(Y)` 依赖严格的书写顺序。
ES 模块的求值顺序由依赖图决定，遇到循环依赖就会读到还没赋值的 `var` / 进 TDZ。
实际踩到的两个坑：

1. `assets/geometry.js` 的 `Vec3/Quat/Mat4` 别名与 `core/math.js` 互相引用 → 求值时 undefined
   （已下沉到零依赖的 `core/three-types.js`）。
2. `var SEA_WAVE_DISPLACE_VERT = SEA_WAVE_MAIN.map(...)` 跨模块引用，模块先求值就崩。

所以最终结构是：**src/ 保持正常 import/export（可编辑、IDE 可分析），构建时由 `tools/link.mjs`
按 `src/.manifest.json` 记录的顺序重新排列语句**，恢复原有求值语义。改 src/ 仍然生效，
只是打包器换成了仓库内的 100 行链接器。

## 用参考仓库做 ground truth（可选环节）

`_refs/fps3ademo-saltline` 是网友从 Claude Artifact 反推的版本（**本仓库不包含，需自行 clone**），
同样做过一轮半还原（约一半符号
仍是 `i3`/`s3`/`pm` 这类短名）。它不能当权威，但能提供两件有价值的东西：**作者意图的命名**和
**原始文件边界**。做法与踩坑记录：

1. **名字精确匹配**：我的符号名与参考仓库某个导出名完全相同且该名唯一 → 直接采用它的文件归属。
   命中 100 个，零误判。
2. **字符串指纹（F1）**：比较函数体里的字符串字面量 + 模板串静态片段（材质名、道具名、GLSL token、
   事件名）。命中 39 个。
3. **数字指纹不可用**：最初把数字常量也当指纹，结果 `NAV_CELL_SIZE`、`createSkyUniforms` 被归到了
   `audio/audio.js` —— 大文件里有几百个数字，召回率必然接近 1。数字只能用于"纯数值配置表"，
   且要 0.9 以上召回。
4. **小符号要设绝对门槛**：只有 1–2 个字符串的符号，命中一个就 recall=1，F1 被放大成假高分。
   少于 3 个字符串的一律跳过，交给下一步。
5. **模块映射兜底**：剩下 700 多个符号走手写映射表（`apply-ground-truth.mjs` 的
   `MODULE_FALLBACK`），配合构件规则把大文件按名字拆开（`structures.js` 里的 `*Crane*` →
   `world/backdrop/cranes.js`，`*Ship*` → `ships.js`，`*Shed*`/`*Building*` → `level/buildings.js`）。

结果：命名同名从 13% 提到 22%（81/374），模块数从 106 收敛到 66（参考仓库 65）。

## 为什么不做字段名治理

反混淆后统计到 153 个 1–2 字符的对象键名（`{px:0,py:0}`、`{v:sfxRecipe,k:sfxName}`、
`{h:0,s:0,l:0}`），看起来像残留的压缩名。**它们不是**：

原 bundle 里 `position` 出现 196 次、`rotation` 80 次、`material` 177 次、`geometry` 133 次，
说明 esbuild **没有启用 `--mangle-props`**——属性名从未被压缩，短键名是作者自己的写法。
直接 grep 原文件也能看到 `px:r,py:` 原文。

所以字段名不需要还原，改了反而偏离原版。`tools/analyze-shortkeys.mjs` 保留为只读分析工具，
输出 `extracted/shortkeys/report.json`（每个短键名的定义点、读取点、涉及模块），
用于以后判断某个键能不能动——跨模块且命中 three.js 契约的（`x/y/z/w`、`r/g/b/a`、`uv`、
四元数分量）绝对不能动。

## 命名质量与边界

- 顶层符号 851 个、参数 993 个、局部绑定 1,979 个已重命名，868 条 JSDoc。
- 短名治理走了三轮共 24 个子代理（`tools/find-shortnames.mjs` 分片 → 代理产出
  `resolved*.json` → `tools/merge-shortnames.mjs` 合并），局部绑定从 1,979 提到 6,737，
  剩余短名从 5,286 降到 2,706。剩下的多是对象字面量的字段名（`{ px: 0, py: 0 }`），
  改名要跨文件保持属性访问一致，属另一类问题。
- 三个踩坑：
  ① `merge-shortnames` 用 `readdir` 顺序合并，旧批次的 `resolved-*.json` 会覆盖新批次——
     必须把已消费的批次移进 `archive/`；
  ② `apply-names` 计算 owner 时只取直接父函数，匿名箭头回调里的绑定拿到 `undefined`，
     整批映射静默失效。短名大多住在回调里，改成向上找最近的具名函数后一次多生效 1,350 条；
  ③ 分片目录里混着上一轮的 `chunk2-*.json`，子代理会读到过期的代码上下文。
- 有 3,067 处映射被"安全规则"主动跳过：新名字与祖先作用域绑定同名会造成遮蔽
  （真实踩过：`let x = ctx.M(...)` 遮蔽参数 `x`，原代码在该声明前的引用直接 TDZ 崩溃）。
  这类不硬改，宁可留短名。
- 3 处跨域命名冲突（`_i`、`Pb`、`u_` 被两个域各起了一个名字），取先到者，记录在
  `extracted/STAGE2-REPORT.md`。
- 命名与注释是**基于代码行为的推断**，不是原始作者的本意；函数边界与模块归属同理。

## 常见改动怎么做

| 想做的事 | 改哪里 |
|---|---|
| 调画面参数（画质档、FOV、太阳色） | `src/config.js` |
| 改某个材质外观 | `src/render/shaders/surface.js`（`surf(uv)` 函数族） |
| 改后处理 | `src/render/passes/`、`src/render/pipeline.js` |
| 加一种道具 | `src/assets/props/<name>.js` + `props/index.js` 注册 + `PROP_SIZES` |
| 改敌人行为 | `src/entities/hound.js`、`src/entities/gull.js`、`src/entities/ai.js` |
| 改音效 | `src/audio/sfx.js`（配方表）、`src/audio/engine.js`（合成器） |
| 改关卡布置 | `src/level/layout.js`、`src/level/world.js` |
| 改 HUD/菜单 | `src/ui/hud.js`、`src/ui/menus.js` + 外壳 CSS（在原 HTML 里） |

改完跑 `npm run build`；`npm run build:dev` 会额外注入启动诊断块（把 `window.__fatal` 打到页面）。
