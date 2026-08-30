# Workbench server (`packages/workbench-server`)

Inherits the root `AGENTS.md`.

- Own concrete HTTP/WebSocket adapters, storage implementations, daemon composition, host use cases, task lifecycle policy, and workbench-specific domain adapters.
- Keep shared schemas in `@nervekit/contracts`, protocol lifecycle behavior in `@nervekit/protocol`, agent execution in `@nervekit/harness`, and tool execution/security in `@nervekit/tools`.
- Keep `src/domains/runs/runtime/` port-driven and independent of protocol transports, HTTP/WebSocket, persistence, UI, and concrete process drivers. Cross-domain clock, ID, diagnostics, and domain-event ports live in `src/core/ports.ts`.
- Keep host harness construction in `src/domains/agents/execution/harness-factory.ts` and host tool composition in `src/domains/tools/orchestration/host-tool-factory.ts`. Native process lifecycle belongs in `@nervekit/native`; platform port discovery belongs behind `src/domains/tasks/adapters/task-port-inspector.ts`.
- Register protocol operations in the domain-grouped maps under `src/adapters/protocol/handlers/`. Bootstrap binds each group to an explicit capability context before registry combination; adapters must not import `RuntimeServices`, `RuntimeLifecycle`, or receive a generic `services` property. Do not recreate a central exhaustive switch or a second manually maintained operation list; the registry derives and verifies the workbench surface from the contracts catalog.
- Keep handler modules as thin adapters over domain services. Preserve validation, side-effect ordering, and contract result shapes.
- Validate with `pnpm --filter @nervekit/workbench-server check` and `pnpm --filter @nervekit/workbench-server test`.
