# Text-edit/diff profile — synthetic Linux x64 only

## Scope and reproduction

Profile-only evidence for proposal E; **not authorization to implement a native text kernel**. No production edits, filesystem mutations, real project contents, database access, native prototype or permission-policy changes.

```sh
cd packages/tools
pnpm exec tsx test/benchmarks/text-diff.benchmark.ts
```

The runner creates one subprocess per fixture/mode, with a 20-second wall-clock watchdog, `SIGKILL` on expiry, 256 MiB V8 old-space ceiling and 128 KiB captured-output ceiling. The heap ceiling is **not** an RSS/process-memory limit. A failed child stops further workloads; no automatic adversarial size escalation. All input is generated deterministically in memory; no random seeds or external files are required. The only source reads are the implementation/dependencies being profiled.

Measured owners:

- Kernel: actual `generateDiffString()` in `src/execution/filesystem/text-editing.ts`, calling installed `diff@8.0.4` `structuredPatch(context: 3)` and `formatPatch(OMIT_HEADERS)`.
- Pipeline: actual, unmodified `executeEdit()` source in `src/execution/filesystem/edit.ts`, transpiled with TypeScript and linked via Node VM modules. Whitelisted ports replace read, atomic write, queue admission and path resolution with memory-backed functions. All private validation, exact-match/ambiguity/overlap resolution, line metadata, reverse replacement construction, BOM/line-ending handling, diff and result/error mapping remain the owning source, not a copied benchmark algorithm. Unexpected runtime imports fail the harness. VM compilation and fixture setup are excluded from timing; VM overhead and output assertions during execution are included.
- Modes: one kernel call, one whole in-memory edit, and four in-memory edits admitted together with `Promise.all`. Burst mode intentionally excludes the real per-path mutation lane and filesystem/permissions/approval layers. It measures CPU/microtask contention, **not** same-path mutation correctness, filesystem throughput or tool-request latency. The identical synthetic payload is shared; each read captures the original before writes resume.

Each case computes one untimed oracle diff, then performs one mode warm-up and nine timed trials, with a 3 ms idle gap. Thus kernel mode sees two untimed kernel calls; pipeline/burst setup sees an oracle kernel call and one untimed pipeline call. p50/p95 use nearest-rank order statistics; with nine samples, p95 is the maximum, not a stable tail estimate. CPU is process user+system time during execution. A 1 ms timer is armed **before** each call/burst and observed afterward; reported lag is elapsed minus 1 ms, clamped at zero. This avoids an idle-diluted histogram hiding synchronous blocking; timer scheduling and GC noise remain. Memory reports post-call RSS maximum and OS process high-water RSS, both including the TS compiler, VM, module loader and fixtures; neither is incremental kernel memory. No competing-workload isolation or cold/JIT-discard/cache-eviction experiment is claimed.

Harness fixture bounds: original plus expected written bytes at most 2 MiB, expected patch at most 4 MiB, actual output checked for equality; bounded JSON summaries only, never patches. These are **benchmark safety bounds, not production limits**. Timed child setup/parity/failure checks are inside the outer watchdog too.

Fixtures:

- Small: 80 unique lines / one replacement; also a BOM+CRLF variant.
- Repeated: 10,000 identical lines around one unique edited marker (510,021 input bytes). This tests repetitive tokenization with a uniquely anchored edit, not a worst-case ambiguous alignment.
- Many replacements: 300 disjoint edits in 3,000 unique lines (165,000 bytes).
- Low similarity: wholly disjoint before/after line sets at 200, 800 and 1,600 lines, one whole-document replacement. Larger hostile inputs are intentionally not attempted.

## Platform-specific results (2026-10-18)

Local Linux x64, Node v24.21.0, Intel Core i7-13650HX; `diff@8.0.4`. Synthetic only; shared development machine. Re-run for supported macOS/Windows/other architectures before portability claims. Kernel and pipeline subprocesses have independent JIT/GC state, so subtracting their timings is not a precise stage attribution.

All 21 fixture/mode children completed inside their safety bounds (189 timed samples, including 63 four-edit bursts), with successful output and failure-semantics assertions. Exact machine-readable summaries, CPU times and process-memory observations: [`text-diff.results.jsonl`](text-diff.results.jsonl).

Times below are **milliseconds**; burst times are for all four calls, not per call.

