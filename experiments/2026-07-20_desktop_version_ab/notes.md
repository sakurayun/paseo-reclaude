# Notes

- GIF 是视觉证据，不参与数值统计；指标 pass 不截图。
- v1 H176 fixture 只有约 0.75 MB 且没有工具调用，只能作为 smoke，不能外推。
- v2 fixture daemon 固定为 `17678`；A/B 期间不得重启。
- `6767` 是生产 daemon，harness 和人工检查都必须确认其 PID 未变化。
- v2 校准实际值：5,394 timeline item、6,956,521 JSON bytes、2,586 tool calls、
  108 provider subagents（10 running）；真实样本是 7,602,591 bytes，偏差 -8.5%。
- tail 模式模拟重启后每个 tab 的持久化 tail page；full 模式把所有历史页拉入 renderer，
  作为内存硬上限 saturation gate。两版 full 模式都在约 4 GB V8 heap OOM。
- H176 history Agent 的确定性 prompt 为 `desktop-version-h176-a{1..8}-turn-{1..88}`。
- 官方仓库 remote 是 `origin=getpaseo/paseo`，用户 fork 是
  `fork=BetterAndBetterII/paseo-1`；本实验的 main 对照必须取 `origin/main`。
- 新 profile 会默认启动内置 daemon。A/B profile 都预置
  `manageBuiltInDaemon: false`，并在每次正式 run 前确认 6768 没有 Paseo listener。
- Command Center 打开 H176 后会自动挂载同 workspace 的 Markdown 和大 diff Agent。
  正式 workload 在第一次 history Agent 就绪后关闭这两个非 history tab，只保留 8 个
  H176 history Agent（另有一个固定 terminal tab）。
- 1 MiB Markdown 冷开使用从未访问的 `Perf Light 01` workspace 中专用 Agent
  `e7dbcbb7-187a-4128-abdc-d973a62b00b3`，避免 H176 inactive tab 预渲染污染。
- v2 main tail：`production_v2_tail_latest_main_3d86c7`；优化版：
  `production_v2_tail_optimized_74f05b`。
- v2 secondary interactions：`production_v2_tail_interactions_latest_main` 和
  `production_v2_tail_interactions_optimized`。
- eager-inactive ablation：main `20260720_014836__latest_main__2a0ee8`，优化版
  `20260720_014450__optimized_p0__e229c4`。这两组说明 main 会提前渲染隐藏 Markdown，
  因此之后的 tab 点击变快，但不作为冷开 Markdown 的最终结论。
