# 调试与内容迭代手册

原作者的调试体系：**`?show=<场景>` 隔离加载 + 每个场景自己的筛选参数 + 全局探针**。
选中的 showcase 只会加载它需要的模块，其余全部替换成 stub（`window.__G` 里能看到 `stub` 列表），
所以加载快、不受其他子系统干扰。

## 一、单看一个物件

```
?show=props&names=hand_truck
```

道具陈列场景按 `PROP_SIZES` 的宽度自动排布（每行不超过 26 单位宽），返回相机位置与注视点，
所以不需要手动调相机。`names` 支持逗号分隔，多个道具会并排摆开对比尺寸：

```
?show=props&names=forklift,pallet,crate_wood,hand_truck
```

不传 `names` 就是全部 37 种。

## 二、9 个 showcase 场景

| `?show=` | 看什么 | 专属参数 |
|---|---|---|
| `props` | 全部道具陈列 | `names=a,b,c` |
| `backdrop` | 远景（岸桥/船/小艇/天际线） | `bshow=crane\|ship\|boat\|sky` |
| `level` | 关卡整体 | — |
| `ground` | 地面/沥青/水面 | — |
| `mats` | 材质球阵列 | `only=concrete,steel_galv` |
| `fx` | 特效系统 | `fxt` `fxshow` `fxsize` `fxhold` `fxsoft` |
| `weapon` | 枪械视图模型 | `wpose=hip\|ads` |
| `enemies` | 敌人 | `eshow` `eseed` `efreeze` |
| `render` | 渲染管线 | `post` `bloom` `ao` `mb` |

## 三、全部 URL 参数

**相机与截图**
| 参数 | 作用 |
|---|---|
| `cam=x,y,z,lx,ly,lz` | 相机位置 + 注视点；`cam=`（空）恢复默认 |
| `fov=54` | 视场角 |
| `shot=1` | 截图模式：强制 `q=test`、不显示标题、不锁指针 |
| `wpose=hip` | 武器姿态 |

**画质与渲染开关**
| 参数 | 作用 |
|---|---|
| `q=test\|low\|medium\|high\|ultra` | 画质档位 |
| `tex=N` | 纹理分辨率覆盖 |
| `post=0` | 关掉整个后处理链 |
| `bloom` `ao` `mb` | 单个效果开关 |
| `dynres=0` | 关动态分辨率 |
| `wet=0..1` | 雨天湿度 |
| `epre=秒` | 预渲染时长（让动画跑到第 N 秒再截） |
| `noweapon=1` | 隐藏武器 |

**特效调试**：`fxt`（类型）、`fxshow=all|...`、`fxhold`、`fxsize`、`fxsoft=0`

**敌人调试**：`eshow=both|...`、`eseed=9001`、`efreeze=1`（冻结动画）

**流程与其它**：`seed=N`（默认 4207）、`dt=秒`（固定步长）、`noaudio=1`、`vol`、`autostart=1`、`bench=1`

## 四、全局探针

```js
window.__G              // 运行时上下文，所有子系统挂在这里
window.__setShot({cam:[x,y,z,lx,ly,lz], fov:54, exposure:1})
window.__stats          // 帧率/耗时
window.__frames         // 累计帧数（自动化截图判活用）
window.__ready          // 首帧渲染完成
window.__fatal          // 未捕获异常
window.__errors         // 错误列表
```

`dist/saltline.dev.html` 额外在左下角显示实时面板（`ready` / `frames` / `fatal` / `errors` / `stub` /
`renderer` / `hasLoop` / `state` / `modules`），每秒刷新。

## 五、新增一个道具（已验证的流程）

三步，全程不用碰渲染管线：

**1. 写建造器**（`src/content/props/basic-builders.js` 或同级 builders 文件）

```js
export function buildHandTruck(ctx, truckOpts = {}) {
  let builder = new PartBuilder(ctx),
    paint = builder.M('paint_yellow');       // 材质名见 render/materials/catalog.js
  builder.box(paint, 0.5, 0.028, 0.28, 0, 0.034, 0.17, { r: 0.008 });   // 宽 高 深 x y z，r=倒角
  builder.cyl(paint, 0.019, 0.019, 1.2, 0.23, 0.65, -0.02, {             // 上径 下径 高 x y z
    seg: 12,
    rot: [0.14, 0, 0],                                                    // Euler XYZ
  });
  return tagPropUserData(builder.group(), 'hand_truck', getPropSize3('hand_truck'), [
    { min: [-0.28, 0, -0.27], max: [0.28, 1.3, 0.31], surface: 'metal' },
  ]);
}
```

**2. 注册**（`src/content/props/detailed-builders.js` 的 `registerDetailedProps`）

```js
register('hand_truck', (propCtx, propOpts = {}) => buildHandTruck(propCtx, propOpts)),
```

**3. 加尺寸**（`src/content/props/registry.js` 的 `PROP_SIZES`）

```js
hand_truck: [0.52, 1.32, 0.5, 'paint_yellow', 'metal'],
//           [宽, 高, 深, 主材质名, 物理/音效材质类]
```

然后 `npm run build:dev` 并打开 `?show=props&names=hand_truck` 立刻看到。

要点：
- `PROP_SIZES` 是尺寸的**唯一真源**，物理盒、脚步材质、陈列布局都从这里取，不要在建造器里另写一份
- 需要变体时用 `propOpts.seed` 派生（参考 `buildBarrel` 的 `variantSeed = Math.abs(seed|0) % 4`）
- 重复实例想省内存就套 `buildCachedPropClone(cacheKey, () => build...)`
- 放置到关卡里用 `ctx.place('hand_truck', x, z, rotY, opts)`

## 六、几何接合自检（本项目补充）

原 bundle **没有任何"部件是否接合"的校验**：内容层只有未知道具名 `console.warn` 和骨骼父节点
`throw`（动画骨骼层级，不是几何拼装）。程序化拼装的正确性原本完全靠 showcase 人眼检查。

dev 构建补了一个机械检查：

```
?show=props&names=hand_truck&check=hand_truck
```

它取每个子 mesh 的世界包围盒，用并查集把相交（含 1cm 容差）的部件合并成簇：

- `"propCheck": "ok"` — 全部部件连成一体
- `"propCheck": { "clusters": 2, "orphan": [["steel_galv@(0.00,1.24,-0.11)"]], ... }` — 有簇悬空，
  列出每个悬空部件所在的材质名与中心坐标，直接定位到出错的那一行

也可在控制台手动调用：`window.__checkProp('forklift', 0.01)`。容差默认 1cm，贴面接触算接上。

## 七、已知限制

- 后台标签页的 `requestAnimationFrame` 会被浏览器暂停（`frames` 恒为 0），要在可见窗口里看效果
- `?show=` 模式下 `hud` / `audio` / `weapon` / `enemies` 等都是 stub，想同时看这些就别用 showcase，走 `?autostart=1`
