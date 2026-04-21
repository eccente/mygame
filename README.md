# myGame

当前仓库是一个前端静态站点项目，包含：

- 工具集合首页（`web_frontend/index.html`）
- 挪车小游戏（`web_frontend/game.html`）
- 家人健康记录工具（`web_frontend/health.html`）

## 目录说明

- `web_frontend/`：前端源码与资源
- `scripts/build_frontend_web.sh`：前端构建脚本
- `docs/`：文档（保留）

## 本地预览

```bash
cd web_frontend
python3 -m http.server 8080
```

浏览器访问：`http://127.0.0.1:8080`

## 构建

在项目根目录执行：

```bash
./scripts/build_frontend_web.sh
```

构建产物目录：

```text
web_frontend/dist
```

## 部署

将 `web_frontend/dist` 下文件完整上传到静态站点根目录。

## PWA

站点已包含 `manifest` 和 `service worker`，在手机浏览器可“添加到主屏幕”。

## 健康工具与 AI 协作

健康工具支持四类记录：

- 血压
- 用药
- 症状
- 睡眠

AI 协作流程（模式 A+）：

1. 在健康页点击“复制并打开AI”或“一键模板并打开AI”
2. 在千问/豆包对话后复制整段回复
3. 回到健康页点击“粘贴并入库”自动解析 `health_actions` JSON
4. 校验失败或疑似冲突的记录会进入“待确认”

增强能力：

- 严格导入模式（`health-actions/v1`）
- 老人模式（大字号大按钮）
- 语音录入（浏览器支持时可用）
- 本地备份提醒与导入恢复
