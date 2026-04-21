# 方块挪一挪主线 6~12 章生成器最终版落地方案

> 说明：本文件记录当前在仓库内已经落地的 `v2` 生成管线。若后续开始做生成器重构与提速，新的总架构以 `docs/fangkuai-nuoyi/14-generator-v3-architecture.md` 为优先基线。

## 1. 本次落地的目标
本轮不是直接批量写死第 `6~12` 章关卡，而是把它们的**最终版生成管线**补齐，使后续可以按统一抽象模型离线生产、筛选、写回章节文件。

本轮落地后的定位：
- `第 6~12 章` 不再依赖“单个样例关 + 人工脑补”
- 生成器直接建立在当前统一状态模型、求解器、校验器之上
- 章节机制、形状池、终章配额，都从配置层驱动
- 支持 `quick-only` 预筛与正式 `full validate` 精筛两种模式

## 2. 新增/更新的关键文件
- `scripts/rebuild_shift_mechanic_chapters.mjs`
  - 负责生成第 `6~12` 章候选关，并可在整章通过后写回 `web_frontend/src/shift/data/campaign/chapter-xx.js`
- `web_frontend/src/shift/design/mainline-generator-profiles.js`
  - 负责冻结第 `6~12` 章章节元数据、主机制映射、终章 `6x5` 配额顺序、方向辅助块数量带
- `web_frontend/src/shift/design/shape-pools.js`
  - 已补齐 `chapter06 ~ chapter12` 的形状权重

## 3. 生成器的最终版思路

### 3.1 总体结构
生成器采用“**样例机制骨架 + 高密度填充 + 出口重建 + 求解筛选**”的四段式流程：
1. 先从第 `6~11` 章现有样例关提取主机制骨架
2. 按章节 band 决定 `rows / occupancy / door budget / difficulty band`
3. 在不破坏机制骨架的前提下填充普通目标块，把盘面压到正式密度
4. 重新生成整章正式出口布局，再交给 `validateLevel()` 做快筛/精筛

### 3.2 为什么不用“纯随机从 0 起盘”
原因很明确：
- 机制章如果纯随机，很容易生成“机制存在但不构成题眼”的空机制盘
- 锁门、切换门、变色、冰面这类机制，更适合先固定骨架，再高密度补压
- 当前运行时与求解器已经共享统一规则层，所以“骨架 + 填充”的方式最稳，返工最低

### 3.3 机制骨架来源
- `directional` ← 第 `6` 章样例关
- `lock-gate` ← 第 `7` 章样例关
- `one-way` ← 第 `8` 章样例关
- `toggle-gate` ← 第 `9` 章样例关
- `recolor` ← 第 `10` 章样例关
- `ice` ← 第 `11` 章样例关

生成器会先对这些骨架做：
- 行数扩展
- `X / Y` 镜像打散
- 颜色重映射
- 重新编号

## 4. 章节配置冻结

### 4.1 第 6~11 章
- 每章默认 `30` 关
- 分段固定：`01~05 = hard`、`06~20 = expert`、`21~30 = brutal`
- 颜色数按当前冻结方案统一使用 `6` 色
- 主机制由章节决定，方向辅助块由章节配置决定

### 4.2 第 12 章
- 采用 `single-mechanic-fixed-quota`
- 配额固定：`6` 种机制 × 各 `5` 关
- 顺序不是按五关一组连续堆叠，而是交错穿插，避免玩家体感重复
- 单关只保留 `1` 个主机制，不叠第二个高约束主机制

## 5. 求解与筛选策略

### 5.1 两阶段筛选
为了让量产速度可接受，生成器采用两阶段校验：

**阶段 A：quick-only 预筛**
- 用较小 `maxStates` 跑 `validateLevel()`
- 目标是快速淘汰明显无解、结构不合法、门预算离谱的盘
- 主要用于批量扫候选

**阶段 B：full validate 精筛**
- 只对 quick 阶段排名最高的少量候选做完整验证
- 目标是确认 `solutionFamily / difficulty / door competition / move band` 等正式指标

### 5.2 当前脚本中的评分维度
生成器当前会综合以下指标打分：
- `rows`
- `occupancy`
- `colors`
- `bestMoveCountEstimate`
- `doorGroupCount`
- `doorSlotCount`
- `doorCompetitionCount`
- `difficultyScore`
- `solutionFamilyCount`
- `mobileViewportFit`

这保证它不是“随便能过就收”，而是尽量往章节 band 靠拢。

## 6. 输出方式
脚本支持两种工作模式：

### 6.1 预筛 / 调参
```bash
node scripts/rebuild_shift_mechanic_chapters.mjs --chapter=10 --from=1 --to=3 --attempts=4 --quick-only
```
用途：
- 验证某章某几关的骨架方向是否对
- 看门预算、密度、解长是否往目标带靠
- 低成本迭代参数

### 6.2 正式写回
```bash
node scripts/rebuild_shift_mechanic_chapters.mjs --chapter=10 --attempts=10 --write
```
用途：
- 在整章 `30` 关全部生成完成后，直接写回 `chapter-10.js`
- 第 `12` 章同理，会生成/覆盖 `chapter-12.js`

## 7. 当前边界
本轮已经把“生成器是否完整”这件事补到了可以正式进入下一阶段的程度，但也刻意保留了两个边界：
- 第 `12` 章生成文件写出后，是否马上并入 `levels.js`，属于发布接线步骤，不和本轮生成器耦死
- 章节最终发布前，仍建议对 `best_effort` 关做一次人工巡检，尤其关注门槽预算和极难段的首步隐藏度

## 8. 下一步建议
有了这条生成器主线，后续最顺的推进方式是：
1. 先用 `quick-only` 扫出第 `6~12` 章候选池
2. 再对每章 `best_effort` 关提升 `attempts` 做精筛
3. 最后把通过章写回章节文件，并接上第 `12` 章的运行时入口
