# Native Rust acceleration roadmap

## Purpose

Nerve already uses `@nervekit/native` for reliable, cross-platform managed subprocesses. This document evaluates other work that could benefit from Rust and tracks a gradual migration.

The goal is not to rewrite Node.js code because Rust is assumed to be faster. The goals are to:

- reduce recursive search and traversal latency;
- reduce daemon CPU usage and event-loop pressure;
- improve cross-platform filesystem-watch behavior;
- remove optional runtime dependencies on `rg` and `fd` where doing so produces a measured benefit;
- expose structured, bounded operations rather than parsing subprocess output.

Ordinary asynchronous filesystem I/O is usually limited by the filesystem rather than JavaScript execution. Every migration therefore needs representative benchmarks and semantic-parity tests.

## Decisions

- [x] Use **gradual acceleration**, not a broad Rust rewrite.
- [x] Keep existing TypeScript contracts and domain orchestration.
- [x] Extend `@nervekit/native` initially instead of creating another native package.
- [x] Benchmark before and after each migration.
- [x] Keep security policy, permission decisions, transports, output formatting, and UI state outside Rust.
- [x] Keep writes, edits, Git mutations, remote operations, and Bashkit adoption out of the initial roadmap.
- [ ] Reconsider package splitting only if native binary size, ownership, or release cadence makes it necessary.

A native implementation must beat Nerve's current primary path on representative projects. Temporary side-by-side implementations are allowed for parity testing and benchmarking, but an accepted Rust migration replaces and deletes the old production implementation.

## Success criteria

Every migrated operation must pass all applicable gates:

- [ ] Existing observable behavior is captured by parity tests before migration.
- [ ] Results, errors, paths, limits, ignore rules, cancellation, and timeout behavior remain compatible.
- [ ] Work is bounded in memory and output volume.
- [ ] N-API calls are coarse-grained or batched; no callback per traversed file.
- [ ] Cancellation and close operations are idempotent and complete exactly once.
- [ ] Linux, macOS, and Windows behavior is tested.
- [ ] x64 and arm64 prebuild packaging remains valid for all six current targets.
- [ ] Median and p95 latency, CPU, RSS, event-loop impact, and binary-size delta are reported.
- [ ] A meaningful improvement is demonstrated on representative fixtures.
- [ ] Missing, corrupt, wrong-architecture, and unsupported-platform native bindings fail fast with actionable startup errors.
- [ ] The replaced Node.js or executable production implementation is deleted after parity and performance gates pass.

## Current architecture inventory

### Native process host

- `packages/native/src/index.ts`
  - Eagerly loads the mandatory platform-specific `.node` prebuild.
  - Exposes platform capability metadata and the managed-process TypeScript facade.
  - Fails module initialization when the native binding is missing or invalid.
- `packages/native/native/src/lib.rs`
  - Defines current N-API objects and functions.
- `packages/native/native/src/managed_process.rs`
  - Owns process spawning, output relay, completion, and termination.
- `packages/native/native/src/platform/{linux,macos,windows}.rs`
  - Own platform process identity, containment, inspection, and termination.
- `packages/native/package.json`
  - Defines six Linux, macOS, and Windows x64/arm64 prebuild targets.

### Filesystem tools

- `packages/tools/src/execution/filesystem/search.ts`
  - Prefers `rg --json`, streams matches, and falls back to Node traversal/search only when ripgrep is unavailable.
  - Owns context-line behavior, result limits, timeout, cancellation, and output shaping.
- `packages/tools/src/execution/filesystem/find.ts`
  - Prefers `fd` and falls back to Node traversal.
- `packages/tools/src/execution/common/search-utils.ts`
  - Resolves search roots and implements fallback recursive traversal/glob handling.
- `packages/tools/src/execution/filesystem/list.ts`
  - Performs a shallow `readdir`, classification, deterministic sorting, and limiting.
- `packages/tools/src/execution/filesystem/read.ts`
  - Currently reads the complete file before applying line or byte ranges.
