# 方块挪一挪首出导向生成器改造方案

## 1. 文档定位
本文件用于回答三个问题：
- 为什么“首个离场方块”是本项目主线难度的核心变量。
- 这一理论如何转成可执行的生成器目标，而不是停留在主观手感描述。
- 这一理论如何真正提升生成效率，而不是只在最终评分里多加几个字段。

本文件是 `v3` 总架构的专项补充，优先级低于统一规则层，高于单个章节脚本调参。

配套文档：
- `docs/fangkuai-nuoyi/10-level-design-standard-v3.md`：关卡结构与成品体验标准
- `docs/fangkuai-nuoyi/14-generator-v3-architecture.md`：生成器总架构与迁移路线
- `docs/fangkuai-nuoyi/12-unified-mechanic-state-model-and-validator.md`：统一状态模型与求解器 / 校验器输出

---

## 2. 为什么“首出”是这个游戏的核心难点
在本项目里，真正决定关卡是否烧脑的，不是“最后能不能清完”，而是：
- 玩家多久才能找到第一个有效离场方块。
- 这个首出方块是否是关键大块或关键结构块。
- 首出之前是否需要完成一段明确的准备链。
- 首出之后释放的空间，是“局部松动”还是“整盘塌陷”。

因此应把整局过程拆成两个阶段：
1. `首出前阶段`：以解锁局面、识别主瓶颈为主，是主要思考区。
2. `首出后阶段`：以兑现空间收益、完成后续顺序压缩为主，是次级思考区。

项目当前的大部分“关卡不够难”问题，本质上都来自以下几类失败：
- 首出太早。
- 首出太明显。
- 首出的是小块，收益不够高。
- 首出的是大块，但代价太低，导致盘面直接塌穿。
- 假首出太多，玩家不是在推理，而是在盲试。

因此，后续生成器应把“首出质量”提升为第一阶段硬门槛。

---

## 3. 首出相关术语定义

### 3.1 首出 `firstClear`
参考解中，第一个完整离场的方块。

### 3.2 关键首出 `keyFirstClear`
满足以下任一条件的首出：
- 面积较大，`shapeCells.length >= 3`
- 首出后释放的有效空间显著
- 首出后带来新的主通道或解锁下一批块

### 3.3 假首出 `fakeFirstClear`
开局或前几步看似能形成收益，但实际上：
- 不应优先离场
- 或者虽可离场，但会显著降低后续效率
- 或者只是无效绕路，不构成真正推进

### 3.4 首出准备深度 `firstClearSetupDepth`
从开局到首个方块离场前，需要先完成的有效准备步数。

### 3.5 首出面积 `firstClearArea`
首出块占格数，等于 `shapeCells.length`。

### 3.6 首出释放值 `firstClearReleaseGain`
首出发生后，盘面获得的实际收益，建议由以下几个量加权得到：
- 新增空格数
- 新增可动锚点数
- 新增可通行边缘通道数
- 新增“从不可出到可出”的目标块数

### 3.7 首出路线数 `firstClearRouteCount`
能在目标步数带内完成首出的不同方案数量。该值越低，说明首出越聚焦。

### 3.8 开局有效动作数 `openingActionCount`
开局时，所有可产生真实推进的动作数量。它不是“所有可移动锚点”的原样计数，而应该在未来与首出价值结合做去噪。

---

## 4. 首出理论为什么能提升生成效率
首出理论不会自动让求解器变快，但能显著减少“值得跑完整求解的候选关数量”。

当前生成器慢的根因，不是摆块本身，而是：
- 生成大量候选布局
- 用 `probe / quick / full` 反复淘汰坏候选
- 很多候选要跑到较后阶段，才暴露出“首出很烂、但结构合法”的问题

引入首出理论后的提速逻辑是：
1. 先用便宜指标判断“首出是否有资格成为主瓶颈”
2. 不合格者直接淘汰，不进入完整求解
3. 只有首出质量足够高的候选，才进入整局校验

因此它提升的是：
- `单位有效关卡成本`
- `完整求解触发率`
- `门位搜索效率`
- `候选排序准确度`

不是简单意义上的“单次 solver 提速”。

---

## 5. 从“整局求解优先”改成“首出优先”的生成流程

### 5.1 阶段 A：生成致密布局骨架
先满足以下硬约束：
- 固定 `cols = 6`
- 行数落在章节 band 内
- 颜色数符合章节合同
- 占地率落在目标带内
- 形状配额、异形配额、面积配额符合章节目标
- 不出现结构性重叠 / 无门颜色 / 移动端规格失配

