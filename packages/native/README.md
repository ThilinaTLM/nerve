# `@nervekit/native`

Normalized TypeScript façades over one N-API Rust crate.

- `src/binding/`: private loading and raw binding contract.
- `src/git/`: typed Git client and contracts.
- `src/process/`: managed process and child-process façades.
- `native/src/api/`: N-API DTO boundary.
- `native/src/git`, `process`, `platform`, `runtime`: Rust domain, OS, and execution internals.

Consumers import only the normalized root API. Raw bindings and prebuild paths remain private.

## Completion-index pilot

`await createFileCompletionIndex(candidates, { signal? })` retains a Rust snapshot.
Candidates supply `relativePath`, `name`, `stem`, `segments`, `depth`, and `kind`.
`await index.query(rawQuery, { limit? })` returns original `candidateIndex`, exact
unrounded `score`, and UTF-16 label `matchRanges`; item adaptation remains caller
policy. Limit defaults to 8 and must be an integer from 0 through 8.

The cold facade call includes host JS lowercase preparation, stable `localeCompare`
ranks (equal ranks for comparator-equivalent paths), and N-API conversion. Private
N-API strings use `Utf16String`, including lone surrogates, with no ICU dependency.
Rust owns matching/ranking; the facade retains no candidate graph after creation.
Build and query kernels and explicit disposal run on async native workers. Creation
appends at most 1024 candidates per private build call; JS stable locale sorting
uses bounded chunks and yielding merges. Cold JS sorting/conversion still consumes
Node time and must be included in whole-call latency/RSS measurement.

Cold construction has a process-wide admission gate: two active builds and at
most 16 waiting; overload rejects and waiting AbortSignals remove their requests.
Slots cover JS preparation, native append work, and failure cleanup.
Each index runs one query with up to 32 FIFO waiting requests; overflow rejects.
Raw queries above 4096 UTF-16 units reject before enqueue (protocol requests are
already limited to 512); no query is silently truncated. Queued work is FIFO, not
superseded automatically by newer queries.
`await index.close()` immediately cancels native work cooperatively, rejects queued
requests, releases the snapshot, and waits for the active query. Close is idempotent;
a closed index rejects new queries. The creation signal cancels only construction.
Finalization is a fallback, not a replacement for explicit close.

Creation rejects, never truncates, above 1,000,000 candidates or 64Mi UTF-16 source
units (path + name + stem + segments), rather than imposing the fallback walk's
20k entry cap. Discovery synthesizes directory candidates: huge or deep Git
snapshots can exceed these native caps even within the 16MiB Git listing bound.
Negative, fractional, nonfinite, and over-eight limits intentionally reject rather than
emulating internal TS `slice` behavior.

The server now owns native completion routing, selected for the warm cached workload
following parity and whole-service comparison. Linux-only measurements reduced warm
Composer latency from 59.886 to 15.113 ms at 20k candidates and from 299.827 to
69.17 ms at 100k. Tradeoffs are material: 100k cold latency increased from 555.716
to 926.87 ms and RSS from 288.5 to 405.4 MiB. These results are not cross-platform
performance evidence. See the [detailed benchmark methodology and limitations](../workbench-server/test/benchmarks/file-completion.benchmark.md)
and the recorded comparison at `/tmp/nerve-completion-native.jsonl`.
