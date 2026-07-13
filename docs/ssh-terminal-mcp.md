# SSH + 终端 MCP 面（fork 定制）

让 AI 代理通过 Paseo MCP（`/mcp/agents`，注入名 `paseo`）管理 SSH 主机与终端：列主机、
建连接、开 tab、写命令、读输出/退出码。server 侧入口在
`packages/server/src/server/agent/tools/`（`ssh-tools.ts`、`run-terminal-command.ts`、
`terminal-summary.ts`），协议推送为 `terminal.reveal`。

## 架构决策

- **MCP 终端工具吃 compositeTerminalManager**。bootstrap 把合并了本地 worker 与
  in-process SSH 两个 manager 的 composite 注入 `PaseoToolHostDependencies.terminalManager`，
  于是 list/capture/send/kill 天然覆盖 SSH 终端；`createTerminal` 恒走本地（SSH 终端只
  经 `connect_ssh_host` → `sshManager.connectHandler` 创建）。
- **SSH 身份靠内存注册表**（`packages/server/src/ssh/ssh-terminal-registry.ts`）。终端
  记录不带 hostId；连接服务在 ssh2 与 fallback 两条成功路径 register
  `terminalId → {hostId, hostLabel, via}`，`terminal.onExit` 时 unregister。
  `list_terminals` 的 `kind`/`sshHostId` 与 `list_ssh_hosts` 的 `activeTerminalIds`
  都是对它的 join。daemon 重启即清空（与终端本身同生命周期）。
- **SSH 工具组条件注册**：`createPaseoToolCatalog` 里 `if (options.sshManager)`，与
  voice/browser 工具同一门控模式。

## terminal.reveal 推送（daemon → client 单向）

Tab 是纯客户端概念，daemon 只能"请求"打开。`open_terminal_tab` 工具与
`create_terminal`/`connect_ssh_host` 的 `focus: true` 都走
`websocket-server.broadcastTerminalReveal`：

- 广播给**所有**客户端（都要 `registerSshTerminal` 注册远程标签元数据）；
- 只有 presence 最活跃的客户端拿到 `shouldFocus: true`（复用
  `computeNotificationPlan`，focusTarget 传 null），避免全设备同时跳转；
- 返回值 = 是否选出了聚焦客户端，透出为 `open_terminal_tab.delivered`。

app 侧消费在 `session-context.tsx` 订阅簇，纯逻辑抽在
`app/src/utils/handle-terminal-reveal.ts`：合成 workspace（`ssh:<hostId>` /
`standalone:`）不导航（SSH 终端由全局 auto-open 集合拉起），真实 workspace 走
`navigateToPreparedWorkspaceTab`。老客户端对未知消息 safeParse 失败 warn+丢弃，无需
capability flag。

## run_terminal_command 的三层完成检测

1. **OSC 633 `D;<exitCode>`**（`session.onCommandFinished`）— 精确，仅 daemon 注入
   zdotdir 的本地 zsh（SSH 远端除非自带集成）。`completed: true`。
2. **输出静默 quietMs**（默认 1.5s）— 终端会回显命令本身，所以静默计时总能武装。
   `completed: false`。
3. **timeoutMs 兜底**（默认 30s）— **不 kill 不 Ctrl-C**，长任务可能还在跑。

监听先挂后发送（防快命令竞态）；输出增量 = 基线 `totalLines` 之后的 capture 切片，
scrollback（1000 行）+ 可视区达到容量时置 `truncated: true`（头部可能被环形淘汰）。
远端要精确退出码：`cmd; echo EXIT:$?`。

## 安全红线

- `list_ssh_hosts` 是白名单投影：`startupSnippet`、`env`、`proxy` 细节与一切 secret
  不出网。
- `connect_ssh_host` 不收 password；auth_failed 指引去客户端保存凭据。
- host_key_mismatch 只回指纹（不含 publicKeyBase64），**没有 MCP 端 TOFU 信任工具**，
  信任决策必须由人在客户端 Known Hosts 完成。

## 陷阱

- exited 终端的 scrollback 随 worker 会话释放；`capture_terminal` 对 exited 终端回退
  到 exit info 的 `lastOutputLines`（最多 12 行，退出时抓取）并附 `note`。别试图从
  镜像 `record.state` 回放——那是订阅回放时刻的陈旧快照。
- 同一终端并发 `run_terminal_command` 会互相污染基线与完成信号，首版不加锁，工具
  description 已声明 one command at a time。
- Mosh/FIDO2 主机走系统 ssh fallback（本地 pty），注册表 via="fallback"；它们没有池化
  ssh2 连接，SFTP/端口转发类能力不可用，但终端读写与本地终端完全一致。
