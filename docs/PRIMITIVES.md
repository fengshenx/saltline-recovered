# 游戏原语手册

按**能力**组织的原语清单：几何、建模、纹理、材质、渲染管线。`MODULES.md` 按文件说明“哪段代码在哪”，
本文说明“想做什么该用哪个原语、它的契约和坑”。

所有签名取自源码，行号指向 2026-11 时的位置。源码是反混淆产物，参数名多为 `e/t/n`，
下面按语义重命名，与源码不一致处以源码为准。

## 0. 全链路数据流

```
建造器（content/props/*.js）
   │  PartBuilder.box/cyl/bar/beam  →  按材质分桶的 BufferGeometry
   ↓
几何层（assets/procedural/geometry.js）  82 个导出：基元体 / 变形 / 连线 / 放样 / 合批
   │  mergeGeometryParts → 每材质一个 Mesh
   ↓
材质层（render/materials/）
   │  SURFACE_LIB 40 条规格 → getMaterial(name, opts)
   │       └─ 纹理来自 SURFACE_DEFS 29 条 → GLSL surf 烘焙 → albedo/orm/normal 三张图
   ↓
场景（content/level/）  placeProp 布置 → mergeStaticMeshes 合批
   ↓
渲染（render/renderer.js）  sun + 点光池 + IBL + PCSS 阴影  →  HDR 目标
   ↓
后处理（render/postprocessing.js）  深度 → AO → 体积光 → 合成 → 运动模糊 →
                                    bloom → 自适应曝光 → 调色 → 最终输出
```

三条单向依赖：**几何不认材质**（只带材质名与顶点色）、**材质不认场景**（只认表面规格）、
**后处理不认内容**（只认深度与颜色缓冲）。跨层跳跃只允许一种：`tagPropUserData` 把语义挂到
`userData` 上，供物理与特效在运行期读取。

## 1. 几何层

`src/assets/procedural/geometry.js`（2236 行，82 导出）。按用途分五族。

### 1.1 基元体

| 原语 | 签名 | 说明 |
|---|---|---|
| `boxGeometry` | `(w, h, d, anchor='center')` | 轴对齐盒，`anchor` 可选 `min`/`center` |
| `chamferedBoxGeometry` | `(w, h, d, bevel=0.01, anchor)` | 倒角盒。**定义在 `content/props/geometry.js:10`**，几何层只是 import 转发 |
| `cylinderGeometry` | `(rTop, rBot, h, seg=12, open)` | Y 轴圆柱，可锥台 |
| `createCylinderX/Y/Z` | `(rTop, rBot, h, seg=12)` | 轴向变体 |
| `tubeGeometry` | `(points, radius=0.03, radial=8, closed, tension=0)` | 沿路径的管，Catmull-Rom 插值 |
| `createSphereGeometry` | `(r, wSeg=10, hSeg=6, phiLen, phiStart, thetaLen)` | 球（带弧度裁剪） |
| `createScaledSphere` | `(r, wSeg=14, hSeg=10, sx, sy, sz)` | 椭球 |
| `createTorusGeometryWorldUV` | `(…)` | 环，UV 按世界尺度展开 |
| `createPlaneGeometry` | `(w, h)` | XY 平面片 |
| `createLatheGeometryFromProfile` / `revolveProfileGeometry` | `(profile, seg=16)` | 车削：2D 轮廓绕 Y 轴旋成回转体 |

### 1.2 变形与拓扑

| 原语 | 签名 | 说明 |
|---|---|---|
| `mapVertices` | `(geo, fn)` | 逐顶点回调变形，`fn(x,y,z,i)` 返回新坐标 |
| `flipGeometryWinding` | `(geo)` | 翻转绕序（法线朝内→朝外） |
| `removeGeometryGroup` | `(geo, index)` | 删掉一个材质组（多材质合体的局部替换） |
| `mirrorGeometryX` | `(geo)` | X 轴镜像（左右对称件） |
| `colorGeometry` | `(geo, [r,g,b])` | 写顶点色属性 |
| `bakeVertexColorTint` | `(geo, tint)` | 顶点色乘一个整体色调 |
| `triangleCount` | `(geo)` | 三角数（预算审计） |

### 1.3 连线与结构

面向“两点之间要一根杆/梁”的接线件，道具细节大量使用：

