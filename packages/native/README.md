# `@nervekit/native`

Cross-platform native runtime primitives for Nerve. The npm package and Rust crate produce one mandatory N-API binding for the supported Linux, macOS, and Windows targets.

## Rust architecture

`native/src` uses a hybrid feature-first layout:

- `api/` contains only N-API DTOs, exported functions/classes, callback adapters, and conversions.
- Feature modules contain N-API-independent mechanics and models. `process/` is the current feature; future accepted work belongs in focused `filesystem/`, `watch/`, or `git/` modules.
- `sys/` contains compile-time-selected operating-system integration, unsafe code, and FFI.
- `runtime/` is reserved for shared cancellation, bounded batching, and exactly-once completion primitives. Add these modules with their first consumer rather than as empty scaffolding.

Keep `native/src/lib.rs` limited to module wiring and boundary re-exports. Feature modules must not import `napi` or expose Node concepts. Convert transport-neutral internal records at the `api` boundary, and avoid generic `utils.rs`, `common.rs`, or `types.rs` modules.

The shared filesystem walker planned in [`../../TODO.md`](../../TODO.md) is an internal primitive for search and find, not a generic exported operation. Watchers remain a separate long-lived feature. A native Git module is appropriate only if the narrow read-only snapshot spike passes its parity and performance gates; do not expose a broad `runGit(args)` API.

Keep one Rust crate and one npm package while they share an artifact and release cadence. Reconsider splitting only when measured binary composition, compile cost, ownership, or release cadence justifies the additional boundary.

## Validation

Package scripts format, lint, build, and test both the Rust crate and TypeScript facade. Cross-platform CI additionally verifies all six x64/arm64 prebuild targets.
