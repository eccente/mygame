# 方块挪一挪统一机制状态模型与校验器扩展方案 v1.0

## 1. 文档定位
本文件用于把第 `6~12` 章后续开发最容易反复分叉的部分一次性冻结为统一基线，主要覆盖：
- `运行时 / 求解器 / 生成器` 共享的统一状态模型
- 第 `6~11` 章机制如何抽象成稳定的数学字段
- 校验器如何从“基础可解”扩展到“机制可解 + 唯主解 + 终章配额验收”
- 第 `12` 章 `终章拼盘` 如何基于离线配额制生产

后续只要涉及：
- 方向限定、锁门、单向门、开关门、变色格、冰面
- 求解器支持哪些机制
- 校验器如何做状态哈希、去重、解法家族收口
- 第 `12` 章如何冻结 `6x5` 机制配额

都以本文件为优先实现基线。

## 2. 当前冻结结论
- 运行时、求解器、生成器必须共享同一套 `二维网格状态 + 规则结算流水线`。
- 任何机制都必须先被抽象成 `静态字段 + 动态字段 + 状态转移规则`，再进入运行时或生成器。
- 校验器不再只验证“能不能过”，而要同时验证：`结构合法`、`机制可解`、`低冗余`、`章节目标带`、`手机可读性`。
- 第 `12` 章不新增机制；它是 `终章收束章`，采用 `6` 种机制 × 各 `5` 关的离线固定配额。
- 道具不进入可解性证明；校验器和生成器默认按 `不给道具` 前提运行。
- 首发道具白名单冻结为 `万能钥匙 + 润滑油 + 金手指`，不再预留第四道具槽位。

## 3. 统一状态模型

### 3.1 设计原则
统一状态模型必须满足三件事：
1. `运行时能直接执行`：不能是只给策划看的抽象表。
2. `求解器能直接哈希`：不能依赖 Three.js Mesh、动画状态、临时高亮。
3. `生成器能直接评估`：候选关生成后不需要再做人肉翻译。

### 3.2 静态关卡描述 `LevelStatic`
建议统一拆成以下几部分：

```ts
LevelStatic = {
  levelId,
  cols,
  rows,
  exits,
  tiles,
  gates,
  blocks,
  chapterTags,
}
```

字段职责：
- `exits`：门组定义，只包含边、起点、跨度、颜色等静态信息。
- `tiles`：地格类机制，如 `key_pad`、`toggle_switch`、`recolor`、`ice`。
- `gates`：门类结构，如 `lock_gate`、`one_way_gate`、`toggle_gate`。
- `blocks`：初始块模板，只记录初始锚点、形状、颜色、方向限定等。
- `chapterTags`：只用于章节生产控制，不参与运行时物理判定。

### 3.3 动态运行态 `LevelState`
建议统一为以下结构：

```ts
LevelState = {
  blocks: {
    [blockId]: {
      anchor: { x, y },
      color,
      moveAxis,
      cleared,
      flags,
    }
  },
  gates: {
    [gateId]: {
      open,
      consumed,
      phase,
    }
  },
  session: {
    usedItems,
    moveCount,
    chainSerial,
    lastAction,
  },
}
```

其中：
- `flags` 只放真正影响规则的状态，例如 `isLubricated`。
- `phase` 用于开关门这类需要记录当前相位的机制。
- 不把 `高光 / 阴影 / 拖动中偏移 / toast / camera` 这类表现数据写入 `LevelState`。

### 3.4 状态哈希 `stateHash`
用于求解器去重、重复关过滤、问题复现。

必须进入哈希的内容：
- 每个未清除方块的 `anchor`
- 每个未清除方块的 `color`
- 每个未清除方块的 `moveAxis / isLubricated`
- 所有动态门状态 `open / phase / consumed`
- 影响后续规则的会话状态

不进入哈希的内容：
- Three.js 动画时间
- 选中态、高亮态、提示态
- 相机角度、阴影强弱
- UI 是否打开商店或设置弹层

建议：
- 方块按 `blockId` 排序后串行化，避免哈希受数组顺序污染。
- `stateHash` 与 `signature` 分离：前者用于求解去重，后者用于关卡重复过滤。

## 4. 统一动作模型与结算流水线

### 4.1 玩家动作归一化
尽管玩家是 `自由拖动后吸附`，但求解器不处理像素拖动，而统一处理为：

```ts
Action = {
  blockId,
  targetAnchor,
  approachDir,
}
```

说明：
- `targetAnchor` 是吸附后的候选锚点。
- `approachDir` 是本次动作的主方向，用于出口判定、冰面延续、单向门检查。
- 运行时先由拖动系统把连续输入归一化，再交给规则层。

