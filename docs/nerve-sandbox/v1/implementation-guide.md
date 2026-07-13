# Sandbox implementation guide

Compose shared contracts and runtime services rather than adding host-specific lifecycle owners:

1. manager creates PostgreSQL-backed stores, versioned storage, runtime driver, volume provider, typed HTTP/WS dispatchers, and lifecycle reconciler;
2. daemon validates version-4 file state, recovers, composes `HostToolFactory`, `TaskService`, `RunCoordinator`, and `GitService`, then connects with a shared client session;
3. manager accepts the authenticated `sandbox_agent`, binds it to its sandbox ID, forwards catalog RPC, and ingests original `sandbox:<id>` sequences;
4. manager UI loads manager/selection snapshots and uses independent processed cursors;
5. built images preserve the non-root filesystem and health contracts.

Test the protocol conformance suite, manager-agent integration, reconnect/replay, snapshot cursors, state recovery, idempotency, host parity, process-group cleanup, static UI serving, and both images. Never add alternate wire frames or state readers to make disposable development data load.
