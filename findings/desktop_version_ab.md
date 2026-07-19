# Desktop version A/B（2026-07-20）

## v2 生产校准结论

旧 H176 fixture 只有 1,408 条、0.75 MB、0 个工具调用，不能代表真实使用。v2 改用
6 个 root Agent 加 2 个 provider subagent tab：5,394 条 timeline、6.96 MB JSON、
2,586 个工具调用、108 个 subagent descriptor（10 个 running）。和采样的真实工作区
7.60 MB 相比只低 8.5%，其余关键计数完全一致。

在同一 v2 daemon、独立空 profile 和两轮共 48 次真实 tab 点击下，
`perf/desktop-interaction-followup@74f05b527` 相比 `origin/main@3d86c738f`：

| 指标                       | 最新 main |    优化版 |  改善 |
| -------------------------- | --------: | --------: | ----: |
| 正文一致 p50（48 次合并）  |  842.7 ms |  774.5 ms |  8.1% |
| 正文一致 p95（48 次合并）  | 1589.4 ms |  989.7 ms | 37.7% |
| Long Task p95              |   1589 ms |    989 ms | 37.8% |
| React duration p50         | 3519.5 ms | 3163.1 ms | 10.1% |
| React duration p95         | 6998.5 ms | 4250.7 ms | 39.3% |
| GC 后 DOM                  |    59,391 |    35,668 | 39.9% |
| inactive timeline DOM      |    44,968 |    21,244 | 52.8% |
| GC 后 JS heap              | 1017.8 MB |  853.4 MB | 16.2% |
| renderer RSS p50           | 3015.4 MB | 2851.7 MB |  5.4% |
| physical footprint         | 2048.0 MB | 1433.6 MB | 30.0% |
| physical peak              | 3891.2 MB | 3686.4 MB |  5.3% |
| workload renderer CPU time |   38.36 s |   29.37 s | 23.4% |

两轮结果都显示 title/body mismatch p50/p95 为 0。优化解决了“新标题配旧正文”的
一致性问题，但 0.99 秒 p95 仍远高于 16/50 ms 交互预算。

### workspace、subagent、工具详情

| 指标（3 次，p95）        | 最新 main |    优化版 |  改善 |
| ------------------------ | --------: | --------: | ----: |
| 切到冷 workspace         |  455.9 ms |  354.1 ms | 22.3% |
| 切回重型 workspace       | 1381.9 ms | 1267.2 ms |  8.3% |
| 重型 workspace Long Task |   1170 ms |   1063 ms |  9.1% |
| 展开 108 个 subagent     |  165.2 ms |  161.4 ms |  2.3% |
| 展开工具详情             |   69.5 ms |   67.6 ms |  2.7% |

侧边栏切 workspace 仍卡的主因不是侧边栏按钮，而是重新激活重型 workspace 后的
timeline/store 恢复、React commit 和 RN Web layout。subagent 列表和工具详情是次级成本。

### 饱和门槛：仍未通过

把所有 5,394 条历史分页全部拉入同一 renderer 时，两版都在进入正式切换前 OOM：

- main：约 162.2 秒，V8 heap 3,989.5 MB，`Reached heap limit`。
- 优化版：约 140.8 秒，V8 heap 3,987.3 MB，`Ineffective mark-compacts`。

因此当前 P0 只降低了挂载/渲染成本，没有建立客户端 timeline store 的硬内存上限。
长时间运行后仍可能回到用户观察到的 3.2–3.7 GB footprint 和大规模 page-in。

### Markdown 判断

生产级 tail 场景的 1 MiB 未闭合代码冷开没有稳定的 ready-time 收益（一次配对中
395.2→432.2 ms，另一轮 292.3→301.7 ms），但最大 Long Task 198→162 ms。最大的单 tab
收益来自只有 39 条、但包含约 200 KB 单消息的 A6：main p50 1578.9 ms，优化版
574.8 ms。这继续支持“超长单消息/高亮是尖峰热点”，但普通重型切换的主成本仍是
timeline 视图构建和布局，不应仅靠更换 Markdown 库解决。

## 优化账本与下一优先级

| 优先级 | 项目                                   | v2 证据                                             | 状态                   |
| ------ | -------------------------------------- | --------------------------------------------------- | ---------------------- |
| P0     | 客户端 history/tail 硬上限与可回收分页 | 两版 full-history 都在约 4 GB OOM                   | 未解决，下一项         |
| P0     | inactive panel 有界 LRU/卸载           | 优化后仍有 21,244 inactive DOM、2.85 GB RSS p50     | 部分完成               |
| P1     | 重型 workspace 恢复增量化              | 切回 p95 1267 ms、Long Task 1063 ms                 | 未解决                 |
| P1     | 超长单消息 Markdown 分段/worker        | A6 优化后仍 575 ms p50                              | 部分完成               |
| P1     | subagent track 虚拟化                  | 108 行展开 p95 161 ms                               | 未解决、次于 workspace |
| P2     | Explorer Changes 首次查询              | 685 个 dirty files fixture 已具备，尚未形成可信 A/B | 待测                   |

## v1 smoke（不可外推）

以下 H176 结果只保留为早期方向验证。它没有工具调用，数据量比生产校准 fixture 小约
一个数量级，不能作为最终收益数字。

