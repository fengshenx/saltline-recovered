# 模块契约

还原后的源码结构。每个文件对应 bundle 里的一段连续顶层声明（阶段3 由 `tools/split.mjs` 机械切分），
所以文件边界 = 原始代码的作用域顺序边界，import/export 由自由变量分析自动生成。

目录按"依赖单向向下"分层：`platform → core → assets → 子系统(render/audio/physics/animation)
→ content/physics → gameplay → app → ui`。层内按特性纵向切片，不按技术类型横切。

```
src/
  index.js                 入口：import init-order 后调用 startGame()
  init-order.js            930 条非声明语句，按原始书写顺序执行（反混淆债，见文末）
  misc.js                  14 个未能归类的顶层符号（剩余的债）

  platform/                浏览器差异隔离带，其余各层不直接碰 document/navigator
    input.js               键鼠 + Pointer Lock + 触屏 + 手柄 → 语义化动作

  core/                    不含业务逻辑的底座
    config.js              世界边界、太阳、天空色、玩家物理规格、画质预设
    math.js                插值、弹簧、平滑、clamp/smoothstep、阻尼
    random.js              种子随机数（mulberry32 系）、哈希、噪声
    events.js              事件总线（weapon:fire / enemy:killed / game:state …）
    quality.js             设备能力探测与画质档位选择
    fallbacks.js           各模块的 stub（加载失败时兜底，保证降级不白屏）
    three-types.js         Vec3/Quat/Mat4 别名（零依赖，防循环）

  assets/                  资源的创建与释放集中在这一层
    procedural/geometry.js 几何合并、平面网格、变换、倒角盒、管件
    procedural/textures.js canvas 2D 程序化纹理（铭牌、警示、锈迹、涂鸦）

  render/                  渲染子系统
    renderer.js            WebGLRenderer 创建、能力自检、三级降级、室内 probe 与环境捕获
    postprocessing.js      后处理链编排（prepass → 世界 → 各 pass 合成）
    shadows.js             阴影贴图与 PCF 配置
    sky.js                 天空与云
    materials/materials.js 表面材质定义表与材质缓存
    materials/catalog.js   材质清单与预设
    materials/surface-shaders.js  表面着色器 surf 函数注入
    materials/showcase.js  材质展示场景（?show=mats）
    effects/effects.js     VFX 系统（爆炸、火花、烟、雨丝）
    effects/particles.js   粒子与实例化贴花
    effects/pools.js       碎片/弹壳/贴花三类对象池

  audio/                   WebAudio 子系统
    audio.js               合成引擎（振荡器/滤波/卷积混响/空间化）
    library.js             音效配方表（hound_servo、gull_rotor、impact_metal …）
    synthesis.js           波形、包络、滤波原语
    music.js               背景音乐

  physics/                 仿真：不依赖渲染，只认几何与向量
    collision.js           碰撞世界、导航网格、射线与球体查询

  animation/               跨实体复用的动画能力
    skeleton.js            骨骼绑定与腿部 IK

  content/                 世界内容（几何与布置），被 gameplay 与 render 消费
    backdrop/backdrop.js   堆场背景装配
    backdrop/cranes.js     岸桥（SATLINE 84 等）
    backdrop/ships.js      集装箱船、船体、泊位
    backdrop/sky.js        天际线、云层、地平线
    backdrop/geometry.js   背景专用几何工具
    ground/ground.js       地形、海平面、边界
    ground/asphalt.js      沥青路面材质与斑驳
    ground/water.js        水面与湿度/积水
    ground/geometry.js     地面专用几何工具
    level/level.js         关卡定义（数据，不是构造逻辑）
    level/placement.js     布置算法（place/stack 调用表）
    level/buildings.js     仓库、车间、办公楼的构造
    props/registry.js      道具注册表（PROP_SIZES + 生成入口）
    props/geometry.js      道具通用几何
    props/containers.js    集装箱箱体与部件（角件、波纹板、门锁杆、铭牌）
    props/barriers.js      围栏类（水马、铁丝网、道闸、岗亭）
    props/fixtures.js      杆件与灯具（灯杆、泛光灯、标志牌、照明架）
    props/mooring.js       系泊件（系缆桩、立柱）
    props/structures.js    通行结构（钢梯、检修通道）
    props/storage.js       仓储件（托盘垛、货架、冷藏机组）
    props/relay.js         中继节点设备
    props/parts-geometry.js 零件级几何原语（油桶轮廓、轮胎、沙袋）
    props/vehicles.js      车辆（手推车、被遗弃轿车）
    props/cargo-builders.js    集装箱、IBC 吨桶、冷藏机组
    props/detailed-builders.js 细节道具（叉车、灯杆、岗亭、楼梯、货架…）
    props/character-builders.js 人物相关道具
    props/detail-geometry.js   道具细节几何
    props/props.js         道具模块聚合导出（原 basic-builders.js 5000+ 行，已按职责拆为上面 9 个文件）
    models/enemies.js      敌人模型（Walker / Drone 的网格与材质）

  gameplay/                玩法规则
    player.js              玩家控制器（移动、蹲、冲刺、受伤、相机）
    combat.js              命中判定、伤害结算、击杀事件
    weapons/weapon.js      pac-9：开火/换弹/后坐力/ADS/弹药
    weapons/geometry.js    武器几何（机匣、弹匣、枪管、导轨、瞄具）
    weapons/rig.js         视图模型（手套、镜片、枪口焰、材质、骨骼挂点）
    enemies/enemies.js     AI 共用（感知、状态、群体调度）
    enemies/walker.js      地面敌人 Hound
    enemies/drone.js       飞行敌人 Gull

  ui/                      DOM 界面
    hud.js                 罗盘、任务、准星、血条、弹药、击杀播报
    menus.js               标题/暂停/死亡/结算卡、设置面板、触屏布局

  app/                     应用编排
    runtime.js             启动序列：按序加载模块、挂主循环、组织每帧更新顺序
    flow.js                任务流程状态机、罗盘方位名、Control 无线电台词
    boot.js                启动进度与致命错误兜底
    showcase.js            ?show= 参数到各模块 showcase 入口的注册表
    diagnostics.js         帧率与耗时探针（window.__stats）
    benchmark.js           ?bench=1 压测
```

## 命名规范

| 类别 | 规则 | 例 |
|---|---|---|
| 函数 | camelCase，动词开头 | `createRenderer`、`buildContainer` |
| 类/构造器 | PascalCase | `Rig`、`DecalBatch` |
| 常量表 | SCREAMING_SNAKE | `WORLD_BOUNDS`、`PROP_SIZES` |
| 可调参数对象 | camelCase | `qualityPresets`、`settings` |
| GLSL 常量 | 与源码一致 | `SALTLINE_POST_FRAG` |
| 事件名 | 保持字符串原样 | `'weapon:fire'` |

注释用中文，写"为什么/约束"，不写"做了什么"。参数名要能看出语义（`opts`、`props`、`scene`、
`seed`、`dt`），避免 `i/e/t/n/s`。

## 两处反混淆遗留

`init-order.js` 与 `misc.js` 不是设计出来的模块，是反推工程的债：

- 原 bundle 依赖严格书写顺序，`var X = f(Y)` 跨"模块"取值时必须保证 `Y` 已初始化。
  ESM 的求值顺序由依赖图决定，遇循环依赖必然踩 TDZ，所以所有非声明语句集中到
  `init-order.js` 按原始 order 执行，构建时由 `tools/link.mjs` 重排。
- 消掉它需要把 930 条语句的依赖关系做成完整 DAG 后重排，属于独立工程，收益是可维护性而非功能。
