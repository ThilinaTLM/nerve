# Workbench server module ownership

The workbench server owns local runtime effects and authority boundaries: HTTP/WebSocket transport, local auth, catalog dispatch, file-first repositories, policy, tasks, tools, and run coordination.

Root TypeScript files are entrypoints only: `index.ts` is the package API and `main.ts` is `@nervekit/workbench-server/main`.

- `app/` composes the server, routes, protocol host, status, and version metadata.
- `runtime/` composes server-owned host services and route-facing registries.
- `domains/<area>/` owns feature repositories/services for auth, agents, conversations, tools, tasks, projects, pinned commands, interactions, plans, Git, usage, providers, storage, and completions.
- `infrastructure/` owns file-first storage, events, rebuildable indexes, TLS, secrets, and diagnostics.
- `http/` and `routes/` adapt authenticated HTTP/WebSocket requests to typed handlers.
- `core/application-error.ts` defines transport-neutral domain failures; HTTP and protocol adapters map them at their boundaries.
- `domains/filesystem/filesystem.service.ts` owns filesystem behavior shared by REST and protocol handlers.
- `domains/runs/runtime/conversation-runtime.ts` owns mutable, server-scoped conversation/run projection state.
- HTTP and WebSocket dispatchers share one state-scoped idempotency store so retries are deduplicated across transports.

`ProtocolServerSession` is the session lifecycle authority. `RunCoordinator`, `TaskService`, `HostToolFactory`, and `GitService` provide host semantics inside this package. The run runtime under `domains/runs/runtime/` stays port-driven and imports only contracts, local run modules, and neutral ports from `core/ports.ts`; concrete protocol, storage, and process adapters remain outside it. Keep transport-neutral schemas in `@nervekit/contracts`, protocol mechanics in `@nervekit/protocol`, agent mechanics in `@nervekit/harness`, and canonical tool mechanics in `@nervekit/tools`.
