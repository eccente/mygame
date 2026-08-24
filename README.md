# Web Frontend (Mobile First)

这是当前前端静态站点版本，目标是优先保证手机浏览器（尤其 iPhone Safari）上的：

- 工具入口清晰
- 挪车游戏完整保留
- 健康工具可本地记录
- 支持全项目备份（健康管理 + 小游戏存档）
- AI 协作回填流程可用

## 页面

- `index.html`：工具集合首页
- `game.html`：挪车小游戏（沿用 `src/app.js`）
- `health.html`：健康记录工具（本地 IndexedDB）

## 脚本与样式

- `src/app.js` / `src/styles.css`：游戏逻辑与样式
- `src/health.js` / `src/health.css`：健康工具
- `src/site.css`：首页样式
- `src/pwa.js`：PWA 注册脚本

## PWA 文件

- `manifest.webmanifest`
- `service-worker.js`
- `assets/icons/icon.svg`

## 构建

在项目根目录执行：

```bash
./scripts/build_frontend_web.sh
```

产物目录：

```text
web_frontend/dist
```

## 健康工具数据说明

存储在浏览器本地 `IndexedDB`：

- `persons`：成员
- `records`：健康记录（血压/用药/症状/睡眠）
- `pending`：待确认动作
- `audit`：审计日志
- `meta`：元数据（如上次备份时间、UI偏好）

## 全项目备份说明

首页提供“全项目备份”入口，支持：

- 导出：统一打包健康管理（IndexedDB）与小游戏存档（localStorage）
- 导入：支持覆盖恢复或合并导入
- 兼容：可导入历史 `health-backup/v1` 文件（自动映射为全局备份格式）

核心文件：

- `src/backup-hub.js`：统一备份注册中心与导入导出协议（`mygame-backup/v1`）
- `src/backup-provider-health.js`：健康数据 provider
- `src/backup-provider-game.js`：小游戏存档 provider

后续新增模块接入方式：

1. 新建 `src/backup-provider-<module>.js`
2. 调用 `window.mygameBackupHub.registerProvider(...)` 注册 `id/label/exportData/importData`
3. 在 `index.html` 中增加该 provider 的 `<script type="module">` 引入

## AI 协作（模式 A+）

1. 点击“复制并打开AI”或模板按钮生成 Memory Pack
2. 在外部 AI（千问/豆包）对话
3. 将 AI 回复粘贴回工具，自动提取 `health_actions` 代码块
4. 合法记录自动提交；异常/冲突进入待确认

补充能力：

- 导入模式：严格模式（推荐）与兼容模式
- 老人模式：更大字号与按钮
- 语音录入：支持时可直接语音写入结构化记录

## 音频说明

游戏会按顺序尝试：

1. `assets/audio/bgm.mp3`
2. `assets/audio/bgm.m4a`
3. `assets/audio/bgm.ogg`

若都无法播放，会回退到 WebAudio 合成 BGM。
