# ReClaude 集成 — 登录流程与用量查询

> 本文档记录 [reclaude.ai](https://www.reclaude.ai/) 的对外 API（登录 + 用量），以及把它接入 Paseo「设置 → 使用情况（Usage）」中 Claude 卡片的设计。
>
> API 细节通过 reverse-engineer 前端 SPA bundle（`https://www.reclaude.ai/assets/index-*.js`）+ **一次真实登录抓包**得到，并用 `curl` 验证了无头（非浏览器）流程可行（Cloudflare 不拦带浏览器 UA 的请求）。

## 1. ReClaude 是什么

ReClaude 是 Claude Code 的「账号续杯 / 调度」服务（拼车 ¥400/月起、独享 ¥1600/月）：它把官方 Claude 账号自动调度到你的机器，Claude Code **零配置**直连官方 API。核心卖点之一是 **"official OAuth passed through so you can view usage data end-to-end"** —— 把官方 OAuth 用量**透传**给你，所以它的用量接口里同时含 Anthropic 原生用量窗口 + ReClaude 自己的计费额度。

在本 fork 里，"reclaude" 已经作为 **Claude 底层二进制替换**存在：`packages/app/src/screens/settings/providers-section.tsx` 的 `ClaudeReclaudeRow` 开关会把 `config.providers.claude.command` 设为 `["reclaude"]`（见 `RECLAUDE_COMMAND`）。本功能在此基础上，增加「登录 ReClaude 账号 + 查询用量」。

## 2. 鉴权机制（已验证）

- API 同源：`https://www.reclaude.ai/api/...`，在 Cloudflare 后面。
- **鉴权是 Cookie 会话制**：登录成功后服务端下发 `Set-Cookie: rc_sid=<token>; Path=/; HttpOnly; Secure; SameSite=Lax`（约 7 天有效）。普通登录响应体里**不返回 token**，只有 `{ landing_route, primary_role, step }`。
- 后续请求带 `Cookie: rc_sid=<token>` 即可。**daemon 集成用 cookie 捕获+回放**（Node `fetch` 用 `response.headers.getSetCookie()` 读取，请求时手动设 `Cookie` 头）。
- 必须带浏览器式 `User-Agent`（否则可能被 Cloudflare 拦）；可带 `x-lang: en/zh` 控制错误信息语言。
- 未登录访问 `GET /api/me` / `GET /api/app/me` 返回 `401`。
- bundle 里另有一套 `client:"embed"` 的 token 流，但实测 `POST /api/auth/login {client:"embed"}` 返回 `403`（受限），**不要走 embed 流，用 cookie**。

## 3. 登录流程（reverse-engineered）

### 3.1 普通登录

```
POST https://www.reclaude.ai/api/auth/login
Content-Type: application/json
User-Agent: <浏览器式 UA>
{ "email": "<email>", "password": "<password>" }
```

响应（HTTP 200）有两种分支，看 `step`：

- **直接成功**：`{ "landing_route": "/app", "primary_role": "", "step": "completed" }` + `Set-Cookie: rc_sid=...`（**会话就在这个 cookie 里**）。
- **需要二步验证（MFA）**：`{ "step": "mfa_required", "mfa_challenge_token": "<challenge>", ... }`（本测试账号未开 MFA，此分支形状取自 bundle）。

失败时（如错误密码/被风控）返回非 2xx + `{ code, type, layer, message, retryable, request_id }`。

### 3.2 二步验证（仅当 step === "mfa_required"）

```
POST https://www.reclaude.ai/api/auth/mfa/verify
Content-Type: application/json
{ "challenge_token": "<mfa_challenge_token>", "code": "<6位验证码>" }
```

响应：成功后同样通过 `Set-Cookie: rc_sid=...` 下发会话。

### 3.3 登出

```
POST https://www.reclaude.ai/api/auth/logout
Cookie: rc_sid=<token>
```

### 3.4 其它 auth 端点（备查）

- `POST /api/auth/register` + `POST /api/auth/register/email-code`（注册）
- `POST /api/auth/forgot-password/email-code` + `POST /api/auth/forgot-password/reset`（找回密码）
- `POST /api/auth/change-password`
- `POST /api/cli/auth/approve` / `GET /api/cli/auth/describe`（CLI 设备授权流）

## 4. 用量查询（reverse-engineered）

带 `Cookie: rc_sid=<token>` + 浏览器 UA 调用：

### 4.1 `GET /api/app/me` — 用户 + 套餐 + 用量汇总（首屏主接口，已验证）

真实响应（已脱敏）的关键结构：

```jsonc
{
  "email": "user@example.com",
  "subscription": { "status": "active", "expires_at": 1789210726492, "period_started_at": 1781434726492 },
  "current_account": {                       // 当前绑定的官方 Claude 账号
    "status": "bound",
    "email_masked": "fe****@gmail.com",
    "subscription_type": "max_20x",          // → planLabel "Max 20x"
    "usage_updated_at": 1781956725333,
    "usage_snapshot": {                       // ★ 透传的官方 Anthropic OAuth 用量
      "five_hour":  { "utilization": 0, "resets_at": null, "limit_dollars": null, "remaining_dollars": null, "used_dollars": null },
      "seven_day": null, "seven_day_opus": null, "seven_day_omelette": null,
      "seven_day_sonnet": null, "seven_day_cowork": null, "seven_day_oauth_apps": null,
      "extra_usage": { "is_enabled": false, ... },
      "limits": [
        { "group": "session", "kind": "session",      "percent": 0, "resets_at": null, "scope": null,                                    "severity": "normal", "is_active": true },
        { "group": "weekly",  "kind": "weekly_all",    "percent": 11, "resets_at": "…", "scope": null,                                    "severity": "normal", "is_active": true },
        // ★ per-model weekly limit (Fable / fable5) — NOT a top-level seven_day_* field; only here:
        { "group": "weekly",  "kind": "weekly_scoped", "percent": 0, "resets_at": null, "scope": { "model": { "display_name": "Fable", "id": null } }, "severity": "normal", "is_active": false }
      ],
      "spend":  { "enabled": false, "limit": null, "percent": 0, "used": { "amount_minor": 0, "currency": "USD", "exponent": 2 } }
      // 还有若干代号字段（amber_ladder/cinder_cove/iguana_necktie/omelette_promotional/tangelo），通常为 null，忽略
    }
  },
  "unread_notifications": 0
}
```

**`usage_snapshot` 的 `five_hour`/`seven_day`/`seven_day_opus`/`seven_day_omelette` 字段名、`{utilization, resets_at}` 形状与官方 `https://api.anthropic.com/api/oauth/usage` 完全一致** —— 可直接复用 `claude.ts` 现有的窗口映射逻辑。

### 4.2 `GET /api/app/usage/me` — ReClaude 计费额度（已验证）

`{ "ledger": [], "quota_limit_usd": "0", "remaining_usd": "0", "used_usd": "0", "status": "none" }`（美元，字符串）。订阅用户为 `status:"none"`/0；按量付费/充值用户才有非零额度。

### 4.3 `GET /api/app/usage/stats?range=30d` — 用量统计（已验证，可选）

`{ overview: { sessions, messages, total_tokens, total_usd, active_days, current_streak, favorite_model, peak_hour, heatmap[] }, models: { timeseries[], breakdown[]{model,total_tokens,total_usd,percent} } }`。可做 `details[]`（如"近 30 天 N 次会话 / $X"）。

### 4.4 用量同步的真实流程(org-based,daemon 实际用这条)

1. `GET /api/app/orgs/` → 取 `active_business_org_id ?? default_org_id`(本测试账号 = `256`),以及该 org 的 `items[].current_account`(含 `subscription_type`、`email_masked`、`usage_snapshot`)。**orgs 的快照通常就是有效数据**。
2. `POST /api/app/account/usage/refresh?org_id=256` → 强制 reclaude.ai 向 Anthropic 重新拉取,返回 `{ usage_snapshot, usage_updated_at }`。
   - ⚠️ **实测该接口偶尔返回空快照**(`five_hour: null …`,可能是后台异步刷新尚未落地)。因此 daemon 端逻辑:**只有当 refresh 的快照确实含窗口数据时才采用,否则回退使用 orgs 的快照**(`snapshotHasWindowData` 判定)。

`five_hour.utilization` 等就是 Session 等窗口的百分比;`resets_at` 为重置时间(客户端按秒倒计时)。

### 4.5 `GET /api/app/billing/carpool-quota?org_id=` — 拼车额度分配

## 5. 映射到 Paseo `ProviderUsage`

ReClaude 用量天然契合现有 `ProviderUsage`（`packages/protocol/src/messages.ts`）：

| ReClaude 字段                                                                          | → Paseo 字段                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `usage_snapshot.five_hour/seven_day/...`（透传官方窗口）                               | `windows[]`（复用 `windowFromUsedPct`，label：Session / Weekly / Weekly·Opus …）                                                                                                                 |
| `usage_snapshot.limits[]` 中 `kind:"weekly_scoped"`（按模型的周限额，如 Fable/fable5） | 额外 `windows[]` 项 `Weekly · <display_name>`（id `weekly_<slug>`，按 id 去重避免与顶层窗口重复；`buildUsageWindows`）。refresh 若缺 `limits[]` 会从 orgs 快照回填，防止 scoped 窗口在同步时丢失 |
| `usage_remaining_usd` / `usage_quota_limit_usd` / `usage_used_usd`                     | `balances[]`（美元额度条，tone 由剩余额度决定）                                                                                                                                                  |
| `subscription_type`(+ status/expiry)                                                   | `planLabel`（如 "Carpool" / "Dedicated"，可附到期）                                                                                                                                              |
| `usage_status` / `usage_enabled`                                                       | `status` + `details[]`                                                                                                                                                                           |
| `usage_updated_at`                                                                     | 响应 `fetchedAt` / 卡片 "Updated …"                                                                                                                                                              |

## 6. Paseo 接入设计

**触发条件**：仅当 Claude provider 使用 reclaude（`config.providers.claude.command?.[0] === "reclaude"`）时启用本路径。

**数据流**：凭据/会话始终留在 **daemon 侧**（app 只发邮箱/密码给 daemon，daemon 去登录、存 cookie、查用量）。

1. **server 凭据存储**：新增 `reclaude-credentials-store`（仿 `appearance-settings-store` / claude `saveClaudeCredentials` 的 `0o600` 文件落盘），存 `{ cookie: "rc_sid=...", email, savedAt }` 于 `$PASEO_HOME` 下。
2. **server 登录/用量（缓存 + 手动同步模型）**：
   - 新增 `ReclaudeClient`：`login({email,password})` → `{step:"completed", cookie}` 或 `{step:"mfa_required", challengeToken}`；`verifyMfa({challengeToken,code})` → `{cookie}`；`logout()`；`fetchUsage(cookie)`（带 cookie 调 `/api/app/me`，映射成 `ProviderUsage`，窗口标记 `fullCountdown`）。统一带浏览器式 UA。
   - `ReclaudeAccountService` 持有一份**内存缓存** `cachedUsage`，并暴露两条路径：
     - `getCachedUsage()`：**只读缓存、绝不发网络**。Claude usage provider 在 reclaude 激活时只调它，所以「套餐用量」列表的加载/顶部刷新/自动刷新都**不会**触发 reclaude 实时拉取——只读上次同步到的非实时快照。
     - `syncUsage({ force })`：实时拉取入口(走 4.4 的 org 流程),更新 `cachedUsage`。两个触发点:① 专用「同步用量」按钮(`force=true`,绕过节流,总是拉最新);② 对话框右下角的**上下文用量按钮**展开时(`force=false`,**服务端节流到 5 分钟一次**,5 分钟内重复展开只返回缓存、不再实时拉)。登录成功后也 force 同步一次以填充卡片。
   - 登录/MFA/登出**不再 invalidate 整张用量缓存**，因此不会连带重新拉取 Codex 等其它 provider。
   - reclaude 用量窗口的重置时间走**完整实时倒计时**（天/时/分/秒，每秒跳动，永不显示「即将重置」），由 `window.fullCountdown` 标记驱动客户端 `formatFullResetLabel`。
3. **protocol（dotted RPC + 能力位）**：
   - `provider.reclaude.login.request/response`（body：email/password → `{status:"ok"|"mfa_required", mfaChallengeToken?}`）
   - `provider.reclaude.mfa.request/response`（challengeToken/code → ok）
   - `provider.reclaude.logout.request/response`
   - `provider.reclaude.status.request/response`（是否已登录 + 登录邮箱）
   - 能力位 `server_info.features.reclaudeUsage`（`COMPAT(reclaudeUsage)`）。
4. **client**：`DaemonClient` 增 `reclaudeLogin/reclaudeVerifyMfa/reclaudeLogout/reclaudeStatus`。
5. **app UI**：在 Claude 用量卡片，当 reclaude 激活：
   - 未登录 → 「登录 ReClaude」按钮 → 弹出邮箱/密码表单（+ MFA 码二级步骤）→ 调登录 RPC → 成功后刷新用量。
   - 已登录 → 正常展示 reclaude 用量 + 「登出」入口。
   - 新增 i18n `providerUsage.reclaude.*` 文案（六个 resources 同步）。

## 7. 安全注意

- 密码只在「app → daemon → reclaude.ai」链路上传一次，**不落盘、不进日志、不写 memory**。
- 落盘的只有会话 cookie `rc_sid`（`0o600`）。cookie 失效（401）时 UI 回到「需登录」态。
- `rc_sid` 是 HttpOnly/Secure/SameSite=Lax、约 7 天有效，到期需重新登录。

## 8. 跨端实时广播（`COMPAT(reclaudeUsageBroadcast)`，v0.1.108）

凭据（cookie）与用量缓存（`cachedUsage`）本就**只在 daemon 端**、由同一 daemon 的所有客户端共享——任一端登录/登出/同步用量，改的都是这一份共享状态。但此前所有 reclaude 响应都是**按连接点对点**（`this.host.emit` + requestId），不广播；于是其它已连接的客户端只能等自己的 React Query `staleTime`（status 60s / usage 5min）过期或重新挂载才刷新。

本功能补上这道广播，让「某端同步用量后，其它桌面端和 app 端**实时**更新」：

- **server**：`ReclaudeAccountService` 新增 `onChange(listener)` 订阅 + 私有 `emitChange()`。在每个会改变共享状态的点调用 `emitChange()`：`login`（completed 分支）、`verifyMfa`、`logout`、`syncUsage`（实时拉取成功 + cookie 被拒 `NEEDS_AUTH` 清理两条路径）；节流早退/无 cookie 早退**不触发**（无状态变化）。`emitChange` 在无监听者时短路。
- **server**：`WebSocketServer` 构造时 `this.reclaudeAccountService.onChange(...)` 订阅一次，回调里 `broadcastReclaudeChanged(payload)` 把 `{active, loggedIn, email, usage}` 发给**所有**会话（**不排除发起方**：事件源自共享的 daemon 服务、无连接上下文，且重复应用同值经 React Query 结构共享是幂等的）。**只广播派生数据，绝不含 cookie**。
- **protocol**：新增 outbound `provider.reclaude.changed`（`ReclaudeUsageChangedMessageSchema`，payload `{active, loggedIn, email, usage: ProviderUsage|null}`）+ 能力位 `server_info.features.reclaudeUsageBroadcast`。旧客户端收到未知消息类型经 `WSOutboundMessageSchema.safeParse` 失败被忽略，向后兼容。
- **app**：新增桥接 `packages/app/src/provider-usage/reclaude-usage-sync.ts`，在 `session-context.tsx` 挂载。监听 `provider.reclaude.changed`，按 `serverId` 把 status 写入 `reclaudeStatusQueryKey` 缓存、把 `usage` 原地 patch 进 `providerUsageQueryKey` 列表的 Claude 条目（复刻 `useReclaude` 的 `patchClaudeUsage`，不动 Codex 等其它 provider）。无需 daemon 往返；旧 daemon 不发该事件，桥接为纯 no-op。
