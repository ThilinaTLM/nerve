# Completion TS-first benchmark

Run from `packages/workbench-server`:

```sh
pnpm exec tsx test/benchmarks/file-completion.benchmark.ts
# Optional: COMPLETION_BENCH_ROUNDS=30 pnpm exec tsx test/benchmarks/file-completion.benchmark.ts
```

No project lookup, Git discovery, filesystem traversal or real user data is used. `file-completion-baseline.ts` is a frozen pre-optimization oracle, imported only by tests/benchmark, not a second production engine.

## Method

Synthetic retained candidate arrays contain 1k, 20k and 100k Git-like paths, mixed ASCII/Unicode names and directories. Candidate creation is timed separately. Every query first checks exact output parity and warms both engines. Nine subsequent rounds alternate engine order and time the **entire synchronous `completeFileCandidates` call**, including normalization, ranking, selection and result conversion. Results have the existing eight-item cap. This is not just a matching kernel, but also not the service/protocol/filesystem end-to-end API.

Seven consecutive queries measure a separate rapid burst. A zero-delay timer scheduled before that burst records timer dispatch delay, a direct blocking indicator, not a `monitorEventLoopDelay` histogram or statistically sampled event-loop p95. JSON also records candidate build time, process RSS snapshots and combined CPU time for both engines. Shared-process RSS includes both engines, warmup, garbage and previous sizes; it does **not** establish comparative memory usage or index disposal behavior. No forced GC is used.

## Results

Linux x64, Node v24.21.0, nine rounds. Small sample p95 is effectively the slowest sample and is noisy; these are local observations, not cross-platform evidence. The checked-in harness prints full per-query p50/p95 data for repeatability.

Final-run values (milliseconds; baseline → optimized):

| Candidates | Query                         | p50               | p95               |
| ---------- | ----------------------------- | ----------------- | ----------------- |
| 1k         | ordered `app/Composer`        | 4.968 → 4.065     | 5.448 → 4.262     |
| 20k        | broad prefix `packages`       | 27.441 → 5.253    | 35.304 → 14.622   |
| 20k        | basename `CompletionService`  | 21.100 → 9.940    | 30.246 → 10.778   |
| 20k        | fuzzy `CED`                   | 42.274 → 28.210   | 49.051 → 29.292   |
| 20k        | unordered `server Completion` | 39.658 → 18.926   | 43.788 → 19.349   |
| 20k        | ordered `app/Composer`        | 84.341 → 61.949   | 86.237 → 66.102   |
| 20k        | Unicode `résumé`              | 27.053 → 10.919   | 28.410 → 11.272   |
| 20k        | miss `no-such-match`          | 15.334 → 5.568    | 16.756 → 6.317    |
| 100k       | broad prefix `packages`       | 174.856 → 25.860  | 200.767 → 28.534  |
| 100k       | fuzzy `CED`                   | 214.296 → 141.153 | 224.020 → 146.615 |
| 100k       | ordered `app/Composer`        | 432.522 → 314.425 | 444.294 → 332.012 |

Seven-query burst timer delays: 1k 15.229 → 8.889 ms; 20k 252.521 → 142.531 ms; 100k 1377.059 → 726.298 ms. Candidate build times were 1.993 / 30.525 / 128.779 ms respectively. Process RSS after both engines' queries was approximately 114 / 303 / 635 MiB, not attributable to either engine independently.

## Interpretation of the TS stage

Bounded stable top-eight selection is especially beneficial for broad matches. Query/term normalization and reuse of retained lowercase segments also reduce work even on misses. Matching still dominates ordered/fuzzy searches at larger sizes. The initial TS-only stage added no production logs, telemetry, native resources, cache changes or schema changes.

The TS measurements made a completion-index pilot a reasonable **next experiment**, not by themselves an established Rust speedup. Keep it asynchronous and retain candidate data across queries; compare complete calls including index build/replacement, N-API transfer, disposal and total process RSS against this optimized TS implementation. Worker-based isolation remains an alternative if responsiveness rather than throughput is the deciding requirement. No native implementation was added in the initial TS stage. The subsequent single native pilot and service lifecycle integration are measured separately below.

