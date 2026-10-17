# Native library organization

> Proposal for discussion; not yet approved. Applies to `packages/native` as it grows with [unified completion](unified-completion.md), [Git batched reads](git-operations.md) and possible text-diff work ([Rust native boundaries](rust-native-boundaries.md)).

## Goal

Keep the native library easy to read and change as domains are added. A change to one domain should touch that domain's files only, and each domain should follow the same conventions for async work, cancellation, errors and tests.

## Current structure

```
packages/native/
  native/src/
    api/         N-API adapters and DTOs (git/, process/, monitor.rs, completion.rs)
    git/ monitor/ process/ completion/   domain logic
    platform/    OS-specific code
    runtime/     shared Tokio runtime (2 worker threads)
  src/
    binding/contract.ts   one NativeBinding interface for every domain
    binding/loader.ts     prebuild loading
    git/ monitor/ process/ completion/   TypeScript façades
    index.ts              single root export
```

What works: domain logic is separate from N-API adapters, raw bindings are private, and consumers use normalized façades.

## Coupling hotspots

1. **One binding contract.** `src/binding/contract.ts` lists every raw function of every domain. Any domain change edits a shared file.
2. **Inconsistent lifecycles.** Completion uses per-handle atomics, leases and TypeScript admission queues. Monitor uses a process-global registry. Processes use a global permit registry and reject at capacity. Git reads have no cancellation at all.
3. **Inconsistent errors.** Git maps a typed error to `{ category, message }`; other domains throw string reasons.
4. **Shared execution resources.** A two-thread Tokio runtime and N-API worker pool are shared by every domain without any per-domain budget. This is not yet shown to be a bottleneck, but batched Git reads and search indexing will add load.
5. **No internal dependency rules.** Nothing prevents one domain from reaching into another's internals.

## Proposal

### Domain-first layout

Each domain is one vertical slice in both languages:

```
native/src/<domain>/
  mod.rs        public domain API (plain Rust, no N-API)
  ...           private internals
  napi.rs       thin adapter: DTO conversion, AsyncTask wiring
src/<domain>/
  binding.ts    this domain's raw binding interface (private)
  <facade>.ts   normalized public API
  index.ts
test/<domain>/
```

- `src/binding/contract.ts` becomes a composition of per-domain binding interfaces; the loader stays shared and private.
- Planned domains: `process`, `git`, `monitor`, `search` (generalized completion index), and later `text` (diff) if measurements justify it.
- Domains do not import each other. Shared code lives only in `native/src/core/`.

### Small shared core, only for proven repetition

`native/src/core/` holds primitives that at least two domains use:

- **Cancellation token:** cooperative check inside long loops; close/abort sets it.
- **Bounded admission:** N active + M waiting, explicit overflow error.
- **Handle registry:** typed IDs, explicit close, close awaits in-flight work, heavy memory released off the Node thread.
- **Error model:** `{ category, message, retryable }` mapped once to JavaScript errors.

Domains choose their own policy (queue versus reject at capacity); the core supplies mechanisms, not policy. Do not build a generic framework in advance.

### Execution budgets

Give CPU-heavy domains (search, text) and I/O domains (Git reads, monitor) explicit concurrency limits instead of competing silently for the same small pool. Measure before resizing the shared runtime.

### Exports

Keep the single root export for now; per-domain folders already make the structure clear. Add subpath exports (`@nervekit/native/git`) only if consumers need to avoid loading unrelated façades—this changes the export-surface policy in `scripts/checks/package-export-surfaces.mjs`.

### Enforcement and tests

- Add a check that native domains import only `core/` and their own modules (Rust `pub(crate)` visibility plus a simple script rule).
- Each domain tests: Rust unit tests for logic; façade tests for close/cancel races, queue bounds and error mapping; parity fixtures when replacing a TypeScript implementation.
- Each domain's README section documents its limits, lifecycle and cancellation behavior.

## Migration

1. Move completion to the `search` domain layout and introduce `core/` cancellation/admission/error types extracted from its existing code.
2. Split `binding/contract.ts` per domain; no behavior change.
3. Adopt the error model and cancellation in Git reads as part of batched snapshots.
4. Align monitor and process registries gradually when they are next changed.

Each step is mechanical and independently reviewable.

## Open questions

- Should native domains eventually be separate Rust crates in a workspace, for faster builds and stricter boundaries? Recommended only once build time or dependency weight becomes a problem.
- Should subpath exports become a supported API?
