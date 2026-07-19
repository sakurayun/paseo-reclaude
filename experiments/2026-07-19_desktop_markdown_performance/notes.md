# Notes: desktop_markdown_performance

## 已有基线证据

- 生产安装包 v0.1.110 与当前分支的 Markdown 相关文件无差异，因此下面的代码短板适用于
  本机高占用版本；观测期间没有停止或重启生产 daemon。
- 已接受的 recent-window 优化在 8 个 tab、176 条 history 下，将正文一致 p50/p95 从
  151/280ms 降到 92/175ms，inactive DOM 从 4,404 降到 886，post-GC heap 从
  220.7MB 降到 156.8MB。挂载量与布局已被证实是第一层根因。
- 现有 1MiB 纯文本流式基线中，reducer p50/p95 仅 9.8/12.0ms，但 Long Task 总时长
  p50/p95 达 1,265/1,741ms，反馈延迟为 80/89ms。下一阶段应测 renderer，不应继续只看
  reducer microbenchmark。
- 真实队列中 chunks-per-flush 中位数为 1-2、p95 为 3；这限制了连续 chunk reducer 合并
  对端到端体验的上限。

## 定向诊断（不是正式候选 benchmark）

| 诊断                                           |                         结果 | 含义                         |
| ---------------------------------------------- | ---------------------------: | ---------------------------- |
| 1MiB 纯文本、47 次前缀的 `splitMarkdownBlocks` |                  累计 0.42ms | 不是当前优先项               |
| 同一负载的 MarkdownIt parse                    |                   累计 131ms | 有成本，但小于布局           |
| 同一负载的 block height 全量 hash              |                    累计 25ms | 可优化，非主导               |
| raw Chromium 单个不换行文本块并强制布局        |                 累计 1,178ms | 超大单块布局是明确短板       |
| raw Chromium 可换行文本块并强制布局            |                   累计 863ms | 即便可换行，布局仍占主导     |
| 约 2,089 个稳定段落、只追加末块                |                    累计 75ms | block memo 对稳定块有效      |
| 100KiB TypeScript 单次高亮                     |          25ms、37,843 tokens | 后续 RN Web 节点构建风险很高 |
| 100KiB TypeScript 20 次增长前缀高亮            |                   累计 264ms | 未闭合 fence 重复做全量工作  |
| 50 个增长前缀的高亮缓存                        | 12MiB、188,515 token objects | entry-count LRU 没有内存上界 |
| 1,000 个 MarkdownIt 实例                       |    170ms、约 221MiB retained | 每消息一个实例存在乘法浪费   |
| 80 个真实 TS token tree 的 cache heap          |      14.60MB → 8.99MB (-38%) | 8MiB weighted LRU 有效限界   |

这些数字用于选择消融变量，不作为产品验收数字。正式结论必须来自冻结的
`desktop_markdown_rendering@v2` Electron/Chromium benchmark。v1 仅在流开始时采一次反馈延迟，
会漏掉后半段 Long Task，因此只保留作 calibration，不用于候选验收。

## 当前代码短板

1. 每条挂载的 assistant message 创建一个配置相同的 MarkdownIt 实例。
2. 流式未闭合 fence 会在每个变化前缀上重新高亮完整代码，并产生新的内容缓存 key。
3. 高亮缓存只限制 200 个 entry，不按 bytes、token 数或完成状态设上限。
4. 100KiB code 可产生四万量级的 TokenSpan/换行组件；消息内部没有节点上限或虚拟化。
5. 稳定 block 的正文被 memo，但外层 block container、keyed projection 和每 block 样式边界
   仍可能在每次更新参与 React/RN Web 工作。
6. Markdown/file link 路径会创建额外 query observer、tooltip、Pressable 和 JS hover 树，
   link-dense history 需要独立 workload 才能定量。
7. 隐藏 retained tab 虽冻结 stream 数组，外层 shell 仍可能随 stream head identity 更新；
   这是多会话 CPU 问题，不应误判为 Markdown parse 本身。

## 决策规则

- 每次只改一个主要变量，保存 before/after/rollback run。
- 纯文本 ablation 若不能让目标 workload 的 p95 改善至少 20%，Markdown 路径不算主要瓶颈。
- Streamdown 只有在 web-only 完整候选相对当前 renderer 的 p95 改善至少 15%、Long Task
  明显下降、heap 增幅不超过 10% 时才进入迁移讨论。
- React profiler duration 是嵌套 profiler 的求和，可能重复计时；决策以反馈延迟、Long Task、
  frame gap、DOM/AX、post-GC heap 和端到端完成时间为主。

## v1 calibration 与 rejected live-tail 候选

`20260719_223805__baseline_current_renderer__ef244e` 首次量化了三个 anchor：1MiB 单增长块
end-to-end p95 2,597ms；64KiB 开 fence 产生 29,132 DOM / 58,550 AX nodes；256KiB
混合 Markdown 产生 111,358 DOM nodes、post-GC heap 2.37GB，Long Task p95 6,922ms。

