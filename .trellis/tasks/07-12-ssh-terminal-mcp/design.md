# 技术设计：SSH+终端能力 MCP 化

完整验证过的设计见已批准计划 `/Users/suanshu/.claude/plans/shimmying-zooming-frog.md`。本文档记录边界、契约与关键取舍。

## 架构边界

```
MCP HTTP (/mcp/agents, Bearer token)
  └─ createPaseoToolCatalog(PaseoToolHostDependencies)
       ├─ terminalManager ← 改为 compositeTerminalManager（P1 根修复）
       ├─ sshManager（新增 dep，门控 SSH 工具组）
       ├─ sshTerminalRegistry（新增：terminalId → {hostId,hostLabel,via}）
       └─ revealTerminal 回调（P4，闭包懒取 wsServer）
```

- SSH 终端身份是隐式的（归属 in-process sshTerminalManager）；注册表在 `ssh-connect-service.ts` 两条成功路径（ssh2 / fallback）register，`terminal.onExit` unregister。fallback 终端建在 primary worker manager 上，同样登记。
- `terminal.reveal` 是 daemon→client 单向 push（`SessionOutboundMessageSchema` union 新成员），`shouldFocus` 语义仿 `terminal_attention_required.shouldNotify`：presence 最活跃客户端 true，其余 false（都要注册 SSH 元数据）。
- app 端消费点：`session-context.tsx` 订阅簇；导航复用 `navigateToPreparedWorkspaceTab`；SSH 元数据复用 `registerSshTerminal`；合成 workspace（`ssh:<hostId>`）只注册元数据不导航（由现有 SSH auto-open 集合拉起）。

## 数据契约（新/改 MCP 工具 schema）

- `TerminalSummarySchema` 扩展全 optional：`workspaceId,title,status,exitCode,activity,kind,sshHostId,sshHostLabel`。
- `list_ssh_hosts` → hosts 白名单投影 + `auth:{password,key,agent,fido2}` + `activeTerminalIds`；groups 原样（id,name）。
- `connect_ssh_host` → `{outcome, terminal?, error?, observedKey?{host,port,keyType,fingerprintSha256}, progress?}`；非 connected 置 isError 但保留 structuredContent。
- `run_terminal_command` → `{terminalId, completed, exitCode|null, output[], totalLines, truncated, durationMs}`。
- `open_terminal_tab` → `{success, delivered}`（delivered=false ⇒ 无活跃客户端）。

## 关键取舍（已定案）

1. exited 终端 capture 不做镜像快照 fallback（快照停留在订阅回放时刻，误导）→ 附 note。
2. connect 不收 password；无 MCP 端 TOFU 信任（安全红线）。
3. run_terminal_command 超时不 kill/不 Ctrl-C；per-terminal 并发不加锁（description 声明）。
4. 协议无 feature flag：MCP 工具自描述；push 老客户端 warn+丢弃（已验证 daemon-client safeParse 行为）。
5. composite 换入使 agent 内嵌工具目录与 archive kill 也触达 SSH 终端——有意为之，与 WS 客户端路径一致。

## 兼容性

- 仅新增消息类型 + optional 字段；AOT 校验器 prebuild 自动重生成；改 protocol 后必须 `npm run build:client` 再 typecheck。
- 上游合并注意：paseo-tools.ts / bootstrap.ts / session-context.tsx 是 upstream 文件，改动需在合并 playbook 中标记（fork 定制清单）。
