# 技术设计 — Paseo 内建 SSH 主机管理器

> 完整批准版计划：`/Users/suanshu/.claude/plans/optimized-jingling-axolotl.md`（本文件为其技术设计部分的权威拷贝）。

## 架构总览

```
app (Expo)                          daemon (packages/server)
┌─ 侧边栏 sidebarContentMode ─┐      ┌─ ssh/ (fork-owned 新目录) ────────────┐
│  sessions ↔ ssh 原地切换    │ RPC  │ 5 个 store（hosts/keys/known/fwd/log）│
│  SidebarSshList (5入口+主机) │◄────►│ ssh2 连接池（终端/exec/转发共享连接） │
├─ /ssh 主面板 ───────────────┤ push │ SshTerminalBackend → 主进程 in-process │
│  卡片网格│编辑pane│内嵌终端  │      │ TerminalManager，与 worker manager 用 │
└─────────────────────────────┘      │ composite 合并 → 既有终端传输零改动   │
                                     └───────────────────────────────────────┘
```

关键已核实事实：现有终端跑在 fork 的 worker 进程（`terminal-manager-factory.ts` → `createWorkerTerminalManager`）；`terminal.ts` pty 触点 6 处（spawn :958、onData :1191、onExit :1218、write :1294、resize :1332、kill :1480 + DA1/OSC 应答写回）；app 端 `TerminalPane` 不依赖 workspace store。

## 1. 数据模型（PASEO_HOME 6 个文件，Zod schema 在 protocol 包）

| 文件 | 内容 | 写入方式 |
|---|---|---|
| `ssh-hosts.json` | groups + hosts（label/address/port/groupId/tags/username/hasPassword/keyId/useAgent/useFido2/backspaceMode/agentForwarding/startupSnippet/chainHostIds/proxy/env/charset/mosh/terminalThemeId/platform/createdAt/updatedAt） | writeJsonFileAtomic |
| `ssh-secrets.json` | hostPasswords/proxyPasswords（密码只上行不下行，wire 层只有 hasPassword；update 请求 `password?: string \| null`，null=清除，undefined=不变） | **writePrivateFileAtomicSync 0o600** |
| `ssh-keys.json` | 密钥库（label/privateKey/publicKey/certificate/passphrase）；wire 下行仅元数据（keyType/hasCertificate/hasPassphrase） | **0o600** |
| `ssh-known-hosts.json` | host/port/keyType/fingerprintSha256/publicKeyBase64/firstSeenAt/lastSeenAt/source(tofu\|imported) | atomic |
| `ssh-forwards.json` | per-host 规则（type local/remote/dynamic、bindAddress、listenPort、targetHost/Port、autoStart）；运行态（stopped/starting/active/error）不持久化随推送下发 | atomic |
| `ssh-logs.json` | 环形 500 条（hostId/hostLabel/username/address/port/protocol ssh\|mosh/startedAt/endedAt/durationMs/status/error） | atomic |

store 实现照抄 `packages/server/src/port-forward/port-forward-manager.ts`（Map + 宽容解析 + persistQueue 串行化 + subscribeChanged）。

**host → ssh2 ConnectConfig 映射**（`ssh/ssh-connect-config.ts` 单一函数 `resolveSsh2ConnectConfig(host, deps): Promise<{config, dispose()}>`）：
- chainHostIds：递归 hop，`hopClient.forwardOut("127.0.0.1", 0, next, port)` 得 stream 作下一跳 `sock`；dispose 反序关闭。
- proxy：`socks` 包（socks4/5）/ 手写 HTTP CONNECT 建首跳 sock。
- known-hosts：`hostVerifier`（TOFU：首见记录放行；不匹配拒绝并暂存观测指纹供 UI）。
- charset：iconv-lite 在 backend 数据路径双向转码（stream decoder 防多字节切包）。
- env：`shell({env})`（sshd AcceptEnv 受限时降级 snippet 前置 `export K=V;`）。
- startupSnippet：shell 建立后 `channel.write(snippet+"\n")`。
- backspaceMode：输入路径 `\x7f`↔`\x08` 改写（仅 ctrl-h 模式启用）。
- useAgent：`agent: SSH_AUTH_SOCK`（win32 用 openssh-ssh-agent pipe）；agentForwarding → `agentForward: true`。

