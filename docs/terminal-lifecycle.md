# Terminal lifecycle（fork 定制）

终端不再是"退出即消失"。生命周期分三层，全部由 daemon 侧镜像（`worker-terminal-manager.ts`）拥有：

1. **running** — 正常运行。worker 进程持有 PTY，镜像持有元数据。
2. **exited（保留态）** — PTY 退出后 worker 删除会话，但镜像**保留**记录并标记
   `status: "exited"` + `exitCode` + `endedAt`，继续出现在 `list_terminals` /
   `terminals_changed` 里，直到被显式关闭。每个 cwd 最多保留
   `MAX_EXITED_TERMINALS_PER_CWD`（10）个，溢出的最旧条目直接进入历史。
3. **closed（历史）** — `kill_terminal` / `killTerminalAndWait`（含工作区归档）把条目
   从镜像移除，并通过 `onTerminalClosed` 回调写入
   `$PASEO_HOME/terminal-history.json`（`FileBackedTerminalHistoryStore`，上限 200 条，
   原子写）。新 RPC `terminal.history.list.request/response` 列出历史；"找回" 是客户端
   语义——按历史条目的 cwd/name 重新 `create_terminal`。

## 协议要点

- `TerminalInfoSchema` 新增可选 `status` / `exitCode` / `endedAt`；缺失 status 视为
  running（旧 daemon 兼容）。
- wire 上的终端条目重新携带可选 `cwd`（`TerminalInfoWireSchema`）——主机级列表需要它
  来做侧栏项目归组。
- **主机级订阅**：`subscribe_terminals_request` / `list_terminals_request` 的 `cwd: ""`
  表示"整机全部终端"。controller 对 `""` 订阅在任何 cwd 变化时都推送全量快照
  （payload cwd 为 `""`）。客户端复用 `workspaceTerminals` push 路由（route.cwd `""`
  时不做 workspaceId 过滤），入口是 `useHostTerminals()`。
- 能力门：`server_info.features.terminalLifecycle`（COMPAT v0.1.124）。旧 daemon 上
  侧栏终端列表与历史区整体隐藏。

## 客户端语义

- **侧栏**：`assignTerminalsToSidebarGroups()` 先按 workspaceId、再按 cwd 祖先/后代
  把终端归入项目分组；图标三色 = 运行中（绿）/ 非零退出（红）/ 正常退出（灰）。
  `standalone:` 前缀的 workspaceId 是 daemon 分组用的假 id，不能用于导航。
- **Tab 关闭弹窗**（`CloseTabChoiceSheet`）：agent tab = 关闭标签（仅布局）vs 归档；
  terminal tab = 关闭标签（终端继续跑、留在侧栏）vs 彻底关闭（kill → 历史）。
  注意：关闭 terminal tab 从"总是 kill"改成了"默认保留终端"。
- **历史找回**：sessions 面板开启"显示已归档"后出现"已关闭的终端"区，"恢复"按钮在原
  cwd 重建终端并打开其 tab。

## 陷阱

- daemon 重启后 exited 保留态丢失（仅内存）；历史文件仍在。
- 点开一个 exited 终端的 tab 走原有"进程已退出"路径，scrollback 已随 worker 会话释放，
  不能回放。
