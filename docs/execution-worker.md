# Execution worker

Production command execution is owned by a persistent Rust worker, not by the Node.js daemon. One authenticated worker is started per Nerve profile and discovered through `<NERVE_HOME>/execution-runtime/worker.json`; its token is stored separately under `<NERVE_HOME>/auth`.

The daemon sends framed, versioned requests over loopback TCP. Execution IDs are deterministic for agent tool calls, starts are idempotent, output is written to durable per-execution journals before it is replayed by cursor, and cancellation targets the native process group or Windows Job Object. The worker and command trees therefore survive daemon restarts, while the daemon can reconnect, replay output, and finish task/tool state without launching a duplicate command.

Worker subprocesses run below normal priority by default. The worker remains at normal priority so output draining and control requests stay responsive. Idle workers exit after one minute when no execution is active; terminal execution records are retained for seven days unless explicitly removed.

Native release packaging includes both `nerve_native` and `nerve_execution_worker` artifacts for Linux, macOS, and Windows on x64 and arm64. Run `pnpm build:native` to build the local worker used by source development.
