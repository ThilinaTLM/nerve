# Native addon (`packages/native`)

Inherits the root `AGENTS.md`. Layout and APIs: `README.md`.

**When to add native code**

- Only for measured CPU-heavy kernels or OS primitives. First fix the algorithm in TS (single pass, top-k, no repeated materialization); move to Rust only if a whole-API benchmark, including N-API conversion, still shows a benefit.
- Native must replace the TS implementation, not run alongside it. The old TS version may survive only as a test oracle.
- Rust owns computation; TS keeps policy: permissions, approvals, lifecycle/recovery state machines, protocol, cache invalidation and freshness.
- Do not port: Git mutations (hooks/credentials/filters), SQLite access, ripgrep search, image processing (Sharp), HTML→Markdown (workers give hard termination), HTTP/auth.
- Text-edit diffing is deferred until the user reviews `packages/tools/test/benchmarks/text-diff.benchmark.md`.

**Rules**

- N-API code only in `<domain>/napi.rs`; domains must not import each other; cross-domain wiring goes in `api/` only. `core/` holds mechanisms only (domains own queue/reject policy); do not add speculative abstractions.
- Never block the Node thread: use async workers; a synchronous N-API call blocks the event loop.
- Bound every queue, batch and input; reject on overflow, never truncate silently. Pass large data in batches or retain it natively instead of re-sending it per call.
- Provide an explicit close/cancel API, check cancellation cooperatively inside long loops and dispose memory off-thread. Rejecting a promise does not stop native work; finalizers are a fallback only.
- JS-facing offsets are UTF-16 code units, never byte offsets. Unicode casing stays in JS.
- Benchmarks report p50/p95, event-loop lag and total RSS (the JS heap misses Rust allocations); a single Linux run is not cross-platform evidence.
- Validate with `pnpm --filter @nervekit/native check` and `pnpm --filter @nervekit/native test`. Rebuild with `build:native` before testing Rust changes through TS.
