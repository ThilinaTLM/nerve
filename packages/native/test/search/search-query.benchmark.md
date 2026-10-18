# Native search: warm-query optimization checkpoint

Measured 2026-10-18, **Linux x64 / Node v24.21.0**, synthetic data only.
This supplements rather than replaces the [preserved pre-optimization whole-API
report](search.benchmark.md).

## Decision summary

The optimized typed API preserves exact captured results and substantially reduces
its earlier warm regression. It **does not yet meet the no-material-warm-regression
goal** against A at the intended 64-result pool:

- 100k five-query burst p50: pre-optimization/64 **318.66 ms**, optimized/64
  **203.89 ms**, A/8 **193.41 ms**. Optimized is 36.0% faster than pre-optimization
  but still **5.4% slower than A**; p95 is 229.01 versus 208.50 ms (+9.8%).
- 20k burst p50: **39.74 versus 36.51 ms** (+8.8%); p95 45.55 versus 40.15 ms
  (+13.4%). The earlier single-trial pilot win did not persist across nine trials.
- At 100k, increasing optimized retrieval from 8 to 64 changes burst p50 from
  200.29 to 203.89 ms; at 20k, 39.51 to 39.74 ms. Thus returning 64 instead of 8
  does not explain most of the remaining gap. Path-containing queries retain
  regressions while `Com`/`Composer` improve at 100k. This is measurement-based
  localization, **not a causal CPU/allocator profile** or a completed isolated-cost
  diagnosis. Lead review/further profiling is required before claiming the goal met.
- Cold build and retained RSS remain below A, but typed cold heartbeat lag remains
  higher. Disposal duration improved substantially and remains off-thread.

No mixed-provider quality, production UI responsiveness, churn-performance,
cross-platform performance or universal speedup claim follows from these results.

### Subsequent lead decision and functional work

The lead reviewed the disclosed 5–9% p50 overhead as a **provisional engineering
tradeoff** for typed/default-64 capability; whole-service completion measurements
will decide final acceptance. This does not establish the no-regression goal.
Subsequent search work intentionally changes typed equal-score ties to shortest
original path length then opaque ID (nonpath sentinel after paths), and adds
bounded `documentIds`-filtered retrieval. Those additions are **not measured by
these frozen numbers**; legacy scores/order stay unchanged. No unbounded further
microoptimization is authorized ahead of the functional fixes.

The intentional tie change has its own strict reference, not a relaxed comparison:
`typed-parity.benchmark.ts --capture-structural` queries <=128-document shards of
the preserved matcher at limit 256, retaining **every** matching document before
applying only the specified structural/ID comparator and top-k. Scores and ranges
are never recomputed or tolerated. The frozen facade still passes the original
228-query exact capture; that capture remains unchanged. New explicit unit cases
put the longer path's opaque ID first, verify same-length ID determinism, neutral
mixed-field sentinel transitivity and legacy score/order preservation.

From `packages/native` (the last command requires the coordinated new addon):

```sh
pnpm exec tsx test/search/typed-parity.benchmark.ts /tmp/nerve-search-opt-53292194/src/search/index.ts --compare /tmp/nerve-search-typed-preopt-parity.json
pnpm exec tsx test/search/typed-parity.benchmark.ts /tmp/nerve-search-opt-53292194/src/search/index.ts --capture-structural /tmp/nerve-search-typed-structural-reference.json
pnpm exec tsx test/search/typed-parity.benchmark.ts src/search/index.ts --compare /tmp/nerve-search-typed-structural-reference.json
```

The generated structural reference SHA-256 is
`3bb54a3f00368afbc561d1e320e31e0af20332a6638bb266efd02a88744d00b8`.
Both reference-generation commands passed. After the coordinated Git freeze, the
combined rebuild also passed the new-addon comparison exactly. No heavy timings
ran during source edits.

## Changes measured

One production matcher remains shared with the legacy file facade. Optimizations:
request-local normalized queries/terms; defer ID cloning, output match-vector
allocation and coordinate remapping until top-k; merge/remap ranges in place;
optional sparse aligned-path caches charged to available structural-record headroom;
and dense document traversal with a separate ID-to-position map, full replacement
and swap-removal (no tombstones). ID comparison is lazy after score comparison.
Caches are skipped/evicted rather than rejecting otherwise-valid updates.