### 4.2 标准结算流水线 `settle(action, state)`
所有运行时、求解器、生成器回放都必须走同一条流水线：

1. `合法性预检`
   - 是否越界
   - 是否与其他块重叠
   - 是否撞到关闭门
   - 是否违反单向门 / 方向限定
2. `主位移落点`
   - 确认最终合法锚点
3. `事件链结算`
   - 钥匙格 / 开关格
   - 变色格
   - 出口离场
   - 冰面续滑
4. `移动链收束`
   - 若冰面继续，则生成下一段子动作
   - 若已离场，则标记 `cleared = true`
5. `结果记录`
   - 输出 `criticalEventChain`
   - 输出 `settleSummary`
   - 更新 `moveCount / chainSerial`

### 4.3 为什么必须共享这条流水线
如果运行时、求解器、生成器各写一套：
- 运行时能过、校验器说不过
- 生成器说有解、真机里却卡死
- 第 `12` 章终章配额关会因为机制细节不一致而大量返工

所以必须做到：
- `一个动作` 在三套系统里得到同一个结果
- `一个 stateHash` 能稳定复现同一盘面
- `一个 criticalEventChain` 能同时用于调试、验收、做关复盘

## 5. 第 6~11 章机制编码表

| 机制 | 静态字段 | 动态字段 | 是否进入 `stateHash` | 说明 |
| --- | --- | --- | --- | --- |
| 方向限定 | `block.moveAxis = horizontal / vertical` | `block.flags.isLubricated` | 是 | 被润滑后 `moveAxis` 可变为 `both` |
| 锁门 / 钥匙格 | `gate.type = lock`、`tile.type = key_pad` | `gate.open`、`gate.consumed` | 是 | 钥匙触发后本局常驻开启 |
| 单向门 | `gate.type = one_way`、`gate.allowDir` | 无 | 否 | 属于纯路径合法性约束 |
| 开关门 | `gate.type = toggle`、`tile.switchIds` | `gate.open`、`gate.phase` | 是 | 每次触发翻转相位 |
| 变色格 | `tile.type = recolor`、`tile.toColor` | `block.color` | 是 | 颜色变化会直接改变出口兼容性 |
| 冰面 | `tile.type = ice` | 无 | 否 | 它改变动作链，而不是长期状态 |

补充约束：
- 同一机制若没有持久状态，就不要强行造动态字段。
- 同一机制若只影响 `路径合法性`，就放在 `move legality` 层判断，不放进事件层。
- 终章拼盘不新增第 `7` 种字段，只是组合使用已有字段。

## 6. 校验器扩展方案

### 6.1 校验器分层
建议校验器扩成六层：

1. `结构层`
   - 盘面越界
   - 方块重叠
   - 门组冲突
   - 同色单门相邻
   - 白名单越界
2. `规则层`
   - 单步合法性
   - 完整离场判定
   - 机制是否能正确结算
3. `求解层`
   - `isSolvable`
   - `bestMoveCountEstimate`
   - `expandedStates`
4. `低冗余层`
   - `solutionFamilyCount`
   - `openingActionCount`
   - `criticalEventChain`
5. `难度量化层`
   - `fastDifficultyScore`
   - `solverDifficultyScore`
   - `difficultyScore / difficultyTier`
   - `difficultyVector`
6. `章节验收层`
   - 占格率、颜色数、门预算、机制配额
   - `mobileViewportFit`
   - 第 `2~11` 章的 `困难 / 专家 / 极难` 目标带
   - 第 `12` 章 `6x5` 配额是否满足

### 6.2 解法家族 `solutionFamily`
为了做“唯主解”而不是“唯一步序”，解法家族应按 `关键事件链` 聚类，而不是按完整 move list 聚类。

建议最小聚类键：
- 清除顺序 `clearOrder`
- 不可逆承诺顺序 `oneWayCommitOrder`
- 锁门 / 开关门变化顺序
- 变色发生顺序
- 冰面主滑行链顺序

因此：
- 同样的关键顺序、只是中间让位步略有差异，可归为同一 `solutionFamily`
- 关键清盘顺序不同，则必须计为不同家族

### 6.3 终章拼盘的校验口径
第 `12` 章的目标不是“唯一点击序列”，而是：
- `solutionFamilyCount = 1`
- `openingActionCount` 尽量压到 `1~2`
- `difficultyTier = brutal`，且 `difficultyScore` 目标带为 `92~100`
- 主机制必须清晰可读
- 不允许依赖隐藏机制或读不懂的多层联动

### 6.4 机制支持的分阶段接入
校验器扩展顺序建议固定为：
1. `directional`
2. `lock-gate`
3. `one-way`
4. `toggle-gate`
5. `recolor`
6. `ice`
7. 第 `12` 章配额审查

