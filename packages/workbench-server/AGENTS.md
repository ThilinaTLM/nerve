# Workbench server (`packages/workbench-server`)

- Own concrete HTTP/WebSocket adapters, storage implementations, daemon composition, host use cases, task lifecycle policy, and workbench-specific domain adapters.
- Keep shared schemas in `@nervekit/contracts`, protocol lifecycle behavior in `@nervekit/protocol`, the agent loop in `@nervekit/harness`, conversation storage and runtime in `@nervekit/conversation-core`, and tool execution/security in `@nervekit/tools`.
- Compose the conversation core in `src/app/bootstrap/create-conversation-core.ts`; the host adapters it consumes (model, tools, permissions, processes, turn resources) live in `src/core-host/`. Cross-domain clock, ID, diagnostics, and domain-event ports live in `src/core/ports/`.
- Native process lifecycle belongs in `@nervekit/native`; platform port discovery stays behind `src/infrastructure/process-host/port-inspector.ts`.
- Register protocol operations in the domain-grouped maps under `src/adapters/protocol/handlers/`. `src/adapters/protocol/create-method-registry.ts` binds each group to an explicit capability context before registry combination; adapters must not import `RuntimeServices`, `RuntimeLifecycle`, or receive a generic `services` property. Do not recreate a central exhaustive switch or a second manually maintained operation list; the registry derives and verifies the workbench surface from the contracts catalog.
- Keep handler modules as thin adapters over domain services. Preserve validation, side-effect ordering, and contract result shapes.
- Unit tests colocate as `<name>.test.ts`; `test/` is for cross-module, contract and integration scenarios and shared fixtures (see `docs/architecture/codebase.md`).
