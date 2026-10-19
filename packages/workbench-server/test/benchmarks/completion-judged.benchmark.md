# Unified completion: synthetic judged quality

```sh
cd packages/workbench-server
pnpm exec tsx test/benchmarks/completion-judged.benchmark.ts
```

Measures production provider mapping, typed native retrieval and unified ranking against independently declared synthetic judgments. Reports top-1, top-3 and MRR separately for the original 56 judgments, 19 adversarial judgments, nine provider-coverage cases and eight context/usage policy scenarios. Missing intended answers contribute zero. Lexical judgments use empty synthetic history and no context signals; policy cases explicitly seed invented signals. The historical file-only baseline and duplicate `completion-unified.benchmark.ts` entrypoint were removed. The shared harness remains because native correctness tests also use its ranking, policy and empty-prefix evidence.

The corpus combines invented paths, 2,000 distractor files and synthetic source catalogs. Warm timing uses nine rounds after judging and is informational. No real workspace discovery, network, user history, renderer or cross-platform quality claim is included. See `completion-whole-api.benchmark.md` for isolated whole-service timing.