### v1 最终严格场景

| 指标                        | 最新 main |   优化版 |     改善 |
| --------------------------- | --------: | -------: | -------: |
| 切换正文一致 p50            |   130.1ms |   81.8ms |    37.1% |
| 切换正文一致 p95            |   226.0ms |  144.3ms |    36.2% |
| 切换 Long Task p95          |     203ms |    119ms |    41.4% |
| 最大 frame gap p95          |   226.0ms |  144.3ms |    36.2% |
| React commit 数 p50 / p95   |     9 / 9 |    8 / 9 | p95 持平 |
| React duration p50          |   496.6ms |  297.8ms |    40.0% |
| React duration p95          |  1036.9ms |  642.7ms |    38.0% |
| 单次切换 heap 增量 p50      |    23.2MB |   12.7MB |    45.3% |
| 单次切换 heap 增量 p95      |    29.3MB |   23.9MB |    18.4% |
| 1 MiB Markdown 冷开         |  2858.7ms |  286.5ms |    90.0% |
| Markdown Long Task 总时长   |    2635ms |    254ms |    90.4% |
| Markdown 最大 Long Task     |    2384ms |    110ms |    95.4% |
| Markdown 打开后 heap        |   243.6MB |  205.1MB |    15.8% |
| GC 后 DOM 节点              |      4609 |     2628 |    43.0% |
| active timeline DOM 节点    |      1316 |      656 |    50.2% |
| inactive timeline DOM 节点  |      2206 |      886 |    59.8% |
| AX 节点                     |      2110 |     1464 |    30.6% |
| GC 后 JS heap               |   206.7MB |  172.1MB |    16.7% |
| renderer RSS 峰值           |  1172.7MB | 1008.4MB |    14.0% |
| renderer physical footprint |   636.9MB |  458.3MB |    28.0% |
| physical footprint 峰值     |  1433.6MB |  893.0MB |    37.7% |
| renderer CPU time           |    9.346s |   4.905s |    47.5% |

两组的 title/body mismatch p50/p95 都是 0ms；每次切换的标题、选中态和正文在同一
animation frame 达到一致。掉帧计数 p50/p95 都是 1，没有改善；但对应最大 frame gap
p95 从 226.0ms 降至 144.3ms。

## 方法

1. H176 workspace 的 8 个 Agent 各有 176 条 projected timeline item。
2. 逐个加载到 turn 1，再回到底部 turn 88；随后循环 3 轮，共 24 次真实 tab 点击。
3. 点击前同步挂载 Long Task、rAF、React Profiler 和 title/body 一致性探针。
4. 数字 pass 结束后再录 GIF，截图/压缩不进入延迟与 CPU 指标。
5. Markdown 使用从未访问过的 Light workspace 专用 Agent，从 Command Center 行点击开始
   计时，到 1 MiB prompt 和代码正文同时可见为止。
6. 两个版本使用同一 fixture daemon PID 84875；生产 6767 daemon PID 5275 全程未重启。

绝对数字来自 Electron dev build（日志明确显示 Performance optimizations: OFF），适合
同机 A/B，不应直接当作 packaged release 的绝对 SLA。

## Run 与视觉证据

- main：`20260720_015914__latest_main__2a0ee8`
- 优化版：`20260720_020120__optimized_p0__e229c4`
- main GIF：`runs/2026-07-20/20260720_015914__latest_main__2a0ee8/artifacts/latest_main-desktop-version-ab.gif`
- 优化版 GIF：`runs/2026-07-20/20260720_020120__optimized_p0__e229c4/artifacts/optimized_p0-desktop-version-ab.gif`

## 解释与剩余短板

- React commit p95 仍是 9，说明收益主要来自每次 commit 的工作量下降，而不是 commit
  数量消失。下一步仍可减少切换时的同步 store/layout 更新。
- 优化版切换 p95 144ms、Long Task p95 119ms，仍明显高于 60fps 预算；timeline layout 与
  RN Web 视图构建仍是下一层瓶颈。
- 1 MiB Markdown 最大 Long Task 已降到 110ms，但仍超过 50ms。下一步应继续切分首个可见
  code block 的同步工作，或把剩余 token tree 构建放到 idle/worker。
- renderer RSS p50 几乎持平（983.5MB 对 981.6MB），但 GC heap、physical footprint 和峰值
  明显下降；macOS Chromium 的 RSS 包含可回收/共享页，physical footprint 更能反映实际压力。
- sampled CPU p95 受多核瞬时调度影响，优化版反而更高（213.4% 对 180.3%）；完整 workload
  CPU time 从 9.346s 降到 4.905s，后者是更稳定的总成本指标。

## Eager inactive ablation

未关闭 H176 自带 Markdown tab 时，main 会先在后台构建完整隐藏内容，因此之后点击只需
200.5ms；对应 DOM 为 4638。优化版保留更小 inactive window（DOM 2659），之后激活原
H176 Markdown tab 需要 2605.4ms。这不是冷开 renderer 对比，而是“后台预付成本 vs 激活时
付成本”的产品策略差异。最终严格场景用独立、从未访问的 Markdown workspace 消除了该污染。
