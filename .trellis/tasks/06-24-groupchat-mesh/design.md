# 技术设计：Paseo 网状群聊

> 本设计完全对齐研究阶段在源码中核实的真实路径。引用文件/函数用于实现时定位，行号可能随代码漂移，以符号名为准。

## 1. 设计要旨（为什么"正确网状"必须有发言权策略）

投递进一个 agent 会话的真实链路：
`sendPromptToAgent`（`agent-prompt.ts`）`→ startAgentRun → streamAgent / replaceAgentRun`（`agent-manager.ts`）`→ session.startTurn()`。
当目标**正在运行**时，走 `replaceAgentRun → cancelAgentRun → session.interrupt()`（`agent-manager.ts`），即**打断并替换**，不是排队。

推论：若 N 个成员各自发言、每条扇给其余 N−1 个，只要有人在途，投递就打断其半成品发言；被打断者重生成又发一条 → 又打断别人 → **活锁 + 成本超线性**。

⇒ 唯一正确的网状 = **服务端拥有的房间 + 顺序 transcript + 服务端强制的发言权/轮次策略**，叠加在既有注入链路上。两种合法语义都要做，唯独"无界互相打断"显式不做：
- **round-barrier**（先收齐再揭晓）→ 独立性正确性。
- **free-mesh**（即时扇出）→ 空闲门控 + 跳数预算兜底。

## 2. 组件与边界

```
┌─────────────────────────── packages/server ───────────────────────────┐
│                                                                        │
│  GroupRoomService  (净新增,包住 FileBackedChatService)                  │
│   - 成员集 / round / turnMode / barrier 状态                            │
│   - seq 化 transcript(复用 chat 的 rooms Map + enqueuePersist + 原子写) │
│   - per-member outbox + per-member 已投递 seq 游标                       │
│        │ postMessage / openRound / awaitRound / fetchTranscript         │
│        ▼                                                                │
│  MeshDeliveryRouter  (净新增,薄路由,唯一行为增量)                       │
│   - recipients = 成员 − 作者  (复用 expandChatMentionTargets 剔除规则)   │
│   - hasInFlightRun() 忙检查 → 空闲即注入 / 忙则入 outbox + idle-waiter   │
│        │  复用既有注入链路                                               │
│        ▼                                                                │
│  notifyChatMentions 同路: sendAgentMessage → sendPromptToAgent          │
│        → startAgentRun → session.startTurn()  (文本裹 <paseo-system>)    │
│                                                                        │
│  MCP 工具(registerTool 工厂 + AgentMcpServerOptions DI,同 scheduleService)│
│   groupchat_post / groupchat_await / groupchat_round                    │
│                                                                        │
│  WS RPC 处理(session 内新 dispatch 分支)                                │
│   groupchat.room.* / message.post / round.* / transcript.fetch          │
│   groupchat.room.event(服务端推送给旁观客户端,经 Session.emit→broadcast) │
└────────────────────────────────────────────────────────────────────────┘
            │ 数据 schema(加性)                         │ 能力位
            ▼                                            ▼
   packages/protocol/src/groupchat/*  ,  messages.ts:  features.groupChat
            │ client SDK 方法
            ▼
   packages/client/src/daemon-client.ts
```

## 3. 投递机制（载荷部分，最关键）

一条 peer 消息到达其余 N 个 agent，**复用**既有链路，只加**一个新行为=忙检查**：

1. agent 调 `groupchat_post(room, body)`（或人类发 `groupchat.message.post.request`）。
2. `GroupRoomService.postMessage`：分配 `seq` → 追加 transcript 行 → 原子持久化（`enqueuePersist → persist → writeJsonFileAtomic`）→ 计算 `recipients = 成员 − 作者`（复用 `expandChatMentionTargets`，自动剔除自己/内部/已归档/error）。
3. `MeshDeliveryRouter.deliverToMembers`：对每个 recipient
   - `hasInFlightRun(recipientId)`（`agent-manager.ts`）== false（**空闲**）→ 立即注入：`sendAgentMessage → sendPromptToAgent`，文本裹 `formatSystemNotificationPrompt`（`<paseo-system>…</paseo-system>`，被 `isSystemInjectedEnvelope` 识别为系统注入而非用户轮次）——与今天 @mention / 定时器触发 / notify-on-finish **完全同一条路**。
   - **正在跑** → 消息进该成员的 per-room **outbox**，并注册一个 `AgentManager.subscribe({agentId, replayState:false})` idle-waiter（克隆 `setupFinishNotification` 的订阅范式，`agent-prompt.ts`）。成员 lifecycle 翻到 `idle` 时，waiter 把 outbox 里积压的多条 peer 消息**合并成一条 `<paseo-system>` digest** 一次性注入。
