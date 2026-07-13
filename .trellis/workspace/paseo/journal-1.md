# Journal - paseo (Part 1)

> AI development session journal
> Started: 2026-06-24

---

## 2026-07-13 · 07-12-ssh-terminal-mcp · SSH+终端能力 MCP 化

- 交付：MCP 终端工具换 compositeTerminalManager（覆盖 SSH 终端）+ TerminalSummary 富化；新工具 list_ssh_hosts / connect_ssh_host / run_terminal_command / open_terminal_tab；新 push `terminal.reveal`（presence 最活跃客户端 shouldFocus）；app 端订阅复用 navigateToPreparedWorkspaceTab + registerSshTerminal。文档 docs/ssh-terminal-mcp.md + public-docs/mcp.md。
- 关键教训：captureTerminalLines 的 totalLines 恒含完整可视网格行——短命令输出不会增加行数，"基线 totalLines 切片"取空；改为行内容前缀 diff（trimTrailingBlank + 最长公共行前缀）。靠 mcp-parity e2e（真实 zsh）抓出，纯单测（mock capture）抓不到这类语义错配。
- 基线既有失败：mcp-parity 的 `update_agent updates name and labels` 在 HEAD 版 paseo-tools 下同样失败（文件级 stash 隔离验证），与本任务无关。
- 验证：全仓 typecheck/lint 绿；mcp-server.test 121 绿；registry/reveal/AOT/fallback 单测绿；parity e2e run_terminal_command 真实回路绿（OSC exitCode=0）。
- 遗留：提交范围需与用户确认（工作区混有并行工作改动）；真实 SSH 主机连接 + app tab 自动打开需用户环境人工验证。