**降级路径**：mosh=true 或 useFido2=true（ssh2 不支持 sk-）→ 走现有 worker 终端 spawn 系统 `mosh`/`ssh`（`buildFallbackSshArgv`：-p/-J/-i 临时密钥 0o600 落盘用后即删/-o SetEnv；mosh 用 `--ssh="ssh -p N -i …"`）。此路径不支持 http/socks proxy 与 daemon 侧 known-hosts 钩子（交给系统 ssh），UI 注明。

## 2. daemon 端

**新目录 `packages/server/src/ssh/`**（全 fork-owned）：
ssh-host-store / ssh-key-store / ssh-known-host-store（含 ~/.ssh/known_hosts 导入解析，hashed 行忽略记 warning）/ ssh-forward-store / ssh-log-store / ssh-connect-config / ssh-connection / ssh-connection-pool（按 hostId 引用计数复用，0 时延迟关闭）/ ssh-terminal-backend / ssh-terminal-manager / ssh-forward-runtime / ssh-platform-detect / ssh-session-controller + 各自 .test.ts。

**terminal.ts backend 抽象**（唯一实质改动的 upstream 终端文件）：

```ts
export interface TerminalBackend {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
  onData(l: (data: string) => void): void;
  onExit(l: (e: { exitCode: number | null; signal: number | null }) => void): void;
  waitForStart?(): Promise<void>;
}
```

:958 spawn 段提取为 `createPtyBackend(options)`；`options.backend ?? createPtyBackend(...)`；6 触点改调 backend；headless xterm/scrollback/DA1/OSC/activity 全复用。

**SSH 终端走主进程**（不进 worker）：TOFU 回调、exec 平台检测、转发、日志需与 ssh2 Client 同进程同连接；复用 `terminal-manager.ts` 的 in-process `createTerminalManager`（createTerminal options 加可选 `backend`）。新增 `terminal/composite-terminal-manager.ts` 合并 worker 与 ssh 两个 manager（按 id 路由、列表合并、createTerminal 只走 primary），bootstrap.ts :540 替换注入 → subscribe_terminal/输入/二进制流/kill 零改动生效。

**connect 流程**（`ssh.hosts.connect.request {hostId, cols?, rows?}`）：取 host →（mosh/FIDO2 降级）→ 池取连接（TOFU + 日志）→ shell() → backend → createTerminal（cwd=PASEO_HOME/ssh，workspaceId=`ssh:<hostId>`）→ 异步平台检测（`cat /etc/os-release || uname -s`）回写并推送 → 响应 terminalId。指纹不匹配：结构化 error `host_key_mismatch` + 观测指纹，UI 确认 → `ssh.known_hosts.update` → 重连。

**转发 runtime**：local=net.createServer→forwardOut pipe；remote=forwardIn+"tcp connection"→net.connect；dynamic=自维护最小 SOCKS5（仅 CONNECT、无认证，~150 行）；状态随 `ssh.forwards.changed` 推送；断连→error，autoStart 指数退避（上限 5 次）；daemon 关闭 dispose 全部。

**依赖**：`ssh2@^1.17.0`、`@types/ssh2`(dev)、`socks@^2.8.3`、`iconv-lite@^0.6.3`。

## 3. protocol + client

- `messages.ts`（Port Forward 段 :2490-2559 后新增 SSH 段）：Info schema + RPC `ssh.hosts.list/create/update/delete/connect.request/.response`、`ssh.host_groups.*`、`ssh.keys.*`、`ssh.forwards.*（含 start/stop）`、`ssh.known_hosts.*（含 import）`、`ssh.logs.list`；推送 `ssh.hosts.changed`/`ssh.keys.changed`/`ssh.forwards.changed`/`ssh.known_hosts.changed`。inbound union :2561、outbound union :5246 注册。
- 红线：无 transform/catch/preprocess；discriminatedUnion；default 仅原始叶子；新字段全 optional。
- feature flag：`features.sshHosts: z.boolean().optional()` + `// COMPAT(sshHosts): fork feature, added in v0.1.x`；websocket-server.ts :1394 附近置 true。
- AOT：`npm run generate:validators -w @getpaseo/protocol`。
- `daemon-client.ts`（:4914 后）：22 个方法（listSshHosts…listSshLogs），事件走 `client.on("ssh.hosts.changed")`。

