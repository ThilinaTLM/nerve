# Native search: pre-optimization synthetic whole-API comparison

This checkpoint intentionally preserves the original regression evidence. See the
[optimization follow-up](search-query.benchmark.md) for newer per-query/default-64
measurements, exact-output hashes and the remaining warm-performance gap. Tables
below have not been replaced with later measurements.

Measured 2026-10-18 on **Linux x64 / Node v24.21.0**. These are local synthetic
measurements, not production traffic, cross-platform evidence or ranking-quality
judgments. Native source, declarations and addon stayed frozen throughout the
exclusive after-benchmark window. No filesystem discovery, user data, network,
database, providers or UI were involved.

## Result

The parity-preserving file API demonstrates lower cold-build time and retained
process RSS than the preserved A/PR458-behavior baseline. At 100k candidates, cold
p50 is **426.5 → 352.6 ms** (−17.3%) and retained RSS **269.8 → 224.1 MiB** (−16.9%).
Warm file bursts are approximately unchanged.

The new typed API has different identity/tie/highlight semantics and adds atomic
updates. Its 100k cold p50 is **317.0 ms**, retained RSS **249.2 MiB**, and a
100-document atomic upsert takes **1.07 ms**. This is not a universal improvement:
its five-query warm burst is **313.4 ms versus A's 199.5 ms**, cold heartbeat-lag
p95 is **91.8 versus 59.6 ms**, and disposal p50 is **50.3 versus 29.2 ms**.
Disposal remains off-thread: its measured heartbeat-lag p95 is **0.80 ms**.

Do not hide those regressions behind the incremental-update gain. The baseline has
no update API: its changed-corpus workflow rebuilds a replacement while retaining
the old snapshot, then closes/swaps the old owner. Incremental upsert is a new
capability, not a faster implementation of an identical baseline update operation.

## Method

- `search.benchmark.ts` runs **nine isolated Node subprocess trials per variant
  and size** (20,000 and 100,000). Each subprocess uses `--expose-gc --import tsx`.
- The deterministic corpus uses synthetic
  `packages/project-N/src/ComposerItemN.ts` paths; every 97th name uses `İstanbul`.
  All records are files. Typed documents have opaque `file:N` IDs, kind `file`,
  and one `path` field. No real paths are enumerated or read.
- Cold timing includes synthetic input construction, the complete public facade
  call, JS preprocessing/capture, N-API transfer, native preparation and publication.
  Entrypoint/module loading precedes timing. Direct implementation-module imports
  select the same exported public functions without unrelated facade import noise.
- After explicit GC, sample process RSS. This is **process RSS after GC**, not
  native live bytes or a guaranteed memory ceiling.
- Each trial runs nine warm bursts. A burst sequentially awaits five whole queries:
  `Com`, `Composer`, `src/Com`, `project-3/Composer`, `İst`.
  **All timed queries request eight results** to match A's limit. Typed default-64
  and maximum-256 behavior are unit-tested, not performance-profiled here.
- The changed-corpus phase changes the first 100 filenames by adding `Updated`.
  A and the new legacy facade build a complete replacement, retain the old index
  until it is ready, then await old-index close. Typed search atomically upserts
  those 100 complete documents with the same IDs; no removals are timed.
- Finally await explicit close. A 1 ms heartbeat records the maximum timer lag
  during each phase; JS capture, allocation/GC and conversion are included. Forced
  GC between phases is outside phase timing. A 5 ms settling interval captures
  pending heartbeat delivery but is not added to the API duration.
- p50 is the median. p95 uses sorted index `floor(n*0.95)`, capped at `n−1`.
  Cold/update/disposal have nine samples each: their reported p95 is consequently
  the largest observed sample, not a precise tail estimate. Warm bursts have
  **81 samples per variant/size**. Burst values are not per-keystroke latencies.

## Whole-call durations (ms)

Values are **p50 / p95**. “File replacement” is the changed-corpus workflow above;
“typed upsert” is an atomic 100-document update.

