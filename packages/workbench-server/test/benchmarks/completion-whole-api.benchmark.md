# Synthetic whole-service API comparison

Provisional Linux/x64, Node 24.21.0 evidence, 2026-10-18. **Not full RPC/UI end-to-end, filesystem discovery, real-user accuracy, or a same-capability kernel comparison.**

Final frozen addon SHA256: `12405115cab5fad125576b23866df4a882ac90059b37fb471f2fc7229ab10252`. No native edits/rebuilds during this run. The preserved A facade/binary was not modified.

Raw observations: [`completion-whole-api.results.json`](completion-whole-api.results.json). Harness: [`completion-whole-api.benchmark.ts`](completion-whole-api.benchmark.ts).

## Method and different capabilities

- **A baseline:** actual `FileCompletionService`, preserved A/PR458 native facade, original retrieval **8**, display **8**, file-only, no context/usage policy. Passing even empty `{}` context would enable a different 64-candidate policy and is deliberately avoided.
- **Unified:** actual production providers and `UnifiedCompletionService`, main retrieval **64** plus one same-query/kind native-filtered lookup of at most **256** known context/usage/state IDs, deduplicated, display **8**. This fixture has empty usage history but active non-file state seeds; it does not measure a populated 1,000-entry usage store.
- Same invented path/kind fixture; roughly one in eleven entries is a directory. Generation is inside discovery and cold wall time. Baseline includes raw entries, legacy normalized name/stem/lowercase/segment graphs and locale sort; unified generates raw entries only and includes provider metadata/identity/native preparation. No workspace filesystem enumeration, network or transport. The unified empty temporary usage-store startup read is included; historical baseline has no usage policy.
- Separate process per size/variant, ordered A then unified at 20k, then A then unified at 100k. Module/addon loading and temporary-home creation precede the cold measurement. Explicit GC is outside timings; RSS/heap snapshots follow GC. RSS high-water is process-lifetime, not an isolated allocation counter.
- One cold sample per row; 90 warm service calls (nine rounds of ten filename/Unicode/multi-term queries). Two subsequent calls re-query the same baseline project; unified switches conversation overlays and back. Therefore the switch row is **not equivalent context functionality** in A.
- No thresholds, repeated-trial confidence intervals, production hardware claims or attribution to individual kernel changes. Controlled native-only comparisons belong to the native owner's separate evidence, not these rows.

## Wall time (ms)

| Entries | Variant         |    Cold | Discovery/generation (within cold) | Warm p50 | Warm p95 | Warm max | Two re-queries / overlay switches total | Awaited disposal |
| ------- | --------------- | ------: | ---------------------------------: | -------: | -------: | -------: | --------------------------------------: | ---------------: |
| 20k     | A8              | 113.430 |                             33.971 |    4.772 |    9.574 |   10.188 |                                   9.385 |            6.326 |
| 20k     | Unified64+seeds | 108.307 |                              1.673 |    4.898 |    9.542 |    9.706 |                                  11.231 |            5.194 |
| 100k    | A8              | 556.201 |                            179.261 |   22.690 |   48.347 |   49.345 |                                  49.542 |           25.081 |
| 100k    | Unified64+seeds | 463.263 |                              7.678 |   24.037 |   48.640 |   49.316 |                                  49.919 |           24.410 |

**Warm p50 regresses:** +2.6% at 20k and +5.9% at 100k. P95 is approximately unchanged at 20k and +0.6% at 100k. Cold wall time is lower in these samples, but this is **not a blanket no-regression claim**; the new route performs more work and has different features/budgets.

## RSS and retained JS heap (MiB)

| Entries | Variant         | Initial RSS | RSS after cold | Cold RSS increment | RSS after warm/switch | RSS after disposal | Cold lifetime peak RSS |
| ------- | --------------- | ----------: | -------------: | -----------------: | --------------------: | -----------------: | ---------------------: |
| 20k     | A8              |      149.35 |         188.07 |              38.72 |                188.07 |             184.07 |                 188.07 |
| 20k     | Unified64+seeds |      153.73 |         194.57 |              40.84 |                194.70 |             190.80 |                 197.31 |
| 100k    | A8              |      151.90 |         409.95 |             258.05 |                409.95 |             386.28 |                 412.95 |
| 100k    | Unified64+seeds |      153.81 |         381.36 |             227.55 |                381.36 |             363.60 |                 400.22 |

| Entries | Variant         | Heap used after cold | After warm/switch | After disposal |
| ------- | --------------- | -------------------: | ----------------: | -------------: |
| 20k     | A8              |                42.03 |             42.10 |          40.01 |
| 20k     | Unified64+seeds |                45.82 |             45.96 |          40.72 |
| 100k    | A8              |                51.34 |             51.42 |          40.06 |
| 100k    | Unified64+seeds |                65.13 |             65.30 |          40.76 |

