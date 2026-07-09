# P2 ssh2 连接与终端桥接

> 父任务：`.trellis/tasks/07-07-ssh-host-manager`（design.md 第 1、2 节 + implement.md P2 清单为权威）。**依赖 P1**（协议与 store 就绪）。核心风险阶段。

## Goal

实现 ssh2 连接层并桥接进现有终端管道：TerminalBackend 抽象、连接池、connect RPC 实装、TOFU 指纹钩子、连接日志、平台检测。

## Requirements

- `terminal.ts` 提取 `createPtyBackend`，新增 `TerminalBackend` 接口，6 个 pty 触点（spawn :958 / onData :1191 / onExit :1218 / write :1294 / resize :1332 / kill :1480）改调 backend；行序尽量少动（upstream merge 冲突面）。
- `ssh-connection` / `ssh-connection-pool`（hostId 引用计数）/ `ssh-connect-config`（chain=递归 forwardOut、proxy=socks 包或 HTTP CONNECT、hostVerifier=TOFU、agent/agentForward）。
- `ssh-terminal-backend`（charset iconv stream decoder、backspace 改写、setWindow、close→exit{null,null} 映射、stderr 合并）。
- SSH 终端走主进程 in-process manager；`composite-terminal-manager` 合并 worker manager，bootstrap 注入替换——既有 subscribe_terminal/输入/二进制流/kill 零改动生效。
- connect RPC：池取连接 → shell → backend → createTerminal（workspaceId=`ssh:<hostId>`）→ 异步平台检测回写推送；host_key_mismatch 结构化错误。
- 日志 append：connected / failed / closed（含时长）。

## Acceptance Criteria

- [ ] 终端 5 个既有测试文件回归通过（terminal / terminal.posix / terminal-manager / worker-terminal-manager / terminal-session-controller）。
- [ ] ssh-terminal-backend.test（假 duplex stream：数据/resize/exit/charset/backspace）通过。
- [ ] docker sshd 手动连通：密码 + 密钥两种认证；TOFU 首连记录指纹；platform 回写。
- [ ] typecheck + lint 全绿。
