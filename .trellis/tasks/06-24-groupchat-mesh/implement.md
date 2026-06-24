# 执行计划：Paseo 网状群聊

> 顺序推进，每个 Phase 自成一个可独立验证的交付物，结束处有 review gate 与 rollback point。
> 通用校验：每个 Phase 收尾跑 `npm run typecheck` + `npm run lint`；跨包类型错误前先 `npm run build:client` / `npm run build:server`；只跑改动文件的 `npx vitest run <file> --bail=1`，**不跑全量**；全量验证推 CI。

## Phase 0 — schema + 能力位（地基）
- [ ] 新建 `packages/protocol/src/groupchat/types.ts`：`GroupChatRoomSchema`（在 `ChatRoomSchema` 基础上加 `participants/turnMode/round`，全 `.default()`）、`GroupChatTranscriptRowSchema`（`seq/timestamp/roomId/round/message`）。
- [ ] 扩展 `ChatStorePayloadSchema`：`messages` → 顺序 `transcript[]`（兼容旧 `messages` 字段：保留可解析，加载时归一化），`nextSeq: z.record(z.string(), z.number())`（计算态，加载重算）。
- [ ] `messages.ts`：`ServerInfoStatusPayload.features` 加 `groupChat: z.boolean().optional()` + `// COMPAT(groupChat): added in v0.1.X, drop the gate when floor >= v0.1.X`。
- [ ] `chat-service.ts`：`load()` 时按 `max(seq)+1` 重算每房间 `nextSeq`；旧 payload（无 seq/round/participants）走默认值。
- **校验**：往返 parse 测试——旧 `rooms.json` 能加载；新 schema 序列化后旧 schema 仍能解析（双向）。`typecheck` 通过。
- **Gate**：协议 reviewer 确认全部新字段 optional/default、无类型收窄。**Rollback**：删 `groupchat/` + 还原 union/features 改动。

## Phase 1 — MVP 扇出（纯复用，无新轮次逻辑）
- [ ] 新建 `packages/server/src/server/groupchat/service.ts` 的 `GroupRoomService`，包住 `FileBackedChatService`：`postMessage` 分配 seq → 落 transcript → 计算 recipients（复用 `expandChatMentionTargets`）。
- [ ] `mcp-server.ts`：经 `registerTool` 工厂注册 `groupchat_post`；`groupRoomService` 经 `AgentMcpServerOptions` 注入（仿 `scheduleService`），在 `bootstrap.ts` 初始化并传入。
- [ ] 协议：`groupchat.message.post.request/.response`（`packages/protocol/src/groupchat/rpc-schemas.ts` + 接入 `messages.ts` union）；`session.ts` 加 dispatch 分支；`daemon-client.ts` 加 `postGroupChatMessage` 方法。
- [ ] 扇出**先沿用今天的语义**（@everyone 展开 + `CHAT_MENTION_FANOUT_LIMIT`，运行中即打断——本阶段不修）。
- **校验**：2-agent 房间发一条 → 断言另一 agent 收到 `<paseo-system>` 注入 + transcript 行落盘。针对性 vitest。
- **Gate**：确认走的是既有注入链路（无新增打断路径）。**Rollback**：移除 service + 工具 + RPC 分支。

## Phase 2 — 空闲门控（= 活锁修复，本特性的核心正确性）
- [ ] 新建 `MeshDeliveryRouter`：投递前 `hasInFlightRun(recipientId)`；空闲即注入，忙则入 per-member outbox。
- [ ] idle-waiter：克隆 `setupFinishNotification` 的 `AgentManager.subscribe({agentId, replayState:false})`，lifecycle→idle 时把 outbox 合并成一条 `<paseo-system>` digest 注入。
- [ ] `GroupRoomService.postMessage` 改为经 `MeshDeliveryRouter` 投递（替换 Phase 1 的直接扇出）。
- **校验**：向忙碌 agent 连发 5 条 → 断言转 idle 时**恰好一条**合并 digest，且在途 turn **未被 interrupt**（不触发 `replaceAgentRun`）。
- **Gate**：确认无路径会对运行中 agent 调用注入即打断。**Rollback**：postMessage 退回 Phase 1 直接扇出。

## Phase 3 — round-barrier（先收齐再揭晓）
- [ ] `GroupRoomService.openRound/awaitRound`：reveal 门控 + round 计数 + round 超时（复用 chat waiter 超时）；ineligible/error/closed 成员当"空完成"防死锁。
- [ ] MCP `groupchat_round` + `groupchat_await`；RPC `groupchat.round.open/.await.request/.response`。
- [ ] 揭晓时：原子追加 N 条到 transcript（同 round R）+ `room.round++` + 经 `setupFinishNotification` 的 `<paseo-system>` 通知开局者。
- **校验**：3-agent 开回合 → 断言揭晓前互不可见；全部提交/超时后同 round 原子出现 + 开局者收到揭晓通知。
- **Gate**：barrier 在"某成员永不回"时仍能靠超时解开。**Rollback**：保留 free-mesh，关闭 round 工具。

## Phase 4 — 客户端面 + 收敛护栏
- [ ] RPC `groupchat.transcript.fetch`（游标分页，照搬 `AgentTimelineStore.fetch`）+ `groupchat.room.event` 服务端推送（`Session.emit→broadcast`）；`daemon-client.ts` 加订阅/拉取方法。
- [ ] per-room `maxRounds` 跳数预算 + 静默检测（某代 round 超时内无新 post → 停止自动扇出）。
- **校验**：free-mesh 种子消息自限 `maxRounds` 代后停；旁观 web 客户端 reconnect 后 seq 游标分页正确 + gap 检测。
- **Gate**：确认人类旁观不触发 agent 投递（只读路径）。**Rollback**：关推送/拉取 RPC，保留 agent 侧能力。

## Phase 5 — 加固 + 文档
- [ ] @everyone 成员上限强制；按规范 id 复核资格（`isChatMentionTargetEligible`）。
- [ ] 持久化 per-member 已投递 seq 游标；重启后重放 `seq > 游标` 恢复未投递。
- [ ] `docs/` 增补：群聊轮次模式（round/free）、投递语义、COMPAT 清理日期；必要时在 CLAUDE.md docs 表登记新文档。
- **校验**：重启恢复测试；`features.groupChat` 关掉时客户端展示"升级宿主"。**最终**：推 CI 跑全量。
- **Gate**：协议 reviewer 终审 + `rg "COMPAT("` 确认 gate 唯一且标注。

## 跨阶段注意
- **不提交、不推送**，除非用户明确要求；当前在 `main`，实现时应先开分支。
- 每次改动后 `npm run format`（Biome），勿手改格式。
- 改动 protocol 后，依赖包类型错误先 `npm run build:client` / `build:server` 再诊断，勿加本地重复类型去消错。
- **NEVER 重启 6767 主 daemon**；本仓库 dev 用 `.dev/paseo-home`，测试用隔离 in-process harness（见 `docs/ad-hoc-daemon-testing.md`）。