| Candidates | Variant       | Cold build        | Five-query warm burst | File replacement / typed upsert | Final disposal  |
| ---------- | ------------- | ----------------- | --------------------- | ------------------------------- | --------------- |
| 20k        | A baseline    | 87.750 / 123.692  | 37.603 / 42.667       | 81.688 / 90.489                 | 5.897 / 6.357   |
| 20k        | D file facade | 74.516 / 76.885   | 37.828 / 41.534       | 68.717 / 72.330                 | 3.641 / 4.733   |
| 20k        | D typed API   | 71.231 / 74.414   | 47.821 / 57.884       | 0.811 / 1.311                   | 9.085 / 10.761  |
| 100k       | A baseline    | 426.503 / 445.651 | 199.489 / 228.344     | 448.487 / 541.296               | 29.248 / 35.365 |
| 100k       | D file facade | 352.620 / 406.419 | 193.882 / 212.823     | 344.360 / 444.042               | 17.555 / 22.174 |
| 100k       | D typed API   | 316.977 / 322.034 | 313.424 / 333.380     | 1.071 / 1.315                   | 50.307 / 52.629 |

## Process RSS (MiB)

Values are medians of nine trials. “Update overlap sample” is the maximum of the
cold sample and explicit update checkpoints (for replacement, before old-index
close and after the swap). It is **not a continuously measured peak RSS**. Typed
upsert has no intermediate sampling inside its native task.

| Candidates | Variant       | Before input | After cold build + GC | Update overlap sample | After update + GC | After final close + GC |
| ---------- | ------------- | ------------ | --------------------- | --------------------- | ----------------- | ---------------------- |
| 20k        | A baseline    | 73.25        | 118.70                | 152.04                | 147.02            | 143.05                 |
| 20k        | D file facade | 73.62        | 102.23                | 133.81                | 130.82            | 125.88                 |
| 20k        | D typed API   | 73.63        | 109.64                | 109.95                | 109.95            | 106.98                 |
| 100k       | A baseline    | 73.28        | 269.82                | 423.34                | 401.63            | 381.79                 |
| 100k       | D file facade | 73.47        | 224.12                | 318.30                | 293.33            | 277.34                 |
| 100k       | D typed API   | 73.54        | 249.15                | 249.50                | 249.50            | 237.37                 |

Close releases owned native state on workers, but Node/native allocators need not
return freed pages immediately. These RSS samples do not establish live-allocation
counts or prove absence/presence of leaks; no allocator/heap profile was collected.
Logical source and structural limits are documented in the package README and must
not be described as RSS limits.

## Event-loop responsiveness (ms)

Values are **p50 / p95 of each phase's maximum heartbeat lag**, not API duration.

| Candidates | Variant       | Cold build      | Warm five-query burst | Replacement / upsert | Final disposal |
| ---------- | ------------- | --------------- | --------------------- | -------------------- | -------------- |
| 20k        | A baseline    | 7.809 / 10.511  | 0.469 / 0.939         | 6.760 / 7.495        | 0.264 / 1.041  |
| 20k        | D file facade | 7.887 / 9.563   | 0.662 / 1.017         | 6.834 / 7.455        | 0.263 / 0.453  |
| 20k        | D typed API   | 23.341 / 24.484 | 0.509 / 0.905         | 0.444 / 1.020        | 0.193 / 0.578  |
| 100k       | A baseline    | 53.515 / 59.613 | 0.722 / 1.241         | 32.827 / 43.027      | 0.217 / 1.131  |
| 100k       | D file facade | 54.878 / 57.537 | 0.638 / 1.202         | 32.084 / 42.370      | 0.484 / 1.273  |
| 100k       | D typed API   | 90.410 / 91.787 | 0.593 / 1.042         | 0.563 / 0.823        | 0.366 / 0.802  |

Cold input construction, synchronous validation/capture and host preparation remain
Node work. Off-thread kernels do not make the entire cold API nonblocking. The typed
warm-burst and disposal regressions warrant review; this experiment does not identify
their precise causes. No source optimization or pool resizing was performed during
the frozen measurement window.

## Behavioral boundary and validation provenance