## 4. app 端

**侧边栏**：`stores/sidebar-view-store.ts` 加 `sidebarContentMode: "sessions" | "ssh"`（照 groupMode，persist）；left-sidebar.tsx 入口替换（classic 桌面 :1161 / 移动 :935；new-theme 在 sidebar-sessions-toolbar.tsx :94-103）；4 处列表分叉（:917/:1143/:976/:1184）包三元；新建 `components/sidebar/sidebar-ssh-list.tsx`（5 入口 SidebarHeaderRow compact：Server/KeyRound/ArrowLeftRight/Fingerprint/ScrollText → `/ssh?section=…`；主机列表按分组，单击 → `/ssh?section=hosts&connect=<hostId>`）。

**主面板 `/ssh`**：`app/ssh.tsx` 薄壳（照 app/schedules.tsx）；`_layout.tsx` `<Stack.Protected>` :981 注册 + shouldShowAppChrome :909-915；`screens/ssh/ssh-screen.tsx` 读 `?section&connect`，`useIsCompactFormFactor()` 单点分叉（桌面 = 主体 + 右 detail pane；compact = 全屏 + AdaptiveModalSheet）。sections：hosts 卡片网格（照 open-project-screen.tsx :216-241 tiles）/ keychain / forwards / known-hosts / logs。`ssh-terminal-area.tsx` 多连接 tab（`stores/ssh-terminals-store.ts`）+ 内嵌 `<TerminalPane>`；terminal-pane.tsx 仅加 `localFileLinks?: boolean` 与 `paletteOverride` 两个可选 prop。数据 hooks 照 use-port-forwards.ts。

**编辑面板**：docs/forms.md 三件套 `ssh/ssh-host-form-model.ts`(+test) + `use-ssh-host-form-model.ts` + `components/ssh/ssh-host-form.tsx`。分节：基本（Address/Label/Parent Group/Tags）→ 凭据（用户名/密码/私钥 SelectField/证书状态/FIDO2/Agent Forwarding）→ 连接（端口/Host Chaining 有序多选/Proxy disclosure/Mosh）→ 终端（Backspace SegmentedControl/字符集/主题/Startup Snippet/环境变量 KV）。FIDO2/Mosh 开启时 disclosure 提示降级。控件复用 ui/form-field、select-field、combobox、switch、segmented-control、AdaptiveModalSheet。

**OS 图标**：components/icons/ 新增 11 个发行版 icon（react-native-svg，照 claude-icon.tsx）+ `components/ssh/os-icons.ts` 映射（照 provider-icons.ts，兜底 linux）。

**i18n**：8 个 resources/*.ts 加 `ssh.*` 分组。

## 5. 风险与对策

1. ssh2 channel 无 pty 语义：exitCode 缺失（close 补 null）、setWindow 无回执、无 pid（waitForStart 直接 resolve）、stderr 独立流合并、断线≠退出（UI 文案区分「连接断开」）。
2. upstream merge 冲突面收敛到 8 个共享文件（terminal.ts 最大点，提取 createPtyBackend 少动行序；messages.ts 段尾追加；session/bootstrap/websocket-server 各一小段；left-sidebar 4 分叉本体外置；_layout 两行；terminal-pane 两个可选 prop）。
3. 协议兼容：全走 `sshHosts` 门控；旧 daemon 显示原定时任务入口，无 fallback 路径。
4. 安全：密钥/密码 0o600 明文落盘（与 reclaude-credentials 同水位），永不下行；错误信息过滤密码；TOFU 首连指纹 UI 可核对；留 tweetnacl 加密 TODO。
5. SSH 终端泄漏进 workspace 终端列表：客户端按 `workspaceId.startsWith("ssh:")` 过滤，P3 手动验证；若泄漏在 composite manager list 路径按调用方过滤。
6. 连接池生命周期：终端关闭但转发活跃时引用计数保活；daemon 重启 SSH 终端丢失（与本地终端同语义），autoStart 转发重建。