4. 人类**旁观**客户端：同样的 transcript 行经服务端推送 `groupchat.room.event`，走既有 `Session.emit → websocket broadcast`，**无需新 WS 层**。

> 第 3 步的忙检查 + outbox 合并，是把既有的"打断"语义转成"忙时排队 + 合并"，**这是阻断活锁的核心动作**，也是相对 @mention 扇出的唯一行为增量。

## 4. 发言权 / 轮次模式（服务端拥有，agent 不拥有）

### (A) round-barrier —— 独立性保证
- `groupchat_round({room, prompt, participants, barrier:true})` 开 round R。
- 服务端把**同一 prompt** 经注入链路发给所有 participant，但**揭晓被门控**：每个 participant 的回答（其下一条 `groupchat_post` 或其 finish-notification body）被收进 round 缓冲，**不投递给 peer**。
- 完成条件 = 每个**存活** participant 各提交一次 **或** round 超时（复用 chat waiter 超时机制）。
- 完成后服务端**原子地**把 N 条回答按 round R 追加进 transcript、`room.round++`、把"已揭晓的整轮"扇给 peer，并经 `setupFinishNotification` 的 `<paseo-system>` 信封通知开局者。
- 因为揭晓前谁都看不到他人回答 → 回答**独立**。

### (B) free-mesh —— 即时讨论
- 即时扇出，但仍：空闲门控（忙时 outbox 合并）+ 跳数预算。

### 防活锁 / 收敛（全部服务端）
1. **空闲门控**：`hasInFlightRun` 把打断转成排队合并轮次。
2. **作者抑制**：成员永不收到自己的消息（`expandChatMentionTargets` 已剔除自己）。
3. **系统信封标注**：投递的 peer 消息为 `<paseo-system>`，服务端标注 room+author+round，便于 prompt 指示 agent 不要对自己的回声自动回复。
4. **跳数预算**：`room.round` 每代扇出递增；可配 `maxRounds` 上限——一颗人类种子能引发的代数封顶，超过即停止自动扇出、需人/agent 重新 seed。**这是活锁/成本硬顶。**
5. **静默检测**：某代扇出在 round 超时内无新 post → 判定收敛、停扇。

## 5. 持久化设计

- **位置**：沿用 `$PASEO_HOME/chat/rooms.json` 单文件（房间数量低），经既有 `enqueuePersist → persist → writeJsonFileAtomic`（temp 文件 + POSIX 原子 rename）。**不新增持久化机制。**
- **顺序 transcript**：复用两个现成范式——`agent-timeline-store` 的 seq 行日志、`loop-service` 的 `nextSeq`。transcript 行 = `{seq, timestamp, roomId, round, message}`，`seq` **per-room 单调**。
- **nextSeq 不信磁盘**：启动 `load()` 时按各房间 `max(seq)+1` 重算，杜绝重复 seq。
- **游标分页**：`fetchTranscript({direction: tail|before|after, cursor:{seq}})`，返回 `minSeq/maxSeq/nextSeq` 窗口 + gap 检测，照搬 `AgentTimelineStore.fetch`。
- **outbox / idle-waiter 是纯内存**（同今天的 chat waiters / foreground-run waiters）。重启恢复：把 **per-member"已投递 seq 游标"持久化到房间/成员记录**；重启后重放 `seq > 游标` 的 transcript 行。
- **崩溃安全**：未提交的 post 在崩溃时直接丢失（原子 rename 保证读者不会看到半截写入）；in-flight barrier 重启后从持久化的部分回答恢复或重开。

## 6. 协议契约与兼容

- **点分命名**（`docs/rpc-namespacing.md`）：domain=`groupchat`，resource=`room/message/round/transcript`，verb=`create/join/post/open/await/fetch`，方向 `.request/.response`。requestId 为关联键；请求参数置顶层，响应数据置 `payload` 含 `error` 字段。
- **新 RPC** 加入 `messages.ts` 的 `SessionInboundMessageSchema` / `SessionOutboundMessageSchema` 判别联合（紧挨现有 `chat/*` 条目）。
- **能力位**：`ServerInfoStatusPayload.features.groupChat: z.boolean().optional()`，gate 处单条 `// COMPAT(groupChat): added in v0.1.X, drop the gate when floor >= v0.1.X`，`rg "COMPAT("` 可定位清理点。
- **客户端**：`daemon-client.ts` 读 `serverInfo.features.groupChat`；缺失则展示"升级宿主以使用群聊"，**无回退路径**、不用 legacy `chat/*` 模拟网状（遵 CLAUDE.md feature contract）。
- **向后兼容**：新增字段（`participants/turnMode/round`、transcript 行的 `seq/round`、features 位）全部 `.optional()`/`.default()`；不翻 required、不收窄、移除字段仍解析。`groupchat_post/await/round` 是 **MCP 工具**（非 WS schema），不加宽线协议——搭既有 MCP session。

