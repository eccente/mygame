# 方块挪一挪 Web 版技术实现草案与开发里程碑 v1.3

## 1. 文档定位
本文件用于把产品与规则文档落到当前仓库结构下，明确：
- 代码目录怎么拆
- 页面如何接入
- Three.js 如何接入当前静态前端结构
- 状态与存档如何组织
- 无限模式怎么实现
- 性能目标和兼容策略怎么落地
- 里程碑怎么安排

本文件的目标不是写具体代码，而是作为后续实际开发的“施工图”。章节 `6~12` 的统一机制状态模型与校验器扩展细则，另见 `docs/fangkuai-nuoyi/12-unified-mechanic-state-model-and-validator.md`。

## 2. 技术路线总览

### 2.1 总体技术选型
本项目采用以下技术路线：
- 规则核心：`JavaScript 自定义网格规则引擎`
- 场景渲染：`Three.js`
- 视觉类型：`2.5D / 轻 3D`
- UI 容器：`DOM + CSS`
- 本地存档：`localStorage`
- 无限模式：`模板化生成 + 逆向扰动 + 求解校验`

### 2.2 为什么不用重物理引擎
不建议为本项目引入 Ammo.js、Cannon-es、Rapier 等重物理作为玩法核心，原因如下：
- 本游戏的核心是确定性的空间解谜，不是真实物理演算
- 物理引擎会提高性能压力与状态不确定性
- 物理调参会显著增加维护成本
- 无限模式生成与求解器更依赖确定性规则，而不是连续物理世界

### 2.3 允许的“物理感”实现方式
可在纯 JS 表现层中加入轻量运动手感：
- 吸附缓动
- 轻微回弹
- 被挡住时的小幅抖动
- 清除时的缩放与位移

这些都由表现层完成，不进入规则判定。

## 3. 与现有仓库结构的适配建议

### 3.1 当前已知前端结构
当前项目主要前端入口为：
- `web_frontend/index.html`
- `web_frontend/game.html`
- `web_frontend/health.html`

现有游戏逻辑集中在：
- `web_frontend/src/app.js`

现有全局备份体系集中在：
- `web_frontend/src/backup-hub.js`
- `web_frontend/src/backup-provider-game.js`
- `web_frontend/src/backup-provider-health.js`

### 3.2 第二款游戏的接入策略
建议采用 `独立页面 + 独立模块目录` 的方式：
- 新增页面：`web_frontend/shift.html`
- 新增样式：`web_frontend/src/shift.css`
- 新增脚本入口：`web_frontend/src/shift-entry.js`
- 新增模块目录：`web_frontend/src/shift/`
- 新增备份 provider：`web_frontend/src/backup-provider-shift.js`

这样做的理由：
- 不污染现有 `app.js`
- 第二款游戏规则复杂度更高，适合模块化设计
- 与后续继续扩关、扩机制、扩无限模式更匹配

### 3.3 Three.js 的接入方式
由于当前项目以静态前端为主，且没有现成的 npm bundler 流程，建议首版使用 `本地 vendor 的 ES Module Three.js`。

推荐结构：
- `web_frontend/vendor/three/three.module.js`
- 如需额外工具，再按需放入 `web_frontend/vendor/three/examples/jsm/...`

优点：
- 不需要改造当前构建流程
- 可离线开发
- 方便在静态站点里直接通过 `type="module"` 引入

## 4. 推荐目录结构
```text
web_frontend/
  shift.html
  vendor/
    three/
      three.module.js
  src/
    shift.css
    shift-entry.js
    backup-provider-shift.js
    shift/
      core/
        constants.js
        board.js
        rules.js
        move-simulator.js
        effect-runner.js
        item-effects.js
        solver.js
      data/
        styles.js
        campaign/
          chapter-01.js
          chapter-02.js
          ...
        design/
          chapter-bands.js
          mechanic-whitelist.js
          shape-pools.js
          prototype-briefs.js
        endless/
          templates-single-lane.js
          templates-dual-lane.js
          templates-lock-detour.js
          mechanic-compatibility.js
          signature.js
          scoring.js
          generator.js
      render/
        scene-root.js
        renderer-factory.js
        camera-presets.js
        board-meshes.js
        block-view.js
        exit-view.js
        gate-view.js
        tile-view.js
        material-library.js
        animation-controller.js
        performance-profile.js
      state/
        store.js
        progression.js
        economy.js
        settings.js
        serializer.js
      ui/
        hud.js
        menus.js
        modal.js
        toasts.js
        tutorial.js
        compatibility.js
      services/
        save-service.js
        audio-service.js
        endless-service.js
        campaign-service.js
        backup-service.js
        capability-service.js
      utils/
        math.js
        rng.js
        ids.js
        object-pool.js
```

