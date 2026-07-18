# Sandbox v1 overview

A sandbox is an isolated workspace plus a persistent `/state` volume. The manager creates lifecycle records and runtime volumes, launches the container/task, accepts the `sandbox_agent` protocol session, forwards targeted catalog operations, ingests the sandbox's dense sequenced stream, and serves snapshots to the UI.

The daemon composes shared `HostToolFactory`, `TaskService`, `RunCoordinator`, and `GitService` behavior with sandbox-specific process, filesystem, credentials, outbox, and checkpoint adapters. The same host contracts power local and sandbox behavior; environment adapters own process/container differences.

## Data ownership

- Manager PostgreSQL: sandbox/session/lifecycle records, manager and ingested sandbox events, idempotency, audit, credentials/policies, pinned commands, runtime-volume records.
- Manager storage directory: version marker and backend volume/config files; local backend bind mounts live below it.
- Sandbox `/state`: version 4 file-first runtime state, secure launch environment, setup state, run/task state, dense outbox metadata, idempotency, checkpoints, and caches.
- Sandbox `/workspace`: project files.

No secret value belongs in protocol events, snapshots, logs, or browser state.
