# Workbench server (`packages/workbench-server`)

Inherits the root `AGENTS.md`.

- Own concrete HTTP/WebSocket adapters, storage implementations, daemon composition, and workbench-specific domain adapters.
- Keep shared host use-case semantics in `@nervekit/host-runtime`, shared schemas in `@nervekit/contracts`, and protocol lifecycle behavior in `@nervekit/protocol`.
- Register protocol operations in the domain-grouped maps under `src/protocol/method-handlers/`. Do not recreate a central exhaustive switch or a second manually maintained operation list; the registry derives and verifies the workbench surface from the contracts catalog.
- Keep handler modules as thin adapters over domain services. Preserve validation, side-effect ordering, and contract result shapes.
- Validate with `pnpm --filter @nervekit/workbench-server check` and `pnpm --filter @nervekit/workbench-server test`.