| 原语 | 签名 | 说明 |
|---|---|---|
| `strutBetween` | `(start, end, radius=0.03, seg=5, openEnded)` | 圆杆，自动算朝向 |
| `beamBetween` | `(start, end, width, depth, bevel=0)` | 方梁 |
| `createRoundedBeamBetween` | `(…)` | 圆角方梁 |
| `createCylinderBetween` | `(from, to, rA, rB=rA, seg=8)` | 锥形连线 |
| `createStrut` | `(from, to, rA, rB, seg=8)` | 同上，参数顺序不同（历史遗留，两者并存） |
| `strutsAlongPath` | `(points, radius=0.03, seg=5)` | 沿折线批量生成杆 |
| `catenaryPoints` | `(start, end, sag=1, seg=10)` | 悬链线采样（缆绳、电线） |
| `planeAt` | `(w, h, x, y, z, rotY, rotX)` | 定点定位的平面片 |

### 1.4 曲面与放样

这是“非箱体形状”的全部来源。

| 原语 | 签名 | 说明 |
|---|---|---|
| `catmullRomPath` | `(points, samplesPerSegment=6, closed=false)` | Catmull-Rom 采样。维度由首点长度决定：2D 用于截面，3D 用于空间路径 |
| `loftProfileSurface` | `(profile, stations, project, {closed, center, inward, caps})` | **截面放样**：把 2D 截面沿站点序列投影成带状曲面 |
| `buildGridSurface` | `(uSamples, vSamples, project)` | 参数化网格片，`project(u, v) → [x,y,z]` |
| `createHollowPolygonExtrusion` | `(polygon, …)` | 带孔的凸多边形挤出（法兰、框） |
| `createRibbonFromPolyline` | `(points, halfExtent, doubleSided=true)` | 折线扩展成带（路面标线、束带） |
| `buildCorrugationStations` | `(min, max, pitch, depth, flat, slope, origin)` | 波纹站点生成（集装箱侧板） |
| `sheetEdgeWeight` / `SHEET_SAMPLES` | — | 薄板边缘的权重采样，防止边缘过亮 |

`loftProfileSurface` 的 `project` 回调签名是 `(coordU, coordV, station, rowIndex) → [x, y, z]`：
`coordU/coordV` 是归一化截面坐标，`station` 是当前站点值。UV 的 u 用截面弧长、v 用站点值。

### 1.5 UV 与贴花面

项目没有 UV 展开流程（`grep unwrap` 无匹配），所有 UV 靠三平面投影或下面这些专用面：

| 原语 | 说明 |
|---|---|
| `createPlaneGeometryWorldUV` / `createTiledPlane` | UV 按世界尺寸展开，贴图不随物件缩放拉伸 |
| `createPlaneGeometryOffsetUV` / `...Alt` | 带 UV 偏移的平面（同一贴图错开拼贴） |
| `createDecalPlane(w, h)` | 贴花面片，透明度混合 |
| `createCurvedDecalQuad(r, arcLen, h, seg)` | 贴在圆柱面上的贴花（油桶、管道） |
| `createTiledSphere` | 世界 UV 球（天空、水花） |

### 1.6 合批

| 原语 | 说明 |
|---|---|
| `mergeGeometries(geos, useGroups)` | 底层合并 |
| `mergeGeometryParts(parts)` | 带属性对齐的合并（顶点色/UV 缺失会自动补齐） |
| `mergeStaticMeshes(root, {castShadow, receiveShadow})` | 遍历静态子树，按「材质 uuid + 阴影标志 + layer」分组烘成大网格。**skinned / instanced / 多材质 / 带 `userData.noMerge` 的子树原样保留** |
| `MeshBatcher` | 按材质归并的批处理器，支持材质重映射、整体平移、**最小尺寸剔除**（远景只留大块） |

### 1.7 三个构建器

同名不同代，选错会写得很痛苦：

| 构建器 | 定位 | 适合 |
|---|---|---|
| `PartBuilder` | 第一代零件装配器：变换矩阵栈 + 材质分桶 + 语法糖 | 常规道具（95% 的建造器用它） |
| `RingMeshBuilder` | 环形累加器：固定环顶点数逐环推点，收尾统一算索引与法线，可焊接接缝 | 管状曲面、手套、袖管 |
| `MeshBatcher` | 只做归并，不带装配语法 | 上千个小件的批量收敛 |

