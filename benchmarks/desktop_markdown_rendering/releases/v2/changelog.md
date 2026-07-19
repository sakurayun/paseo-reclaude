# desktop_markdown_rendering v2

Payloads and splits are unchanged from v1. The scoring harness now samples main-thread feedback
throughout the complete stream at 100ms intervals and records per-run p95/max delay. v1 sampled
feedback only once near stream start and is retained as calibration evidence, but must not be used
to accept interaction-latency candidates.
