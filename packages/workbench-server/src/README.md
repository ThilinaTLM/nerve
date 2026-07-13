# Workbench server module ownership

The workbench server owns local runtime effects and authority boundaries: HTTP/WebSocket transport, local auth, catalog dispatch, file-first repositories, policy, tasks/workers, tools, and run coordination.

Root TypeScript files are entrypoints only: `index.ts` is the package API and `main.ts` is `@nervekit/workbench-server/main`.

- `app/` composes the server, routes, protocol host, status, and version metadata.
- `runtime/` composes shared host runtime services and route-facing registries.
- `domains/<area>/` owns feature repositories/services for auth, agents, conversations, tools, tasks, workers, projects, pinned commands, interactions, plans, Git, usage, providers, storage, and completions.
- `infrastructure/` owns file-first storage, events, rebuildable indexes, TLS, secrets, and diagnostics.
- `http/` and `routes/` adapt authenticated HTTP/WebSocket requests to typed handlers.

`ProtocolServerSession` is the session lifecycle authority. `RunCoordinator`, `TaskService`, `HostToolFactory`, and `GitService` provide shared host semantics; local process/filesystem adapters remain here. Keep transport-neutral schemas in `@nervekit/contracts`, protocol mechanics in `@nervekit/protocol`, reusable host mechanics in `@nervekit/host-runtime`, and presentation in the UI packages.