## 5. 技术架构建议

### 5.1 整体原则
- `规则层` 与 `渲染层` 分离
- `数据层` 与 `页面层` 分离
- `本地存档` 与 `运行时状态` 分离
- 无限模式生成器使用与主线共通的规则校验逻辑
- Three.js 场景对象不直接持有规则真相

### 5.2 五层结构

#### 5.2.1 数据层
负责提供：
- 固定主线关卡
- 无限模式模板
- 样式与主题映射
- 颜色语义与功能徽记映射
- 相机与光照预设

#### 5.2.2 核心规则层
负责：
- 方块移动合法性
- 出口判定
- 机关结算
- 道具效果
- 通关判定

要求：
- 尽量写成纯函数
- 不直接依赖 DOM
- 不直接依赖 Three.js

#### 5.2.3 状态层
负责：
- 当前局状态
- 金币与库存
- 主线解锁进度
- 无限模式当前轮次信息
- 设置项

#### 5.2.4 渲染层
负责：
- Three.js 场景、相机、灯光
- 逻辑对象到 3D 视图对象的映射
- 拖动预览、吸附、回弹、清除等动画
- 质量分级与降级策略

#### 5.2.5 UI 层
负责：
- 页面切换
- 按钮、浮层、商店、设置
- 兼容提示页
- HUD 和轻提示

## 6. 页面接入建议

### 6.1 首页接入
在 `web_frontend/index.html` 增加“方块挪一挪”卡片入口。

### 6.2 独立页面
新增 `web_frontend/shift.html`，结构建议：
- `<main id="shift-app">`
- DOM HUD 容器
- `<canvas id="shift-canvas">`
- 商店 / 设置 / 结算等弹层容器
- 兼容提示容器

### 6.3 脚本入口
`web_frontend/src/shift-entry.js` 负责：
- 做 WebGL 能力检查
- 初始化 Store
- 恢复本地存档
- 创建 Renderer
- 创建 SceneRoot
- 绑定输入控制器
- 挂载页面事件

## 7. 运行时状态设计

### 7.1 Store 顶层结构
推荐运行时状态：

```js
{
  view: 'menu',
  mode: null,
  campaign: {
    chapter: 1,
    level: 1,
    unlockedChapter: 1,
    completed: {},
  },
  endless: {
    tier: null,
    streak: 0,
    currentSeed: null,
    currentTemplateId: null,
    bestStreak: {
      easy: 0,
      normal: 0,
      think: 0,
    },
  },
  economy: {
    coins: 0,
    inventory: {
      masterKey: 0,
      lubricant: 0,
      goldFinger: 0,
    },
  },
  settings: {
    musicOn: true,
    sfxOn: true,
    vibrationOn: false,
    reducedMotion: false,
    colorAssist: false,
    qualityTier: 'standard',
  },
  activeRun: {
    mode: null,
    levelId: null,
    boardState: null,
    startedAt: null,
    presentationState: null,
  },
}
```

### 7.2 运行时与持久化的区别
- `Store`：当前页面运行时对象
- `SaveData`：写入 `localStorage` 的最小必要数据

不要把：
- 临时渲染缓存
- 动画状态
- Three.js Mesh 引用
- DOM 引用

写入存档。

## 8. 存档方案

### 8.1 首版存储介质
建议首版使用 `localStorage` 即可。

原因：
- 单机数据量小
- 无多档案需求
- 关卡和无限模式当前局状态都可序列化为小对象
- 与现有项目小游戏存档风格一致

### 8.2 存档键建议
建议使用一个主键：
- `block_shift_save_v1`

