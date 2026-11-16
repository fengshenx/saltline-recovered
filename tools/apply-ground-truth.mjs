#!/usr/bin/env node
// 把 ground truth（原版仓库）应用到命名表，产出最终合并表 extracted/names/merged.json。
//
// 做三件事：
//   1. 合并 8 个分域命名文件，解决跨域撞名（同一压缩符号被两个域各起了一个名字）
//   2. 用 original-map.json 里高置信度的匹配覆盖成原作者的命名（原版仍是短名的保留我方命名）
//   3. 用 original-filemap.json 覆盖模块归属，让 src/ 的文件边界对齐原版
//
// 用法: node tools/apply-ground-truth.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const NAMES_DIR = resolve('extracted/names');
const isShort = (n) => !n || n.length <= 3;

//------------------------------------------------------------- 1. 合并 + 去重
const byCompressed = new Map(); // compressed -> {name, kind, module, doc, domain}
const params = {};
const locals = {};
const conflicts = [];

const existingPath = resolve(NAMES_DIR, 'merged.json');
const incremental = existsSync(existingPath) && !process.argv.includes('--rebuild');

if (incremental) {
  // 增量模式：在上一轮结果上继续应用对照，避免把已经采纳的原版名字冲掉
  const d = JSON.parse(readFileSync(existingPath, 'utf8'));
  for (const s of d.symbols || []) byCompressed.set(s.compressed, s);
  Object.assign(params, d.params || {});
  Object.assign(locals, d.locals || {});
}

for (const file of incremental ? [] : readdirSync(NAMES_DIR).filter((f) => /^[A-H]\.json$/.test(f))) {
  const data = JSON.parse(readFileSync(resolve(NAMES_DIR, file), 'utf8'));
  for (const s of data.symbols || []) {
    if (!s.compressed) continue;
    const prev = byCompressed.get(s.compressed);
    if (prev && prev.name !== s.name) {
      // 撞名：优先语义更具体（更长、非缩写前缀）的那个
      const keep = s.name.length > prev.name.length ? s : prev;
      const drop = keep === s ? prev : s;
      conflicts.push({ compressed: s.compressed, kept: keep.name, dropped: drop.name, keptFrom: keep.domain || file, droppedFrom: drop.domain || file });
      byCompressed.set(s.compressed, keep);
      continue;
    }
    byCompressed.set(s.compressed, { ...s, domain: data.domain });
  }
  Object.assign(params, data.params || {});
  Object.assign(locals, data.locals || {});
}

//------------------------------------------------------------- 2. 覆盖原版命名
const mergeOnly = process.argv.includes('--merge-only');
const gtPath = resolve('extracted/original-map.json');
const gt = !mergeOnly && existsSync(gtPath) ? JSON.parse(readFileSync(gtPath, 'utf8')) : [];
const byMineName = new Map();
for (const [compressed, meta] of byCompressed) {
  if (!byMineName.has(meta.name)) byMineName.set(meta.name, compressed);
}

let renamed = 0;
const renameLog = [];
for (const g of gt) {
  if (!g.adoptName || g.adoptName === g.mine) continue;
  if (isShort(g.adoptName)) continue;
  const compressed = byMineName.get(g.mine);
  if (!compressed) continue;
  const meta = byCompressed.get(compressed);
  // 不覆盖成已被别的符号占用的名字
  const taken = new Set([...byCompressed.values()].map((m) => m.name));
  if (taken.has(g.adoptName)) continue;
  renameLog.push({ compressed, from: meta.name, to: g.adoptName, score: g.score });
  meta.oldName = meta.oldName || meta.name;
  meta.name = g.adoptName;
  meta.source = 'original';
  renamed++;
}

