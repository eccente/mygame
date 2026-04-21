# 方块挪一挪生成器 v3 重构方案

## 1. 文档定位
本文件用于回答两个问题：
- 为什么当前生成器虽然已经能出关，但量产速度仍然偏慢。
- 下一代生成器应该如何重构，才能同时提升 `生成速度`、`有解率`、`难度稳定性` 与 `章节风格一致性`。

本文件不替代现有章节规则文档，而是作为它们之上的**生成器总架构说明**。后续涉及：
- 主线第 `2~12` 章批量产关
- 校验器 / 求解器与生成器的职责分层
- 关卡骨架、依赖图、逆向构造、静态快验、正式验收
- 难度量化与候选池筛选

统一以本文件为后续重构基线。

相关文档分工：
- `docs/fangkuai-nuoyi/09-mainline-specials-and-generator-spec.md`：章节规则、白名单、难度带
- `docs/fangkuai-nuoyi/10-level-design-standard-v3.md`：成品级关卡结构标准
- `docs/fangkuai-nuoyi/12-unified-mechanic-state-model-and-validator.md`：统一状态模型与校验器输出
- `docs/fangkuai-nuoyi/13-mainline-generator-final-pipeline.md`：当前 `v2` 生成管线与落地脚本说明
- `docs/fangkuai-nuoyi/16-first-clear-driven-generator-upgrade.md`：首出导向生成、首出预筛、首出局部搜索的专项方案

---

## 2. 为什么现在要重构，而不是继续堆参数

### 2.1 当前 `v2` 的优点
当前方案已经完成了几件重要工作：
- 运行时、求解器、生成器已经共享统一规则层
- 有 `quick-only` 预筛与 `full validate` 精筛的二段式流程
- 已经能输出 `difficultyScore / solutionFamilyCount / openingActionCount` 等关键信号
- 已经可以支撑章节样例关和部分量产脚本

这些都说明：
**我们不需要推翻规则层，只需要重构生成层。**

### 2.2 当前 `v2` 的根问题
当前生成器的主要瓶颈，不是“规则写得不够细”，而是整体仍然偏向：
`先生成候选 -> 再反复调用求解器淘汰`。

这种做法在关卡少、规则简单时可以工作，但在当前项目里会越来越慢，因为：
- 棋盘固定 `6` 列，意味着大量局面具有很强结构性，不适合纯随机乱摆
- 章节难度目标是 `高密度 + 低冗余 + 少量主解法家族`
- 异形块、门预算、颜色覆盖、手机可读性都会显著提高无效候选比例
- 求解器本来应该是“最终验收器”，不应该承担大规模垃圾候选清理

### 2.3 重构目标
生成器 `v3` 不是简单“再快一点”，而是要把流程改成：
`先构造题眼和依赖 -> 再排布 -> 再做便宜过滤 -> 最后才用昂贵求解收尾`

也就是从 `generate-and-test` 转向：
- `template / motif driven`
- `dependency graph driven`
- `reverse construction`
- `constraint-guided placement`
- `cheap filter first, expensive solve last`

---

## 3. 行业内更常见的批量产关思路
对解谜类、关卡类产品来说，更常见的不是“纯随机摆盘”，而是以下组合：

### 3.1 模板驱动
先定义一批结构模板，而不是让随机函数从零决定一切。

常见模板包括：
- 单主走廊
- 双车道竞争
- 中心锚点
- 门前共享整理区
- 首步隐藏
- 机关先触发后清盘

模板的价值是：
- 保证题眼明确
- 保证章节气质一致
- 大幅减少无效候选

### 3.2 逆向构造
不是从“混乱初盘”开始猜，而是从“近解态 / 解尾态”往回推。

原因：
- 更容易保证可解
- 更容易控制解链长度
- 更容易指定“谁必须先走、谁必须后走”

### 3.3 约束排布
把颜色、门、形状、占格率、门预算、视口可读性等，作为硬约束或软约束统一处理。

这类问题本质上接近：
- 约束满足问题
- 组合优化问题
- 有限状态搜索问题

### 3.4 分层验收
真正昂贵的完整求解，只打在少量高质量候选上。

常见分层是：
1. 静态结构过滤
2. 低预算搜索 / 可解快验
3. 完整求解
4. 多样性过滤
5. 人工终筛