`PartBuilder` 方法：

```js
pb = new PartBuilder({ mats })        // mats: 材质工厂（含 get(name, opts)）

pb.push(matrix) / pb.pop()            // 变换栈
pb.box (mat, w, h, d, x, y, z, { r, rot, col })      // r: 倒角半径
pb.cyl (mat, rTop, rBot, h, x, y, z, { seg, open, flat, rot, col })
pb.tube(mat, points, radius, { seg, tension, col })
pb.bar (mat, from, to, radius, { r2, seg, caps, col })   // 两点圆杆
pb.beam(mat, from, to, width, depth, { r, twist, col })   // 两点方梁
pb.decal(matObj, width, x, y, z, rot, height?)        // 贴花面片，高默认 width × material.aspect
pb.parts()                            // → [{ mat, geo, cast }]
pb.group(materialMap)                 // → Group（含 Mesh）
```

### 1.8 坑

**`je(geometry, x, y, z, euler)` 会改写入参并返回同一引用。** 定义在 `geometry.js:841`，
内部 `geometry.applyMatrix4(...); return geometry;`。全库引用 298 次，是主要雷区：

```js
// 错：同一几何被连续变换 4 次，位置累积
for (const side of [1, -1]) add(je(rimGeo, side * 0.8, 0, 0));

// 对：每次 clone
for (const side of [1, -1]) add(je(rimGeo.clone(), side * 0.8, 0, 0));
```

**`chamferedBoxGeometry` 不在几何层。** 它在 `content/props/geometry.js`，几何层只 import 转发。
两者差异：`beveledBoxGeometry`（几何层自带）与 `chamferedBoxGeometry`（道具层）算法不同——
前者按三轴等距倒角，后者按最小边收敛，`PartBuilder.box` 用的是后者。

**`createStrut` 与 `createCylinderBetween` 语义重复。** 前者参数 `(from, to, rA, rB, seg)`，
后者 `(from, to, rA, rB, seg)` 顺序相同但内部实现独立。历史遗留，新代码优先用 `strutBetween`。

## 2. 建模层

“用代码造出一个物件”的方法论。原语只是零件，建模路线决定形状能走多远。

### 2.1 三条路线

| 路线 | 适用 | 代表 |
|---|---|---|
| **组合式** | 硬表面、机械件、建筑：基元体 + 连线 + 倒角 | 集装箱、护栏、灯杆（绝大多数道具） |
| **截面放样** | 有明确“纵向剖面 + 横向截面”的东西：车身、船体、沟槽 | `abandoned_sedan` 车身 |
| **车削 / 网格片** | 回转体（油桶、管件、轮毂）与双参数曲面（手套、帆布） | `revolveProfileGeometry`、`buildGridSurface` |

组合式占 90%：箱体世界的形状本来就是“盒子 + 杆子”。放样与车削是“要看起来像有机/流线”时的升级路径。

### 2.2 一条样条，三种用途

`catmullRomPath` 是全库最通用的形状原语，同一个函数承担三件事：

```js
// 1) 纵向剖面：关键帧表 → 连续站点
const bodyKeys = catmullRomPath(SEDAN_KEYS, 5);        // 19 帧 → 76 站，2D/6 维

// 2) 横向截面：少量控制点 → 圆角环
const bodySection = catmullRomPath([
  [1, 0], [1, 0.9], [0.94, 0.985], [0.62, 1], [0, 1],
  [-0.62, 1], [-0.94, 0.985], [-1, 0.9], [-1, 0], [0, 0],
], 4, true);                                            // closed: 首尾相接

// 3) 空间路径：点位 → 平滑曲线（管、缆、把手）
const curve = catmullRomPath([[0,0,0], [0,1,0.5], [1,1.2,1]], 8);
```

维度由首点 `.length` 决定——所以“6 维关键帧”（z/半宽/底高/腰线/车顶高/收窄率）也能插值，
拿到的是 6 个通道同时平滑过渡的站点表。这是参数化造物的关键技巧：**把形状参数当坐标插值**。

### 2.3 CSG 布尔

`three-bvh-csg`（`Brush` / `Evaluator` / `SUBTRACTION`）。用于“从实体上挖出形状”，
目前只有轮拱一处使用：