### 8.3 SaveData 结构
```js
{
  version: 1,
  updatedAt: '2026-03-11T00:00:00.000Z',
  progression: {
    unlockedChapter: 1,
    completedLevels: {
      'c01-l01': {
        cleared: true,
        clearCount: 1,
        lastClearedAt: '2026-03-11T00:00:00.000Z',
      },
    },
    lastCampaignLevelId: 'c01-l03',
  },
  endless: {
    bestStreak: {
      easy: 0,
      normal: 0,
      think: 0,
    },
    activeSession: null,
    recentSignatures: [],
  },
  economy: {
    coins: 0,
    inventory: {
      masterKey: 0,
      lubricant: 0,
      goldFinger: 0,
    },
  },
  settings: {
    musicOn: true,
    sfxOn: true,
    vibrationOn: false,
    reducedMotion: false,
    colorAssist: false,
    qualityTier: 'standard',
  },
  resume: {
    mode: 'campaign',
    levelId: 'c01-l03',
    boardState: null,
  },
}
```

### 8.4 为什么采用单对象存档
- 便于版本管理
- 便于导出备份
- 便于未来通过 provider 接入统一备份中心
- 不容易出现多 key 不一致问题

## 9. 备份接入方案

### 9.1 原则
虽然首版不做云存档，但应接入当前项目的全局备份体系。

### 9.2 新增 provider
后续开发时新增：
- `web_frontend/src/backup-provider-shift.js`

注册内容应至少包含：
- `id`
- `label`
- `exportData`
- `importData`
- 可选 `clearData`

### 9.3 备份内容
导出内容包括：
- 主线进度
- 无限模式最佳记录与当前轮次
- 金币与库存
- 设置项
- 最近继续游戏状态

## 10. 棋盘引擎实现建议

### 10.1 数据模型
运行时棋盘状态建议拆成：
- `boardSpec`（固定 `cols = 6`，`rows = 8~12`）
- `blocksById`（当前版本默认全部为可清除目标块）
- `staticWalls`
- `gatesById`
- `tilesByPos`
- `exits`

这样做的好处：
- 查找快
- 序列化清晰
- 求解器和实际游戏共享同一结构
- 能在手机优先前提下稳定控制棋盘尺寸上限

### 10.2 核心模块职责

#### `board.js`
负责：
- 创建关卡初始棋盘
- 查询占格
- 复制棋盘状态
- 维护 `shapeCells` 与锚点映射后的真实占格

#### `move-simulator.js`
负责：
- 计算拖动轴向
- 计算最远合法范围
- 计算松手后的吸附位置
- 推进冰面滑行
- 支持多格和异形块的碰撞、吸附与出口完整通行判定

#### `effect-runner.js`
负责：
- 钥匙格
- 开关格
- 变色格
- 出口

#### `rules.js`
负责：
- 通关判定
- 无效移动判定
- 道具使用合法性校验

#### `item-effects.js`
负责：
- 万能钥匙
- 润滑油
- 金手指

### 10.3 纯函数优先
关键函数应设计为：
- 输入：旧状态 + 动作
- 输出：新状态 + 结果描述

例如：
```js
const result = applyMove(state, action);
```

`result` 应至少返回：
- `nextState`
- `moved`
- `clearedBlockIds`
- `triggeredEffects`
- `won`

这样有利于：
- UI 渲染
- 调试
- 求解器复用

## 11. Three.js 渲染方案建议

### 11.1 渲染架构
推荐采用 `DOM + Three.js Hybrid`：
- DOM：主菜单、按钮、商店、设置、结算、提示条
- Three.js：棋盘、方块、出口、机关视觉、拖动过程、收纳动画

### 11.2 为什么不建议全都写在 Three.js 里
- 常规 UI 用 DOM 更高效
- 可访问性更好
- 页面逻辑更易维护
- 游戏规则和场景渲染更容易解耦

### 11.3 相机方案
推荐首版使用 `OrthographicCamera`。

原因：
- 网格阅读稳定
- 占格关系不失真
- 更适合做“桌面玩具盘”视觉
- 比透视镜头更容易保证拖动操作准确

### 11.4 灯光方案
推荐：
- 1 个方向光
- 1 个环境光
- 可选 1 个半球光

策略：
- 首版只允许一个主要投影阴影源
- 低性能模式下关闭阴影