### 3.5 人工最后收口
主线正式关通常不会完全自动上线，而是：
`批量候选 -> 自动评分 -> 人工挑选 / 微调 -> 冻结`

因此我们重构的目标也不是“完全无人值守”，而是：
**让机器更高效地产出值得人工挑的候选。**

---

## 4. `v3` 的核心思想

### 4.1 先决定“这关是什么题”
每一关在生成开始前，先决定：
- 它属于哪个章节 / 难度带
- 它的主结构模板是什么
- 它的关键依赖图是什么
- 它的目标首步隐藏度是多少
- 它允许几种主解法家族

只有这些先定下来，后续的颜色、门、方块摆法才有意义。

### 4.2 先决定“谁是锚点，谁是填充”
所有方块不再被一视同仁随机放置，而是先分角色：
- `anchor`：主锚块，决定局面节奏
- `gatekeeper`：门前守卫块，控制某色离场时机
- `bridge`：桥接块，释放后形成通路
- `filler`：补空块，用于提高密度和扰动解序
- `bait`：视觉上看起来可动，但不是正确首步的诱饵块

### 4.3 求解器只做最终裁判，不做建筑工
求解器的职责应收缩为：
- 快验阶段：确认“不是明显坏题”
- 精验阶段：确认“真的是章节目标强度”

不再让求解器承担：
- 海量随机候选筛垃圾
- 推断章节主题
- 替生成器补题眼

---

## 5. `v3` 的统一数据模型

### 5.1 章节合同 `chapterContract`
每章 / 每个难度带都先冻结一个最小合同：

```js
{
  chapterId: 3,
  band: 'expert',
  board: { cols: 6, rowsMin: 8, rowsMax: 9 },
  colors: 6,
  occupancyBand: [0.72, 0.80],
  shapePool: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4'],
  mechanicPool: [],
  targetFamiliesMax: 2,
  openingActionBand: [1, 3],
  difficultyBand: [73, 88],
  motifPool: ['central-knot', 'dual-lane-race', 'shared-door-queue']
}
```

生成器首先只读取这份合同，不直接读取大而散的配置集合。

### 5.2 形状足迹库 `footprintLibrary`
所有形状变体预计算为不可变 `footprint`：
- `shapePreset`
- `shapeVariant`
- `cellOffsets`
- `area`
- `bbox`
- `exitProjectionBySide`
- `legalPlacementsByRows`

其中最重要的是：
- `exitProjectionBySide`：给定 `left / right / top / bottom`，该形状在该侧离场时所需的正交投影集合
- `legalPlacementsByRows`：在 `6x8~6x12` 上的全部合法落点

这样后续就不需要每次临时重算轮廓和落点。

### 5.3 门合同 `exitContract`
门不再先随机摆，再事后补救，而是生成一份门合同：

```js
{
  exits: [
    { id: 'e-red-r1', side: 'right', start: 2, span: 2, color: 'red' },
    { id: 'e-blue-b1', side: 'bottom', start: 1, span: 3, color: 'blue' }
  ],
  doorGroupCountTarget: [7, 9],
  doorSlotCountTarget: [10, 14],
  sameColorAdjacentAllowed: false
}
```

门合同的作用是：
- 先把颜色覆盖、门预算、边缘竞争定下来
- 再让方块去适配门，而不是相反

### 5.4 依赖图 `dependencyGraph`
依赖图是 `v3` 的核心抽象。

节点类型：
- `block`：方块
- `exit`：门
- `mechanic`：机关状态
- `space`：关键空位 / 通道
- `event`：关键事件，例如“红门首次可用”

边类型：
- `blocks`：A 挡住 B
- `unlocks`：A 释放后，B 才能行动
- `consumes`：A 使用关键空位后，该空位暂时不可用
- `requires`：某事件必须先发生
- `routes-to`：块的目标门关系

依赖图要求：
- 主链必须清晰
- 可以有少量支链
- `brutal` 允许接近单主链
- 不允许出现大量无意义并行边

### 5.5 结构模板 `motif`
模板决定这一关的空间语义，而依赖图决定这一关的逻辑语义。

推荐最小模板集：
- `central-knot`：中心结团，适合 `T / cross`
- `corner-yield`：缺角借位，适合 `L`
- `dual-lane-race`：双车道竞争，适合同色多门
- `shared-door-queue`：多个块竞争同一门前整理区
- `locked-spine`：主脊柱被一组大块锁住
- `phase-split`：机关前后两阶段

