# desktop_markdown_rendering v3

Payloads, splits, feedback sampling, and performance metrics are unchanged from v2. The scorer now
records both the default rendered-text hash and the rendered-text hash after expanding a bounded
long assistant message. Performance, DOM, AX, and heap are sampled before expansion; the expanded
hash must match the unbounded baseline so collapsed rendering cannot hide data loss.