### 11.5 材质与几何策略
- 同类对象共享几何体
- 同类样式尽量共享材质实例
- 方块、墙体、出口统一走样式库配置
- 尽量避免每个对象单独创建复杂材质

### 11.6 动画系统
建议单独实现 `animation-controller.js`，负责：
- 拖动预览位置
- 吸附缓动
- 回弹
- 门开关
- 清除出门动画
- 轻提示脉冲

规则层只给出：
- 新旧位置
- 事件类型
- 触发对象 id

### 11.7 对象池与复用
建议对以下对象使用对象池：
- 方块视图
- 粒子或小型特效
- 高亮边框
- 提示箭头

这样可减少：
- 频繁创建销毁 Mesh
- GC 抖动
- 长时间游玩后的性能波动

## 12. 输入方案建议

### 12.1 统一 Pointer Events
优先使用 `Pointer Events`，兼容触摸与鼠标。

### 12.2 输入控制器职责
建议单独做输入控制器，负责：
- 通过射线命中棋盘平面
- 命中具体方块
- 计算拖动偏移
- 轴向锁定
- 松手结算
- 拖动取消

### 12.3 命中区域
为了提升移动端体验，可在视觉边界外增加小范围命中扩展。

### 12.4 逻辑与渲染边界
- 射线命中只用于找到“玩家想拖哪个对象”
- 真正合法移动范围仍由规则层计算
- 不允许直接按 Mesh 位置来判断规则结果

## 13. 浏览器兼容与能力检测

### 13.1 目标浏览器
- Chrome 主流版本
- Safari 主流版本
- Edge 主流版本
- Firefox 主流版本

### 13.2 启动时能力检查
建议在 `shift-entry.js` 启动时先检查：
- 是否可创建 WebGL 上下文
- 是否能正常初始化 Three.js 渲染器
- 是否存在必要的纹理与精度能力

### 13.3 WebGL 不可用时的策略
- 不进入实际游戏场景
- 展示兼容提示页
- 提供返回首页按钮

### 13.4 上下文丢失处理
建议监听：
- `webglcontextlost`
- `webglcontextrestored`

最简策略：
- 上下文丢失时暂停输入
- 恢复后尝试重建场景
- 若恢复失败则提示重新进入

## 14. 性能目标与分级策略

### 14.1 性能目标写法
采用以下工程目标：
- 主流中端移动设备和桌面浏览器，在主要游玩场景保持 `55~60 FPS`
- 主线和无限模式的常规关卡，拖动和吸附阶段应接近 `60 FPS`
- 低性能机型通过降级策略尽量保持操作顺畅

### 14.2 首版渲染预算建议
首版建议控制在以下范围：
- 同屏活跃可见对象数：尽量低于 `80`
- Draw Calls：尽量控制在 `80` 以内
- 材质种类：尽量控制在 `12` 以内
- 动态阴影光源：`0~1`
- 后处理：首版不启用

说明：
- 这是经验性工程目标，不是规则限制
- 若后续实际 profile 数据更优，可再调整

### 14.3 设备分级
建议至少分为三档：

#### `high`
- 标准像素比
- 阴影开启
- 常规粒子和发光

#### `standard`
- 像素比上限收紧
- 阴影简化
- 减少粒子数量

#### `battery`
- 像素比进一步降低
- 关闭阴影
- 关闭大部分发光和额外动画
- 保留基础方块、出口、机关和清除表现

### 14.4 可调参数
建议把以下内容纳入 `performance-profile.js`：
- renderer pixelRatio 上限
- shadowMap 开关
- 粒子数量上限
- 动画插值精度
- 是否启用环境装饰 Mesh

## 15. 无限模式实现建议

### 15.1 生成器模块
建议将无限模式生成拆成以下文件：
- `web_frontend/src/shift/data/endless/generator.js`
- `web_frontend/src/shift/data/endless/mechanic-compatibility.js`
- `web_frontend/src/shift/data/endless/signature.js`
- `web_frontend/src/shift/data/endless/scoring.js`

输入：
- `tier`
- `seed`
- `recentSignatures`
- `qualityTier`
- `unlockedRuleSet`
- `colsBand`
- `targetSolutionBand`

输出：
- 一个完整的 `LevelData`
- `generationSummary`