---

## 6. 生成器 `v3` 总流程

### 6.1 阶段 A：选择章节合同
输入：`chapterId + levelIndex`。

输出：
- `chapterContract`
- 本关 `rows`
- 本关 `shapeBudget`
- 本关 `doorBudget`
- 本关 `difficultyTarget`

### 6.2 阶段 B：选择结构模板与依赖骨架
先根据章节 / 难度带选：
- `motif`
- `dependencyGraph skeleton`
- 主锚块数量
- 首步隐藏等级

这一阶段不放具体坐标，只决定“这关属于哪类题”。

### 6.3 阶段 C：决定面积预算与角色预算
先决定总占格与形状配额，而不是直接放块：
- 总占格
- 空格底线
- 各颜色面积预算
- 各形状面积预算
- `anchor / gatekeeper / filler / bait` 数量预算

建议把 `面积预算` 和 `角色预算` 绑定，而不是只做“形状抽签”。

### 6.4 阶段 D：从近解态开始逆向构造
这一步是 `v3` 的关键：
- 先构造一个“接近可清盘”的末段局面
- 保证每个关键块理论上都有兼容出口
- 再按依赖图，把必须后出的块逐步往回塞
- 每塞一步，都保持“未来仍可解”

也就是说，我们生成的不是“随机初盘”，而是：
`解尾态 -> 中间关键态 -> 初始态`

### 6.4.1 当前已落地的 `reverseBuilder phase 1`
这一轮代码已经把 `reverse construction` 从概念骨架推进到第一版可执行形态，当前约定如下：
- `shapeQuota` 先转成 `shapeTasks`，再由任务驱动逆向落块，而不是先随机挑块再事后补密度
- 任务不再一开始就锁死单个 `shapeVariant`，而是保留该家族可用变体集合，等拿到目标门之后再按 `exit span / edge` 选择兼容变体
- `anchor / gatekeeper / bait / filler` 会使用不同的离门缓冲距离，避免所有块都贴门生成导致开局太松
- 逆向打乱时不再只看“离门多远”，还会同时考虑 `adjacency`（邻接压迫）、`exitFlex`（多门兼容）与 `centerPressure`（向中心压盘）
- 初始逆向任务的目标占格从“约占目标的 `64%`”上调到“约占目标的 `88%`”，把高密度真正前置到候选构造阶段

这套 phase 1 仍然不是最终版，但已经解决了一个关键问题：
**异形块终于开始按“门兼容 -> 变体匹配 -> 逆向落位”同一逻辑生成，而不是继续挂在旧 seed + densify 的后置修补链上。**

### 6.5 阶段 E：约束排布与补压
逆向骨架成型后，再补足：
- 门位
- 颜色映射
- 干扰块
- 机制部件
- 额外占格密度

这一阶段的目标不是增加随机性，而是：
- 把盘面压到目标密度
- 避免解链被补压破坏
- 让局面更像成品图，而不是求解树产物

### 6.6 阶段 F：静态快验
在调用求解器前，先执行纯静态规则过滤。

必须一次过掉的项目：
- 颜色是否全覆盖
- 每个关键块是否至少存在理论兼容门
- 门预算是否越界
- 是否存在同色相邻单门 / 同边冲突门
- 是否有过多开局直出块
- 视口是否会超出手机安全框
- 占格率、空格率、异形比例是否达标
- 是否存在明显坏结构，例如全图只有一个巨大空腔

静态快验应该尽量做到：
- `O(n)` 或 `O(n log n)`
- 不依赖完整搜索
- 尽可能多地提前淘汰坏题

### 6.7 阶段 G：低预算快验
对通过静态快验的候选，跑轻量搜索：
- 限制 `maxStates`
- 只要求确认 `isLikelySolvable`
- 估算 `openingActionCount`
- 估算 `obviousFirstClearCount`
- 初步估算 `dependencyDepth`

如果在这一层就能判断“明显太松 / 太散 / 太多解”，直接淘汰。

