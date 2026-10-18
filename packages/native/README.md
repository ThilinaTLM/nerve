# `@nervekit/native`

Normalized TypeScript façades over one N-API Rust crate.

- `src/binding/`: private loading and composition of domain-local `binding.ts` contracts.
- `src/{git,monitor,process,search}/`: normalized façades and their private binding contracts.
- `native/src/{git,monitor,process,search}/`: plain Rust domain logic and `napi.rs` adapters.
- `native/src/process/platform/`: process-specific OS implementations.
- `native/src/core/`: existing runtime, cancellation flag, active permit, handle registry, error categories.
- `native/src/api/`: package capabilities and cross-domain composition only. Monitor Git reads are injected here, not imported by monitor.

Consumers import only the normalized root API. Raw bindings and prebuild paths remain private.

## Domain boundaries and lifecycle

`pnpm check:boundaries` checks TS imports/re-exports/import types/dynamic imports/literal
`require` paths and Rust rooted/relative paths, including grouped-root rejection,
module depth, and N-API placement. It checks production source, not tests/generated
bindings. Rust comments (including nested comments), strings/raw strings and character
literals are masked. This is a conservative lexical guard, **not** a Rust parser or
compiler-level isolation: macro-generated dependencies, `include!` and nonliteral TS
loading are not analyzed. Domain modules may use only their own internals and `core`;
TS façades additionally use the shared loader. Package composition is explicitly outside
that rule. There are no cross-domain exceptions. `pnpm check` includes the guard.

- **Git:** asynchronous read tasks; existing per-read output bounds and error categories
  remain unchanged. No cancellation, retryability field or new admission policy is added.
- **Monitor:** bounded scopes/registrations/notice paths; explicit close removes the
  handle before its worker drains and joins. In-flight registry references remain owned
  by tasks. Its Git read port uses the same read functions/options/fingerprint as before.
- **Process:** reject-at-capacity permits remain held for the managed-process lifetime;
  configure-before-first-spawn and platform enforcement/output/termination policy remain
  unchanged. OS implementations belong to this domain, not generic core.
- **Search:** the internal owner of the unchanged public file-completion API. See below
  for existing admission, cancellation and close semantics.

Core extraction does not impose a common lifecycle: it provides mechanisms already
used by their adopting owners. JS queues, search leases, monitor close/join and process
configuration stay domain-owned. Error extraction is only the existing Git category enum,
not a new `{ category, message, retryable }` wire/error model.

## Typed search

`await createSearchIndex({ signal? })` returns an in-memory, project-owned lexical
index. The signal owns the **entire index lifetime**: post-creation abort closes it,
rejects queued work, cancels active work cooperatively, and releases staged/retained
state on native workers. Explicit close detaches the caller's abort listener. There
is no per-query cancellation API or automatic supersession.

```ts
const index = await createSearchIndex({ signal });
await index.update({
  upsert: [
    {
      id: "pr:271",
      kind: "opaque-kind",
      fields: [
        { key: "identifier", text: "271" },
        { key: "title", text: "fix memory leak" },
      ],
    },
  ],
  remove: [],
});
const { revision, items } = await index.query({ text: "271 fix", limit: 64 });
await index.close();
```

IDs and kinds are opaque UTF-16 strings (including lone surrogates); providers own
stable namespacing, permissions, enabled state and freshness. Native does not execute
or enable anything. Results contain `id`, `lexicalScore`, and
`matches: { fieldIndex, ranges, score }[]`; ranges are zero-based UTF-16 half-open
coordinates within each original field. Path fields use `/`; a trailing `/` marks
a directory. Other legacy name/stem/depth overrides are not document metadata.

Updates replace entire documents atomically. Duplicate upsert IDs reject; removals
are idempotent, and remove+upsert of one ID leaves the replacement. Missing-only
removals/empty updates leave revision unchanged. Successful upsert/removal publication
advances revision once. Failed staging/validation publishes nothing and discards all
staged batches before the next request. One FIFO lane serializes updates and queries;
a response revision describes the coherent snapshot observed on that lane. Provider
source generations must still be checked by the owning TS coordinator.

