# 上游 main 迁移记录

日期：2026-11-01；执行者：Codex。

本次将 `sakurayun/paseo-reclaude` 的 `db3bf650a94383d597b6250305478f28d1e77160` 合并至 `getpaseo/paseo` 的 `919e44b3195452a8dcdc0bbbfa7e7a7d3b8ca252`。目标为拉取时最新 main（0.15.0-beta.1），不是自动跟踪未来版本。工作位于本地 `codex/sync-upstream-main` 分支，没有推送远程。

## 迁移内容

- 接入上游工作区、标签/窗格、插件、消息流、Markdown、终端 replay/find、提供商和 CLI 架构。
- 保留并适配 Reclaude 账户/RPC/用量功能、原有主题与浮动界面、纯黑模式、字体与连字设置、侧栏、标签分组、SSH、终端通知、文件操作和项目外观。
- 用上游 EditingTextInput 与面板接口替换失效调用，修复 Electron 44 剪贴板、Windows 命令参数、Shell 偏好、主机全部终端订阅、图片缓存和重放通知等兼容问题。
- 新的原生终端采用上游 renderer，不再引用旧 WebView 终端打包脚本。

## 本地构建

仓库使用 npm workspaces。依赖安装后，核心验证命令为：

```powershell
npm run build:app-deps
npm run build:server
npm run typecheck
npm exec --workspace=@getpaseo/app -- expo export --platform web --max-workers 4
npm run build:main --workspace=@getpaseo/desktop
```

Web 导出产物在 `packages/app/dist`，CLI 构建产物在 `packages/cli/dist`。Windows 开发入口沿用仓库的 `npm run dev:win`；启动前检查端口和本地配置。

## 验证范围

具体执行结果见根目录 `verification.md`，完整本地日志与截图在忽略提交的 `.codex/`。验证在 Windows 上执行，包含真实浏览器终端交互；没有执行远程 CI、发布、远程推送或真实模型付费对话。

Android/iOS 真机与安装包、真实 Electron 系统剪贴板，以及有凭证的 SSH/Reclaude 外部服务调用仍需相应运行环境验证。已通过的 mock/单元测试不替代这些平台与外部服务的端到端验证。

来源：[fork](https://github.com/sakurayun/paseo-reclaude)、[upstream](https://github.com/getpaseo/paseo)。