- `packages/tools/src/execution/filesystem/write.ts`
  - Uses a per-path mutation queue and atomic write helper.
- `packages/tools/src/execution/filesystem/edit.ts`
  - Owns smart matching, line edits, patch application, overlap validation, newline/BOM preservation, dry runs, diffs, and structured errors.
- `packages/tools/src/execution/filesystem/atomic-write.ts` and `file-mutation-queue.ts`
  - Own correctness-sensitive mutation behavior.

### Files pane and refresh

- `packages/workbench-server/src/domains/filesystem/filesystem.service.ts`
  - Resolves and contains paths, classifies symlinks, sorts entries, and provides cursor pagination.
- `packages/workbench-server/src/domains/filesystem/project-filesystem-watcher.ts`
  - Uses recursive `fs.watch`, filters Git metadata, debounces events, enforces maximum wait, and evicts inactive projects.

### Git

- `packages/tools/src/git/git-command.ts`
  - Runs bounded `git` and `gh` subprocesses.
- `packages/tools/src/git/git-service.ts`
  - Owns repository discovery and Git/GitHub workflow orchestration.
- `packages/tools/src/git/git-status.ts`
  - Parses porcelain status and shortstat output.
- `packages/tools/src/git/git-overview.ts`, `git-branches.ts`, and `git-stash.ts`
  - Implement focused workflows over `GitService`.
- `packages/workbench-server/src/domains/tools/git-repository-watcher.ts`
  - Watches worktrees and external Git directories, filters relevant metadata, and publishes invalidations.

### Packaging and observability

- `.github/workflows/native-host.yml` and `.github/workflows/release.yml`
  - Build, test, package, and smoke-test native prebuilds.
- `docs/performance-profiling.md`
  - Documents daemon/desktop performance diagnostics.
- `scripts/summarize-performance-jsonl.mjs`
  - Summarizes process, event-loop, operation, and watcher activity.

## Feasibility and priority matrix

| Candidate                                     | Expected value                                                                                                                                                     | Feasibility and risks                                                                                                                                | Decision                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Recursive grep/content search                 | **Very high.** Traversal, regex, ignore processing, concurrency, and process startup are material.                                                                 | High with ripgrep's lower-level crates. Exact hidden, ignore, glob, binary, context, encoding, limit, and cancellation behavior needs parity tests.  | **Phase 1: first implementation candidate.**                            |
| Find/file discovery                           | **High.** Recursive traversal currently needs optional `fd` for the fast path.                                                                                     | High with a shared ignore-aware Rust walker. Glob, symlink, ordering, and path normalization must be explicit.                                       | **Phase 1 with grep.**                                                  |
| File-pane directory enumeration               | **Moderate.** Rust will not greatly accelerate a normal shallow `readdir`, but batching classification and sorting may reduce event-loop work in huge directories. | High. Containment, realpath/symlink policy, deterministic sorting, and stale cursors must remain exact.                                              | **Phase 2 after search measurements.**                                  |
| Bounded file reads                            | **Moderate for very large files; low for normal files.** Current byte/line ranges allocate the whole file first.                                                   | High with seek, metadata, bounded decoding, and bounded line scanning. UTF-8 boundaries need care.                                                   | **Phase 2, only for ranged reads.**                                     |
| File watching                                 | **Potential reliability and CPU-consistency benefit more than raw speed.**                                                                                         | Medium with `notify`. Rename, atomic save, overflow, deleted roots, network filesystems, and OS event differences remain difficult.                  | **Phase 3 prototype.** Keep TypeScript policy initially.                |
| Git discovery/status/diff/log                 | **Potentially high** for large repositories and frequent refreshes; could avoid process startup and text parsing.                                                  | Medium. Worktrees, submodules, sparse/split indexes, attributes, filters, config, locks, and concurrent writes create a broad compatibility surface. | **Phase 4 read-only spike after filesystem phases.**                    |
| Git mutations, remotes, credentials, and `gh` | Usually subprocess- or network-bound. Compatibility and credential handling dominate.                                                                              | Low value and high risk as an early migration.                                                                                                       | **Keep current TypeScript/CLI paths.**                                  |
| Ordinary `ls` tool                            | **Low.** It performs one shallow read and sort.                                                                                                                    | Easy to implement but unlikely to provide a meaningful independent win.                                                                              | **Do not migrate separately.** Reuse enumeration later only if simpler. |
| Whole-file normal read                        | **Low.** Filesystem I/O and result construction dominate.                                                                                                          | Easy but little expected benefit.                                                                                                                    | **Keep in TypeScript unless profiling disproves this.**                 |
| Write                                         | **Low performance upside.**                                                                                                                                        | Queueing, atomic replacement, permissions, and platform durability are correctness-sensitive.                                                        | **Keep in TypeScript.**                                                 |
| Edit/patch/smart matching                     | Usually small inputs with substantial semantic and error-contract complexity.                                                                                      | Technically possible but poor expected return.                                                                                                       | **Keep in TypeScript.**                                                 |
| Bash/shell/tool policy via Bashkit            | Different product goal: an in-process sandboxed shell and virtual filesystem.                                                                                      | Architecturally mismatched with accelerating trusted host filesystem APIs.                                                                           | **Evaluate separately only if Nerve wants virtual sandboxing.**         |