`query({ text, kinds?, limit?, documentIds? })` optionally restricts matching to at
most **256 opaque document IDs** (1–1024 UTF-16 units each). Omitted means ordinary
dense index traversal; `[]` matches none. Native looks up only supplied IDs,
deduplicates them, ignores missing IDs and applies the same query/kind matching and
limit. No nonmatching items are injected. This is not authorization or a native
context/usage/state prior: TS owns bounded supplemental seeds and ranking policy.
For main-plus-supplemental retrieval, the project coordinator must serialize both
queries with updates (or check revisions); separate calls are not an atomic batch.

Query defaults to **64 candidates**, maximum **256**, independently of the UI's
visible eight. Kinds omitted means all; `[]` means none. Empty query has neutral zero
scores and the structural/ID tie order below. Nonempty queries require complete term coverage across fields:
identifier `271` plus title `fix ...` matches `271 fix`; either partial-only document
is excluded. Queries normalize backslashes, split whitespace/slashes, and support at
most 32 terms / 4096 UTF-16 units. The shared path assignment kernel retains its
six-term bound (exact/prefix path routes remain available); fuzzy text DP retains its
512-unit bound, while exact/prefix/substring matches can inspect larger fields.

### Score bands and ties

These are explainable initial numeric calibrations, **not** a claim of judged
cross-kind quality. The completion owner owns judged evaluation and final policy.
No native kind/usage/context/permission prior is applied.

| Field                | Multiplier / rule                                 |
| -------------------- | ------------------------------------------------- |
| `path`               | Existing file-path ranking, unchanged score rules |
| `name`, `identifier` | 1.00 × calibrated text score                      |
| `title`              | 0.95 × calibrated text score                      |
| `description`        | 0.75 × calibrated text score                      |

The one existing text primitive produces raw score `s`: exact 3600 (+80 same case),
prefix 3000 (+80 same case), substring 2350 (+300 boundary, −10 × offset, +80 same
case), or fuzzy alignment score. Typed text calibrates exact/prefix to `5*s`,
substring to `5*clamp(s,1800,2800)`, and fuzzy to
`3000+clamp(12*s/queryUTF16Length,0,9000)` before the field multiplier. Thus exact is
18000–18400, prefix 15000–15400, substring 9000–14000, fuzzy 3000–12000 before weights.
For each term the strongest field wins (field-index order breaks ties); average
these scores, or use stronger complete whole-field evidence. More fields/terms do
not generate unbounded additive bonuses. Match scores are contributions to the final
lexical score; ranges within a field are merged.

Paths retain exact-path base 20000, exact-name/stem base 18000, path-prefix base
16000, or segment base 7000 plus existing segment evidence; file/directory/ancestor,
depth and path-length rules remain in the single Rust matcher. Typed path highlights
use sparse normalized-alignment views for length-changing JS casing, then map back
to original source offsets. Existing path scores are retained when the legacy route
matched; newly supported normalized matches use that same primitive's score. The
legacy file adapter intentionally retains its old casing-coordinate quirks for
parity. Legacy ties retain host locale ranks
and stable input order. Typed score ties now prefer the shortest original UTF-16
path-field length (minimum across path fields), then opaque ID UTF-16 order;
nonpath documents use a consistent after-all-paths sentinel. This also applies to
neutral empty-query ties. Numeric scores and field matches are unchanged. The
intentional brevity policy uses no directory/name/context heuristics. Empty typed
queries differ from legacy file listing scores/order; fixtures cover these distinctions.

### Input, structure and lifetime bounds

These are **logical input/structure budgets, not an RSS ceiling**. Node/Rust allocator
pages, lowercase/aligned backing buffers, hash tables, other indexes and native domains
add overhead. Retained state, staged replacement data and queued input have separate
bounds and can coexist during an update.

- Typed retained index: at most **200,000 documents**, **400,000 fields**, and
  **2,000,000 structural records**, plus **64Mi UTF-16 source units** (IDs, kinds,
  original field text). A record is a document, field, derived original/lowercase
  path-segment view, or sparse casing span.
- Each update: at most 200,000 upserts and 200,000 removal IDs, with the same field,
  record and source budgets. All queued updates together reserve at most 400,000
  changes, 400,000 fields, 2,000,000 records and 64Mi source units before capture.
