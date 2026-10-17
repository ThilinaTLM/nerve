# Where additional Rust belongs

> Original research and recommendations are preserved below as historical context, not a claim that implementation is still unapproved or absent. See [staged implementation status](#staged-implementation-status-2026-10-18) for the implemented TS improvements and adopted completion pilot. Node/Electron are retained; no database schema changes are proposed.

## Conclusion

Expand Rust selectively around cohesive, bounded computation and OS primitives. Keep application orchestration and policy in TypeScript. Moving more lines to Rust is not itself a performance or maintainability improvement.

The best **CPU-oriented pilot** is file-completion ranking over a retained candidate snapshot, if profiling shows it blocks the event loop. The best **small OS/data-processing pilot** is an aggregate storage-tree scan, after eliminating duplicate walks in TypeScript. Extend existing Git and monitor capabilities only for demonstrated gaps or hot paths.

At the time of the original research, there were no new performance profiles or native prototypes behind these recommendations. The earlier slot-4 startup experiment did establish that avoiding repeated transcript materialization reduced recorded daemon initialization from 17.6 seconds to 348–399 ms **without** a Rust rewrite. Use that as the standard: first improve the work being done, then evaluate its implementation language.

## Original boundary (at research time)

`packages/native` is one Rust N-API addon with normalized TypeScript façades. Raw binding contracts remain private.

| Already native                                                             | Rust owner                                            | What remains naturally TypeScript                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| Managed processes, bounded output, containment, inspection and termination | `native/src/process/`, `native/src/platform/process/` | Launch definitions, approvals, application shutdown policy, Node-facing streams |
| Git repository/snapshot/ancestry and document reads                        | `native/src/git/`, using `gix`                        | User workflows, GitHub API requests, protocol responses, mutation orchestration |
| Filesystem/Git change monitoring and event coalescing                      | `native/src/monitor/`, using `notify`                 | Workspace demand, session ownership, refresh decisions                          |

Paths above are relative to `packages/native`. N-API DTOs are in `native/src/api/`; public façades are in `src/{process,git,monitor}/`.

Important distinction: `native/src/git/file_diff.rs` currently reads the original and modified documents. Its name does not mean it computes the unified textual patch used by the file-edit tool.

A search for `node:child_process` also does **not** establish duplicate process engines: many production imports are type-only and already sit over native-managed processes. Any consolidation must identify an actual duplicate implementation, not replace a useful façade.

## Candidate ranking

### 1. File-completion matching/ranking: strongest CPU pilot

Evidence:

- `packages/workbench-server/src/domains/completions/file-completion-ranking.ts`: `completeFileCandidates()` maps candidates through matching/scoring, sorts the matching set, then takes the bounded result count.
- `file-completion-service.ts`: caches discovered candidates for two minutes, but ranking still runs for each applicable query. Empty/short/directory queries already have a separate direct-listing path.
- `file-completion-candidates.ts`: obtains Git paths or walks with `fdir`; the fallback walk is bounded to 20,000 entries and depth 10. Do not assume that bound applies identically to Git discovery.

**Why Rust could help:** repeated matching and sorting is synchronous JavaScript computation on an interactive request path. A native-owned snapshot could retain normalized path data and return only the top results per query, avoiding repeated JS allocation and whole-candidate transfer.

**First improve TypeScript:** normalize query/terms once per request, examine allocation costs, and benchmark bounded top-k selection instead of sorting every match. Consider a worker if event-loop isolation alone solves the problem. These may be sufficient.

**Possible Rust boundary:** a completion index built/replaced in batches, queried asynchronously with a result limit, explicitly disposed when the project closes. Keep project lookup, authorization, protocol adaptation and cache lifecycle in TS. Do not pass thousands of JS candidate objects into Rust on every keystroke.

**Maintainability tradeoff:** this moves a coherent algorithm, but creates a stateful native resource. It is worthwhile only if the Rust index replaces the matching implementation rather than adding a second permanent ranking engine. Initial comparison can use the TS implementation as a test oracle.

**Parity requirements:** ranking/tie order, directory intent, multi-term/path matching, unsafe queries, Unicode/case handling, and highlight offsets. JavaScript strings use UTF-16 code units; Rust byte offsets must not leak into UI match ranges. Locale-sensitive ordering also needs an explicit compatibility decision.

**Benchmark:** cold index build, warm per-query p50/p95, rapid query bursts, 1k/20k/large Git candidate sets, Unicode paths, Node event-loop delay, total process RSS, and index disposal. No benefit is established until the whole API call beats optimized TS, including N-API conversion.

### 2. Aggregate storage-tree scanning: simplest bounded pilot

Evidence:

- `packages/workbench-server/src/domains/storage/storage-files.ts`: recursive `readdir` and per-file `lstat`, skipping symlinks and tolerating unreadable entries.
- `storage-usage.service.ts`: `computeUsage()` scans conversation files once for a cleanup tally, again for category totals, and again by conversation to find the largest owners. It also scans other home categories and caches results for 15 seconds.

**First improve TypeScript:** make one traversal produce the reusable category/owner totals; deduplicate concurrent refreshes and consider bounded I/O concurrency. Porting repeated traversal unchanged would preserve the main inefficiency.

**Possible Rust boundary:** a cancellable, read-only scan over explicit roots that returns aggregate byte/file counts and bounded owner totals. Keep category labels, protected/cleanable flags, cleanup eligibility, cache invalidation, and UI response assembly in TS. No deletion capability is needed for this pilot.

**Why it may help:** fewer cross-runtime callbacks and allocations, controlled traversal concurrency, one reusable implementation of filesystem enumeration. This is largely I/O-bound; Node's filesystem operations already use native code, so faster wall time is not guaranteed.

**Parity requirements:** symlink and Windows reparse-point behavior, unreadable/disappearing files, logical versus allocated size, hard-link accounting, cancellation, root exclusions, and races while files change. Preserve current semantics unless an intentional behavior change is separately approved. A dashboard scan need not claim a transactionally consistent filesystem snapshot.

**Benchmark:** small and large synthetic trees, many tiny files versus few large files, warm/cold filesystem caches, cancellation latency, concurrent requests, RSS, and event-loop delay. Compare single-pass TS against single-pass Rust, not against today's redundant scans.

### 3. Bounded text-edit/diff computation: useful conditional CPU target

Evidence:

- `packages/tools/src/execution/filesystem/text-editing.ts`: unified patch generation through JavaScript `diff` (`structuredPatch`/`formatPatch`), plus several whole-string normalization passes.
- `edit.ts`: exact-match resolution, overlap checks, replacement construction, and patch generation; writes are serialized per path and use an atomic-write helper.

**Possible Rust boundary:** a pure, asynchronous text transformation/diff operation returning a bounded patch and edit metadata. Keep permission checks, file-mutation queue, atomic write ownership, and tool-result policy in TS. Start with the measured expensive kernel, not the entire edit tool.

**First improve TypeScript:** measure large and adversarial diffs, establish input/output limits, and consider worker isolation. Do not assume tiny edits need a native call.

**Risks:** differing patch algorithms and formatting, BOM/CRLF preservation, exact-match/overlap semantics, large string copies across N-API, and cancellation. A compute error must not be misreported as though a durable file write did not happen. Changing when a patch is computed relative to the write requires explicit failure-semantics tests.

**Benchmark:** small edits, large repeated-line inputs, many replacements, low-similarity files, patch size caps, and event-loop delay under concurrent edits. Compare end-to-end behavior, not just a Rust diff microbenchmark.

### 4. Extend existing native Git/monitor primitives: architectural fit, demand-driven

Evidence:

- `packages/native/native/src/git/` already performs repository reads; Git API methods use asynchronous tasks.
- `packages/native/native/src/monitor/` already owns watcher limits, coalescing, polling and degraded operation.
- `packages/tools/src/git/git-service.ts` and `packages/workbench-server/src/domains/monitoring/workspace-monitor.ts` retain workflow/demand orchestration.

Good extensions would batch related repository reads, avoid redundant repository discovery, or reduce measured watcher-event storms while returning bounded snapshots/notices. Retain explicit limits and full-refresh-on-overflow behavior.

Do not port every Git command: the Git CLI already executes native code, and replacing mutations can change hook, credential, configuration, filter and submodule behavior. GitHub network calls and workspace subscription policy should remain TS. A native monitor is not automatically a complete workspace index; adding one needs explicit memory/invalidation ownership.

## Low-priority or poor candidates

| Capability                                                                | Recommendation                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filesystem grep/find                                                      | Usually keep the current external native tools. `packages/tools/src/execution/filesystem/search.ts` prefers ripgrep and uses Node fallback when unavailable. Only evaluate an embedded Rust search engine for a measured fallback/dependency problem; do not add one Rust call per line/file. JS and Rust regex features are not identical. |
| Image resizing                                                            | Already native-backed. `packages/harness/src/models/image/resize.ts` uses Sharp in Node and an Electron `nativeImage` subprocess for an ABI constraint. A Rust codec path is a separate packaging/security study, not an obvious speed win over libvips. Preserve format/orientation/color/animation semantics and resource limits.         |
| HTML → Markdown                                                           | `packages/tools/src/execution/atlassian/isolated-html-to-markdown.ts` uses bounded, terminable workers. A native parser may be fast, but loses the same easy hard-termination model and must preserve conversion semantics. Do not trade away isolation for an unmeasured benefit.                                                          |
| Token estimation                                                          | `packages/harness/src/compaction/usage.ts` is an approximate estimator; `packages/conversation-core/src/context/context-usage.ts` owns projection/compaction meaning. A native port does not improve estimation quality. Profile projection and caching first.                                                                              |
| Transcript history, JSON and validation                                   | Query only required data, page/bound results, avoid repeated serialization/materialization. Do not duplicate shared contract validation in Rust merely to move parsing.                                                                                                                                                                     |
| SQLite repository layer                                                   | SQLite is already native via `node:sqlite`. Query shape, indexes already present, transactions and materialization are the first levers. A second Rust-owned connection/transaction model adds complexity. No schema/index changes are proposed.                                                                                            |
| Auth, provider clients, HTTP/WebSocket/RPC                                | Predominantly I/O, product policy and shared TS contracts; keep in TS. Node's crypto/TLS primitives already use native implementations.                                                                                                                                                                                                     |
| Run scheduling, approvals, tools, maintenance and recovery state machines | Keep cohesive application policy and durable transitions in their existing owning packages. Rust can supply a bounded primitive underneath; avoid splitting one lifecycle/transaction between languages.                                                                                                                                    |
| Storage cleanup as a whole                                                | Keep protected-target policy, conversation pruning, progress, cancellation and maintenance recovery in TS. A read-only tally pilot does not justify a native deletion engine.                                                                                                                                                               |

## Rules for an acceptable native extraction

1. **One coherent owner:** plain Rust domain logic beneath a thin N-API adapter; normalized TS façade above it. Avoid a catch-all native utilities API.
2. **Shared API policy stays shared:** transport-neutral contracts remain in `packages/contracts`; protocol/session mechanics stay in `packages/protocol`. Native DTOs are an implementation boundary, not a parallel protocol schema.
3. **Large work units, small bounded results:** retain/index data when justified, batch operations, and avoid repeated conversion of large strings or object graphs.
4. **Actually off the Node thread:** a synchronous N-API call still blocks JavaScript. Use the addon's established async/worker patterns, bounded concurrency and backpressure; native tasks also compete for CPU/I/O resources.
5. **Owned lifecycle:** explicit close/cancel/dispose, generation checks for stale results, bounded queues and memory. Finalizers are a fallback, not shutdown coordination.
6. **Honest cancellation/isolation:** rejecting a promise does not stop a native task. Cooperative cancellation requires checks inside the operation. Crashes/unsafe code in an in-process addon can take down the daemon; untrusted or non-cooperative processing may warrant a subprocess instead.
7. **Equivalent behavior first:** fixtures covering Unicode, paths, limits, errors, cancellation and shutdown; short-lived parity comparisons, not a permanent compatibility stack.
8. **Measure the whole system:** p50/p95 latency, throughput, Node event-loop delay, transfer bytes, CPU and total RSS. JS heap alone misses Rust allocations. Test supported OS/architecture builds; one Linux result is not cross-platform proof.

## Recommended sequence

1. Instrument completion ranking and storage-usage stages on representative workloads. Record data sizes and call rates, without collecting file contents or credentials.
2. Implement the simple TS algorithm fixes first: bounded ranking/top-k as justified, and single-pass storage accounting.
3. Choose **one** Rust pilot based on measurements: completion index for demonstrated interactive CPU cost, or aggregate tree scan for demonstrated traversal overhead.
4. Require behavioral parity, measurable end-to-end benefit, and a simpler ownership story before replacing the owning TS implementation.
5. Expand existing Git/monitor domains only when specific profiles or correctness/portability requirements justify it. Do not begin a broad business-logic rewrite.

## Staged implementation status (2026-10-18)

The research above describes the original evidence and recommendations; the staged work below now includes TS improvements, isolated synthetic measurements and one adopted completion-index pilot. Node/Electron remain the runtime; no database/schema changes are part of this work.

- **Storage TS:** one conversation traversal now supplies category, cleanup and per-owner totals; log and database observations are reused. Concurrent refreshes share work, with generation-safe invalidation. Cleanup policy and logical-size/path-counting semantics remain in TS. On Linux x64, nine warm synthetic trials reduced 2,000-tiny-file scan p50 from 54.97 to 19.37 ms (p95 63.40 to 28.85 ms). A 16-file/128 MiB tree measured 1.09 to 0.56 ms p50, with no p95 improvement. These are traversal-kernel results, not whole-service or cold-cache measurements. Method, limitations and results: `packages/workbench-server/test/benchmarks/storage-usage.benchmark.md`.
- **Completion TS:** bounded stable top-eight selection and reused query/path normalization improve measured whole synchronous ranking calls. At 20k synthetic candidates, broad-prefix p50 fell from 27.44 to 5.25 ms; ordered matching still costs 61.95 ms, and a seven-query burst delays a timer by 142.53 ms after optimization. Detailed methodology, parity scope and caveats: `packages/workbench-server/test/benchmarks/file-completion.benchmark.md`.
- **One native pilot, completion:** the production indexed-completion route now uses a retained asynchronous Rust index as the single matching/ranking owner; TS retains discovery, live directory listing, response adaptation and lifecycle policy. The optimized TS engine remains a test/benchmark oracle, not a production fallback. Snapshot leases, generation-safe replacement, bounded project caches, build/query admission and backpressure, and explicit project/shutdown disposal bound resource ownership. FIFO queries are not automatically superseded by newer typing requests.
- **Native adoption evidence and tradeoffs:** nine-round isolated-subprocess synthetic comparisons passed parity on Linux x64 / Node 24. Warm whole-service `Composer` typing-prefix p50 improved from optimized TS 59.886 to 15.113 ms at 20k candidates, and 299.827 to 69.170 ms at 100k; warm native service heartbeat maximum lag was about 2 ms instead of synchronous TS blocking. This is not a blanket speedup: whole cold 100k latency (including synthetic discovery/candidate construction) regressed from 555.716 to 926.870 ms, and retained RSS from 288.5 to 405.4 MiB (20k: 158.8 to 150.7 MiB). Native 100k disposal took 41.361 ms with 0.208 ms maximum heartbeat lag, off-thread. Adoption is justified for cached interactive CPU/responsiveness, not cold-start speed or universal memory improvement. These are synthetic local profiles, not production traffic or cross-platform evidence. See the completion benchmark document for detailed methodology and limitations.
- **Storage Rust remains deferred:** TS single-pass accounting removes the demonstrated redundancy; there is no demonstrated remaining need for a native scan. No second native pilot is started.

Repeat from `packages/workbench-server` (synthetic temporary trees/candidates only; no real user data):

```sh
NERVE_STORAGE_BENCHMARK=1 pnpm exec tsx test/benchmarks/storage-usage.benchmark.ts
pnpm exec tsx test/benchmarks/file-completion.benchmark.ts
# Requires the current local native build.
pnpm exec tsx test/benchmarks/file-completion-native.benchmark.ts
pnpm exec tsx --test test/infrastructure/persistence/storage-files.test.ts test/infrastructure/persistence/storage-usage.service.test.ts test/infrastructure/persistence/storage-cleanup.service.test.ts
```

Focused formatting/checks are serialized by the lead after shared-worktree edits finish; benchmark claims are not full-validation equivalence.

## Follow-up proposals

| Proposal                                                      | Native part                                                                                                         | What stays in TypeScript                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Concurrent Git operations](git-operations.md)                | Single-walk repository discovery and batched, cancellable multi-repository snapshots                                | Per-repository lanes, CLI mutations (pull/push/fetch), progress parsing, cancellation policy |
| [Unified completion](unified-completion.md)                   | Generalized search index with typed fields, fuzzy matching and top-k; lower cold-build and memory cost than PR #458 | Providers, permissions, freshness, usage history, protocol                                   |
| [Activity inbox](activity-inbox.md)                           | None directly; native operations report through it                                                                  | Activity model, retention, UI                                                                |
| [Native library organization](native-library-organization.md) | Domain-first layout, small shared core, per-domain bindings                                                         | Façade policy                                                                                |

**Text-edit diff kernel (candidate 3 above)** remains conditional: profile large and adversarial edits first, then consider an async `text` domain that computes bounded patches while TypeScript keeps permissions, the write queue and atomic writes.
