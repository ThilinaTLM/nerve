# Protocol package (`packages/protocol`)

- Keep the core (`src/sessions`, `src/rpc`, `src/streams`, `src/connections`) transport- and framework-neutral; concrete WebSocket/HTTP/browser adapters live in `src/adapters/`. Domain schemas belong in `@nervekit/contracts`.
- Session, RPC, replay, queue, backpressure, and reconnect behavior belongs here.
- HTTP server routing, authentication, authorization, storage, and Svelte state stay in host packages.
