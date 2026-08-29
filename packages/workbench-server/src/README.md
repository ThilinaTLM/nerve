# Workbench server module ownership

The server owns local authority and runtime effects: HTTP/WebSocket adapters, local auth, canonical persistence, host use cases, tasks, tool composition, and run coordination.

- Root `index.ts` and `main.ts` are package entrypoints only.
- `app/bootstrap/` constructs and hydrates services. `app/runtime/` owns process-lifetime resources, lifecycle, and mutable runtime projections.
- `adapters/http/` owns middleware, routes, request/response translation, cookies, HTML, and static files.
- `adapters/protocol/` owns WebSocket dispatch, snapshots, idempotency, the verified operation registry, and thin domain-grouped handlers. Each handler group declares a narrow compile-time context and uses composed `RuntimeServices` directly where no lifecycle coordination is required.
- `domains/<area>/` owns business behavior. Large task/tool/run slices use explicit `model`, `application`, `persistence`, `artifacts`, `orchestration`, `execution`, or `adapters` areas.
- `domains/agents/execution/` owns prompts, harness integration, subagents/explore, approvals, and streaming. It is distinct from durable run lifecycle.
- `domains/runs/runtime/` owns the port-driven run state machine and may not depend on transports, persistence implementations, UI, or process drivers.
- `infrastructure/persistence/canonical-sqlite/` is authoritative storage; `persistence/query-cache/` is a disposable read model. `storage-bootstrap/` owns paths, locks, layout, initialization, and file mutations. `migrations/` owns compatibility upgrades.
- `core/application-error.ts` and `core/ports.ts` remain transport-neutral boundaries.

`ProtocolServerSession` is session authority. `RunCoordinator`, task application services, host tool orchestration, and Git services provide host semantics. Shared schemas stay in `@nervekit/contracts`, protocol lifecycle in `@nervekit/protocol`, agent mechanics in `@nervekit/harness`, and canonical tool execution/security in `@nervekit/tools`.