原因：
- 前四种机制最适合先把共享状态模型跑通
- `recolor` 会把颜色也纳入状态哈希，是第一道真正的状态爆炸门槛
- `ice` 会把“单步动作”扩成“链式动作”，是第二道结算门槛
- 终章必须等前六种都稳定后再生产

### 6.5 难度量化输出
校验器对每个候选关统一输出：
- `fastDifficultyScore`：只基于静态结构和低成本推导，用于大批量候选初筛
- `solverDifficultyScore`：叠加完整求解结果后的真实强度
- `difficultyScore`：最终对外使用的 `0~100` 总分
- `difficultyTier`：`hard / expert / brutal / endless-peak`
- `difficultyVector`：至少包含 `openingHiddenness`、`solutionLength`、`solutionNarrowness`、`dependencyDepth`、`boardPressure`、`mobilitySuppression`、`mechanicBurden`、`perceptualLoad`

主线冻结口径：
- 第 `1` 章保持现状，不纳入本轮统一调难
- 第 `2~11` 章：`01~05 = hard`、`06~20 = expert`、`21~30 = brutal`
- 第 `12` 章：`01~30 = brutal`，并追加 `solutionFamilyCount = 1`

## 7. 生成器接入方式

### 7.1 候选关输入
生成器除现有输入外，新增两类生产控制：
- `mechanicStateProfile`
  - 指定当前机制允许使用的状态字段
  - 指定允许的机制复杂度上限
- `validatorTargetProfile`
  - 指定 `solutionFamilyCap`
  - 指定 `openingActionBand`
  - 指定 `difficultyScoreBand`
  - 指定 `difficultyTier`
  - 指定 `quotaBucket`（仅第 `12` 章使用）

### 7.2 第 12 章配额生产
终章采用 `离线配额制 + 随机抽样候选`：
- 先按 `6` 种机制建立 `6` 个配额桶，每桶正式目标都是 `5` 关
- 候选生成阶段保留随机主机制抽样，但每次抽样都必须落入某个尚未满额的配额桶
- 每个配额桶至少产出 `20~40` 个可解候选盘
- 候选通过校验器后，才占用该桶正式配额
- 当 `6` 个桶都各自筛满 `5` 关后，再统一重排成 `30` 关正式顺序

### 7.3 为什么保留随机抽样，但不做在线随机终章
因为终章目标是：
- `唯主解`
- `低冗余`
- `手机读盘稳定`
- `全章 6x5 配额可控`

所以：
- 候选生成阶段可以随机抽机制，用于扩大搜索面
- 但正式主线终章不能在线即时随机出题
- 终章最终看到的是“随机来源 + 离线冻结结果”，而不是“运行时随机成关”

## 8. 道具白名单与校验器边界

### 8.1 当前道具白名单
当前正式文档只保留：
- `masterKey`
- `lubricant`
- `goldFinger`

不再保留：
- `hammer`
- `teleportGlove`
- 任何预留占位道具

### 8.2 为什么要保留这三个道具
- `masterKey` 与第 `7` 章锁门机制强相关，认知成本低
- `lubricant` 与第 `6` 章方向限定强相关，玩家一眼能懂
- `goldFinger` 作为终极缓冲道具，提供直接拆解死结的能力，但代价仍高于前两者
- `hammer` 已失去对象，因为正式关卡不再使用独立障碍块
- `teleportGlove` 会过强地跳过空间依赖，不利于主线终章做低冗余收束

### 8.3 校验器如何看待道具
- 候选关必须在 `不用道具` 的条件下被解出
- 道具不参与 `solutionFamilyCount` 统计
- 道具只影响玩家缓冲体验，不影响关卡是否进入正式池

## 9. 推荐开发顺序
1. 先把共享 `LevelState` 与 `settle()` 纯函数层定下来
2. 再让运行时与求解器都改用这套共享状态转移
3. 先补 `directional / lock / one-way / toggle` 四类机制支持
4. 再补 `recolor`
5. 最后补 `ice`
6. 前六类稳定后，再正式制作第 `12` 章终章拼盘脚本
7. 最后再回头删除当前运行时代码里遗留的旧道具 UI / 库存字段

## 10. 变更控制
从现在开始，下列结论不建议随意改动：
- `cols = 6`
- 第 `12` 章采用 `6x5` 固定机制配额
- 第 `12` 章保留随机机制候选抽样，但正式结果必须离线冻结
- 终章单关只允许 `1` 个主机制
- `solutionFamilyCount = 1` 是终章正式验收口径
- 首发道具只保留 `万能钥匙 / 润滑油 / 金手指`