### 6.7.1 `cheap filter` 的正式分层
为了兼顾速度与可解性，`v3` 现在明确拆成四层：
- `static`：`validateLevelStatic` + footprint 缓存，只负责结构合法性、门兼容、移动端规格等
- `probe`：超低预算 `validateLevelQuick`，仅用于 `augmentDensity / signatureQuota` 这类高频内循环，目标是把明显死题尽快剪掉
- `quick`：正常预算 `validateLevelQuick`，用于候选级预筛与 `quick-only` 抽样
- `full`：`validateLevelFull`，只打在少量高质量候选上

原则是：
- 高频内循环绝不直接跑 `full`
- 能被 `static / probe` 淘汰的候选，不进入更贵的层
- `probe` 允许保守，但不能越过门预算与结构红线

### 6.7.2 `difficulty-first` 候选排序
在早期章节的实际量产里，`过松` 比 `略偏难` 更伤体验，因此候选排序增加一条现实约束：
- 低于目标步数带的候选，要被明显更重地惩罚
- 略高于目标上沿的候选，可以保留为可接受偏难样本
- 对 `hard` 段允许少量上浮容忍，用来接住那些结构扎实、只是步数稍高的候选

这不是放弃难度带，而是承认主线前段在用户目标下应当 `宁难勿松`。

落地原则：
- `undershoot penalty > overshoot penalty`
- `hard` 段上沿允许小幅浮动

### 6.7.3 早期章节的 `seed multiplex`
对第 `2` 章这类早期但要求快速变难的章节，单个 seed 的波动会直接影响用户对‘这章到底难不难’的体感。

因此在当前实现里增加一层轻量 `seed multiplex`：
- 外部仍然只请求第 `1` 次或第 `2` 次尝试
- 但 hard 段若首个候选明显偏松，会在内部补测少量强化 seed（当前为 `+2 / +4`）
- 最终只保留其中更强的一个候选对外返回

这层机制的目的不是暴力枚举，而是：
- 保持接口层的尝试次数稳定
- 把 `前 1~2 次尝试` 的体感稳定性做上去
- 避免主流程为了少数坏 seed 被迫整体加大 attempt 预算

### 6.7.4 首出优先的预筛层
在当前项目里，`首个离场方块何时出现、是不是关键大块、首出后释放多少空间`，对主线难度的解释力高于大量后验总分。

因此下一步建议在 `probe -> quick` 之间增加一层正式的 `first-clear` 预筛：
- 先用 `opening-static` 指标淘汰开局白给、多大块贴门、门前直通等明显松题
- 再用“只搜索到首出为止”的局部求解，验证 `firstClearSetupDepth / firstClearArea / firstClearReleaseGain / firstClearRouteCount`
- 只有首出质量合格的候选，才进入 `quick / full`

这层改造的意义，不是让单次 solver 更快，而是显著减少进入完整求解的垃圾候选数量。详见 `docs/fangkuai-nuoyi/16-first-clear-driven-generator-upgrade.md`。
- 真正结构坏题仍然必须被 `static / quick / full` 拦住

### 6.8 阶段 H：完整求解精验
只有少量候选进入这一层。

输出正式指标：
- `isSolvable`
- `bestMoveCountEstimate`
- `solutionFamilyCount`
- `openingActionCount`
- `firstClearSetupDepth`
- `dependencyDepth`
- `criticalEventChain`
- `difficultyScore`

### 6.9 阶段 I：多样性与章节池组装
就算候选都达标，也不能整章太像。

因此还要做一层：
- `signature` 去重
- 相邻关结构相似度控制
- 相邻关颜色主导分布打散
- 相邻关主模板打散
- 相邻关首步类型打散

### 6.10 阶段 J：人工终筛与冻结
最终上线的主线关仍保留人工终筛：
- 看题眼是否足够明显
- 看手机上是否好读
- 看有没有“算法觉得难，但玩家觉得乱”的情况
- 必要时做小规模手调

---

## 7. 数学抽象建议

### 7.1 棋盘状态表示
由于棋盘固定 `6` 列、最高 `12` 行，总格数最多 `72`。

推荐使用：
- `BigInt bitboard`，或
- 两段 `uint64` 风格位板

位索引：
`bitIndex = y * 6 + x`

优点：
- 占位并集、碰撞检测、邻接检测都很快
- 门投影、空位统计、签名哈希都容易做

### 7.2 方块表示
每个方块统一抽象为：

```js
{
  id,
  color,
  shapePreset,
  shapeVariant,
  anchorX,
  anchorY,
  footprintMask,
  role,
  moveAxis,
  mechanicState
}
```