## 7. 数据契约（schema 草案，最终以实现为准）

```ts
// packages/protocol/src/groupchat/types.ts
GroupChatRoomSchema = ChatRoomSchema.extend({
  participants: z.array(z.string()).default([]),
  turnMode: z.enum(["free", "round"]).default("free"),
  round: z.number().int().nonnegative().default(0),
});
GroupChatTranscriptRowSchema = z.object({
  seq: z.number().int().positive(),
  timestamp: z.string(),
  roomId: z.string(),
  round: z.number().int().nonnegative().default(0),
  message: ChatMessageSchema,
});
// messages.ts: ServerInfoStatusPayload.features
//   // COMPAT(groupChat): added in v0.1.X, drop the gate when floor >= v0.1.X
//   groupChat: z.boolean().optional(),
```

## 8. 权衡 / 取舍

- **打断 → 排队合并**：牺牲"立刻送达"，换取无活锁与不打断在途推理。群聊语义下排队合并更符合直觉。
- **单写者 transcript**：服务端是 transcript 唯一写者（成员经 MCP 工具请求服务端写），免锁。
- **单文件 store**：沿用 `rooms.json`，简单、原子；房间数大时再分文件（暂不需要）。
- **确定性收敛 vs LLM 裁判**：用规则（跳数/静默/超时）而非内置裁判，避免把成本与不确定性塞进 daemon；需要裁判时 agent 自任。

## 9. 复用 vs 净新增

**复用（不重造）**：注入链路、`<paseo-system>` 信封、finish-notification 的 idle-waiter 范式、**整套 mention 扇出**（`prepareChatMentionFanout`/`notifyChatMentions`/`expandChatMentionTargets`/`isChatMentionTargetEligible` + 25 上限）、AgentManager pub/sub（`subscribe`/`dispatch`）+ chat waiter 总线、`rooms.json` 原子持久化、seq 日志范式、`registerTool` 工厂 + DI、`Session.emit→broadcast`。

**净新增（最小集）**：①`GroupRoomService`（成员 + round/barrier + seq transcript）；②`MeshDeliveryRouter`（忙检查 + outbox + 合并，唯一行为增量）；③round-barrier 收齐揭晓逻辑；④`groupchat.*` RPC + `groupchat_post/await/round` MCP 工具 + 加性 schema + `features.groupChat`。

## 10. Rollout / Rollback

- **Rollout**：能力位默认可先关（dark ship）；分阶段合入（见 `implement.md` Phase 0→5），每阶段独立可验证。
- **Rollback**：任何阶段出问题——翻 `features.groupChat` 关掉即对客户端隐藏；schema 全加性，回滚=还原新增文件 + 移除 union 条目，旧 `rooms.json` 不受影响（新字段走默认值）。
- **风险与缓解**：见下表对应到具体机制。

| 风险 | 缓解 |
|---|---|
| 打断级联/活锁（#1）| Phase 2 空闲门控 + outbox 合并；绝不投运行中 agent |
| 成本爆炸 | `maxRounds` 跳数预算 + 25 成员上限 + 静默检测停扇 |
| barrier 死锁（成员 error/归档/不回）| round 超时 + ineligible/error/closed 当"空完成"（`isChatMentionTargetEligible`）|
| 回声自激 | 作者抑制 + `<paseo-system>` 标注 author/round + 跳数硬顶 |
| 顺序 vs 原子性 | 先分配 seq 并落 transcript 行再扇出；收方按 seq 游标读 |
| 重启丢内存 outbox/waiter | 持久化 per-member 已投递 seq 游标，重启重放 |
| 协议漂移 | review 强制：新字段全 optional/default、单一 COMPAT gate、新旧双向 parse 测试 |

## 11. 关键文件（实现定位）

- 注入/生命周期：`packages/server/src/server/agent/agent-prompt.ts`、`agent-manager.ts`、`foreground-run-state.ts`
- 既有 chat / mention：`packages/server/src/server/chat/chat-service.ts`、`chat/chat-mentions.ts`、`session/chat/chat-schedule-loop-session.ts`
- MCP 注册 / DI / bootstrap：`packages/server/src/server/agent/mcp-server.ts`、`bootstrap.ts`、`schedule/service.ts`（service 范式）
- 持久化范式：`atomic-file.ts`、`agent/agent-timeline-store.ts`、`loop-service.ts`
- 协议：`packages/protocol/src/messages.ts`、`packages/protocol/src/chat/*`、新增 `packages/protocol/src/groupchat/*`、`docs/rpc-namespacing.md`
- 客户端：`packages/client/src/daemon-client.ts`
