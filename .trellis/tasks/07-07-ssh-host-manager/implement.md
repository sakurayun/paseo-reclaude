# 执行计划 — Paseo 内建 SSH 主机管理器

父任务只做任务图与集成验收；实现落在 6 个子任务，按序执行（P2 依赖 P1；P3 依赖 P1+P2；P4/P5 依赖 P3 骨架；P6 依赖 P2）。

## P1 协议 + store + RPC 骨架（07-07-p1-protocol-store-rpc）

- [ ] `packages/server/package.json` 加依赖：ssh2@^1.17.0、@types/ssh2(dev)、socks@^2.8.3、iconv-lite@^0.6.3；npm install
- [ ] `packages/protocol/src/messages.ts`：SSH 段全部 Info schema + RPC + changed 推送 + inbound/outbound union 注册 + `features.sshHosts`（COMPAT 注释）
- [ ] `npm run generate:validators -w @getpaseo/protocol` 再生成 AOT
- [ ] `packages/server/src/ssh/`：5 个 store（host/key/known-host/forward/log，照 port-forward-manager；secrets/keys 用 writePrivateFileAtomicSync 0o600）+ 单测
- [ ] `ssh-session-controller.ts`：CRUD dispatch 全通，connect 暂返回 not_implemented
- [ ] bootstrap.ts 实例化注入；session.ts dispatch 接线 + 5 个 subscribeChanged → emit changed；websocket-server.ts 置 `sshHosts: true`
- [ ] `packages/client/src/daemon-client.ts`：22 个方法
- [ ] 验证：`npm run typecheck`；`npx vitest run packages/protocol/src/messages.test.ts packages/protocol/tests/validation/ws-outbound.test.ts packages/server/src/server/wire-compat.test.ts --bail=1`；5 个 store 单测（宽容解析/0600 权限/串行写）；`npm run lint`

## P2 ssh2 连接与终端桥接（07-07-p2-connection-terminal-bridge）

- [ ] terminal.ts：TerminalBackend 接口 + createPtyBackend 提取 + 6 触点改造（保持行序少动）
- [ ] terminal-manager.ts createTerminal options 加可选 backend 透传
- [ ] ssh-connection.ts / ssh-connection-pool.ts / ssh-connect-config.ts（chain/proxy/TOFU hostVerifier/agent）
- [ ] ssh-terminal-backend.ts（charset iconv stream decoder + backspace 改写 + setWindow + close→exit 映射）
- [ ] ssh-terminal-manager.ts + terminal/composite-terminal-manager.ts + bootstrap :540 注入替换
- [ ] connect RPC 实装（含日志 append connected/failed/closed；host_key_mismatch 结构化错误）
- [ ] ssh-platform-detect.ts（exec os-release → 回写 host.platform → 推送）
- [ ] 验证：`npx vitest run packages/server/src/terminal/terminal.test.ts packages/server/src/terminal/terminal.posix.test.ts packages/server/src/terminal/terminal-manager.test.ts packages/server/src/terminal/worker-terminal-manager.test.ts packages/server/src/terminal/terminal-session-controller.test.ts --bail=1`；新增 ssh-terminal-backend.test.ts（假 duplex）；docker sshd 手动连通验证

## P3 侧边栏 + 主机 UI + 内嵌终端（07-07-p3-sidebar-hosts-ui）

- [ ] sidebar-view-store 加 sidebarContentMode + setter（persist）
- [ ] left-sidebar.tsx：2 处入口替换（features.sshHosts 门控，否则保留 schedules）+ 4 处列表分叉；sidebar-sessions-toolbar.tsx onSsh
- [ ] components/sidebar/sidebar-ssh-list.tsx（5 入口 + 分组主机列表 + OS 图标占位）
- [ ] app/ssh.tsx + _layout.tsx 注册（Stack.Protected + shouldShowAppChrome）
- [ ] screens/ssh/ssh-screen.tsx + ssh-hosts-section.tsx（卡片网格）+ ssh-terminal-area.tsx + stores/ssh-terminals-store.ts
- [ ] terminal-pane.tsx 加 localFileLinks / paletteOverride 可选 prop
- [ ] use-ssh-hosts.ts 等数据 hooks；i18n `ssh.*` 8 语言
- [ ] 验证：typecheck + `npm run lint`；`npx vitest run packages/app/src/i18n/resources.test.ts --bail=1` + terminal-pane 相关回归；web+Electron 手动：切换往返、连接 docker sshd、resize/中文/退出重连；确认 SSH 终端不泄漏进 workspace 终端列表

## P4 编辑面板全字段（07-07-p4-host-edit-form）

- [ ] ssh/ssh-host-form-model.ts（先写 .test：disclosure/编辑种子/submit payload 全覆盖）
- [ ] use-ssh-host-form-model.ts + components/ssh/ssh-host-form.tsx（桌面 pane / compact sheet 共用；分节：基本/凭据/连接/终端）
- [ ] 分组管理（ssh.host_groups.*）+ tags chips
- [ ] 验证：form-model 单测；手动 create/edit 不串味（forms.md 生命周期）；changed 推送即时反映

## P5 密钥库 + 指纹 + 日志 + 转发 UI（07-07-p5-keychain-knownhosts-logs-forwards）

- [ ] ssh-keychain-section + ssh-key-form（导入走 expo-document-picker / web input file）
- [ ] ssh-known-hosts-section + 指纹不匹配对话框 + known_hosts 导入
- [ ] ssh-logs-section 表格
- [ ] ssh-forward-runtime.ts（daemon：local/remote/dynamic + 状态机 + 退避重连）+ ssh-forwards-section UI
- [ ] 验证：ssh-forward-runtime.test.ts（三型各一，本机 sshd + echo server）；手动 -L curl 通、指纹篡改被拒可更新

## P6 降级 + 打磨（07-07-p6-fallback-polish）

- [ ] buildFallbackSshArgv + 临时私钥 0o600 落盘/清理 + mosh 缺失文案
- [ ] OS 图标全套 11 个 + os-icons.ts 映射
- [ ] 空态/加载态/日志上限/tweetnacl 加密 TODO 注释
- [ ] 验证：手动 mosh / sk- 密钥走系统 ssh；全量 typecheck + lint + format

## 通用验证命令

- `npm run typecheck` / `npm run lint` / `npm run format`（每步必跑前两个）
- 跨包类型报错先 `npm run build:client` / `npm run build:server`
- 测试只跑指定文件：`npx vitest run <file> --bail=1`
- 端到端：`docker run -d -p 2222:2222 -e USER_NAME=test lscr.io/linuxserver/openssh-server` + `npm run dev` + `npm run dev:app` / `npm run dev:desktop`

## 回滚点

- 每个子任务一个 commit（中文提交信息）；terminal.ts backend 抽象单独 commit（P2 内第一个），出问题可独立 revert。
- feature flag 关闭（websocket-server sshHosts 不置 true）即可整体隐藏功能。