At 100k, unified total and incremental cold RSS are lower in this sample. **At 20k both total and incremental cold RSS are higher**, and unified retained JS heap is higher at both sizes. Initial RSS differs, so totals alone are not a controlled allocation comparison. Disposal returns JS heap near startup levels, but RSS remains elevated; allocator/process RSS retention alone neither proves a leak nor proves memory returned to the OS.

## Event-loop observations (ms)

Histogram resolution 10 ms; independent interval probe every 5 ms. Both are limited observational probes, not a UI responsiveness guarantee.

| Entries | Variant         | Cold histogram samples / p99 | Cold max interval lag | Warm histogram samples / p99 | Warm max interval lag |
| ------- | --------------- | ---------------------------: | --------------------: | ---------------------------: | --------------------: |
| 20k     | A8              |                   7 / 12.075 |                29.687 |                  46 / 11.084 |                 0.991 |
| 20k     | Unified64+seeds |                   6 / 14.549 |                30.086 |                  46 / 11.010 |                 0.981 |
| 100k    | A8              |                  34 / 16.138 |               175.030 |                 222 / 10.887 |                 0.854 |
| 100k    | Unified64+seeds |                  28 / 29.164 |               138.311 |                 233 / 11.002 |                 0.997 |

At 20k, switch/disposal histograms have zero samples, so their p99 sentinel is not meaningful. At 100k, switch p99 is 10.863/10.461 (A/unified; four samples each), disposal p99 10.412/10.314 (one sample each). Switch/disposal interval-lag observations and unrounded phase summaries/counters remain in JSON. Cold histogram p99 is worse for unified even where its interval-lag maximum is lower; do not collapse those into an unqualified event-loop improvement claim.

## Work/lifecycle assertions

All rows discover once, create one index, and upsert the file/directory corpus exactly once (20k or 100k), unchanged by warm calls or context switching. A performs 93 native queries and returns 744 candidates across the measured calls; unified performs **186 queries** and returns 5,983 candidates. Unified also performs ten non-file upserts and one removal across initialization/switching. The extra retrieval, policy, typed metadata and overlay work is intentional feature cost, not equal-work kernel overhead.

Both 128-entry smoke variants and all four heavy rows pass their scope, visible-cap, one-discovery/one-index/corpus-once and awaited-disposal assertions. The exclusive window was released immediately after the heavy command exited; no additional timing runs are needed to justify these observations.

## Quality is measured separately

Unchanged invented judgments, actual final native matching/provider mapping/policy:

| Set                      | Cases |   Top1 |  Top3 |    MRR |
| ------------------------ | ----: | -----: | ----: | -----: |
| Original                 |    56 |  1.000 | 1.000 |  1.000 |
| Adversarial              |    19 | 0.9474 | 1.000 | 0.9649 |
| Typed provider coverage  |     9 |  1.000 | 1.000 |  1.000 |
| Cross-kind/context/usage |     8 |  1.000 | 1.000 |  1.000 |

Original56, provider9 and policy8 assertions are strict; adversarial top3 is strict. `session.ts` now ranks intended `src/auth/session.ts` third with generic typed structural ties; no fixture weakening or source-path prior. Legacy file-facade score/order parity is preserved by the native owner.

Additional actual-native tests pass: nonempty directory score/range parity, matching context beyond main64, unrelated context excluded by the same matcher, two-read revision coherence, prefix/kind/ID/current-conversation isolation, and initial `@`/all empty prefixes. Mixed13, dense54, original crowded218 and a strengthened crowded218 longer-wanted-path fixture verify context/usage/state visibility; the latter requires native-filtered retrieval of a wanted file absent from main64. Empty queries have no static file prior and do not claim legacy empty-score parity. Remaining recall is bounded by main64 plus 256 prioritized known seeds and display8, not arbitrary corpus rescue.

Owning units are `completion-{unified,empty,supplement}-native.test.ts` and `file-completion-document-native.test.ts` under `test/domains/completions/`. These quality sets are synthetic regression evidence, not real-user accuracy or latency evidence.

## Reproduction and limits

After obtaining the lead-approved preserved A facade/binary, and **only with an exclusive heavy-window GO**:

```sh
cd packages/workbench-server
pnpm exec tsx test/benchmarks/completion-whole-api.benchmark.ts --run --baseline /absolute/path/to/preserved-a-facade.ts
```

No extra heavy run is authorized by this document. Full RPC/network/render latency, real filesystem discovery, populated usage histories, live remote churn, broad platform evidence, browser/keyboard proof and combined repository validation are outside this timing result. No commits or native rebuilds were performed by the completion owner.
