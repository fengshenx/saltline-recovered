# 模块契约

还原后的源码目录。每个文件对应 bundle 里的一段连续顶层声明（阶段3 由 `tools/split.mjs` 机械切分），
所以文件边界 = 原始代码的作用域顺序边界，import/export 由自由变量分析自动生成。

```
src/
  config.js              世界边界、太阳、天空色、玩家物理、画质预设、游戏数值常量
  core/
    rng.js               种子随机数（mulberry32 系）、哈希
    events.js            事件总线（weapon:fire / enemy:killed / game:state …）
    math.js              插值、弹簧、平滑、噪声小工具
    settings.js          localStorage 设置读写（saltline.settings.v1）
    input.js             键鼠 + Pointer Lock + 触屏 + 手柄
    loop.js              主循环、状态机、暂停/死亡/结算
  render/
    renderer.js          WebGLRenderer 创建、能力自检、三级降级、室内 probe 环境捕获
    pipeline.js          后处理链编排（prepass → 世界 → 各 pass 合成）
    passes/              单个 pass：bloom、雾/霾、湿滑、受击/低血/ADS 屏幕效果、色调
    materials.js         表面材质定义表（SURFACE_LIB）与材质缓存
    shaders/*.glsl       所有 GLSL（顶点/片元/表面 surf 函数），原样保留
    sky.js               天空与云
    decals.js            实例化贴花（弹孔、血迹、涂鸦）
    wetness.js           雨天湿度/积水
  assets/
    textures.js          canvas 2D 程序化纹理（铭牌、警示、锈迹、涂鸦）
    noise.js             噪声纹理生成（value/perlin/tileable）
    geometry.js          几何合并、平面网格、变换应用
    props/               道具生成器：container、forklift、jersey_barrier、
                         ibc_tote、traffic_cone、crate、chainlink、light_mast、
                         guard_booth、stairs、catwalk、shelf_rack、reefer_unit、relay_node …
      index.js           道具注册表（PROP_SIZES + 生成函数）
    structures.js        堆场、仓库、建筑、桥吊等大结构装配
  entities/
    player.js            玩家控制器（移动、蹲、冲刺、受伤）
    weapon.js            pac9 武器 viewmodel、开火/换弹/后坐力/ADS
    hound.js             地面敌人（骨骼动画 + 寻路 + 攻击）
    gull.js              飞行敌人
    relay.js             任务目标节点（三个 uplink）
    ai.js                AI 共用（感知、状态、群体调度）
    rig.js               骨骼/蒙皮工具
  audio/
    engine.js            WebAudio 合成引擎（振荡器/滤波/卷积混响/空间化）
    sfx.js               音效配方表（hound_servo、gull_rotor、impact_metal …）
  level/
    layout.js            关卡布置（place/stack 调用表）
    world.js             地形/水面/海平面/边界
  ui/
    dom.js               DOM 工具（li/createElement 系列）
    hud.js               罗盘、任务、准星、血条、弹药、击杀播报
    menus.js             标题/暂停/死亡/结算卡、设置面板、触屏布局
    boot.js              启动进度与致命错误兜底
  main.js                入口：boot 序列（Nr）
```

## 命名规范

| 类别 | 规则 | 例 |
|---|---|---|
| 函数 | camelCase，动词开头 | `createRenderer`、`buildContainer` |
| 类/构造器 | PascalCase | `Rig`、`AudioEngine` |
| 常量表 | SCREAMING_SNAKE | `WORLD_BOUNDS`、`PROP_SIZES` |
| 可调参数对象 | camelCase | `qualityPresets`、`settings` |
| GLSL 常量 | 与源码一致 | `SALTLINE_POST_FRAG` |
| 事件名 | 保持字符串原样 | `'weapon:fire'` |

注释用中文，写"为什么/约束"，不写"做了什么"。参数名要能看出语义（`opts`、`props`、`scene`、
`seed`、`dt`），避免 `i/e/t/n/s`。
