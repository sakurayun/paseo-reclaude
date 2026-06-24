# Paseo 网状群聊：多模型协同讨论 daemon 特性

## Goal

在 Paseo daemon 中**原生支持**"网状群聊"：多个不同提供方/模型的 agent 对同一问题进行协同讨论，**每个参与者都能看到并回应其他参与者**，并能在有界轮次内收敛。由 daemon 拥有房间状态与发言权策略，而非纯客户端/纯 MCP 编排。

## Background / 现状

- Paseo 已内置 chat room 子系统：`FileBackedChatService`（`packages/server/src/server/chat/chat-service.ts`，落盘 `$PASEO_HOME/chat/rooms.json`）、`@mention` 星形扇出（`chat-mentions.ts` 的 `notifyChatMentions`/`expandChatMentionTargets`，上限 `CHAT_MENTION_FANOUT_LIMIT=25`）、per-room 等待器（`waitForMessages`/`notifyWaiters`）。
- 消息注入链路成熟且被多处复用：`sendPromptToAgent → startAgentRun → streamAgent/replaceAgentRun → session.startTurn()`，文本裹 `<paseo-system>` 信封（`formatSystemNotificationPrompt`/`isSystemInjectedEnvelope`）。
- **缺口**：没有网状语义（成员人人互见）、没有轮次/发言权控制、没有独立性保证（先收齐再揭晓）、没有防活锁机制。且对**运行中**的 agent 投递是"打断并替换"（`replaceAgentRun → session.interrupt`），直接做全员即时扇出会活锁 + 成本爆炸。

## Requirements

### 功能需求
- **R1 服务端拥有的群聊房间**：扩展现有 room，含成员集合、顺序化 transcript（每条带单调 `seq`）、`round` 轮次状态、`turnMode`。状态跨客户端断连与 daemon 重启存活。
- **R2 agent 侧 MCP 工具**：`groupchat_post`（发言）、`groupchat_await`（阻塞读，按 seq 游标）、`groupchat_round`（开一个"先收齐再揭晓"的回合）。
- **R3 两种发言模式**：
  - `round-barrier`：同一 prompt 发给全体，服务端扣住各自回答直到全部到齐（或超时）再原子揭晓——保证答案**相互独立、不被带偏**（多 agent 投票/评审场景）。
  - `free-mesh`：即时扇出的自由讨论，但受空闲门控与跳数预算约束。
- **R4 投递正确性**：**绝不打断正在运行的 agent**。忙时把 peer 消息排进该成员的 per-room outbox，待其转 idle 后**合并成一条 digest** 注入。
- **R5 防活锁 / 控成本**：per-room `maxRounds` 跳数预算 + 成员/扇出上限 + 静默检测（某代无新消息即判收敛、停止自动扇出）。
- **R6 人类旁观**：客户端可订阅房间、按 `seq` 游标分页查看 transcript，reconnect 后能检测 gap。
- **R7 多提供方参与者**：参与者可分别是不同 `provider/model`（claude / codex / copilot / opencode / pi / 自定义）。

### 非功能 / 约束
- **协议向后兼容（协议契约，硬约束）**：所有新增 schema 字段 `.optional()`/`.default()`；不得把 optional 翻成 required、不得收窄类型；移除字段仍可解析。6 个月旧客户端能解析新 daemon 的房间消息；旧 daemon 不发 `groupchat.*` 时新客户端把特性关掉。
- **特性契约（per-feature）**：整个特性由单一能力位 `server_info.features.groupChat` 门控，配 `// COMPAT(groupChat)` 标记；**无降级回退路径**（老 daemon 上不模拟网状，提示"升级宿主"）。
- **最大化复用**：复用既有 chat/mention/注入/持久化/pub-sub/MCP 注册机制，净新增控制在最小集。
- **显式拒绝**：不实现"无界全员互相打断"模式——该模式会活锁，不作为可选项。
- **新 RPC 命名**：点分命名空间 `groupchat.<resource>.<verb>.request/.response`（见 `docs/rpc-namespacing.md`）。

## Out of Scope（本任务不做）
- app 端富 UI（群聊面板、可视化轮次）——可后续单独任务；本任务交付 daemon + 协议 + client SDK 方法 + 最小可验证路径。
- 内置 LLM "主持人/裁判"智能——收敛用确定性规则；需要裁判时由某个 agent 自行充当。
- relay / 远程访问特定改造——沿用既有传输与 `Session.emit → websocket broadcast`，不新增 WS 传输层。
- 历史 transcript 跨房间检索 / 全文搜索。

## Acceptance Criteria

按实现阶段逐项可独立验证（详见 `implement.md`）：

- [ ] **Phase 0**：旧 `rooms.json`（无 `seq`/`round`/`participants`）仍能经 Zod 默认值加载；新增 schema 通过 `typecheck`；新旧双向 parse 往返测试通过。
- [ ] **Phase 1**：2-agent 房间内 `groupchat_post` 一条消息 → 另一 agent 收到 `<paseo-system>` 注入，且对应 transcript 行原子落盘。
- [ ] **Phase 2（活锁修复）**：向"正在跑"的 agent 快速连发 5 条 → 它转 idle 时**恰好**被注入一条合并 digest，且其在途 turn **未被打断**。
- [ ] **Phase 3（round-barrier）**：3 个 agent 开一回合 → 揭晓前任一参与者都看不到他人回答；全部提交或超时后，所有回答在同一 `round R` 原子出现，开局者经 `<paseo-system>` 收到揭晓通知。
- [ ] **Phase 4**：free-mesh 模式下一颗种子消息自限于 `maxRounds` 代后停止自动扇出；旁观 web 客户端在 reconnect 后用 seq 游标分页正确读取且能检测 gap。
- [ ] **Phase 5**：@everyone 成员上限生效；ineligible/error/closed 成员不会让 barrier 死锁；重启后未投递消息能按持久化的 per-member 已投递 seq 游标重放恢复；`docs/` 增补轮次模式与 COMPAT 清理日期说明。
- [ ] 全程 `npm run typecheck` / `npm run lint` 通过；改动文件的针对性 vitest 通过；最终在 CI 验证而非本地跑全量。

## App UI（本任务新增范围）

> 群聊的 app 端 UI 纳入本任务范围。UI 依赖 daemon 的 `groupchat.*` RPC，故在实现顺序上排在 daemon 阶段之后（见 `implement.md`）。详细 UI 技术设计见 `ui-design.md`。

### UI 目标
- 适配 fork「新主题」（浮动白卡 + #fafafa 底 + 无分隔线），与既有 app **美观/高效/统一**。
- **最大化复用**既有组件：`agent-stream` 流、`message.tsx` 渲染、`subagents/track.tsx` 名册、`composer`、`provider-icons`、`StatusBadge`/`AgentStatusDot`/`LoadingSpinner`、tab/布局/跨端同步。
- 净新增控制在最小：`RoomPanel`、`ParticipantRoster`、`MessageAuthorChip`、`RoundDivider/BarrierRow`、`RoomComposerControls` + `WorkspaceTabTarget` 一个联合成员。

### UI 决策日志（brainstorm 逐题敲定）
- **D1 默认轮次模式** = Round-robin 默认（`maxRounds=2`），**允许中途切换**（模式变更自下一轮生效）。渲染需处理"流中途变更机制"的边界。
- **D2 谁发言** = 固定班底（所选参与者每轮全发）；不做动态路由。名册提供 per-参与者"本轮跳过 / 静音"显式控制（是名册的主操作之一）。