其中：
- `footprintMask` 是以当前锚点平移后的绝对位板
- `role` 用于指导生成，不一定进入运行时

### 7.3 离场兼容性
对于方块 `b` 与门 `e`，定义：
- `proj(b, side)`：方块在某一侧离场时，对正交轴的投影集合
- `slot(e)`：门在该侧开放的正交坐标集合

兼容条件：
- `color(b) == color(e)`
- `proj(b, side(e)) ⊆ slot(e)`
- 从门前合法位置沿离场方向做单调平移时，不穿越关闭门或非法格

这样就能统一覆盖：
- `mono`
- `domino / bar3`
- `square-2`
- `L / T / cross`

### 7.4 依赖图的形式
依赖图可抽象为一个带类型的有向图：

`G = (V, E)`

其中：
- `V = blocks ∪ exits ∪ spaces ∪ mechanics ∪ events`
- `E = precedence ∪ unlock ∪ consume ∪ route`

正式验收时，要求：
- 主链长度达到章节目标
- 有向环只能出现在明确允许的机关状态回路中
- 不允许无意义大环

---

## 8. 难度量化：保留少数真正有用的指标
`v3` 不建议无限增加评分字段，而是收敛到一组真正能指导产线的核心指标。

### 8.1 核心指标
建议正式保留：
- `bestMoveCountEstimate`
- `solutionFamilyCount`
- `openingActionCount`
- `firstClearSetupDepth`
- `dependencyDepth`
- `doorCompetitionCount`
- `occupancyRate`
- `obviousFirstClearCount`
- `mobileViewportFit`

### 8.2 建议的 `difficultyVector`
```js
{
  moveDepth,
  familyTightness,
  openingTightness,
  firstClearDelay,
  dependencyDepth,
  exitCompetition,
  structuralCompression,
  readabilityPenalty
}
```

### 8.3 总分思路
建议总分仍用 `0~100`，但分成三层：
- `staticScore`：结构上像不像本章
- `searchScore`：求解上难不难
- `qualityPenalty`：手机发糊、过散、过像、太露首步时扣分

也就是：

`difficultyScore = staticScore * 0.35 + searchScore * 0.65 - qualityPenalty`

这样可以避免：
- 只看解长，结果产出一堆“步数长但不烧脑”的关
- 只看结构，结果产出“看起来复杂但其实很好过”的关

---

## 9. 第 `2~5` 章的最小生成合同
这一节不是最终的章节细表，而是给 `v3` 提供最小实现目标。

### 9.1 第 2 章：`L` 形借位
核心要求：
- 主模板以 `corner-yield / shared-door-queue` 为主
- `L-3 / L-4` 必须承担真实借位职责，而不是仅作装饰
- 禁止 `T-4 / cross-5`
- 开局直出块严格控制

生成重点：
- 缺角让位
- 门前转折
- 边界错位

### 9.2 第 3 章：`T` 形堵点
核心要求：
- 首次出现 `T-4`
- `T-4` 必须成为中心锚块或主堵点
- 必须出现中心结团或双侧分流
- 禁止 `cross-5`

生成重点：
- `central-knot`
- `dual-lane-race`
- 多门竞争

### 9.3 第 4 章：十字型控场
核心要求：
- 首次出现 `cross-5`
- `cross-5` 必须承担“锚点 / 锁喉 / 四向借位”之一
- `cross-5` 不能只是孤立大块
- 必须让玩家感受到“先处理十字锚点还是先拆边路”的阅读压力

生成重点：
- `central-knot`
- `shared-door-queue`
- `locked-spine`

### 9.4 第 5 章：多异型互锁
核心要求：
- `L-3 / L-4 / T-4 / cross-5` 全部允许
- 至少两种异形同时承担主职责
- 解法家族应明显收紧
- 强化“局部唯一路径 + 首步隐藏 + 多锚点串联”

生成重点：
- `central-knot + shared-door-queue`
- `dual-lane-race + corner-yield`
- 多锚点串联

---

## 10. 校验器与求解器需要怎样配合 `v3`

### 10.1 从一个函数拆成三层
建议把当前 `validateLevel()` 的职责拆成三层：
- `staticValidateLevel(level)`：只做静态结构检查
- `quickValidateLevel(level, budget)`：低预算搜索
- `fullValidateLevel(level, budget)`：完整求解 + 完整评分