- A document has 1–32 fields, at least one nonempty text, and at most **65,536 total
  text units**; IDs are 1–1024 units, kinds 1–128. Empty optional descriptions are
  allowed alongside searchable fields. Oversized/empty structures reject before
  copying the captured graph or constructing casing strings.
- One active operation plus 32 waiting per index; update/cold-build preparation
  additionally shares two active / 16 waiting process-wide slots with the legacy
  file API. Overload rejects explicitly, never silently truncates.
- JS capture/preflight and sparse Unicode casing still consume Node time; native
  matching, publication and disposal run off-thread. Native transfers use bounded
  batches; close waits for active work and worker disposal. Finalization is fallback,
  not shutdown coordination.

### Compact storage and compatibility

ASCII casing and path component derivation happen in Rust. Original/lowercase paths,
names, stems and segments share UTF-16 backing views rather than retaining duplicated
strings. Host JS supplies only necessary Unicode casing/contextual-stem overrides
and sparse length-change metadata; no Rust Unicode-casing approximation replaces JS.
There is one lexical production matcher, reused by typed fields and the existing
file facade; no TS matching fallback or permanent old/new matching engines.

### Frozen synthetic measurement checkpoints

The measured optimization checkpoint passed 41 owning TS tests, 51 Rust unit
tests, legacy parity (25 queries / 1,201 candidates) and typed exact-output parity
(228 queries / 314 documents). These counts precede the subsequent intentional
structural-tie and bounded-ID-filter additions. Request-local preparation, deferred
top-k materialization, in-place range processing, bounded optional alignment caches
and dense document storage
retain one production matcher.

Linux x64 / Node 24.21.0 measurements used nine isolated trials per size/variant.
At 100k, optimized typed cold/RSS/upsert/disposal medians are 321.04 ms / 251.76 MiB /
0.93 ms / 23.71 ms. Its default-64 five-query burst improved from 318.66 to 203.89 ms,
but remains **5.4% slower than A/8's 193.41 ms**; at 20k the gap is 8.8%. The warm
no-regression goal remains unmet. Lead review accepts this as a provisional
engineering tradeoff pending whole-service completion measurements. Cold
heartbeat lag also remains higher than A. Pool-64 overhead explains only part of
the residual gap; these are not production or mixed-provider quality judgments.

See the [optimized per-query/pool measurements, hashes and limitations](test/search/search-query.benchmark.md)
and the [preserved pre-optimization whole-API regression evidence](test/search/search.benchmark.md).
Source/addon stayed frozen during each measurement window. The subsequent
coordinated functional rebuild passed **62 Rust units, 44 owning TS tests**, strict
legacy/structural-tie references and native package checks (including Clippy).
That build includes bounded IDs, typed structural ties and Git metadata/monitor
changes, but **has not been reprofiled**. C/D adoption and whole-service validation
remain lead-coordinated; the preserved benchmark addon is a distinct checkpoint.

## Completion-index pilot (internal search domain)

`await createFileCompletionIndex(candidates, { signal? })` retains a Rust snapshot.
Candidates supply `relativePath`, `name`, `stem`, `segments`, `depth`, and `kind`.
`await index.query(rawQuery, { limit? })` returns original `candidateIndex`, exact
unrounded `score`, and UTF-16 label `matchRanges`; item adaptation remains caller
policy. Limit defaults to 8; callers may request up to 256, including a 64-candidate policy pool.

The cold facade call includes sparse host JS Unicode-casing preparation, stable `localeCompare`
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
Negative, fractional, nonfinite, and over-256 limits intentionally reject rather than
emulating internal TS `slice` behavior.

Historical PR458 adoption evidence (different fixture/scope from the new library
benchmark): the server owns native completion routing, selected for the warm cached
workload following parity and whole-service comparison. Linux-only measurements reduced warm
Composer latency from 59.886 to 15.113 ms at 20k candidates and from 299.827 to
69.17 ms at 100k. Tradeoffs are material: 100k cold latency increased from 555.716
to 926.87 ms and RSS from 288.5 to 405.4 MiB. These results are not cross-platform
performance evidence. See the [detailed benchmark methodology and limitations](../workbench-server/test/benchmarks/file-completion.benchmark.md)
and the recorded comparison at `/tmp/nerve-completion-native.jsonl`.