```js
const archBrush = new Brush(
  new THREE.CylinderGeometry(0.43, 0.43, 2.6, 24, 1)
    .rotateZ(HALF_PI).translate(0, 0.33, axleZ)
);
const result = new Evaluator().evaluate(bodyBrush, archBrush, SUBTRACTION);
```

**顺序约束：CSG 之后必须重算顶点属性。** 布尔运算会丢弃顶点色（以及自定义属性），
所以“按位置计算顶点色”的代码必须放在差集之后。这条约束尚未固化进原语，写在调用处。

### 2.4 道具契约

一个新道具 = 四件东西：

```js
// 1) 尺寸与语义（registry.js）
PROP_SIZES.new_thing = [w, h, d, '主材质名', '物理/音效/特效类'];

// 2) 建造器（content/props/*.js）
export function buildNewThing(ctx, opts) {
  const pb = new PartBuilder({ mats: ctx.mats });
  pb.box('steel_galv', 1, 0.1, 1, 0, 0.05, 0, { r: 0.01 });
  return tagPropUserData(pb.group(), 'new_thing', [w, h, d], colliders);
}

// 3) 注册（registry.js）
registerPropBuilder('new_thing', buildNewThing);

// 4) 布置（level/placement.js）
placeProp('new_thing', x, z, angle, { variant: 2 });
```

第五条隐含契约：**材质名必须是 `SURFACE_LIB` 的键**，否则 `getMaterial` 打警告并退到灰材质。
第六条：`userData` 上的 `propName / propSize / colliders` 是物理与诊断的唯一入口，
`tagPropUserData` 负责填，别手写。

### 2.5 案例：车身

`buildAbandonedSedan`（`content/props/vehicles.js`）是放样路线的完整样本：

```
19 个关键帧 [z, halfW, sillY, beltY, roofY, narrow]
   ↓ catmullRomPath(_, 5)        6 维插值
76 个站点
   ↓ 每组站点再算 surfaceAt(z, v, side)
车身表面坐标（含 bodyTaper：底裙内收 5%，腰线以上按 narrow 收窄）
   ↓ loftProfileSurface(bodySection, stations, project, {closed, caps})
车身壳体（顶点色按位置烘焙锈迹）
   ↓ CylinderGeometry 差集（前后轮拱）
轮拱开口
   ↓ surfaceAt 反查定位
玻璃（roofSkin/sideSkin）、A/B/C 柱、腰线、门缝、把手、后视镜、大灯…
```

关键设计：**所有细节件用 `surfaceAt` 反查定位，不硬编码绝对坐标**。车身关键帧一改，
玻璃、柱、把手自动跟随。这是“参数化”的真实含义——改一处，全部一致。

`bodyTaper(coordV, narrow)` 是收窄函数：

```js
(1 - 0.05 * smoothstepRange(0.14, 0, v)) *           // 底裙内收
(1 - (1 - narrow) * smoothstepRange(0.5, 1, v))      // 腰线以上按 narrow 收
```

`surfaceAt(z, v, side=1) → [side * halfW * taper, sill + v * (roof - sill), z]`

### 2.6 建模的能力边界

这套方法停在“能认出是什么”的水平，往上走有四个硬缺口：

| 缺口 | 后果 | 属于谁的领域 |
|---|---|---|
| 无 UV 展开 | 细节靠三平面投影，接缝处会有拉伸 | bpy / 专用 UV 工具 |
| 无高模烘低模 | 没有法线细节，只能靠 surf 烘焙的假凹凸 | bpy + Substance |
| 无权重笔刷 | 关节形变质量差 | bpy |
| 无 GI | 无间接光，SSAO 只是近似 | 路径追踪器 |

这四条不是代码质量问题，是方法边界。

## 3. 纹理层

两条完全独立的来源：**GLSL 表面烘焙**（全部材质的底图）与 **canvas 2D 配方**（铭牌、贴花、翻页本）。

### 3.1 烘焙管线

`createMaterials`（`materials.js:96`）在启动时把所有表面烘成三张图，运行期只采样。