`20260719_224322__bounded_live_tail_renderer__b90856` 仅对大于 256KiB 的流式增长块使用
稳定 8KiB plain-text chunks。1MiB 单块 Long Task p95 从 355ms 降到 171ms（-52%），但
end-to-end 只从 2,597ms 降到 2,502ms（-4%），max frame gap 从 81ms 升到 102ms（+26%）。
最终 rendered-text hash 完全一致，但候选未达到 promotion gate，代码已回滚。

v1 的 feedback timer 只在开始后 25ms 采一次，无法覆盖后半程同步工作。v2 保持语料不变，
改为全流周期每 100ms 采样并记录 per-run p95/max；后续正式结论只使用 v2。

## v2 baseline 与 rejected 未闭合 fence 候选

正式 v2 baseline `20260719_225058__baseline_v2__fa554c` 显示：1MiB plain 的反馈
p50/p95 为 28.2/40.4ms；64KiB open TypeScript fence 为 504.7/514.5ms；256KiB mixed
Markdown 为 5,768.7/5,843.4ms。后两者最终分别挂载 29,132/111,358 DOM nodes 和
58,550/132,619 non-ignored AX nodes；对应 post-GC heap p95 为 292.5MB/2.37GB。

`20260719_225750__incomplete_fence_plain_during_stream__318f50` 只在 live head 的最后一个
未闭合 fence 暂缓高亮，并在 turn 完成后恢复完整高亮。64KiB open fence 的 highlight calls
从 2 降到 1、highlight p95 从 43.7ms 降到 28.3ms、end-to-end p95 从 1,071.2ms 降到
800.8ms（-25%）、Long Task p95 从 862ms 降到 578ms（-33%）。但最终一次性构造同样的
29,132 DOM / 58,550 AX nodes，max frame gap 从 540.1ms 升到 594.9ms（+10%），反馈
p95 从 514.5ms 升到 557.6ms（+8%）。最终文本 hash 一致，heap +0.9%，但交互 gate 失败，
因此该候选单独 rejected 并回滚。

这次消融把根因进一步收窄到 token/span 与 RN Web/AX 节点挂载，而不是 tokenizer 本身。
`bounded_code_rendering` 和 `long_message_block_virtualization` 据此从 P1/P2 提升为 P0。

## accepted 有界代码 token tree

`20260719_230348__bounded_code_rendering__e9a1a6` 将语法高亮上限从 100,000 字符收紧到
16KiB；超过阈值仍渲染完整、可选择、可复制的 monospace 原文，只是不再构造逐 token span。
64KiB open TypeScript fence 的 end-to-end p50/p95 从 1,056.7/1,071.2ms 降到
206.8/208.1ms（p95 -80.6%），反馈从 504.7/514.5ms 降到 20.3/22.4ms（p95 -95.6%），
Long Task 从 852/862ms 降到 0/0ms，max frame gap p95 从 540.1ms 降到 37.8ms。
DOM 从 29,132 降到 11，non-ignored AX 从 58,550 降到 3,222，post-GC heap p95 从
292.5MB 降到 157.4MB（-46.2%）。最终 rendered-text hash 与 baseline 完全一致。

1MiB plain 和 256KiB mixed 不触发该阈值分支；两者 p50 基本同量级。5-run p95 各出现一个
环境离群值（plain feedback +18%、mixed feedback +8%），但产品代码在这两个 control workload
上的执行路径不变，且 mixed p50 反而从 5,768.7ms 降到 5,719.4ms。因此不把 control 噪声
计入收益，也不据此否决目标 workload 上数量级、跨 DOM/AX/heap/Long Task 一致的改善。

`20260719_231120__long_message_css_content_visibility__40916f` 尝试只在 web 为每个顶层 block
应用 `content-visibility:auto`。候选在第 4 次 mixed run 后归档 agent 时，workspace tab 超过
30 秒仍未 detached，整轮 3.5 分钟失败且没有可发布 metrics。该策略与现有列表高度缓存、
滚动锚点或 retained tab 生命周期存在冲突，已 rejected 并完全回滚；后续改为显式有界挂载。

## accepted 长消息有界挂载

第一版只在单个 `AssistantMessage` 内保留 32 个 head + 64 个 tail block，没有产生任何收益。
诊断发现 `promoteCompletedAssistantBlocks()` 会把每个已完成 Markdown block 提升成独立
`AssistantMessage`；262KiB mixed workload 因而形成 6,551 个 renderer，而不是一个 6,551
block renderer。这个中间消融保留为定位证据，不晋级。

最终候选把每个流式 assistant block group 的稳定提升上限设为 32，剩余内容保留为一个 live
remainder；remainder 默认最多挂载 96 个 block（32 head + 64 tail），并提供“显示隐藏段落”按钮。
展开会挂载完整内容，turn copy 始终从完整 stream items 收集文本，不依赖可见窗口。

正式 v4 baseline `20260719_233546__baseline_v4_unbounded_mixed__c85133` 与候选
`20260719_233724__bounded_promoted_and_mounted_markdown_blocks_v4__166ed9` 均为 5-run：

