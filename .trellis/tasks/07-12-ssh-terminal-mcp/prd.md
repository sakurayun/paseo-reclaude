# SSH+终端能力 MCP 化

## Goal

把 fork 的 SSH 主机管理器与终端子系统暴露为 Paseo MCP 工具，让 AI 代理能够：列出 SSH 主机 → 建立 SSH 连接/新建终端 → 让 app 打开对应终端 tab → 往任意（SSH/本地）终端写入命令 → 读取任意范围输出与命令执行结果 → 识别当前已打开的 SSH/本地终端。

## Requirements

1. 现有 5 个终端 MCP 工具（list/create/kill/capture/send_keys）必须覆盖 SSH 终端（换用 compositeTerminalManager）。
2. `list_terminals` 输出富化：workspaceId、title、status(running/exited)、exitCode、activity、kind(local/ssh)、sshHostId/sshHostLabel。
3. 新增 `list_ssh_hosts`：脱敏白名单投影（禁止输出 startupSnippet/env/proxy 细节/任何 secret），含 auth 摘要与 activeTerminalIds。
4. 新增 `connect_ssh_host`：按 hostId 或 hostLabel 连接；不接受 password 参数；auth_failed/host_key_mismatch 返回诊断（指纹+指引），不提供 MCP 端 TOFU 信任。
5. 新增 `run_terminal_command`：发送命令并等待完成（OSC 633 精确 exitCode > quietMs 静默兜底 > timeout），返回增量输出。
6. `send_terminal_keys` 支持 token 数组（向后兼容字符串）。
7. 新增 `open_terminal_tab` + `create_terminal`/`connect_ssh_host` 的 `focus` 参数：daemon 推送 `terminal.reveal`，app 打开/聚焦对应终端 tab；SSH 元数据在所有客户端注册。
8. SSH 工具组按 `sshManager` 存在性条件注册。

## Acceptance Criteria

- [ ] SSH 连接建立后 `list_terminals {all:true}` 能看到 kind="ssh" + sshHostId 的条目；capture/send_keys/kill 对该 id 生效。
- [ ] `list_ssh_hosts` 返回主机与分组，零敏感信息出网。
- [ ] `connect_ssh_host {hostLabel, focus:true}` 成功后 app 自动打开该 SSH 终端 tab（presence 最活跃客户端聚焦，其余客户端注册 SSH 元数据）。
- [ ] `run_terminal_command` 本地 zsh 下拿到精确 exitCode；SSH 远端静默兜底返回输出，completed 字段区分。
- [ ] exited 终端 capture 返回 note 提示 buffer 已释放。
- [ ] 老客户端收到 `terminal.reveal` 不崩（warn+丢弃）；协议仅新增消息类型与 optional 字段。
- [ ] typecheck/lint 通过；新增/修改测试文件单独跑通（--bail=1）。

## Constraints

- 协议向后兼容（根 CLAUDE.md 协议契约）；wire schema 纯结构声明。
- 密码/私钥绝不经 MCP 出网。
- 不跑全量测试；单文件 vitest；P4 改 protocol 后先 `npm run build:client`。
- 不触碰 6767 生产 daemon。
- 工作区已有未提交改动（SSH connect 错误处理），叠加实现、不回退。

## References

- 已批准计划：/Users/suanshu/.claude/plans/shimmying-zooming-frog.md（含全部读码验证结论）