```
SURFACE_DEFS[name]  { fn, size, tile, bump, hero, p, seed }
   ↓ 尺寸解析：texSize × size，hero 且设备允许 → 2048，下限 32
RT(A, A, count:3)   ← 一次渲染写三路 MRT
   ├─ o0: albedo（sqrt 编码，节省精度）
   ├─ o1: ao(r) / roughness(g) / metalness(b)
   └─ o2: 高度（整数部分/小数部分拆两通道，避免 8bit 量化台阶）
   ↓ 「高度转法线」pass：Sobel + bump 强度 / tile 物理尺寸
   ↓ 「拷贝」pass ×2（albedo 转 sRGB，ORM 保持线性）
albedo(sRGB) / orm(linear) / normal(tangent space)
   ↓ texture.repeat = 1/tile（一格的物理尺寸）
getMaterial(name) 时挂到 MeshStandardMaterial / MeshPhysicalMaterial
```

三个实现细节：

- **RT 用 `NearestFilter` 且不生成 mipmap**，因为它是渲染目标，不是采样源；拷贝出来的贴图才开
  `LinearMipmapLinearFilter` + anisotropy（上限 8）。
- **法线是算出来的，不是烘出来的**：surf 函数只输出高度，`SALTLINE_HEIGHT_TO_NORMAL_FRAG`
  用邻域差分转成切线空间法线，`bump` 参数控制强度并除以 `tile` 得到物理一致的凹凸。
- **显存记账**：`stats.bytes += D * D * 4 * 1.34`（1.34 是三张图 + mipmap 链的经验系数）。

### 3.2 surf 函数库

27 个 surf 函数（注册在 `init-order.js`，赋值给 `SURFACE_SHADERS`）：

```
asphalt  concrete  brick    epoxy    paint    hazard   hull     galv
metal    brushed   rust     diamond  corrugated chainlink gunmetal polymer
carbon   fabric    armor    wood     plastic  tarp     cardboard rope
tire     glass     water
```

每个函数签名统一为 `void surf(vec2 uv)`，通过写 MRT 输出。共享前导
`SALTLINE_SURF_PRELUDE_FRAG` 提供全部工具：

| GLSL 工具 | 用途 |
|---|---|
| `h3(cell, period, seed)` | PCG 哈希，三通道随机数 |
| `gn(p, period, seed)` | 梯度噪声（可平铺） |
| `fbm(uv, freq, octaves, seed)` | 分形噪声，0..1 居中于 0.5 |
| `vor(p, period, seed)` | Voronoi：F1/F2 距离 + 两个 cell 随机 |
| `scr(uv, f, seed, w, ang, spread, dens)` | 散布直线划痕 |
| `rustMask(uv, freq, threshold, seed)` | 软边颗粒化锈斑 |
| `chipsF(uv, freq, seed, density, rmax)` | 掉漆片状掩膜 |
| `paintDmg(uv, amount, out chip, out stain, out run)` | **共享漆面损伤模型**：掉漆分级 + 锈晕 + 垂直流痕 |
| `emit(color, alpha, height, ao, rough, metal)` | 写三路 MRT |
| `L(r,g,b)` | sRGB → 线性 |
| `OV(color, k)` | 按权重叠色（`nt`/`ta` 就地混合） |

`paint` 与 `hazard` 两个 surf 共用 `SALTLINE_PAINT_BODY`（漆面本体：底漆/裸钢/铁锈/新划痕四级
叠加 + 污垢膜 + 垂直水洗痕），只通过 `shade`/`baseR` 参数区分底色与粗糙度。

### 3.3 SURFACE_DEFS 参数

29 条（27 个 fn，`hazard` 复用 `paint`）。字段：

| 字段 | 含义 |
|---|---|
| `fn` | 指向 `SURFACE_SHADERS` 的键 |
| `size` | 相对全局 `texSize` 的倍率（brick 0.5 = 半分辨率） |
| `tile` | 一格纹理对应的物理尺寸（米），可为 `[u, v]`；决定 `texture.repeat` 与法线强度换算 |
| `bump` | 凹凸强度，内部按 `bump * 0.001 * D / tile` 换算 |
| `hero` | 关键表面，设备 `texSize ≥ 2048` 时允许 2048 |
| `p` | vec4 图案参数，原样进 `uP` |
| `seed` | 进 `uSeed` |

`tile` 是“物理一致性”的关键：0.5m 一格的水泥与 3m 一格的水泥，凹凸高度必须不同，
否则近看像砂纸、远看像塑料。

