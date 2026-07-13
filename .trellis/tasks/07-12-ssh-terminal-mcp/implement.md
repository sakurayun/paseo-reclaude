# 执行计划：SSH+终端能力 MCP 化

顺序：P1 → (P2 ∥ P3) → P4 → 文档/收尾。每阶段末跑 typecheck + lint + 本阶段测试文件。

## P1 打通复用

- [x] 新建 `packages/server/src/ssh/ssh-terminal-registry.ts`（register/unregister/get/listTerminalIdsByHost）
- [x] `ssh-connect-service.ts`：deps 增 `terminalRegistry?`；ssh2 与 fallback 成功路径 register + onExit unregister（`trackSshTerminal`）
- [x] `bootstrap.ts`：创建 registry；`createAgentToolHostDependencies` 传 `compositeTerminalManager`、`sshManager`、`sshTerminalRegistry`
- [x] `paseo-tools.ts`：deps 类型扩展；`TerminalSummarySchema` 富化（抽到共享 `terminal-summary.ts` 避免循环引用）；`toTerminalSummary` helper；list/create 共用；capture exited 回退 `exitInfo.lastOutputLines`（比计划的"仅 note"更好——退出时抓的最后 12 行是真实数据）
- [x] 测试：`ssh-terminal-registry.test.ts` 新建（3 用例）；`mcp-server.test.ts` 补 list 富字段/exited 回退

## P2 SSH 工具

- [x] 新建 `packages/server/src/server/agent/tools/ssh-tools.ts`（注入式注册，仿 browser 工具）
- [x] `list_ssh_hosts`（白名单投影 + activeTerminalIds）
- [x] `connect_ssh_host`（hostId/hostLabel 解析、outcome 映射、progress 尾部 20 行、不收 password、focus 参数）
- [x] `paseo-tools.ts`：`if (sshManager)` 门控调用注册
- [x] 测试：gating / 投影脱敏 / label 连接+focus / mismatch 无信任出口 / 多义 label

## P3 命令执行

- [x] 新建 `run-terminal-command.ts`。⚠️ 实现中发现计划缺陷：capture 的 totalLines 含完整可视网格行，短输出不改变行数——"从基线 totalLines 切片"取空。已改为**基线/结果行内容前缀 diff**（trimTrailingBlankLines + 最长公共行前缀），parity e2e 用真实 zsh 验证通过（OSC 路径 exitCode=0）
- [x] `paseo-tools.ts` 注册 `run_terminal_command`；`send_terminal_keys` keys 支持数组（union）
- [x] 测试：OSC 精确 / quiet 兜底 / timeout 不 kill / exited 拒绝；parity e2e 补真实回路用例

## P4 打开/聚焦 tab

- [x] `messages.ts`：`TerminalRevealSchema`（"terminal.reveal"）入 `SessionOutboundMessageSchema`；`npm run build:client` 重新生成 AOT
- [x] `websocket-server.ts`：`broadcastTerminalReveal`（computeNotificationPlan(focusTarget:null) 选 presence 最活跃客户端 shouldFocus）
- [x] `bootstrap.ts`：host deps 增 `revealTerminal`（懒取 wsServer）
- [x] `paseo-tools.ts`：`open_terminal_tab` 工具（delivered 语义）；`create_terminal`/`connect_ssh_host` 增 `focus?`
- [x] `session-context.tsx`：订阅 terminal.reveal；纯逻辑抽 `app/src/utils/handle-terminal-reveal.ts` + 4 用例单测（合成 workspace 不导航）

## 收尾

- [x] `public-docs/mcp.md` 更新（Terminals 表 + SSH 小节）
- [x] 新增 `docs/ssh-terminal-mcp.md` + 根 CLAUDE.md 表登记
- [x] typecheck（全仓库）/ lint（0 错误）/ format:files（只格式化本任务文件）
- [x] e2e：mcp-parity.e2e.test.ts 真实 daemon+zsh+HTTP MCP 回路验证 run_terminal_command
- [x] 既有失败排查：parity 的 `update_agent updates name and labels` 在 HEAD 版 paseo-tools 下同样失败——基线既有问题，与本任务无关
- [x] 多代理对抗评审工作流（正确性/并发/协议安全 ×2 反驳投票）
- [ ] 提交（工作区混有其他并行工作改动，提交范围待与用户确认）
- [ ] 真实 SSH 主机连接 + app tab 自动打开的人工验证（需要用户环境里的真实主机/凭据）

## 验证命令备忘

- `npx vitest run src/server/agent/mcp-server.test.ts --bail=1`（packages/server）
- `npx vitest run src/ssh/ssh-terminal-registry.test.ts --bail=1`
- `npx vitest run src/server/agent/mcp-parity.e2e.test.ts -t "run_terminal_command"`
- `npx vitest run tests/validation/ws-outbound.test.ts --bail=1`（packages/protocol）
- `npx vitest run src/utils/handle-terminal-reveal.test.ts --bail=1`（packages/app）
