# Native library organization

> Workstream A mechanical organization and the generalized search follow-up are implemented; other follow-up status belongs to its owning proposal. Applies to `packages/native` as it grows with [unified completion](unified-completion.md), implemented Git batched reads and possible text-diff work ([Rust native boundaries](rust-native-boundaries.md)).

## Goal

Keep the native library easy to read and change as domains are added. A change to one domain should touch that domain's files only, and each domain should follow the same conventions for async work, cancellation, errors and tests.

## Original structure (before workstream A)

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

## Workstream A implementation status (2026-10-18)

Implemented mechanically, with the existing root TypeScript exports and N-API names/signatures preserved:

- Internal completion is now `src/search/`, `native/src/search/`, and `test/search/`.
  Public `createFileCompletionIndex`, candidate/match/index types and
  `NativeFileCompletionIndex` binding name are unchanged. Ranking, limits, casing,
  locale ties, UTF-16 offsets, queue order and explicit-close behavior are unchanged.
- Each domain owns its private TS `binding.ts`; `binding/contract.ts` composes them.
  Rust DTO conversion and AsyncTask wiring live in each domain's `napi.rs`.
  Search retained state/leases/appends are plain Rust in `search/index.rs`.
- Process-specific platform implementations moved into `process/platform/` and the
  existing shared Tokio runtime into `core/runtime/`; worker counts are unchanged.
- Monitor no longer imports Git. A stateless `GitReadPort` is injected at construction
  by `api/monitor.rs`, which composes the same Git reads/options/hash fingerprint.
  Watch planning, polling, error strings and async worker dispatch are unchanged.

### Extracted primitives versus deferred policy

| Core mechanism adopted | Existing owner and retained semantics                                                    | Deliberately not generalized                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `CancellationToken`    | Search; sticky release/acquire close flag, cooperative loop checks                       | Monitor command shutdown and process termination are not cancellation-token lifecycles                         |
| `ActivePermit`         | Process; atomic reject-at-capacity admission and RAII release                            | Search exclusive lease and JS two-active/16-waiting build + 32-waiting query queues stay owned there           |
| `HandleRegistry<T>`    | Monitor; nonzero collision-safe u32 IDs, poison-tolerant lookup/removal, Arc ownership   | No generic close-await protocol; removal revokes new lookup but does not destroy in-flight references          |
| `ErrorKind`            | Git; same category strings, retained Git-specific classification/message/Display mapping | No new retryable field, shared wire envelope or changed exception mapping; Git adoption/extensions belong to C |

These are extractions of existing mechanisms, not an unused framework. Each currently
has one adopting domain; cross-domain adoption requires proving compatible semantics.
Moving all lifecycle state into generic core would not be mechanical: search retains a
snapshot until worker disposal and its TS close waits for work; monitor closes a command
thread; processes retain permits for process lifetime. Their admission and error policies
are intentionally not unified in A. No execution-budget tuning or new native API is added.

### Dependency enforcement and limits

`packages/native/scripts/check-internal-dependencies.mjs`, wired as
`pnpm --filter @nervekit/native check:boundaries` and into the package's `check`, enforces
own-domain/core Rust references and own-domain/shared-loader TS references. It rejects
cross-domain imports, aggregate-contract imports from façades, escaping relative paths,
grouped crate-root imports, path-attribute bypasses and N-API outside adapter files.
Composition (`lib.rs`, `api/`, TS root/loader/contract) is deliberately allowed to wire
domains. There are **no** cross-domain exemptions.

TS imports use the TypeScript AST. Rust checking is a conservative lexical rule, **not
compiler-level enforcement**: comment/string/raw-string masking and file/inline-module
relative-depth checks have negative fixtures, but arbitrary macros, `include!`, macro-generated
module paths and nonliteral TS imports are not resolved. Separate Rust crates remain a
possible later enforcement step, not part of this mechanical change.

The root focused planner now recognizes the native check-command shape including
`check:boundaries`. Root integration in
`scripts/checks/focused-validation-selection.mjs` schedules the boundary check alongside
package compilation, with owning unit fixtures covering recognition and scheduling.
This serialized root-script integration is shipped; it is no longer pending.

### Validation

Initial workstream A validation covered package compilation, boundary fixtures/real-tree
checks, the rebuilt addon, touched façades, Rust units, formatting and all-target clippy.
The final combined code checkpoint subsequently passed root `pnpm fix:focused && pnpm
check:focused` (default `origin/main`), **528 distinct owning tests: 475 JS/TS + 53 scoped
Rust**, and `git diff --check`. Both Svelte package checks reported zero errors and
warnings. The final validation used the frozen release addon without rebuilding it.
Exact commands, counts and full logs are recorded locally in
`/tmp/nerve-final-validation/HANDOFF.md` and its adjacent logs.

This is Linux x64 synthetic-fixture/focused-validation evidence, not full-suite,
integration, cross-platform or live GitHub validation. No database/schema changes or
new benchmark claims follow from these checks.

### Generalized search follow-up

Search now exposes project-owned typed documents, atomic replacement updates,
field-local UTF-16 matches, kind filtering and a default-64/max-256 retrieval pool.
The follow-up adds bounded opaque-ID-filtered retrieval (at most 256 IDs, direct
lookup with the same matcher) and typed equal-score path-brevity/ID ties, without
native context or permission policy. The existing file facade shares the same
matcher and retains legacy behavior.
Request-local query preparation, bounded optional alignment caches and dense document
storage improve warm scans without a second production engine. Search lifecycle,
structural budgets and measured limits are documented in the
[native README](../../packages/native/README.md) and its linked synthetic benchmark
report. Final combined code validation is green as recorded above; release decisions
remain with the workstream lead.