### 3.4 canvas 2D 配方

`textures.js`（1741 行，22 导出）。用于“文字与图形”这类 GLSL 不适合画的东西：

| 原语 | 产出 |
|---|---|
| `createDecalLibrary(app, maxAniso)` | 全部贴花：集装箱船公司 logo、CSC 铭牌、危险标识、涂鸦、BER 编号… |
| `createSmokeFlipbook(texSize=128)` | 烟翻页本：4×2 格 |
| `createSparkFlipbook(cellSize=128)` | 火花图集：8 格（flash/streak/burst/ring/puff/disc/spike） |
| `PAC9_MARK_REGIONS` + `MARK_ATLAS_*` | 枪身标记图集 1024×512 |

翻页本由 CPU 逐帧画 canvas、上传成一张图集，粒子 shader 按 `cell` 索引取帧——
所以烟与火花是“逐帧动画纹理”，不是程序化噪声。

### 3.5 纹理的取舍

- 台面上限 1024，hero 允许 2048。**整个游戏的纹理显存是启动时一次性付出的**，没有流式加载。
- 没有法线贴图资产，全部由高度图现算；没有粗糙度/金属度贴图资产，全部由 ORM 烘焙。
- 没有 UV，靠 `texture.repeat` + 三平面投影把世界坐标映射到贴图。

## 4. 材质层

`SURFACE_LIB` 是**运行期唯一可用的材质名表**（40 条），键名即 `PartBuilder.box('steel_galv', …)` 的第一个参数。

### 4.1 规格契约

```js
makeSurfaceSpec(set, opts) → {
  set,              // 纹理表面名，必须是 SURFACE_DEFS 的键
  tint: 0,          // 0 = 用 color；1 = 用顶点色乘
  color: 0xffffff,  // 基础色（sRGB）
  rough: 1,         // roughness 倍率
  metal: 1,         // metalness 倍率
  wet: WET_DEFAULT, // 湿润四元组 [暗化, 粗糙度倍率, 垂直水痕, 水珠]
  macro: MACRO_DEFAULT, // 宏观噪声 [幅度, 污垢, 频率, 细节]
  nrm: 1,           // 法线强度
  ...opts,
}
```

加上可选通道：

| 字段 | 作用 |
|---|---|
| `transparent` / `alphaCut` | 透明混合 / alpha 裁剪（铁丝网、玻璃） |
| `doubleSide` | 双面（布、旗、叶片） |
| `emissive` / `emissiveIntensity` | 自发光 |
| `triplanar` | 三平面投影（无 UV 物件的兜底） |
| `interior` | 室内环境贴图标记 |
| `clearcoat` / `clearcoatRoughness` | 清漆（漆面） |
| `transmission` / `thickness` / `ior` | 真实折射（玻璃） |
| `sheen` / `sheenColor` / `sheenRoughness` | 绒面（帆布、织物） |
| `specularIntensity` / `reflectivity` | 高光强度 |

**后 10 个键（`PHYSICAL_EXTRA_KEYS`）存在即触发 `MeshPhysicalMaterial`。** 否则走
`MeshStandardMaterial`——全局 40 条里只有漆面与玻璃走 Physical，因为它的 shader 更重。

### 4.2 湿润与宏观噪声

`surface-params.js:63` 的 `makeSurfaceSpec` 是规格工厂；预设是四元组常量：

```js
WET_PAINT   = [0.05, 0.62, 0.65, 0.7]   // 漆膜淋雨：微暗、明显变亮、挂水痕、有水珠
WET_METAL   = [0,    0.7,  0.55, 0.5]   // 镀锌：不变色，粗糙度大降，水痕硬直
WET_RUST    = [0.3,  0.6,  0.55, 0]     // 锈面：轻微变暗，不变光滑（避免锈被洗成镜面）
WET_PLASTIC = [0.08, 0.62, 0.6,  0.5]
WET_WOOD    = [0.4,  0.5,  0.6,  0]
WET_NONE    = [0,    1,    0,    0]     // 铁丝网、玻璃、水面不该再叠水膜

MACRO_COARSE = [0.22, 0.12, 0.35, 0.35] // 面板级大块色差（集装箱、墙面）
MACRO_FINE   = [0.07, 0.06, 3,    0]    // 高频、无污垢（枪械、绳、轮胎）
MACRO_NONE   = [0,    0,    1,    0]
```