The dense-store pilot reduced the first optimized 100k/64 burst from 282.26 to
194.95 ms, but those one-trial numbers are diagnostic history, not the final result.
All exact typed pilot hashes matched. Dense-map replacement/removal has a 200-round
owning Rust churn test; this is correctness coverage, not a churn benchmark.

## Method

`search-query.benchmark.ts` ran **nine isolated subprocesses per variant and size**
(20k/100k): 54 processes total, serially. Source, declarations and the shared addon
were frozen for the complete window. Variants were A, preserved pre-optimization
typed, then optimized typed; variant order was not randomized. CPU affinity and
frequency were not controlled. This is local characterization, not a CI guarantee.

The corpus and whole-call cold/update/disposal semantics match the earlier report:
synthetic `packages/project-N/src/ComposerItemN.ts` paths, every 97th name using
`İstanbul`; typed IDs `file:N`, kind `file`, one path field. No discovery, filesystem
reads, Git, providers, user data, network or database work is exercised.

A supports eight results. Both typed variants are measured at **8, 64 and 256**,
with budget order rotated across isolated trials. Each trial warms every query and
budget, then runs nine rounds of individual queries and five-query sequential
bursts. There are **81 samples per query/budget/size/variant and per burst**, nested
within nine independent processes, not 81 independent trials. Results are hashed
outside timed query phases. All 30 typed size/query/budget combinations match
exactly between pre-optimization and optimized builds, consistently across rounds
and trials (2,430 hashes per typed variant).

Values below are **p50 / p95 in ms**. p95 is sorted index `floor(n*0.95)`, capped at
`n-1`; cold/update/disposal have only nine samples, so p95 is the maximum observed.
RSS is process RSS after explicit GC, not live native bytes or a memory ceiling.
Module loading and forced between-phase GC are excluded from durations. Heartbeat
lag is each phase's maximum 1 ms timer lag, including its 5 ms settling interval;
that settling interval is excluded from API duration.

## Five-query bursts

| Size | Variant          | Pool | p50 / p95       |
| ---- | ---------------- | ---- | --------------- |
| 20k  | A                | 8    | 36.51 / 40.15   |
| 20k  | Pre-optimization | 8    | 46.62 / 54.00   |
| 20k  | Pre-optimization | 64   | 49.24 / 61.29   |
| 20k  | Pre-optimization | 256  | 51.96 / 62.17   |
| 20k  | Optimized        | 8    | 39.51 / 45.05   |
| 20k  | Optimized        | 64   | 39.74 / 45.55   |
| 20k  | Optimized        | 256  | 41.03 / 46.67   |
| 100k | A                | 8    | 193.41 / 208.50 |
| 100k | Pre-optimization | 8    | 311.15 / 337.00 |
| 100k | Pre-optimization | 64   | 318.66 / 337.20 |
| 100k | Pre-optimization | 256  | 325.68 / 364.20 |
| 100k | Optimized        | 8    | 200.29 / 232.59 |
| 100k | Optimized        | 64   | 203.89 / 229.01 |
| 100k | Optimized        | 256  | 203.93 / 232.73 |

## Individual whole queries

Pre-optimization/8 and /256 samples also remain in the raw logs.

| Size | Query              | A/8           | Pre-opt/64    | Optimized/8   | Optimized/64  | Optimized/256 |
| ---- | ------------------ | ------------- | ------------- | ------------- | ------------- | ------------- |
| 20k  | Com                | 6.27 / 6.80   | 8.71 / 11.61  | 6.17 / 7.08   | 6.27 / 7.53   | 6.53 / 7.64   |
| 20k  | Composer           | 5.63 / 6.20   | 8.17 / 10.61  | 5.57 / 6.60   | 5.67 / 6.74   | 5.93 / 6.99   |
| 20k  | src/Com            | 11.22 / 12.64 | 14.30 / 17.57 | 11.49 / 13.38 | 11.52 / 13.03 | 11.90 / 13.20 |
| 20k  | project-3/Composer | 8.55 / 9.72   | 10.51 / 13.31 | 9.16 / 10.43  | 9.20 / 10.99  | 9.54 / 10.96  |
| 20k  | İst                | 5.29 / 6.12   | 7.19 / 9.25   | 5.58 / 6.71   | 5.70 / 6.62   | 5.82 / 6.59   |
| 100k | Com                | 34.40 / 36.40 | 59.58 / 65.72 | 32.15 / 37.34 | 32.25 / 37.89 | 32.60 / 38.39 |
| 100k | Composer           | 31.81 / 33.01 | 56.79 / 63.79 | 28.89 / 34.37 | 29.38 / 34.20 | 29.85 / 35.10 |
| 100k | src/Com            | 58.50 / 63.00 | 87.78 / 97.27 | 60.69 / 69.16 | 61.69 / 68.17 | 62.06 / 69.87 |
| 100k | project-3/Composer | 45.40 / 52.61 | 65.91 / 70.68 | 48.18 / 55.27 | 48.68 / 55.22 | 48.99 / 55.56 |
| 100k | İst                | 29.42 / 32.34 | 47.40 / 52.15 | 29.02 / 33.37 | 29.44 / 34.04 | 29.48 / 33.21 |

