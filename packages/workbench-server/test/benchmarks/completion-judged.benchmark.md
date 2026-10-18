# Unified completion: synthetic judged baseline

Measured before policy tuning on 2026-10-18, Linux x64, Node v24.21.0. No real projects, user history, network, launches, or filesystem discovery were used.

```sh
cd packages/workbench-server
pnpm exec tsx test/benchmarks/completion-judged.benchmark.ts
```

The deterministic set has **56 judgments**, 44 invented paths plus 2,000 generated distractor files. Expected answers are declared independently of matcher output. The index is the existing native lexical production implementation. Each query asks for eight candidates. A missing intended answer contributes zero to all metrics, including MRR. Typed prefixes are deliberately passed unchanged to establish the pre-integration baseline; missing providers are not excluded.

| Category            | Queries |      Top-1 |      Top-3 |       MRR |
| ------------------- | ------: | ---------: | ---------: | --------: |
| Filename            |       8 |       100% |       100% |     1.000 |
| Partial path        |       8 |       100% |       100% |     1.000 |
| Ancestor directory  |      24 |       100% |       100% |     1.000 |
| Unicode             |       4 |       100% |       100% |     1.000 |
| Typed source intent |      12 |         0% |         0% |     0.000 |
| **All**             |  **56** | **78.57%** | **78.57%** | **0.786** |

Cold index construction: **20.78 ms**. Warm complete native-query calls (nine rounds after the judgment pass, 504 calls): **p50 1.39 ms / p95 2.91 ms**. Observed process RSS delta after querying: **10.19 MiB** (not isolated retained-index memory).

## Limits

This small synthetic corpus is intentionally an initial regression instrument, not evidence of real-user ranking quality. Repeated module templates favor clear lexical matches. Typed-intent cases expose missing routing/providers, not intrinsic fuzzy-matcher quality. The ancestor-directory cases exercise indexed lexical search, **not** the service's direct-directory branch. Unicode coverage is small. No renderer selection, network, discovery, cold filesystem, multi-project workload, event-loop lag, disposal cost, or cross-platform performance is measured here. Timing is informational, not a flaky unit-test threshold.

No tuned-quality or end-to-end speedup claim is made. Context/usage helpers have deterministic unit coverage; they are not wired into runtime/composer requests yet. Generalized native indexing and provider integration must rerun this baseline unchanged, and add ambiguity/context/source cases rather than replacing the initial judgments with easier ones.