- end-to-end p50/p95：7,031.4/7,530.1ms → 838.9/1,005.8ms（p95 -86.6%）
- feedback p50/p95：6,061.3/6,552.3ms → 201.1/355.8ms（p95 -94.6%）
- Long Task p50/p95：6,814/7,314ms → 544/769ms（p95 -89.5%）
- max frame gap p50/p95：5,937.2/6,421.5ms → 255.3/406.1ms（p95 -93.7%）
- post-GC heap p50/p95：2.331/2.341GB → 161.2/173.0MB（p95 -92.6%）
- DOM：111,358 → 2,080（-98.1%）；non-ignored AX：132,619 → 2,695（-98.0%）
- Markdown parse calls：6,552 → 352（-94.6%）；highlight calls：1,310 → 70（-94.7%）

候选默认 hash 因有意隐藏中段而不同；自动展开后的 canonical rendered-text hash 为
`b01ca4df...ce739`，与无限挂载 baseline 完全一致。reducer 单测同时验证所有源 block 和 turn
copy 拼接文本无丢失。v3 的旧 scorer 在每个 React message root 间插入人工分隔符，会把内部
组件边界变化误报为正文差异，因此只保留作 calibration；正式晋级只使用冻结的 v4。

## accepted 高亮缓存内存上限

原缓存只限制 200 个 entry；不同代码块的 token tree 大小差异可达数量级，因此 entry 上限不是
有效的 retained-memory 上限。候选保留 200-entry LRU，同时增加 8MiB 的估算 retained-byte
预算，权重包含 cache key、token 文本、line 与 token object 开销。

在全新 Node 进程中连续缓存 80 个不同的 120 行 TypeScript token tree，并在前后强制 GC：
entry-only baseline heap delta 为 14,595,168 bytes；weighted candidate 为 8,990,008 bytes
（-38.4%）。候选保留 48 项、按 LRU 淘汰 32 项，估算权重为 8,354,112 bytes，未超过
8MiB 预算。该诊断验证的是长会话累计 retention，不替代 Electron 端到端 benchmark；16KiB
代码高亮上限已经独立约束单个超大 entry。

## rejected P0 共享 MarkdownIt 实例

候选 `20260719_234658__shared_markdownit_instance__0f4aae` 与同 commit rollback control
`20260719_234819__per_message_markdownit_control__49eaff` 均运行 5 次 256KiB mixed workload。
共享 parser 的 feedback p50/p95 从 153.1/239.2ms 降到 149.0/215.6ms（p95 -9.9%），
post-GC heap 从 156.9/168.5MB 降到 149.6/161.3MB（p95 -4.3%），parse duration p95
从 12.9ms 降到 9.9ms（-23.3%）。但 end-to-end p95 从 851.2ms 升到 854.8ms
（+0.4%），Long Task p95 仅从 518ms 降到 514ms（-0.8%），未达到 P0 的 20% 交互晋级
门槛。实现已回滚；可在未来有 176 条独立 assistant message 的 history-mount 专项 benchmark
后重新评估为内存 P1，不计入本轮产品收益。

## P0 组合验收

最终代码 run `20260719_235127__final_p0_combined__9c896c` 在同一隔离 Chromium/Electron
overlay 中各跑 5 次三个 anchor。相对冻结 baseline：

- 64KiB 未闭合 TypeScript：end-to-end p50/p95 1,056.7/1,071.2ms → 209.4/210.7ms
  （p95 -80.3%）；feedback 504.7/514.5ms → 23.1/44.9ms（p95 -91.3%）；Long Task
  852/862ms → 0/0；frame gap p95 540.1ms → 35.9ms（-93.4%）；post-GC heap p95
  292.5MB → 157.3MB（-46.2%）；DOM 29,132 → 11，non-ignored AX 58,550 → 3,222。
- 256KiB mixed：end-to-end p50/p95 7,031.4/7,530.1ms → 774.7/816.4ms
  （p95 -89.2%）；feedback 6,061.3/6,552.3ms → 161.3/169.4ms（p95 -97.4%）；
  Long Task p95 7,314ms → 533ms（-92.7%）；frame gap p95 6,421.5ms → 226.6ms
  （-96.5%）；post-GC heap p95 2.341GB → 200.1MB（-91.5%）；DOM/AX 均下降约 98%。
  React duration p95 36,836.7ms → 2,971.1ms（-91.9%），掉帧 p95 15 → 6（-60%）。
- 1MiB plain control：end-to-end p50/p95 2,515.6/2,612.8ms → 2,489.0/2,597.4ms
  （p95 -0.6%），frame gap p95 86.0ms → 87.6ms（+1.9%），post-GC heap p95 基本不变。
  feedback p95 40.4ms → 42.7ms（+5.7%）；Long Task p50 278ms → 286ms（+2.9%），p95
  317ms → 444ms，来自 5 个样本中的单个 444ms 离群值。该 workload 的产品执行路径未被
  三项候选改变，且 end-to-end、React duration、frame gap 与 heap 均稳定；1MiB 单块布局仍是
  未解决短板，不把它计作本轮收益。

三个 workload 的完整 rendered-text hash 均与各自 baseline 一致；mixed 自动展开后的 canonical
hash 也一致。最终组合没有重新引入大 code token tree 或无限 mixed block 挂载。