//------------------------------------------------------------- 3. 覆盖模块归属
// 指纹只能可靠处理"字符串丰富"的符号（约 140 个）。其余用两层兜底：
//   MODULE_RULES    同一文件里按构件名再分派（structures → 吊机/船/天空/建筑）
//   MODULE_FALLBACK 整模块重定向到参考仓库的模块边界
const MODULE_RULES = [
  { mod: 'src/assets/structures.js', test: /CRANE/i, to: 'src/world/backdrop/cranes.js' },
  { mod: 'src/assets/structures.js', test: /SHIP|HULL|BERTH/i, to: 'src/world/backdrop/ships.js' },
  { mod: 'src/assets/structures.js', test: /SKY|CLOUD|HORIZON/i, to: 'src/world/backdrop/sky.js' },
  { mod: 'src/assets/structures.js', test: /BUILDING|WAREHOUSE|SHED|ROOF|OFFICE/i, to: 'src/world/level/buildings.js' },
  { mod: 'src/entities/weapon.js', test: /RIG|BONE|HAND|ARM|ANIM|VIEWMODEL/i, to: 'src/weapons/rig.js' },
  { mod: 'src/entities/weapon.js', test: /GEOMETRY|RECEIVER|MAG|STOCK|BARREL|RAIL|SIGHT/i, to: 'src/weapons/geometry.js' },
  { mod: 'src/assets/props/container.js', test: /./, to: 'src/world/props/cargo-builders.js' },
  { mod: 'src/assets/props/index.js', test: /./, to: 'src/world/props/registry.js' },
  { mod: 'src/assets/props/builder.js', test: /./, to: 'src/world/props/geometry.js' },
  // 阶段3 曾把 36 种道具拆成一物一文件；参考仓库是按建造器类别聚合的，这里收回去
  { mod: /^src\/assets\/props\//, test: /./, to: 'src/world/props/basic-builders.js' },
];

const MODULE_FALLBACK = {
  'src/config.js': 'src/core/config.js',
  'src/main.js': 'src/game.js',
  'src/misc.js': 'src/core/math.js',
  'src/core/rng.js': 'src/core/random.js',
  'src/core/settings.js': 'src/app/runtime.js',
  'src/core/loop.js': 'src/game/flow.js',
  'src/core/input.js': 'src/input/input.js',
  'src/assets/geometry.js': 'src/core/geometry.js',
  'src/assets/textures.js': 'src/render/materials/textures.js',
  'src/assets/noise.js': 'src/core/random.js',
  'src/assets/structures.js': 'src/world/backdrop/backdrop.js',
  'src/assets/props/index.js': 'src/world/props/registry.js',
  'src/assets/props/builder.js': 'src/world/props/geometry.js',
  'src/render/fx.js': 'src/effects/effects.js',
  'src/render/materials.js': 'src/render/materials/materials.js',
  'src/render/decals.js': 'src/effects/particles.js',
  'src/render/wetness.js': 'src/world/ground/water.js',
  'src/render/shaders/surface.js': 'src/render/materials/surface-shaders.js',
  'src/level/world.js': 'src/world/ground/ground.js',
  'src/level/layout.js': 'src/world/level/placement.js',
  'src/level/collision.js': 'src/world/physics.js',
  'src/entities/player.js': 'src/player/player.js',
  'src/entities/weapon.js': 'src/weapons/weapon.js',
  'src/entities/hound.js': 'src/enemies/walker.js',
  'src/entities/gull.js': 'src/enemies/drone.js',
  'src/entities/ai.js': 'src/enemies/enemies.js',
  'src/entities/rig.js': 'src/weapons/rig.js',
  'src/entities/combat.js': 'src/combat/combat.js',
  'src/entities/relay.js': 'src/game/flow.js',
  'src/audio/engine.js': 'src/audio/audio.js',
  'src/audio/sfx.js': 'src/audio/library.js',
  'src/audio/dsp.js': 'src/audio/synthesis.js',
  'src/ui/boot.js': 'src/app/boot-screen.js',
  'src/ui/dom.js': 'src/ui/hud.js',
};

//------------------------------------------------------------- 4. 目录重排
// 上一步得到的是"对齐参考仓库"的文件边界（还算平铺）。这一步把模块收敛到目标工程结构：
// 平台 / 核心 / 资源 / 渲染 / 音频 / 物理 / 动画 / 内容 / 玩法 / 应用 / UI 分层，层内按特性纵切。
// 依赖方向单向向下：platform → core → 子系统 → 内容/物理 → 玩法 → app → ui。
// 键是"当前路径"，前缀规则负责整目录搬迁；重跑时键已不存在，天然幂等。
const MODULE_RELAYOUT_BY_SYMBOL = [
  // 骨骼与 IK 是跨实体复用的动画能力，从武器视图模型里提出
  { mod: 'src/weapons/rig.js', test: /SkinnedRig|LegIK/i, to: 'src/animation/skeleton.js' },
];

const MODULE_RELAYOUT_EXACT = {
  // 物理：碰撞世界 + 导航网格
  'src/world/physics.js': 'src/physics/collision.js',
  // 资源：程序化生成的几何与纹理（"谁创建谁释放"要集中管）
  'src/core/geometry.js': 'src/assets/procedural/geometry.js',
  'src/render/materials/textures.js': 'src/assets/procedural/textures.js',
  // 平台：浏览器事件隔离带
  'src/input/input.js': 'src/platform/input.js',
  // 内容：敌人/道具模型不参与玩法逻辑
  'src/enemies/models.js': 'src/content/models/enemies.js',
  // 应用：流程状态机、展示场景注册表、启动页
  'src/game/flow.js': 'src/app/flow.js',
  'src/game.js': 'src/app/showcase.js',
  'src/app/boot-screen.js': 'src/app/boot.js',
  // 渲染：特效与对象池服务渲染
  'src/effects/effects.js': 'src/render/effects/effects.js',
  'src/effects/particles.js': 'src/render/effects/particles.js',
  'src/effects/pools.js': 'src/render/effects/pools.js',
};

const MODULE_RELAYOUT_PREFIX = [
  ['src/world/backdrop/', 'src/content/backdrop/'],
  ['src/world/ground/', 'src/content/ground/'],
  ['src/world/level/', 'src/content/level/'],
  ['src/world/props/', 'src/content/props/'],
  ['src/enemies/', 'src/gameplay/enemies/'],
  ['src/weapons/', 'src/gameplay/weapons/'],
  ['src/player/', 'src/gameplay/'],
  ['src/combat/', 'src/gameplay/'],
];

/** 把模块路径重写到目标结构，不命中则原样返回 */
function relayoutModule(mod, name) {
  for (const r of MODULE_RELAYOUT_BY_SYMBOL) if (r.mod === mod && r.test.test(name)) return r.to;
  if (MODULE_RELAYOUT_EXACT[mod]) return MODULE_RELAYOUT_EXACT[mod];
  for (const [from, to] of MODULE_RELAYOUT_PREFIX) if (mod.startsWith(from)) return to + mod.slice(from.length);
  return mod;
}

const filePath = resolve('extracted/original-filemap.json');
const fileMap = !mergeOnly && existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : [];
const fileByMine = new Map(fileMap.map((f) => [f.mine, f.file]));
let remoduled = 0;
for (const [, meta] of byCompressed) {
  const before = meta.module;
  // ① 指纹命中（最可信）
  const target = fileByMine.get(meta.oldName || meta.name) || fileByMine.get(meta.name);
  if (target) {
    meta.module = target;
    meta.moduleSource = 'fingerprint';
  } else {
    // ② 构件规则（把大文件按名字拆开）
    const rule = MODULE_RULES.find(
      (r) => (typeof r.mod === 'string' ? r.mod === before : r.mod.test(before)) && r.test.test(meta.name)
    );
    if (rule) {
      meta.module = rule.to;
      meta.moduleSource = 'rule';
    } else if (MODULE_FALLBACK[before]) {
      // ③ 整模块重定向
      meta.module = MODULE_FALLBACK[before];
      meta.moduleSource = 'fallback';
    }
  }
  // ④ 目录重排（最终结构，覆盖以上三步）
  const relaid = relayoutModule(meta.module, meta.name);
  if (relaid !== meta.module) {
    meta.module = relaid;
    meta.moduleSource = 'relayout';
  }
  if (meta.module !== before) remoduled++;
}

// 撞名符号的模块也统一（同一 compressed 只保留一条）
const merged = {
  symbols: [...byCompressed.entries()].map(([compressed, meta]) => ({ compressed, ...meta })),
  params,
  locals,
  generatedFrom: 'names/A-H.json + original-map.json + original-filemap.json',
};
writeFileSync(resolve(NAMES_DIR, 'merged.json'), JSON.stringify(merged, null, 1));

const modCount = new Map();
for (const s of merged.symbols) modCount.set(s.module, (modCount.get(s.module) || 0) + 1);

console.log(`合并符号 ${merged.symbols.length}（撞名 ${conflicts.length}）`);
console.log(`采用原版命名 ${renamed} 个`);
console.log(`模块归属覆盖 ${remoduled} 个，最终分布到 ${modCount.size} 个模块`);
console.log('\n撞名处理:');
for (const c of conflicts) console.log(`  ${c.compressed}: 保留 ${c.kept}（${c.keptFrom}），丢弃 ${c.dropped}（${c.droppedFrom}）`);
console.log('\n改名样例:');
for (const r of renameLog.slice(0, 15)) console.log(`  ${r.from} → ${r.to}`);
console.log('\n模块分布（前 15）:');
for (const [m, c] of [...modCount].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(c).padStart(3)}  ${m}`);
