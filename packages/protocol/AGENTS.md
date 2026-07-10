# Protocol package (`packages/protocol`)

Inherits the root `AGENTS.md`.

- Keep this package transport- and framework-neutral. Domain schemas belong in `@nervekit/contracts`.
- Session, RPC, replay, ACK, queue, backpressure, and reconnect behavior belongs here.
- HTTP server routing, authentication, authorization, storage, and Svelte state stay in host packages.
- Validate with `pnpm --filter @nervekit/protocol check` and `pnpm --filter @nervekit/protocol test`.
