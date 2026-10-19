# Unified completion whole-service benchmark

Measures `UnifiedCompletionService` only; the historical file-only comparison was removed.

```sh
cd packages/workbench-server
pnpm exec tsx test/benchmarks/completion-whole-api.benchmark.ts --run
# Smoke or individual sizes (100–100000 entries):
pnpm exec tsx test/benchmarks/completion-whole-api.benchmark.ts --run --sizes=1000
pnpm exec tsx test/benchmarks/completion-whole-api.benchmark.ts --run --sizes=20000
```

Requires the rebuilt current native addon (`pnpm build:native`). Defaults to 20k and 100k entries, each in an isolated subprocess with exposed GC. Synthetic file/directory entries are generated inside discovery; cold first-query wall time includes discovery, native index construction and waiting for fresh synthetic source catalogs. Imports and service construction precede cold timing. Warm queries are nine sequential rounds of a fixed ten-query mix (including Unicode and multi-term input), with display limit eight. Two conversation-context switches assert that the global file corpus is not rediscovered or rebuilt. JSON reports p50/p95, event-loop histogram and 5ms timer lag, RSS/heap snapshots, and awaited disposal. GC occurs outside timed regions.

## Recorded run

2026-10-20, Linux x64, Node v24.21.0, current native addon; 20,000 generated entries plus synthetic non-file catalogs. A separate 1,000-entry smoke run passed.

| Measurement                           |                20k |
| ------------------------------------- | -----------------: |
| Cold first query                      |          112.40 ms |
| Warm p50 / p95 (90 queries)           |    6.71 / 12.10 ms |
| Cold max histogram delay / timer lag  |   13.41 / 33.19 ms |
| Warm max histogram delay / timer lag  |    11.06 / 1.01 ms |
| Two context switches                  |           15.86 ms |
| Disposal                              |            5.73 ms |
| Initial RSS / heap used               | 151.92 / 40.36 MiB |
| After cold RSS / heap used            | 191.88 / 45.55 MiB |
| After warm + switches RSS / heap used | 192.35 / 45.73 MiB |
| After disposal RSS / heap used        | 188.83 / 40.72 MiB |

A 100,000-entry run also passed on the same platform: cold **494.00 ms**, warm p50/p95 **34.20 / 67.26 ms**, cold/warm max histogram delay **34.90 / 10.90 ms**, cold/warm timer lag **154.41 / 1.01 ms**, disposal **26.49 ms**.

## Caveats

Synthetic inputs, one platform and one cold sample per size are not real-workspace or cross-platform evidence. No real filesystem discovery, network, transport or renderer is measured. Histogram delay includes its 10ms sampling floor and may have no samples during short phases; the timer is a separate lag probe. RSS includes JS/native allocations and allocator retention, so disposal need not return it to baseline. Process-startup costs are excluded; forced GC differs from normal runtime. Shared-machine load can affect timings. Results are informational, not performance thresholds or quality claims; judged ranking has a separate benchmark.