这一阶段只关心“能不能形成候选结构”，不直接做整局难度判断。

### 5.2 阶段 B：做首出静态预筛
不跑完整搜索，只用低成本指标淘汰明显无效候选：
- `directClearCount`：开局直接可离场块数
- `openingLargeBlockNearExitCount`：大块离兼容门是否过近
- `openingActionCountRaw`：开局可动动作是否过多
- `edgePressureBalance`：边缘是否过度松散
- `obviousDoorLineCount`：是否存在明显门前直通道

若以下任一情况出现，候选直接废弃：
- 开局存在多个一眼可出的块
- 大块无需借位就已接近目标门
- 盘面虽致密，但门前通道天然过于干净
- 开局有效动作远超章节带

### 5.3 阶段 C：做门合成，但目标不是“最少门”
门合成应以“塑造首出结构”为目标，而不是盲目追求最少数量。

正确目标是：
- 每个活跃颜色都至少有兼容门组
- 门数落在章节 band 内
- 不让关键首出块开局白给
- 适度制造门竞争与误导
- 不因为补门而破坏首出准备链

因此门合成应使用 `door budget target`，而不是 `minimum door count`。

### 5.4 阶段 D：做“只搜索到首出”为止的局部求解
新增局部搜索层，只求解到“第一个离场事件”发生：
- 记录最短首出深度
- 记录首出块面积
- 记录首出释放值
- 记录首出路线数
- 记录假首出数量

这一层的职责是回答：
- 这关的首出是不是值得做主线关
- 首出是否足够晚、足够有价值、足够集中

这一层通过后，候选才有资格进入完整求解。

### 5.5 阶段 E：再做整局完整验证
完整求解只打在少量首出质量已经达标的候选上，验证：
- `bestMoveCountEstimate`
- `solutionFamilyCount`
- `dependencyDepth`
- `difficultyScore`
- 首出后是否过快塌盘
- 尾盘是否还保留顺序约束

### 5.6 阶段 F：章节池去重与人工终筛
即使生成器已通过首出与整局两层验证，仍需保留：
- 章节内首出模式去重
- 颜色与门位图案去重
- 局部战区形态去重
- 章节压轴关人工巡检

---

## 6. 建议新增的首出指标

### 6.1 静态指标
这些指标不需要完整求解，适合高频内循环：
- `directClearCount`
- `directLargeClearCount`
- `openingActionCountRaw`
- `openingMovableBlockCount`
- `openingLargeBlockNearExitCount`
- `doorLineCleanCount`
- `edgeSlackScore`
- `boardCoreCompression`

### 6.2 局部搜索指标
这些指标来自“求到首出为止”的局部搜索：
- `firstClearSetupDepth`
- `firstClearArea`
- `firstClearReleaseGain`
- `firstClearRouteCount`
- `falseFirstClearCount`
- `firstClearKeynessScore`

其中建议：
- `firstClearKeynessScore`
  - `= areaWeight + releaseWeight + unlockWeight - trivialPenalty`
- `trivialPenalty`
  - 用于惩罚“一贴边就出”的白给首出

### 6.3 全局指标
这些指标仍由完整求解提供：
- `bestMoveCountEstimate`
- `solutionFamilyCount`
- `dependencyDepth`
- `averageSetupSpan`
- `difficultyScore`
- `postFirstClearCollapseScore`

`postFirstClearCollapseScore` 建议新增，用来衡量：
- 首出后是否直接出现大量连续白给离场
- 盘面是否瞬间从“紧锁”变成“无脑收尾”

---

## 7. 首出导向下的目标带建议
以下不是冻结常量，而是建议作为 `chapterContract.segment.firstClearBand` 的首版范围。

### 7.1 `hard`
- `openingActionCount`：`2 ~ 4`
- `directClearCount`：`0 ~ 1`
- `firstClearSetupDepth`：`2 ~ 4`
- `firstClearRouteCount`：`<= 3`
- `firstClearArea`：优先 `>= 2`
- `falseFirstClearCount`：`0 ~ 1`

### 7.2 `expert`
- `openingActionCount`：`1 ~ 3`
- `directClearCount`：`0`
- `firstClearSetupDepth`：`3 ~ 5`
- `firstClearRouteCount`：`<= 2`
- `firstClearArea`：优先 `>= 3`
- `falseFirstClearCount`：`1 ~ 2`