湿润是**全局 uniform**（`uWet` 来自 URL `?wet=` 或画质档），材质只声明“我这种表面湿了会怎样”。

### 4.3 材质工厂

`getMaterial(name, opts)`（`materials.js:273`）的行为：

- **缓存键** = `name|v|t{scale}|d|i|c{color}`（v=顶点色、t=三平面、d=双面、i=室内、c=指定色）。
  所以同一材质名不同选项是不同实例，别指望 `getMaterial('steel_galv')` 返回同一个对象。
- **未知材质**：`console.warn` 一次，退到 `FALLBACK_SPEC` 的灰材质，不抛错。
- **烘焙失败**：`console.error`，退到纯色 `MeshStandardMaterial`（场景继续跑）。
- **双面**：`doubleSide`（或规格里的 `side === 2`）只设 `material.side = DoubleSide`；
  同时它是缓存键的一部分，所以双面与单面是两份材质。

### 4.4 顶点色与染色

顶点色是“同材质多样式”的手段（集装箱色号、锈蚀程度、涂鸦）：

| 原语 | 说明 |
|---|---|
| `colorGeometry(geo, [r,g,b])` | 写死顶点色 |
| `bakeVertexColorTint(geo, tint)` | 与已有顶点色相乘 |
| `tintByHash(x, y, z, base, strength)` | 按位置哈希做微扰，避免千篇一律 |
| `getTintedMaterial(ctx, name, opts)` | 带顶点色的材质变体（缓存在 `TINTED_MATERIALS`） |

规格里 `tint: 1` 才启用顶点色调制，否则顶点色只影响 `colorGeometry` 写入的静态差异。

## 5. 渲染管线

### 5.1 渲染器

`createRenderer`：`WebGLRenderer`（`antialias: false`，MSAA 走渲染目标的 `samples = quality.msaa`，
另有 final pass 里的轻量 FXAA；`powerPreference: 'high-performance'`）+ 能力自检。

三级降级（自检失败即降级，保证不白屏）：

```
完整后处理链 → 失败 → 前向渲染（forward fallback）→ 失败 → 纯色/空场景
```

自检在真实 GPU 上跑一帧，检查 framebuffer 完整性、扩展可用性；失败日志写明原因。

### 5.2 光照

| 光源 | 数量 | 说明 |
|---|---|---|
| `DirectionalLight`（太阳） | 1 | 颜色/强度来自 `SUN`，阴影相机由 `fitSunShadowFrustum` 贴合场景 |
| `PointLight` | 6（池） | `distance: 12, decay: 2`，按距离挑最近的 6 个光源动态绑定 |
| IBL | 2 套 | 天空 PMREM（室外）+ CubeCamera probe（室内），运行时切 `scene.environment` |

**没有 GI。** 间接光靠 IBL + SSAO + 体积光的雾散射近似。这是硬缺口，不是调参问题。

### 5.3 阴影

PCSS（Vogel 盘 blocker search + 可变半影）。`shadows.js` 把这个 PCF/PCSS 实现作为 chunk
注入到材质 shader；chunk 不匹配时降级为普通 PCF。

`fitSunShadowFrustum`（`shadow-frustum.js`）把平行光阴影正交视锥对齐到场景包围盒，
避免“光栅化阴影分辨率浪费在空地上”。

### 5.4 后处理 pass 序列

`postprocessing.js`（901 行）的 `run()` 是唯一的管线入口，顺序固定：

```
① depthHalf     深度降采样到半分辨率（所有屏幕空间效果的基础）
② AO            SSAO → 水平模糊 → 垂直模糊（aoA ⇄ aoB 乒乓）
③ volumetric    体积光 raymarch → 水平模糊 → 垂直模糊（受画质 volSteps 控制）
④ composite     场景色 × AO × 体积光（半分辨率上采样 + 深度引导）
⑤ motionBlur    速度重建运动模糊（需要上一帧 viewProj，首帧跳过）
⑥ bloom         4 级 down → 3 级 up → 拖影 streak（两次不同步长）
⑦ adapt         自适应曝光（亮度直方图按指数平滑，乒乓两张 RT）
⑧ grade         bloom 叠加 + 镜头污渍 + 光斑 + AgX 色调映射 + 色散 + 暗角
                + 受伤/低血量/ADS/闪光/淡入淡出/饱和度
⑨ final         锐化 + 胶片颗粒 → 屏幕
```

