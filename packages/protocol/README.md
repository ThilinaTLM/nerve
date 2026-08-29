# `@nervekit/protocol`

Transport-neutral session/RPC/stream lifecycle with optional concrete adapters.

- `runtime/`: injected ports and system defaults.
- `messages/`: message creation.
- `connections/`: connection generations and reconnect policy.
- `sessions/`: client/server session state, heartbeat, peer binding, and inbound RPC.
- `rpc/`: client, server dispatcher, idempotency, and request preparation.
- `streams/`: replay, batching, buffering, budgets, and priority.
- `transports/`: codec and generic transport contracts.
- `adapters/`: browser IDs, fetch-based operations, and WebSocket transport.

HTTP server routing, auth, storage, and product state remain in host packages.