`generationSummary` 建议至少包含：
- `templateId`
- `stateHash`
- `bestMoveCountEstimate`
- `clearOrder`
- `dependencyDepth`
- `fastDifficultyScore`
- `solverDifficultyScore`
- `difficultyScore`
- `difficultyTier`
- `difficultyVector`
- `scoreBreakdown`

内部阶段建议：
1. 读取当前难度允许的 `shape pool` 与 `mechanic whitelist`。
2. 先做结构硬约束过滤，淘汰明显越界、门预算异常、颜色不足的候选。
3. 计算 `fastDifficultyScore`，把明显过空、过散、开局太直白的候选提前筛掉。
4. 先构建“清盘依赖图”，再落地到盘面骨架。
5. 从可收尾骨架局出发做 `reverse scramble`。
6. 进入求解器校验，并计算 `solverDifficultyScore`。
7. 通过 `scoring.js` 打分并做重复过滤。
8. 通过后输出 `LevelData + generationSummary`。

### 15.2 求解器模块
建议实现一个轻量求解器，用于：
- 校验候选关是否可解
- 估算解长度
- 输出清盘顺序与依赖深度
- 过滤异常局

首版可采用：
- BFS
- 或基于启发式的 A* 搜索

说明：
- 不是为了给玩家提示
- 是为了让生成器更可靠
- 求解器规则必须与实际运行时共享同一套 `board / rules / move-simulator`

建议额外输出：
- `clearOrder`
- `dependencyDepth`
- `branchingScore`
- `expandedStates`
- `signature`
- `solutionFamilyCount`
- `openingActionCount`
- `fastDifficultyScore`
- `solverDifficultyScore`
- `difficultyScore / difficultyTier`

### 15.3 规则配置层
建议把以下内容做成独立配置文件，而不是散落在生成器内部：
- `chapter-bands.js`：章节与难度带配置（含第 `2~11` 章 `hard / expert / brutal` 映射）
- `mechanic-whitelist.js`：主线 / 无限允许机制表
- `shape-pools.js`：各难度形状权重
- `prototype-briefs.js`：每章原型关卡草案
- `mechanic-compatibility.js`：机制兼容矩阵
- `difficulty-metrics.js`：`difficultyVector / difficultyScore` 的统一权重与分段公式

这样做的好处：
- 文档冻结后的决策能直接映射成数据文件
- 后续调权重时不必改动求解器核心
- 便于把主线规则与无限规则保持一致但不同池

### 15.4 性能策略
- 每次只生成下一关，不提前批量生成很多关
- 若当前 seed 失败，立即重采样新 seed
- 单次生成校验的最大状态扩展数要有限制，避免浏览器卡死
- 求解器运行期间如有必要，可分帧或分批推进，避免阻塞渲染
- 生成器必须遵守手机优先的阅读约束，不能只看“可解”而忽略“看不看得清”

## 16. 开发阶段建议

### 16.1 阶段 1：核心原型
目标：先验证玩法和 Three.js 2.5D 手感。

交付：
- `shift.html`
- 基础 Three.js 场景、相机和灯光
- 普通方块拖动与吸附
- 出口清除
- `6x5` 到 `6x8` 棋盘样例
- 重置本关
- 本地金币
- `万能钥匙 / 润滑油 / 金手指`
- `15~30` 个原型关卡

验收：
- 第一关到第三关能顺畅完成
- Three.js 渲染下基础手感成立
- 存档能保存当前关与金币

### 16.2 阶段 2：文档冻结后的第一批生产化实现
目标：把已经明确下来的规则白名单、章节推进和原型关卡草案，真正沉淀成数据结构、求解器骨架和前 5 章可持续迭代的关卡产线。

当前已完成的子目标：颜色语义统一、出口整体染色、多格/异形块底层结构、样例关卡验证。

建议的下一大开发目标：`第 1~5 章形状主线原型关卡 + 求解器骨架 + 无限模板骨架`。
这一步要先把文档冻结内容映射成稳定的配置层与验证层，而不是继续零散补表现。