| Fixture                     |  Kernel p50 / p95 | Pipeline p50 / p95 | Four-edit burst p50 / p95 | Burst timer lag p95 | Patch bytes |
| --------------------------- | ----------------: | -----------------: | ------------------------: | ------------------: | ----------: |
| Small                       |     0.150 / 0.282 |      0.332 / 0.528 |             0.339 / 1.640 |               1.013 |         193 |
| Small CRLF + BOM            |     0.211 / 0.357 |      0.416 / 0.606 |             0.642 / 1.177 |               0.260 |         193 |
| Repeated lines              |     4.619 / 6.672 |     9.064 / 11.700 |           21.015 / 39.250 |              38.368 |         378 |
| 300 replacements            |   21.467 / 32.874 |  452.212 / 482.754 |     1,722.348 / 3,780.321 |           3,785.618 |     140,303 |
| Low similarity, 200 lines   |     5.036 / 5.464 |      5.045 / 6.004 |           21.198 / 49.741 |              55.349 |      12,799 |
| Low similarity, 800 lines   |   59.913 / 91.494 |    63.450 / 93.297 |         258.955 / 303.291 |             302.357 |      51,799 |
| Low similarity, 1,600 lines | 251.598 / 287.322 |  251.723 / 284.079 |     1,002.551 / 1,129.655 |           1,128.714 |     105,001 |

Pipeline CPU p50 was 451.708 ms for many replacements and 252.422 ms for low-similarity 1,600 lines, consistent with CPU-bound synchronous work. The low-similarity kernel grows from 5.036 to 59.913 to 251.598 ms as lines grow 200 → 800 → 1,600; even the largest input is only 53,290 bytes. Byte limits alone therefore do not establish a responsive execution budget. Repeated-line input is much larger yet cheaper, so file size alone is also a poor predictor. Reported child high-water RSS spans 171.867–328.473 MiB, with compiler/harness overhead included; this is not evidence of standalone kernel memory use or a leak. The long many-edit burst tail is noisy shared-machine evidence, not a throughput SLA.

Implementation SHA-256 at measurement:

```text
text-editing.ts 9bccff0df2693de1d6351afbddf29cde3b1f6652ccc351e2b42199d4efe767b2
edit.ts         8e947be64c8b2af921db6d3470ac0e40e816379fec66854087d8c5705623a13e
```

## Input/output limits and failure semantics inspection

At this owner, `executeEdit()` reads the whole file and has no byte/line/edit-count limit; `parseEdits()` validates shape and nonempty edits but does not bound their number/length. `exactMatchOffsets()` retains every overlapping match before rejecting ambiguity. Each resolved edit computes two line numbers with prefix scans, and reverse replacement repeatedly constructs whole strings. Whole-string normalization and line-ending restoration add passes/copies. These are source-inspection observations, not separately measured CPU-stage attribution.

`generateDiffString()` has no patch-byte cap or timeout, calls synchronous jsdiff without `timeout` or `maxEditLength`, then formats the entire patch. jsdiff exposes those options, but simply enabling them is not a semantics-preserving change: abort/no-patch handling and tool reporting need explicit decisions. Downstream display truncation cannot prevent this upstream CPU/allocation work. No claim is made that every transport or model input has unlimited size; those are separate owners, not a kernel safety boundary.

**Write-before-diff hazard:** `executeEdit()` awaits the atomic write (temporary file then rename) **before** building `details.diff`. A later diff exception reaches the catch mapper, returning `EDIT_FAILED` with `appliedCount: 0` and operations marked not applied even though the file was changed. The harness injects a diff exception after memory-backed write and asserts exactly this existing behavior; it is an observation, not an endorsement. Missing-match failure is also checked to leave the write count unchanged. Successful runs assert patch parity, written bytes, BOM/CRLF preservation for the dedicated fixture, and operation count. This is bounded benchmark validation, not exhaustive edit correctness or real-disk durability testing.

## Recommendation / review gate

Do **not** start a Rust text domain from this evidence alone. Tiny edits are cheap, while many-edit transformation overhead can dominate the diff itself. Present these results and the post-write failure hazard to the user/lead first. If approved later, first define explicit input/output/work budgets and truthful post-write failure reporting; then measure TS exact-match/line-number/replacement construction improvements and terminable worker isolation against the same whole-pipeline workloads. Worker/native transfer costs, cancellation and bounded admission require their own measurement. A native candidate would remain pure asynchronous computation; permissions, approval, mutation queue, atomic-write ownership and result policy stay in TS.

No Rust implementation is authorized or started. Production limits/failure-semantics changes are out of this assignment and require lead/user review. Full focused validation remains serialized by the lead; no suites/integration tests were run.

## Validation handoff

- `cd packages/tools && pnpm exec tsx test/benchmarks/text-diff.benchmark.ts`: exit 0; all 21 cases / 189 timed samples and embedded output/failure assertions passed. Captured summaries are in `text-diff.results.jsonl`.
- `pnpm exec eslint packages/tools/test/benchmarks/text-diff.benchmark.ts`: exit 0.
- `pnpm exec oxfmt packages/tools/test/benchmarks/text-diff.benchmark.ts packages/tools/test/benchmarks/text-diff.benchmark.md`: exit 0; scoped to new owned files only.
- Reviewed the proposal diff: one implementation-status bullet added; historical research preserved. No production unit tests were needed/run because no production code changed. No focused/full repository checks, Rust tests, commits or PRs were run/created by this assignment.