### 10.2 状态哈希要显式包含机制态
哈希必须至少包含：
- 所有方块位置
- 颜色 / 形状签名
- 锁门开闭状态
- 开关状态
- 方向解除状态
- 冰面 / 染色等可变状态

否则会把不同局面错误合并，影响解法家族统计。

### 10.3 搜索缓存要服务批量生产
对批量生成来说，缓存不仅用于“同一关重复状态”，还应服务：
- 相同骨架的不同扰动版本
- 相同模板的不同颜色映射版本
- 相同门合同的不同填充版本

也就是说，缓存设计应从“单关求解”升级为“同批候选复用”。

---

## 11. 迁移路线：如何从当前脚本过渡到 `v3`

### 11.1 第一阶段：不改玩法，先拆层
先保留现有规则与章节数据，做三件事：
1. 从 `solver.js` 中拆出 `staticValidateLevel()`
2. 把 `quick` 与 `full` 的预算和输出结构彻底统一
3. 把形状足迹、门兼容计算、视口检查做成独立模块

### 11.2 第二阶段：引入模板与依赖图
新增：
- `motif-library.js`
- `dependency-graph.js`
- `reverse-builder.js`
- `candidate-signature.js`

这一步之后，生成器就不再从“随机摆块”开始，而是从“题眼骨架”开始。

### 11.3 第三阶段：替换早期章节脚本
把现有：
- `scripts/rebuild_shift_early_chapters.mjs`
- `scripts/pressure_pass_shift_chapter.mjs`

逐步替换为一个统一入口，例如：
- `scripts/build_shift_candidates_v3.mjs`

由同一入口根据 `chapterContract` 决定：
- 使用哪些模板
- 使用哪些依赖图
- 用哪些快验 / 精验阈值

### 11.4 第四阶段：做章节级候选池
每章不再“直接生成 30 关写回”，而是：
- 先生成 `300~1000` 个廉价候选
- 静态过滤到 `80~150`
- 快验过滤到 `20~50`
- 精验留下 `8~15`
- 人工挑 `30` 关时，按多样性拼池，而不是按生成顺序直接收

### 11.5 第五阶段：机制章接入
在 `2~5` 章稳定后，再把同一架构接到：
- `方向限定`
- `锁门 / 钥匙格`
- `单向门`
- `开关门`
- `变色格`
- `冰面`

重点不是马上支持所有机制，而是先确保：
- 每个机制都能被依赖图表达
- 每个机制都能被静态快验部分理解

---

## 12. 性能目标
`v3` 重构后的目标不是“单关求解更快一点”，而是整条产线更快。

建议目标：
- 静态快验吞吐量至少达到当前 `full validate` 的 `20~50` 倍
- 至少 `70%` 以上的坏候选在进入求解器前被淘汰
- `quick validate` 平均只处理静态快验后前 `10%~20%` 的候选
- `full validate` 只处理 `quick validate` 后前 `10%~30%` 的候选
- 单章正式产线的时间开销，主要花在“少量优质候选精验”上，而不是“海量垃圾候选陪跑”上

---

## 13. 现阶段最重要的落地顺序
如果现在开始正式重构，建议严格按下面顺序做：
1. 先拆 `static / quick / full` 三层校验
2. 再抽 `footprintLibrary + exitContract` 基础模块
3. 再做 `motif + dependencyGraph` 结构层
4. 再做 `reverseBuilder` 逆向构造层
5. 最后再写统一的 `build_shift_candidates_v3.mjs`

**不要**先做的事：
- 不要先把第 `2~5` 章细表写到极细，再让旧生成器硬套
- 不要先追求一键全自动量产 `360` 关
- 不要先给 `difficultyScore` 加太多新权重

当前最关键的，是先把：
`生成思路从“随机摆后求解”改成“先定骨架再求解”`。

---

## 14. 一句话结论
当前项目后续最值得投入的，不是继续给旧生成器堆更多参数，而是尽快升级到：

`章节合同 + 结构模板 + 依赖图 + 逆向构造 + 静态快验 + 低预算求解 + 完整精验`

这套 `v3` 架构一旦稳定，后面的章节细化、难度收紧、样板关批量生成，都会比现在顺得多。