## Whole-API phases

A's changed-corpus workflow rebuilds a replacement while retaining the old owner;
typed updates atomically replace 100 documents. These are different capabilities,
not identical update operations. These new runs do not remeasure the legacy D file
facade; its earlier results remain explicitly in the pre-optimization report.

| Size | Variant   | Cold            | Replacement / upsert | Disposal      |
| ---- | --------- | --------------- | -------------------- | ------------- |
| 20k  | A         | 87.32 / 89.94   | 83.26 / 87.08        | 5.27 / 9.13   |
| 20k  | Pre-opt   | 70.77 / 73.53   | 0.90 / 1.01          | 8.42 / 9.44   |
| 20k  | Optimized | 70.45 / 86.89   | 0.86 / 1.48          | 5.29 / 5.72   |
| 100k | A         | 417.49 / 466.34 | 425.78 / 484.73      | 25.54 / 29.83 |
| 100k | Pre-opt   | 317.74 / 337.10 | 0.89 / 1.25          | 50.25 / 53.05 |
| 100k | Optimized | 321.04 / 326.44 | 0.93 / 1.29          | 23.71 / 25.18 |

RSS medians (MiB); no intermediate replacement-overlap/continuous peak sampling in
this harness. These samples follow substantially more warm queries than the original
whole-API harness and should not be substituted into that report's tables.

| Size | Variant   | Before input | After cold | After update | After close |
| ---- | --------- | ------------ | ---------- | ------------ | ----------- |
| 20k  | A         | 73.51        | 119.02     | 147.76       | 143.65      |
| 20k  | Pre-opt   | 74.35        | 109.34     | 117.68       | 114.74      |
| 20k  | Optimized | 74.95        | 110.32     | 118.94       | 116.59      |
| 100k | A         | 73.70        | 269.80     | 402.63       | 382.89      |
| 100k | Pre-opt   | 74.45        | 249.79     | 251.98       | 239.89      |
| 100k | Optimized | 75.21        | 251.76     | 253.95       | 242.23      |

Maximum heartbeat-lag distributions (ms); warm uses A/8 and typed/64.

| Size | Variant   | Cold          | Warm burst  | Replacement / upsert | Disposal    |
| ---- | --------- | ------------- | ----------- | -------------------- | ----------- |
| 20k  | A         | 7.93 / 8.95   | 0.64 / 0.95 | 6.87 / 7.21          | 0.34 / 0.80 |
| 20k  | Pre-opt   | 22.77 / 23.22 | 0.58 / 0.92 | 0.38 / 0.94          | 0.24 / 0.71 |
| 20k  | Optimized | 22.56 / 35.62 | 0.65 / 1.12 | 0.40 / 0.66          | 0.15 / 0.85 |
| 100k | A         | 53.37 / 59.13 | 0.57 / 1.19 | 32.83 / 38.05        | 0.17 / 1.30 |
| 100k | Pre-opt   | 87.63 / 94.12 | 0.59 / 1.28 | 0.30 / 0.64          | 0.18 / 0.44 |
| 100k | Optimized | 88.88 / 92.41 | 0.61 / 1.01 | 0.43 / 0.74          | 0.37 / 0.78 |

## Owning validation

- Release addon/declarations rebuilt successfully before measurement; 51 Rust unit
  tests passed (`cargo test --manifest-path native/Cargo.toml`). No Rust rebuild was
  performed after releasing the window to Git.
- 41 TS tests passed via `pnpm exec tsx --test` with exactly
  `test/search/{search-index,typed-path,search-lifecycle,file-completion-index,budget,lane,normalize}.test.ts`
  and `test/boundaries/internal-dependencies.test.ts` (shell-expand the brace list).