关键设计：

- **半分辨率做昂贵效果**：AO 与体积光都在 `size.hw × size.hh` 上算，合成时上采样。
- **AO 与体积光各用两张 RT 乒乓模糊**，避免读写同一张图。
- **自适应曝光先于调色**：曝光是标量乘子，调色是 LUT 风格的非线性，顺序反了会过曝。
- **所有 pass 共用同一个全屏 quad 与正交相机**（`blitScene`），只换 material。

### 5.5 画质档位

五档 `test / low / medium / high / ultra`（`QUALITY_PRESETS`，`core/config.js:60`），唯一数据源，控制：

| 字段 | 影响 |
|---|---|
| `scale` | 渲染分辨率倍率（0.7 / 0.85 / 1 …） |
| `msaa` | 渲染目标采样数（0 即关） |
| `shadow` / `tex` | 阴影贴图与纹理尺寸 |
| `volSteps` | 体积光步数（10 / 12 / 16 / …，0 = 关闭） |
| `ao` / `bloom` / `motionBlur` | 各 pass 开关 |
| `planar` | 湿滑地面的反射强度（`ground/asphalt.js` 消费） |
| `rain` | 雨量 |

全部通过 `syncQualityDefines()` 反映到 shader define，改档位不需要重编译全部材质。
注意 `wet`（湿润强度）不在 preset 里，来自 URL `?wet=`，默认 1。

## 6. 速查：想做什么 → 用哪个原语

| 目标 | 原语 | 位置 |
|---|---|---|
| 一个盒子 | `PartBuilder.box(mat, w,h,d, x,y,z, {r})` | geometry.js:909 |
| 两点一根杆 | `pb.bar` / `strutBetween` | geometry.js:935 / 1695 |
| 两点一根方梁 | `pb.beam` / `beamBetween` | geometry.js:951 / 1716 |
| 沿曲线的管 | `pb.tube` / `tubeGeometry` | geometry.js:928 / 346 |
| 圆角截面 | `catmullRomPath(points, n, true)` | geometry.js:595 |
| 沿剖面放样 | `loftProfileSurface(profile, stations, project, {closed,caps})` | geometry.js:628 |
| 回转体 | `revolveProfileGeometry(profile, seg)` | geometry.js:1042 |
| 双参数曲面 | `buildGridSurface(uSeg, vSeg, project)` | geometry.js:2032 |
| 从实体挖洞 | `Brush` + `Evaluator` + `SUBTRACTION` | 调用处 vehicles.js |
| 合并大量小件 | `mergeStaticMeshes(root)` / `MeshBatcher` | geometry.js:455 / 1610 |
| 新材质 | 在 `SURFACE_LIB` 加一条 `makeSurfaceSpec` | catalog.js:221 |
| 新表面纹理 | 写 `surf(vec2 uv)` → 注册到 `SURFACE_SHADERS` | init-order.js |
| 文字/logo 贴图 | `createDecalLibrary` 里加配方 | textures.js:203 |
| 拿材质 | `getMaterial(name, { vertexColors, triplanar, doubleSide })` | materials.js:273 |
| 顶点色染色 | `colorGeometry` / `bakeVertexColorTint` / `tintByHash` | geometry.js:398/1437 / materials.js:430 |
| 调整体湿润 | URL `?wet=` 或画质档 | materials.js:105 |

## 7. 已知边界与未完成

| 项 | 状态 |
|---|---|
| UV 展开 | 无。全部三平面投影或专用 UV 面 |
| GI / 光照探针 | 无。IBL + SSAO 近似 |
| LOD | 无。只有静态合批（`mergeStaticMeshes`） |
| 流式加载 | 无。全部资产启动时生成，常驻显存 |
| CSG 属性保留 | 需手动在差集后重算顶点色（未封装成原语） |
| `je` 的入参语义 | 会改写入参，298 处引用，靠人记住 |
| `createStrut` / `createCylinderBetween` | 语义重复，历史遗留 |
| surf 函数注册位置 | 在 `init-order.js`（反混淆遗留），不在 `surface-shaders.js` |
