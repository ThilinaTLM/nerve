# Storage accounting benchmark

Run from `packages/workbench-server`:

```sh
NERVE_STORAGE_BENCHMARK=1 pnpm exec tsx test/benchmarks/storage-usage.benchmark.ts
```

Optional `NERVE_STORAGE_BENCHMARK_TRIALS=9` (integer 3–100). Only generated temporary trees are accessed; no Nerve home/database is opened. Trees are removed on completion. Output contains aggregate sizes/timings, never paths or contents.

## Method

Compare the old conversation-accounting work (cleanup tally, category tally, owner tally: three traversals) with one reusable traversal. Both use the same serial TS filesystem walker and must agree on aggregate and per-owner totals before timing. Tree creation and one parity/warm-up pass are excluded. Nine measured trials alternate order. Filesystem caches are warm/OS-managed, not forcibly evicted. Large files are written, not sparse; scans inspect metadata, not contents.

Report wall p50/p95, CPU p50, stage p50, sampled whole-process RSS and event-loop delay (1 ms histogram resolution, with 5 ms settling intervals outside wall/CPU timing). RSS is not an allocation delta and includes retained fixture buffers; samples every 5 ms can miss short peaks. Large-file calls are too short for reliable delay/RSS attribution. No N-API/transfer boundary exists. This measures the changed traversal kernel, not the whole dashboard API, concurrency latency, cancellation or cold-disk behavior.

## Linux x64 result (Node v24.21.0, 2026-10-18)

| Synthetic tree              | Logical size | Old wall p50 / p95 | Single-pass wall p50 / p95 | Old / new CPU p50 |
| --------------------------- | -----------: | -----------------: | -------------------------: | ----------------: |
| 40 owners, 2,000 tiny files |    128,000 B |   54.97 / 63.40 ms |           19.37 / 28.85 ms |  62.35 / 22.05 ms |
| 4 owners, 16 large files    |      128 MiB |     1.09 / 1.31 ms |             0.56 / 1.51 ms |    0.93 / 0.40 ms |

Tiny-file stage medians: old cleanup 17.88 ms, category 17.29 ms, owners 20.22 ms; new combined scan 19.37 ms. Large-file stages: 0.56 / 0.26 / 0.23 ms versus combined 0.56 ms. Tiny-file sampled RSS peaks were both 95.7 MB; large-file peaks 110.0 / 110.1 MB. Maximum across trial event-loop p95 readings: tiny 1.10 / 1.32 ms, large 1.92 / 1.87 ms (old/new).

Tiny-file median traversal time fell about 65% (2.84×); large-file p95 did not improve and should not be interpreted from nine sub-millisecond-scale samples. The results demonstrate redundant work removed, not a Rust speedup or cross-platform evidence. Storage Rust is deferred: no remaining user-facing traversal bottleneck is demonstrated, and completion is the selected native pilot. Representative cold/warm workload profiles and supported-platform parity would be required before reconsidering a native scan.