Workload caveats for the pilot:

- Equal weighting of seven unrelated queries is not observed user traffic. Benchmark realistic incremental typing, backspaces and pauses as well as bursts, with explicit queue/backpressure policy; an async worker must not merely accumulate obsolete queries.
- Empty, one-character non-path queries and trailing-slash queries use live directory listing in the service and should not be credited with index speedups. `app/Composer` has no trailing slash and does exercise ranking.
- The synthetic broad prefix intentionally matches almost every candidate. Paths have uniform depth and correlated leaf/parent names; Unicode is deliberately overrepresented. Vary selectivity, depth, directory ratio, basename collisions, repeated terms and fuzzy target length before drawing general conclusions.
- 20k approximates the fallback walk cap; Git discovery can exceed it. 100k is a synthetic large-Git scenario, not evidence that typical projects reach that size.
- Preserve locale comparator ties, duplicate input order, folder intent, case-sensitive score bonuses and UTF-16 highlights. Native byte offsets and a different collation must not silently change results.
- Gather more samples, isolate engines/processes for memory/CPU comparisons, and measure supported platforms. Do not treat one Linux run as Windows/macOS evidence or synthetic ranker timing as a production request SLA.

## Expanded workload

```sh
pnpm exec tsx test/benchmarks/file-completion-workload.benchmark.ts
```

This freezes both TS implementations (`file-completion-baseline.ts` and `file-completion-optimized.ts`) for pilot comparisons. Seed `0x5eed` models 70% depth 2–5, 25% depth 6–10 and 5% depth 11–16, approximately 10% directories and 5% Unicode leaf names. These are declared synthetic assumptions, not observed repository distributions. Queries include incremental typing/backspacing, selective unique basenames and full paths, deep ordered/unordered matches, misses and Unicode. Paced arrivals are 60ms apart, burst arrivals 8ms apart, followed by a pause and unrelated search.

The scheduler measures intended-arrival-to-result age, intake lateness, obsolete completed results, dropped requests, maximum pending count and 5ms heartbeat lag. It compares FIFO against one-active/one-latest-pending **benchmark policies**; latest-pending never cancels active work and is not the server's production policy. A fast synchronous call can complete before a timer's exact intended timestamp, so tiny negative intake lag is ordinary timer granularity. Overflow, FIFO serialization, deterministic generation/parity and failure cleanup have unit coverage.

In the three-round expanded TS run, 20k selective full-path p50 improved 118.747 → 88.161ms, while `Composer` still cost 64.250ms optimized. Burst FIFO response-age p95 improved 445.690 → 300.347ms. Latest-pending optimized response-age p95 was 101.898ms by dropping four of ten requests, not by performing equivalent work faster. This workload confirmed the hotspot was not limited to the original broad-prefix benchmark.

## Native pilot: isolated complete-call gate

```sh
pnpm exec tsx test/benchmarks/file-completion-native.benchmark.ts
# Short harness smoke:
COMPLETION_BENCH_SIZES=1000 COMPLETION_BENCH_ROUNDS=1 pnpm exec tsx test/benchmarks/file-completion-native.benchmark.ts
```

Each size/engine runs in a fresh Node child with explicit GC available. Engines are frozen optimized TS, the public native facade plus production output adapters, and the actual `FileCompletionService` with synthetic injected discovery. The service snapshot retains only original path/kind metadata, reconstructing at most eight candidates for result adaptation; it does not retain the full JS normalization graph alongside native state. Native module load is reported separately. Cold first-complete includes synthetic candidate construction, index construction, and the first `Composer` query. Filesystem/Git discovery and protocol transport remain excluded.