- `pnpm check:boundaries`, package-local `pnpm exec tsc -b --pretty false`, both
  parity captures, scoped ESLint/Oxfmt and search-only Rust formatting checks passed.
- Strict all-target Clippy was blocked by an out-of-scope `collapsible_if` warning
  at `native/src/git/project_status.rs:193`; the Git owner must resolve/recheck it.
  Combined focused validation and subsequent Git diagnostic/helper reruns belong
  to the lead's serialized window. No integration suites or commits were run.

## Reproduction and artifacts

From `packages/native`, with the preserved temporary facades/addons:

```sh
pnpm exec tsx test/search/search-query.benchmark.ts a8-final /tmp/nerve-search-query-a8-final.jsonl file /tmp/nerve-search-a-facade.ts 8
pnpm exec tsx test/search/search-query.benchmark.ts preopt-final /tmp/nerve-search-query-preopt-final.jsonl typed /tmp/nerve-search-preopt-828af0d5/src/search/index.ts 8,64,256
pnpm exec tsx test/search/search-query.benchmark.ts dense-final /tmp/nerve-search-query-dense-final.jsonl typed /tmp/nerve-search-opt-53292194/src/search/index.ts 8,64,256
```

| Artifact                                                                                    | SHA-256                                                            |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/tmp/nerve-search-query-a8-final.jsonl`                                                    | `fc6698aebc8a57d840bfcf0737cda56c98711bb453c70af381fa73b901b6a2ab` |
| `/tmp/nerve-search-query-preopt-final.jsonl`                                                | `29225303d78ec4bd11d3709cb126af6a0928c5853cbd2ded60cf6b37a36ebff0` |
| `/tmp/nerve-search-query-dense-final.jsonl`                                                 | `a010d16f91589690139e69da04178c66b8ba688bca85ee259e8248d34b76fea0` |
| Measured optimized addon: `packages/native/prebuilds/local/nerve_native.linux-x64-gnu.node` | `5329219457bf5a3d0985bd04a3e3d1bb97193ecf7f4ceef36a420dc585e1d90c` |

Baseline and pre-optimization addon hashes remain in the preserved report. Parity
captures: `/tmp/nerve-search-a-parity.json` (25 queries/1,201 candidates) and
`/tmp/nerve-search-typed-preopt-parity.json` (228 queries/314 documents, multiple
kinds/fields, updates and pools). Preserve raw logs, captures, frozen facades and
addons before temporary cleanup. No binaries are committed.

A frozen optimized facade/addon also lives at `/tmp/nerve-search-opt-53292194/`;
its loader points only at that preserved addon. The synthetic evidence archive
`/tmp/nerve-search-checkpoint-53292194.tar.gz` contains all three measured addons,
frozen facades, original/new raw logs and both parity captures (SHA-256
`1f7719b791aefdf46a5d08164aa1f14036476eca74b4b26f7b432ec5c543b1f4`).
It is evidence, not a hermetic source-build environment; retain/attach it before
`/tmp` cleanup.

### Subsequent coordinated functional build

After Git/core/api-monitor and search froze, the sole builder rebuilt the shared
release addon and native declarations. **62 Rust units and 44 owning search/boundary
TS tests passed**, including bounded-ID recall/filtering, input snapshots, lifetime
behavior, exact-basename brevity, same-length ID ties and legacy preservation.
Legacy parity (25 queries/1,201 candidates) and the strict structural-tie reference
(228 queries/314 documents) passed. Native `pnpm check` passed: boundaries,
TypeScript, Rust formatting and strict all-target Clippy; the earlier Git Clippy
blocker is resolved in this combined source.

Current functional addon SHA-256:
`12405115cab5fad125576b23866df4a882ac90059b37fb471f2fc7229ab10252` at
`packages/native/prebuilds/local/nerve_native.linux-x64-gnu.node`. Generated native
`prebuilds/local/index.d.ts` includes optional fourth `search` argument
`documentIds` and `readGitMetadataSnapshot`. Normalized consumers still use only
the root package API, not these private bindings/declarations.

The original measured addon/archive above remain preserved and distinct. **No
performance numbers in this report measure the subsequent functional build.**
Source/addon stay frozen for C/D adoption and Git diagnostic/helper reruns; the lead
owns those coordinated checks, whole-service measurement, global validation and
commits. No heavy reprofiling, global focused checks or commits ran in this build
window.
