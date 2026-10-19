# Typed search benchmark

`search.benchmark.ts` measures the public typed search API in isolated subprocesses, including build/update/query/close timing, event-loop lag and total RSS. Aggregate repeated samples as p50/p95; synthetic Linux x64 results are not cross-platform evidence.

The removed file-completion API is no longer a benchmark variant. Earlier comparison tables have been retired; no replacement measurements were run for this cleanup.

Run from `packages/native` after rebuilding the release addon:

```sh
pnpm exec tsx test/search/search.benchmark.ts current /tmp/search.jsonl src/search/index.ts
```