All cold and warm outputs are compared exactly against TS in the parent, outside measured child processes. This avoids contaminating native RSS with a second TS oracle graph. A separate native unit gate covers hundreds of deterministic generated/edge queries at limits 0/1/8, including lowercase expansion (`İ`), supplementary/unpaired surrogate strings, canonical locale ties, duplicate candidates, distinct/repeated segments, unsafe queries and >6-term exact/prefix fastpaths.

The harness reports per-query p50/p95, cold/index-build timing, cold/index-build/close heartbeat delay, process CPU, stream response age and heartbeat lag. RSS includes the addon, native allocations and actual service snapshot metadata. `resourceUsage().maxRSS` is converted from KiB to bytes. Forced post-close GC is timed separately and is not included in close latency; allocator high-water retention means closed resources need not return RSS immediately to baseline. Warm batch heartbeat lag measures the whole uninterrupted batch, whereas the stream heartbeat metrics are the useful paced/burst responsiveness comparison.

Nine-round Linux x64 / Node v24.21.0 observations, optimized TS → actual service:

| Metric                                   | 1k              | 20k               | 100k               |
| ---------------------------------------- | --------------- | ----------------- | ------------------ |
| `Composer` p50 ms                        | 3.826 → 0.859   | 59.886 → 15.113   | 299.827 → 69.170   |
| selective full-path p50 ms               | 5.253 → 1.982   | 79.218 → 28.807   | 406.710 → 141.779  |
| cold first-complete ms                   | 17.316 → 15.655 | 147.764 → 167.783 | 555.716 → 926.870  |
| cold first-complete max heartbeat lag ms | 12.563 → 5.263  | 142.934 → 43.177  | 550.909 → 297.007  |
| retained process RSS MiB                 | 90.4 → 89.2     | 158.8 → 150.7     | 288.5 → 405.4      |
| peak process RSS MiB                     | 100.2 → 89.6    | 163.7 → 152.0     | 293.1 → 406.9      |
| post-close/GC process RSS MiB            | 96.5 → 89.6     | 160.7 → 146.3     | 287.3 → 379.1      |
| burst FIFO response-age p95 ms           | 3.188 → 2.124   | 307.013 → 37.644  | 1596.355 → 419.535 |

100k native service index construction took 553.671ms; synthetic candidate construction itself took 301.016ms synchronously and accounts for much of the cold heartbeat gap. The facade-only 100k build was 546.750ms. Service close took 41.361ms with 0.208ms maximum heartbeat lag, consistent with off-thread release rather than a synchronous large drop. Full facade call `Composer` p50 was 72.955ms at 100k, close to the service's 69.170ms; the service benefit is not a matching-kernel-only claim. Separate final harness diagnostics now expose index-build heartbeat lag independently of candidate construction as well.

**Decision:** the single completion pilot is justified for repeated warm cached interaction and Node-thread isolation, **not** as a universal latency or memory win. At 100k, cold first-complete regressed about 371ms and retained RSS grew about 117MiB. A rough arithmetic comparison amortizes that cold difference after approximately two additional `Composer` queries, but this is not a workload-independent guarantee: query selectivity, refresh frequency, project churn, allocator behavior and real traffic determine the actual crossover. Even native 100k ordered queries are not instantaneous. No broader Rust extraction follows from these results.

Service resource policy: at most eight current project roots (LRU), root reconciliation and awaited project/global disposal; active leases may temporarily outlive eviction until accepted callers finish. At most 32 accepted ranked callers per entry, with FIFO owned solely by the native facade. Shared refresh admission covers discovery plus build across all roots, including evicted entries: two active and sixteen waiting, with explicit overflow errors for cold ranked callers. Best-effort prewarming/failed background refresh retain the existing directory-listing/stale-response behavior. Finite negative internal limits reject because they imply unbounded result slicing; the public contract already validates positive integer limits ≤8. Other useful slice conversions remain supported.

Evidence remains local Linux-only, with nine samples per query and single scheduled streams per engine. Cold runs and process RSS are observations, not cross-platform proof or a production request SLA. The final resource-admission change is validated by deferred-factory unit tests rather than claimed as a measured performance improvement.