### 7.3 `brutal`
- `openingActionCount`：`1 ~ 2`
- `directClearCount`：`0`
- `firstClearSetupDepth`：`4 ~ 7`
- `firstClearRouteCount`：`<= 1` 或 `<= 2`
- `firstClearArea`：优先 `>= 3`
- `firstClearReleaseGain`：必须显著，避免“晚但没价值”
- `falseFirstClearCount`：允许存在，但不能演化成纯盲试

注意：
- “首出越晚越难”不是单独目标
- 必须同时要求“首出有价值”
- 极难关不应只是闷，而应是“推理后才能松动”

---

## 8. 生成器实现建议

### 8.1 新增 `collectOpeningStaticMetrics(level)`
职责：
- 只用 footprint、门兼容、边缘接触信息，收集静态首出相关指标
- 不调用完整 `validateLevelQuick`
- 可用于 `augmentDensity / extendExits / roleBudget` 等高频内循环

### 8.2 新增 `validateFirstClear(level, options)`
职责：
- 只搜索到“第一个离场事件”为止
- 返回局部首出报告，不要求整局清空

建议输出：
- `isFirstClearReachable`
- `bestFirstClearDepth`
- `firstClearBlockId`
- `firstClearArea`
- `firstClearReleaseGain`
- `firstClearRouteCount`
- `falseFirstClearCount`
- `firstClearKeynessScore`

### 8.3 `quick` 不再直接覆盖所有候选
推荐分层变为：
1. `static`
2. `opening-static`
3. `first-clear`
4. `quick`
5. `full`

原则：
- 高频内循环最多打到 `opening-static`
- 候选级预筛优先用 `first-clear`
- 只有进入章节候选前列的样本才跑 `quick / full`

### 8.4 门合成改成“首出感知型”
门位搜索时，优先惩罚：
- 让大块开局贴门
- 让某色形成明显直通车道
- 让首出变成低面积、低收益小块

优先奖励：
- 首出前需要局部借位
- 首出块面积较大
- 首出后释放关键空腔，但不直接全盘松脱
- 门前冲突与借位冲突适度叠加

---

## 9. 与当前 `v3` 的关系
这套方案不是推翻 `v3`，而是给 `v3` 增加一个更靠前、更贴近玩法本质的筛选层。

### 9.1 保留的部分
继续保留：
- 章节合同 `chapterContract`
- 形状足迹库 `footprintLibrary`
- 依赖图 / 角色预算 / motif
- `probe / quick / full` 的后验精验体系

### 9.2 需要前移的部分
应从后验评分前移到候选构造阶段的，是：
- 首出静态预筛
- 首出局部搜索
- 首出驱动的门合成约束
- 首出质量排序

### 9.3 适用范围
- 主线模式：强烈建议使用
- 无限模式：建议降配使用，只保留静态首出预筛 + 低成本首出校验
- 手工关：建议把首出指标当成复盘模板，而不是硬性脚本约束

---

## 10. 迁移路线建议

### 10.1 第一步：先补指标，不改脚本主流程
先在求解器 / 校验器补：
- `collectOpeningStaticMetrics()`
- `validateFirstClear()`
- `postFirstClearCollapseScore`

目标是把观测面补齐。

### 10.2 第二步：把 `first-clear` 接进候选预筛
在 `scripts/rebuild_shift_early_chapters.mjs` 与后续机制章脚本中：
- 内循环不再高频打 `quick`
- 先用 `opening-static`
- 候选级先用 `first-clear`
- 最后才进 `quick / full`

### 10.3 第三步：把门合成改成首出感知型
也就是从：
- “补到可解即可”

改成：
- “补到既可解、又不破坏目标首出结构”

### 10.4 第四步：把首出带写回章节合同
给每个章节段增加：
- `firstClearDepthBand`
- `firstClearAreaBand`
- `firstClearRouteMax`
- `directClearMax`
- `falseFirstClearBand`

这样生成目标会比单纯 `difficultyScoreBand` 更稳定。

---

## 11. 一句话结论
本项目后续的生成器提速，不应继续依赖“生成更多候选，再更晚淘汰它们”；而应改成：

**先证明这关的首出值得成为主瓶颈，再让它进入整局求解。**

这既更符合玩法本质，也更符合工程上的提速方向。
