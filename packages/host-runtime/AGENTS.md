# Host runtime package (`packages/host-runtime`)

Inherits the root `AGENTS.md`.

- Own shared host use-case semantics and narrow constructor-injected ports.
- Compose `@nervekit/harness` and `@nervekit/tools`; never depend on protocol, HTTP, WebSocket, Svelte, container drivers, or SQLite.
- Keep repositories, credentials, process behavior, policy, event journals, and diagnostics behind explicit use-case ports.
- Validate with `pnpm --filter @nervekit/host-runtime check` and `pnpm --filter @nervekit/host-runtime test`.