## Referenced projects and candidate crates

### ripgrep

[ripgrep](https://github.com/BurntSushi/ripgrep) demonstrates the right shape for fast recursive search: parallel traversal, ignore-aware filtering, binary detection, bounded output, and early termination.

Potential crates:

- [`ignore`](https://docs.rs/ignore) for parallel, ignore-aware directory walking;
- [`grep-searcher`](https://docs.rs/grep-searcher) and [`grep-regex`](https://docs.rs/grep-regex) for line-oriented search;
- [`globset`](https://docs.rs/globset) for compiled glob matching.

Nerve should use lower-level library crates behind Nerve-owned request/result types, not embed ripgrep's CLI glue as its public API. The current tool explicitly enables hidden paths while still relying on ripgrep's ignore behavior; parity tests must freeze the intended behavior instead of assuming ripgrep defaults.

The native search contract must preserve:

- multiple roots and file roots;
- hidden and ignored path behavior;
- fixed-string, regex, case-insensitive, and glob options;
- binary-file behavior and non-UTF-8 handling;
- line numbers and context windows;
- deterministic normalized display paths;
- match and output limits;
- timeout, abort, and limit-driven early cancellation.

### Grit

[Grit](https://github.com/gitbutlerapp/grit) is useful architectural inspiration: a linkable, structured Git implementation is a better native boundary than a broad `runGit(args)` wrapper.

It is not the initial production dependency. Its README currently warns that real-world speed and usability have not yet been proven even though it passes a large portion of Git's upstream tests. Licensing also needs precise review: `grit-lib` is MIT, while `grit-git` is GPL-2.0.

Reassess Grit during the Git spike only if its production maturity changes materially.

### gix/gitoxide

[`gix`](https://github.com/GitoxideLabs/gitoxide) is the leading pure-Rust candidate for read-only repository snapshots. It is library-first and performance-oriented.

The spike must evaluate:

- API and feature stability;
- dependency and binary size;
- status/diff correctness;
- worktree, submodule, sparse/split-index, and filter support;
- non-UTF-8 paths;
- concurrent index update safety;
- actual Nerve fixture performance.

### git2/libgit2

[`git2`](https://github.com/rust-lang/git2-rs) is the mature alternative. Compare its compatibility and API coverage with `gix`, while accounting for libgit2 build/link complexity and native dependency size.

No Git library should be selected before the benchmark and parity spike.

### notify

[`notify`](https://github.com/notify-rs/notify) is the primary watcher candidate. It abstracts platform backends but cannot make filesystem events perfectly reliable. Its documentation notes limitations for very large trees and unexpected behavior when watched roots are renamed or removed.

A Nerve watcher therefore still needs:

- event batching and debounce;
- overflow/error signals;
- full rescan and watcher recreation;
- duplicate-event tolerance;
- watched-root replacement handling;
- cross-platform atomic-save and rename fixtures.

### Bashkit

[Bashkit](https://github.com/everruns/bashkit) provides useful design lessons:

- bounded resources;
- explicit cancellation;
- structured tool contracts;
- pre-execution analysis;
- controlled virtual filesystem access.

It should not replace Nerve's real-host filesystem, Git, or shell tools as part of this performance work. A Bashkit evaluation would be a separate sandbox/product-capability project.

## Target native architecture

### Package and module shape

Keep one `@nervekit/native` package initially. Future implementation can add focused Rust modules such as:

- `packages/native/native/src/search.rs`;
- `packages/native/native/src/walk.rs`;
- `packages/native/native/src/watch.rs`;
- `packages/native/native/src/git.rs` only after the Git spike.

The TypeScript facade can be split into focused files under `packages/native/src/` while preserving the package entry point.

### Boundary rules

- Use plain, transport-neutral requests and results.
- Keep paths as strings at the N-API boundary.
- Use tagged records for result, completion, and error states.
- Do not expose HTTP, WebSocket, UI, storage, or Node stream concepts from Rust.
- Use async N-API tasks for bounded one-shot operations.
- Batch search, walk, and watch records through a bounded queue or threadsafe callback.
- Do not cross N-API once per file or match.
- Give every long-running operation an idempotent cancellation or close handle backed by an atomic cancellation token.
- Complete exactly once with `completed`, `cancelled`, or `failed` state and useful counts.
- Catch native panics at the boundary and never block the JavaScript main thread.

### Ownership boundary

Rust should own performance-sensitive mechanics:

- traversal;
- ignore and glob matching;
- regex scanning;
- bounded file access;
- low-level watcher event collection;
- eventually, narrowly defined read-only Git snapshots.

TypeScript should continue to own:

- tool argument validation and policy;
- workspace containment decisions;
- output budgets and user-facing formatting;
- public contracts and event publication;
- file-pane cursor encoding;
- watcher filtering, debounce, maximum wait, diagnostics, and LRU eviction initially;
- Git/GitHub workflow orchestration;
- user-facing operation errors.

### Mandatory binding and capability policy

`@nervekit/native` is a required runtime dependency. Importing its runtime exports eagerly loads the platform prebuild and fails immediately with an actionable error when the binding is missing, corrupt, built for the wrong architecture, or unsupported.

`nativeRuntimeCapabilities()` describes platform/runtime features such as process containment; it is not an addon-availability probe. New operation APIs become mandatory parts of the matching native package version rather than optional production backends.

During each migration, the current and native implementations may coexist temporarily in development-only parity tests and benchmarks. Once the phase passes its gates, production code switches to Rust and deletes the replaced Node.js or executable implementation. Nerve does not silently retry an operation through another backend.

## Implementation checklist

### Phase 0 — Measurement and semantic fixtures

#### Instrumentation

- [ ] Add timings and counters for grep execution by backend.
- [ ] Add timings and counters for find execution by backend.
- [ ] Measure project directory listing latency and entry counts.
- [ ] Measure bounded-read latency and allocated/RSS impact for large files.
- [ ] Expand refresh diagnostics to distinguish raw watcher events, coalesced invalidations, rescans, and watcher recreation.
- [ ] Measure Git overview/status command count, cold/warm latency, and refresh frequency.
- [ ] Extend `scripts/summarize-performance-jsonl.mjs` only with aggregate, privacy-safe fields.

#### Fixtures

- [ ] Small repository fixture for overhead and cold-start regression.
- [ ] Large monorepo fixture with nested ignore files.
- [ ] Huge flat directory fixture for file-pane sorting/pagination.
- [ ] Hidden, ignored, and explicitly included path fixture.
- [ ] Binary, very long line, invalid UTF-8, and mixed line-ending fixture.
- [ ] Symlink, broken symlink, cycle, and path-race fixture.
- [ ] Git worktree, submodule, sparse checkout, split index, and no-remote fixture.
- [ ] Concurrent Git index mutation/lock fixture.
- [ ] High-churn watcher fixture with rename, atomic save, directory move, and deleted/recreated root.

#### Baseline and gates

- [ ] Capture cold and warm median/p95 latency, CPU, RSS, and event-loop delay.
- [ ] Record result counts and hash normalized results to verify equality.
- [ ] Record current native prebuild and desktop tarball sizes per platform.
- [ ] Freeze current grep semantics in `packages/tools/test/search-find.test.ts` and focused fixtures.
- [ ] Freeze file-pane sorting, symlink, containment, and stale-cursor behavior in server tests.
- [ ] Freeze watcher debounce/filter/publication behavior in existing watcher tests.
- [ ] Freeze Git status/diff/overview behavior in existing Git service tests.
- [ ] Set an evidence-based minimum improvement threshold after collecting the baseline; do not invent one in advance.

### Phase 1 — Native traversal, grep, and find

#### Dependency review

- [ ] Review `ignore`, `grep-searcher`, `grep-regex`, and `globset` versions, MSRV, licenses, maintenance, advisories, features, transitive dependencies, and release build size.
- [ ] Add only the features Nerve needs.
- [ ] Record dependency and prebuild-size changes.

#### Shared traversal core

- [ ] Add a Nerve-owned ignore-aware walker in `packages/native/native/src/`.
- [ ] Support directory and individual file roots.
- [ ] Define hidden, `.gitignore`, `.ignore`, `.rgignore`, custom glob, and nested ignore behavior explicitly.
- [ ] Do not follow symlinks by default; test any future follow option against cycles.
- [ ] Normalize result paths consistently across operating systems.
- [ ] Handle files disappearing or changing during traversal without failing an otherwise valid search.
- [ ] Support a bounded result count and cancellation checks throughout traversal.

#### Native grep

- [ ] Define a transport-neutral search request and batched match/context result.
- [ ] Implement fixed-string, regex, case-insensitive, glob, multiple-root, and context options used by `executeGrep`.
- [ ] Detect binary content consistently with the frozen behavior.
- [ ] Bound line size, batch size, queued bytes, and total matches.
- [ ] Implement timeout/abort/limit cancellation.
- [ ] Return completion counts and an explicit completion state.
- [ ] Add Rust tests for matching, context, ignores, encoding, cancellation, races, and bounded memory.

#### Native find

- [ ] Define a bounded find request/result using the shared walker.
- [ ] Preserve current path-oriented glob behavior, including patterns containing `/`.
- [ ] Return normalized relative paths and explicit truncation/count metadata.
- [ ] Add Rust tests for hidden files, ignores, symlinks, globs, limits, and cancellation.

#### TypeScript integration

- [ ] Add focused typed facades under `packages/native/src/` and export them from the package entry point.
- [ ] Compare native search/find directly with the current `rg`/`fd` and Node implementations in development-only parity tests and benchmarks.
- [ ] Preserve output budgets, display formatting, details, and tool errors in TypeScript.
- [ ] Add cancellation, partial-failure, binding-load, and semantic parity tests.
- [ ] Benchmark all implementations on the Phase 0 fixtures before choosing the native implementation.
- [ ] After parity and performance gates pass, switch `executeGrep` and `executeFind` to the mandatory native APIs.
- [ ] Delete `runRg`, `fallbackGrep`, `runFd`, `fallbackFind`, obsolete fallback traversal code, and their production dependencies.

### Phase 2 — File-pane enumeration and bounded reads

#### Project directory enumeration

- [ ] Profile `projectDirectoryEntries` to confirm classification/sorting is material before implementation.
- [ ] Add a native batch enumeration/classification API if the profile justifies it.
- [ ] Preserve root containment and realpath checks.
- [ ] Preserve safe symlink classification, including broken and outside-root links.
- [ ] Preserve the exact directory-first, case-insensitive, numeric-aware deterministic sort key.
- [ ] Keep contract validation and cursor encoding/decoding in TypeScript.
- [ ] Preserve stale-cursor detection.
- [ ] Return enough native ordering metadata to avoid per-entry N-API calls.
- [ ] Add parity tests for huge directories, Unicode names, case collisions, symlinks, path races, pagination, and stale cursors.
- [ ] Benchmark cold/warm listing and event-loop impact.
- [ ] Reuse enumeration in `executeLs` only if it reduces complexity without changing behavior.
- [ ] Keep `directoryListing` project-signal detection in TypeScript unless profiling shows material cost.

#### Bounded reads

- [ ] Add seek-based byte-range reads without allocating the whole file.
- [ ] Evaluate bounded line-window scanning for explicit line ranges.
- [ ] Preserve safe UTF-8 boundary handling and size metadata.
- [ ] Detect file replacement/truncation during reading and return a consistent error or snapshot policy.
- [ ] Keep image MIME detection, base64 construction, output budgets, and user-facing formatting in TypeScript.
- [ ] Keep ordinary whole-file reads in TypeScript.
- [ ] Add tests for sparse files, long lines, invalid UTF-8, changing files, byte boundaries, and cancellation.
- [ ] Enable native ranged reads only after memory and latency gains are demonstrated.

### Phase 3 — Watcher and refresh prototype

#### Native event source

- [ ] Review `notify` version, backend features, MSRV, licenses, advisories, and transitive dependencies.
- [ ] Define normalized batched events with change kind, paths, backend error, overflow, and root-invalidated signals.
- [ ] Add an idempotent native watcher handle with `close()`.
- [ ] Bound the Rust-to-JavaScript event queue and report overflow rather than consuming unbounded memory.
- [ ] Normalize rename pairs where the backend provides them, but do not assume every platform can do so.
- [ ] Add Rust and N-API lifecycle tests for close, callback failure, event bursts, root removal, and recreation.

#### Server integration

- [ ] Introduce an injectable watcher adapter rather than coupling server domains directly to N-API.
- [ ] Replace only the low-level event source in `ProjectFilesystemWatcher` first.
- [ ] Preserve filtering, 300 ms quiet debounce, 2 s maximum wait, project eviction, diagnostics, and event publication.
- [ ] Integrate `GitRepositoryWatcher` only after project watching is stable.
- [ ] Preserve worktree plus external Git/common-directory watching.
- [ ] Preserve relevant Git metadata filtering and stable-metadata invalidation.
- [ ] Trigger a full rescan after overflow, backend errors, watcher recreation, and watched-root replacement.
- [ ] Keep `fs.watch` as the sole production backend until the native watcher passes its gates.
- [ ] When the native watcher is accepted, switch production to it and delete the `fs.watch` backend instead of retaining a runtime fallback.

#### Cross-platform validation

- [ ] Test editor-style atomic save on Linux, macOS, and Windows.
- [ ] Test file and directory rename/move/delete/recreate.
- [ ] Test high-churn generated output and Git operations.
- [ ] Test watch-limit exhaustion and recovery on Linux.
- [ ] Test network and virtual filesystems where practical; document unsupported behavior.
- [ ] Compare raw event count, coalesced invalidations, CPU, RSS, event-loop delay, and missed refreshes.
- [ ] Do not make native watching the default unless reliability is at least as good as the current path.

#### Persistent workspace index decision

- [ ] After watcher and enumeration measurements, decide whether a persistent Rust workspace index is justified.
- [ ] If justified, design one snapshot API shared by file-pane listing, find, and invalidation.
- [ ] Define rescan, overflow, ignore-file change, rename, memory-limit, and shutdown behavior before implementation.
- [ ] Do not build an index speculatively.

### Phase 4 — Read-only Git snapshot spike

#### Required Nerve surface

- [ ] Inventory the exact fields consumed by Git routes and the UI.
- [ ] Define a narrow read-only snapshot: repository discovery, HEAD/branch/upstream, staged/unstaged/untracked status, file diff/stat, and recent commits.
- [ ] Keep the request/result structured; do not expose native `runGit(args)`.
- [ ] Keep GitHub API, `gh`, authentication, network operations, and all mutations on current paths.

#### Candidate comparison

- [ ] Benchmark current Git CLI, `gix`, and `git2` on all Git fixtures.
- [ ] Reassess `grit-lib` maturity and licensing at spike time; include it only if production readiness is demonstrated.
- [ ] Compare cold/warm latency, repeated refresh cost, CPU, RSS, dependency size, prebuild size, and build time.
- [ ] Compare worktrees, external/common Git dirs, submodules, sparse/split indexes, unborn branches, detached HEAD, conflicts, renames, ignored/untracked files, attributes/filters, config includes, and non-UTF-8 paths.
- [ ] Verify behavior while Git holds or replaces index/ref lock files.
- [ ] Verify cancellation and repository mutation during snapshot construction.
- [ ] Review licenses, advisories, maintenance, API churn, and MSRV.

#### Integration decision

- [ ] Select no Git library until one passes parity and performance gates.
- [ ] Keep `GitService` orchestration and observability in TypeScript.
- [ ] Use watcher invalidation to discard native snapshot caches; never serve an indefinitely stale snapshot.
- [ ] Use the Git CLI as the parity oracle during the spike, not as a permanent runtime fallback for accepted read operations.
- [ ] When a read operation migrates, delete its replaced Git CLI production path.
- [ ] Keep staging, checkout, commit, stash, branch mutation, merge, sync, remotes, credentials, and GitHub operations on their existing CLI/network paths because they are outside this roadmap.

## Explicitly deferred

- [ ] Native write implementation—revisit only with profiling evidence.
- [ ] Native edit, smart matching, or patch implementation—revisit only with profiling evidence.
- [ ] Broad native `runGit(args)` API—avoid because it adds N-API complexity without eliminating Git process semantics.
- [ ] Git mutation implementation—outside the gradual read-acceleration scope.
- [ ] Bashkit replacement for host tools—track as a separate sandbox proposal if wanted.
- [ ] Persistent workspace index—blocked on Phase 3 evidence.

## Future file-level change map

### Native facade and build

- `packages/native/src/index.ts`
- future focused facade modules under `packages/native/src/`
- `packages/native/native/src/lib.rs`
- future Rust operation modules under `packages/native/native/src/`
- `packages/native/native/Cargo.toml`
- `Cargo.lock`
- `packages/native/package.json`
- `packages/native/test/`

### Search and find

- `packages/tools/src/execution/filesystem/search.ts`
- `packages/tools/src/execution/filesystem/find.ts`
- `packages/tools/src/execution/common/search-utils.ts`
- `packages/tools/test/search-find.test.ts`

### File pane and reads

- `packages/workbench-server/src/domains/filesystem/filesystem.service.ts`
- `packages/workbench-server/test/filesystem.service.test.ts`
- `packages/tools/src/execution/filesystem/read.ts`
- focused filesystem tests under `packages/tools/test/`

### Watchers

- `packages/workbench-server/src/domains/filesystem/project-filesystem-watcher.ts`
- `packages/workbench-server/src/domains/tools/git-repository-watcher.ts`
- `packages/workbench-server/src/runtime/runtime-composition.ts` only if adapter injection requires it
- existing project and Git watcher tests under `packages/workbench-server/test/`

### Git spike

- `packages/tools/src/git/git-command.ts`
- `packages/tools/src/git/git-service.ts`
- focused Git modules under `packages/tools/src/git/`
- existing Git service tests under `packages/tools/test/` and `packages/workbench-server/test/`

### Contracts, release, and quality

- Change `packages/contracts` only if an externally visible API/event shape must change; preserving contracts is preferred.
- `.github/workflows/native-host.yml`
- `.github/workflows/release.yml`
- `scripts/verify-npm-tarballs.mjs`
- `scripts/smoke-desktop-package.mjs`
- `docs/performance-profiling.md`
- `scripts/summarize-performance-jsonl.mjs`

## Validation checklist for every implementation phase

- [ ] Run Rust formatting and Clippy with warnings denied.
- [ ] Run native Rust unit/integration tests.
- [ ] Run cancellation, queue-bound, and memory-bound tests.
- [ ] Run focused package checks and tests.
- [ ] Run native-versus-current semantic parity tests before deleting the old implementation.
- [ ] Run fail-fast tests for missing, corrupt, wrong-architecture, and unsupported-platform bindings.
- [ ] Run Linux, macOS, and Windows smoke tests.
- [ ] Verify all six x64/arm64 prebuild artifacts and package paths.
- [ ] Run `pnpm check:native && pnpm test:native`.
- [ ] Before completing code changes, run `pnpm fix && pnpm check && pnpm test` in one command, fix failures, and rerun the full chain.
- [ ] Publish benchmark results with median/p95 cold/warm latency, CPU, RSS, event-loop impact, result equality, and binary/tarball size delta.
- [ ] Keep a phase experimental or reject it when it lacks a representative improvement.

## Risk register

### N-API overhead and backpressure

Passing one callback per file or match can erase Rust's advantage and overwhelm the JavaScript event loop. Batch records, cap queue bytes and item counts, and report overflow/cancellation explicitly.

### Main-thread blocking and native failures

Filesystem traversal, regex work, and Git reads must run away from the JavaScript main thread. Catch panics at the boundary, complete exactly once, and ensure dropping JavaScript handles cannot leak long-running native work.

### Search semantic drift

Ignore rules, glob syntax, hidden paths, symlinks, binary detection, Unicode, line endings, context windows, and disappearing files are easy to change accidentally. Frozen fixture-based parity is required.

### Watcher event loss and platform differences

No watcher backend guarantees a perfect event stream. Nerve must tolerate duplicates, loss, rename variation, overflow, deleted roots, and backend failure through debounce and rescan/recovery behavior.

### Git semantic drift

Git behavior includes worktrees, submodules, sparse/split indexes, attributes and filters, config includes, locks, credentials, non-UTF-8 paths, and concurrent mutation. Keep the initial native scope read-only and narrow, with the Git CLI as compatibility authority.

### Packaging and release cost

Heavy Rust dependencies can enlarge every prebuild and desktop package and slow six-target CI. Track dependency features, build time, artifact size, and tarball size for each phase.

### Supply chain, MSRV, and licensing

Review direct and transitive crate maintenance, advisories, MSRV, and licenses before adoption. Pay particular attention to which Grit crate is used because `grit-lib` and `grit-git` have different licenses.

### Mandatory native packaging

The native binary is required. A missing, corrupt, wrong-architecture, or unsupported binding must fail at import/startup instead of degrading to a Node.js implementation. CI, release packaging, tarball verification, and desktop smoke tests must catch native artifact failures before release.

## Research references

- [Grit—Git in Rust](https://github.com/gitbutlerapp/grit)
- [ripgrep](https://github.com/BurntSushi/ripgrep)
- [Bashkit](https://github.com/everruns/bashkit)
- [`notify`](https://github.com/notify-rs/notify)
- [`gix`/gitoxide](https://github.com/GitoxideLabs/gitoxide)
- [`git2-rs`](https://github.com/rust-lang/git2-rs)

This roadmap records hypotheses and implementation gates. It does not claim that a proposed native path is faster until Nerve's own benchmarks demonstrate it.