- The baseline addon was preserved before D replacement. A was the mechanical
  organization checkpoint with PR458 file behavior; the baseline facade was
  reconstructed from `03ec66bed8eedb182e69731d93419dc6ad16a5ba`'s
  `packages/native/src/completion/file-completion-index.ts`, replacing only its
  private loader import to use the preserved addon. It is a temporary benchmark
  artifact, not a production fallback or second matcher.
- The final shared addon/declarations built successfully. Eight exact owning TS
  unit files passed **41 tests**, including budget/lifetime/stage-rollback and typed
  path remapping. Rust units passed **48 tests** before the coordinated final build.
- `parity.benchmark.ts` compared **25 queries over 1,201 synthetic candidates** to
  captured A results on this host and passed. This includes casing, lone surrogates,
  unsafe queries, paths, stems and accepted legacy component overrides. It is not
  exhaustive ranking parity or cross-platform locale proof.
- The typed API intentionally uses stable opaque UTF-16 ID ties and field-local
  highlights. Its path casing-expansion highlights are corrected; the file facade
  retains legacy coordinates/order/scores. Therefore typed-versus-A timing rows are
  capability characterization, not a claim of identical result ordering/highlights.
- This is a file/path corpus, not a judged mixed-provider set. The completion owner
  owns actual cross-kind judgments and policy tuning. README score bands describe
  numeric rules, not measured top-1/top-3/MRR quality.
- These results use different fixtures/scope from PR458's workbench-server service
  measurements. Do not report its 405.4 MiB service RSS as this experiment's baseline
  or infer whole-service startup/UI improvement from these whole-library calls.

## Raw artifacts and reproduction

All raw logs are synthetic JSONL, 18 trials per file (nine per size):

| Artifact               | Path                                           | SHA-256                                                            |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| A raw trials           | `/tmp/nerve-search-a-baseline-final.jsonl`     | `9489bad0821212c8784c8bd45d46bcb186e6a07ccb22c0d6b7ee51d0db8c2c6e` |
| D file raw trials      | `/tmp/nerve-search-d-legacy-final.jsonl`       | `27789edb397fc02f8a152ec581c7fc70383d99c075fb7527b404c5b7f93529bd` |
| D typed raw trials     | `/tmp/nerve-search-d-typed-final.jsonl`        | `9fb9b346f939d100dfde35dcf382dbf5232066b6369a20133836a04f2d1f68a5` |
| Preserved A addon      | `/tmp/nerve-search-a-baseline.node`            | `833e8c9d2220e1df96ee49f451e838fcde8a3dfa018f916fe6bd1b0ab5c608eb` |
| Pre-optimization addon | `/tmp/nerve-search-preopt-828af0d5/addon.node` | `828af0d5d593425565bf60c18bce0e1b96009eb2a3d09b3a51a8a07e50f5c992` |

Temporary artifacts also include `/tmp/nerve-search-a-facade.ts` and
`/tmp/nerve-search-a-parity.json`. Preserve/attach them and the raw logs before temp
cleanup if release evidence needs to outlive this worktree. No binary is committed.
Future A rebuilds must use a separate coordinated baseline environment, never replace
the shared addon while another owner is testing or measuring.

From `packages/native`, with the corresponding preserved/current artifacts:

```sh
pnpm exec tsx test/search/search.benchmark.ts a-baseline-final /tmp/nerve-search-a-baseline-final.jsonl legacy /tmp/nerve-search-a-facade.ts
pnpm exec tsx test/search/search.benchmark.ts d-legacy-final /tmp/nerve-search-d-legacy-final.jsonl legacy src/search/file-completion-index.ts
pnpm exec tsx test/search/search.benchmark.ts d-typed-final /tmp/nerve-search-d-typed-final.jsonl typed src/search/search-index.ts
pnpm exec tsx test/search/parity.benchmark.ts src/index.ts --compare /tmp/nerve-search-a-parity.json
```

Run heavy benchmarks serially. The lead owns repository-wide validation and commits;
these measurements are not full-validation equivalence. No DB/schema or production
user-data changes are part of this experiment.