交付：
- `shapePreset + shapeVariant + shapeCells` 的统一数据入口
- `mechanic-whitelist / shape-pools / chapter-bands / prototype-briefs` 配置文件
- 第 `1~5` 章每章至少 `10` 个可玩原型关
- 求解器首版：能输出 `isSolvable`、`bestMoveCountEstimate`、`clearOrder`
- 无限模式模板骨架：至少 `single-lane`、`dual-lane`、`lock-detour`
- 商店与当前 `3` 个首发道具继续沿用到新语义体系
- 手机视口与小屏布局继续优先适配

验收：
- 玩家在不看说明的情况下，也能快速读懂“颜色 = 出口、箭头 = 特殊规则”
- 第 `1~5` 章的难度曲线能明显区分“整块离场、L 形借位、T 形堵点、十字型控场、多异型互锁”
- 求解器能稳定筛掉不可解关
- 在目标设备上主要交互阶段稳定接近 `60 FPS`

### 16.3 阶段 3：MVP
目标：形成可长期游玩的第一个可交付版本。

交付：
- 主线 `180` 关
- 3 个首发道具全部接入
- 无限模式 `轻松/普通`
- 生成器 + 求解校验
- 备份 provider 接入
- 上下文丢失处理

验收：
- 无限模式能稳定连续玩下去
- 退出和继续游戏可靠
- 关卡内容足够支撑日常游玩
- 在 Chrome/Safari/Edge/Firefox 主流环境中正常运行

### 16.4 阶段 4：完整版 v1.0
目标：达到当前方案的完整形态。

交付：
- 主线 `360` 关
- 无限模式 `动脑` 档
- 第 `6~11` 章机制全部接入，并完成第 `12` 章终章配额关
- 更完整的音效与视觉打磨
- 兼容提示页与质量分级完善

验收：
- 全内容打通
- 存档兼容升级无明显问题
- 规则文档与实现一致
- 主要游玩场景在目标设备范围内稳定接近 `60 FPS`

## 17. 测试建议

### 17.1 规则层测试重点
- 方块吸附是否正确
- 出口颜色、跨度和完整离场判定是否正确
- 多尺寸方块是否正确清除
- 锁门开启是否本局生效
- 润滑油是否仅本局生效
- 金手指是否只移除一个可移动目标方块，且不触发常规移动链结算
- 冰面与变色/出口的优先级是否符合文档

### 17.2 渲染层测试重点
- 拖动时 Mesh 是否稳定跟手
- 逻辑落位后动画是否与最终状态一致
- 清除时是否存在视觉残影
- 切换关卡时是否存在对象泄漏
- 低性能档是否正确关闭阴影与高成本效果

### 17.3 存档测试重点
- 主线进度是否正确恢复
- 无限模式是否能继续当前轮次
- 道具库存是否正确保存
- 版本升级时旧存档是否能平滑兼容

### 17.4 无限模式测试重点
- 是否出现不可解局
- 是否出现明显重复局
- 是否出现超时生成

## 18. 风险与规避

### 18.1 风险：规则层和渲染层耦合
规避：
- 纯函数规则层
- Three.js 只负责表现

### 18.2 风险：无限模式生成质量不稳定
规避：
- 模板家族
- 逆向扰动
- 求解器校验

### 18.3 风险：Three.js 性能在移动端波动
规避：
- 设备分级
- 共享材质
- 限制阴影和粒子
- 控制对象数与 draw calls

### 18.4 风险：Safari WebGL 差异
规避：
- 尽早做 Safari 真机验证
- 限制高风险图形特性
- 保持上下文恢复方案和兼容提示页

### 18.5 风险：后期关卡维护困难
规避：
- 章节拆分数据文件
- 统一 `LevelData` 结构
- 表现字段与规则字段分离

### 18.6 风险：多机制同时出现后边界变乱
规避：
- 所有效果优先级写死在规则文档中
- 关键规则先做小样例回归测试

## 19. 未来接入当前构建流程
虽然这次只是方案文档，不涉及实现，但后续正式开发时应遵循仓库现有约定：
- 编辑源文件在 `web_frontend/` 下进行
- 不手改 `web_frontend/dist/`
- 每次代码改动后执行：
  - `./scripts/build_frontend_web.sh`
- 编辑过的 JS 文件做语法检查：
  - `node --check web_frontend/src/shift-entry.js`
  - 以及对应新模块文件
