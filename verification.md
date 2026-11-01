# 本地迁移验证

日期：2026-11-01；执行者：Codex。

目标：完整同步 upstream/main `919e44b3`，保留 fork UI 与 Reclaude 功能。初始 299 项合并冲突已消解。

| 检查                      | 执行结果与证据                                                     |
| ------------------------- | ------------------------------------------------------------------ |
| 内部依赖构建              | 通过；`.codex/build-app-deps.log`                                  |
| Server + CLI 生产构建     | 通过；`.codex/build-server-final.log`                              |
| Desktop 主进程 + CLI      | 类型检查、编译、CLI --help 通过；`.codex/desktop-cli-migration.md` |
| Web 生产导出              | 通过；`.codex/export-web-delivery.log`，产物 `packages/app/dist`   |
| App 全目录 lint           | 2,612 文件零错误；`.codex/app-lint-final3.log`                     |
| 终端真实浏览器回归        | 45 项通过；`.codex/test-terminal-browser-final2.log`               |
| 根集成回归                | 4 文件、78 项通过；`.codex/test-root-final.log`                    |
| 主机终端订阅              | 33 项通过；`.codex/test-terminal-session-final.log`                |
| Windows forge 参数        | 4 项通过、5 项平台跳过；`.codex/test-forge-cli-final.log`          |
| 网站 canonical URL        | 3 项通过；`.codex/test-canonical-url-final.log`                    |
| Reclaude/额度             | 70 项通过；`.codex/backend-migration.md`                           |
| 工作区状态/可见性         | 211 项通过；`.codex/app-state-tests4.log`                          |
| 消息流/差异共享           | 130 项通过；`.codex/test-stream3.log`                              |
| 提供商、桌面、UI 其他回归 | 各批次明细见 `.codex/*migration.md`，不将重复执行计入总数          |

浏览器人工操作由本地 AI 自动完成：浅色/纯黑主题、中文路径项目打开、独立 daemon 直接连接、终端命令回显、390px 移动视口。测试服务使用隔离的 `.codex/browser-daemon-home` 和 4198/4199 端口。

初次浏览器测试因自带 Chromium 未安装失败；改用已安装的 Chrome 运行同一 Vitest browser 项目后通过。网站纯函数测试跳过 Cloudflare 部署插件，使用临时本地配置运行。历史失败与修复过程保存在 `.codex/operations-log.md` 和对应日志，不能将早期失败日志视为最终结果。

未执行：全仓所有测试、Android/iOS 原生安装包/真机、真实 Electron 剪贴板 E2E、带凭证的外部 SSH/Reclaude/模型请求。没有运行远程 CI、发布或推送。

最终复核：全 workspace 类型检查通过（`.codex/typecheck-all-last.log`）；全仓 lint 5,609 文件零错误（`.codex/lint-all-last.log`）。最新 Web 导出记录为 `.codex/export-web-verified.log`；Server 最后编译记录为 `.codex/server-build-last.log`。

追加回归：终端和 Mermaid 真实浏览器 47 项通过（`.codex/test-browser-delivery.log`）；配额异步读取 113 项通过（`.codex/quota-async-tests.log`）；SSH 异步临时密钥生命周期等 27 项通过（`.codex/ssh-async-tests.log`）；空工作区 8 项和内嵌浏览器查找 3 项通过（`.codex/backend-migration.md`）。

最终页面验证：空工作区重载、新标签、历史面板、端口映射、文件树和 README Markdown 预览通过，截图 `.codex/workspace-final.png`。控制台仅有未启动默认6767服务的自动发现错误，4198显式连接正常，没有页面渲染错误。

桌面专用渲染包导出通过（`PASEO_WEB_PLATFORM=electron`，`.codex/export-electron-final.log`，产物 `.codex/desktop-web-dist`）。终端面板查找组件 2 项交互测试通过（`.codex/terminal-pane-fixture-final2.log`），覆盖下一项/上一项、Enter/Shift+Enter、清空、关闭与 Ctrl+C。
