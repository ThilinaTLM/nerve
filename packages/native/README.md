# `@nervekit/native`

Cross-platform native runtime primitives for Nerve. The npm package and Rust crate produce one mandatory N-API binding for the supported Linux, macOS, and Windows targets.

## Rust architecture

`native/src` uses a feature-first layout:

- `api/` contains only N-API DTOs, exported functions/classes, callback adapters, and conversions. Git and process boundaries have their own submodules.
- `process/` owns policy validation, managed subprocess state, native output accounting, and active-process admission.
- `git/` owns stateless, read-only local repository access through `gix`.
- `runtime/` owns the shared Tokio executor used for asynchronous process pipes, waits, and timers.
- `platform/process/` contains compile-time-selected Linux, macOS, and Windows containment, identity, signaling, and resource-limit integration. Unsafe code and OS FFI stay in this layer.

The TypeScript facade follows the same feature split under `src/git/` and `src/process/`; `src/binding/` alone loads and describes the raw addon. `src/index.ts` remains the public barrel, so consumers continue importing only `@nervekit/native`.

Keep `native/src/lib.rs` limited to module wiring and boundary re-exports. Feature modules must not import `napi` or expose Node concepts. Convert transport-neutral internal records at the `api` boundary, and avoid generic `utils.rs`, `common.rs`, or `types.rs` modules.

The shared filesystem walker in `native/src/` is an internal primitive for search and find, not a generic exported operation. Watchers remain a separate long-lived feature.

## Managed process boundary

Managed commands retain platform containment while the root process or inherited stdout/stderr pipes remain active. Root exit and pipe closure are separate lifecycle events: `exited` reports that the root was reaped, while `closed` waits for inherited output handles to close and for native buffered output to be consumed.

Pipe reads, child waits, and wall timers run on one shared Rust async runtime instead of creating three operating-system threads per child. Rust owns a byte-bounded queue of stream-tagged output. N-API sends only a coalesced readiness notification; the TypeScript facade pulls bounded batches and pauses pulling whenever a Node `PassThrough` reports backpressure. A full Rust queue therefore propagates bounded backpressure through the OS pipe rather than growing daemon memory.

Per-spawn policies can bound queue bytes, total output, wall time, memory, CPU, and process count. Output, wall time, and native admission are platform-independent. Linux uses delegated cgroups v2; Windows applies Job Object memory, CPU-rate, and active-process limits; macOS currently reports tree-wide OS resource limits as unsupported. Every requested OS limit reports `enforced`, `fallback`, or `unsupported`. `required` policy rejects unsupported limits before command execution, while `best-effort` preserves local availability and exposes the weaker result.

Linux discovers the daemon's unified cgroup from `/proc/self/cgroup`. Deployments with an explicitly delegated subtree can set `NERVE_CGROUP_ROOT`; the runtime validates that it is a writable cgroup v2 directory before launching commands into child cgroups.

On Windows, the active tree remains in a Job Object so explicit cancellation, timeout handling, foreground Bash promotion, and graceful daemon shutdown can terminate the complete supervised tree. Natural completion releases the Job Object without terminating descendants only after output pipes close. A correctly detached daemon can therefore survive its launcher across tool calls, matching Unix behavior; a descendant that retains managed pipes remains supervised and keeps `closed` pending until it exits or is terminated.

## Git boundary

The native Git API is deliberately narrow and structured. It supports repository metadata, worktree/index status, refs and branch upstreams, remotes, ahead/behind ancestry, recent commits, stash listing, revision resolution, branch-name validation, and bounded revision/index/worktree document reads. Every potentially expensive repository operation is an N-API worker task rather than main-thread work.

TypeScript retains domain orchestration, caching, watcher invalidation, workflow policy, and user-facing error mapping. Native errors use stable categories. The tools package may invoke the Git CLI compatibility reader only for the explicit `unsupported` category; corruption, I/O, invalid input, limits, and internal defects remain visible.

Remote/network operations and every mutation remain on the Git CLI. These commands, plus the token-only `gh auth token` call, are launched through the Rust managed-process host. There is no native `runGit(args)` API, and `gh` is not used for repository workflows.

Keep one Rust crate and one npm package while they share an artifact and release cadence. Reconsider splitting only when measured binary composition, compile cost, ownership, or release cadence justifies the additional boundary.

## Recorded production check (2026-08-19)

On the Nerve repository (387 refs, 27 dirty status entries, 10 recent commits), two warm diagnostic reads produced a native median of **8.38 ms** versus **10.42 ms** for the six-process CLI compatibility snapshot. The structured counts matched for branch, status, refs, remotes, recent commits, and stashes. Run `pnpm --filter @nervekit/tools benchmark:git-read -- <repo> <iterations>` to repeat the non-gating diagnostic.

The Linux x64 GNU addon built at 7,942,816 bytes (5,785,216 bytes after `strip`). A release build of the pre-gix `HEAD` crate was 874,928 bytes (635,344 stripped), so the local measured delta is approximately **+6.74 MiB shipped / +4.91 MiB stripped**. `ldd` showed only libc and libgcc_s in addition to the loader; gix introduced no network library or new dynamic runtime dependency. Cargo metadata contained permissive/compatible license expressions (MIT, Apache-2.0, BSD-3-Clause, ISC, Zlib, Unicode-3.0, CC0/Unlicense alternatives); gix itself is MIT OR Apache-2.0, so the existing NOTICE policy requires no additional attribution entry.

The release inventory remains six prebuilds: Linux, Windows, and macOS on x64 and arm64. CI is authoritative for compilation on each target; the local artifact measurement above is not a substitute for the existing six-target release check.

## Validation

Package scripts format, lint, build, and test both the Rust crate and TypeScript facade. Cross-platform CI additionally verifies all six x64/arm64 prebuild targets.
