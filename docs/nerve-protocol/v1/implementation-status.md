# Implementation status

Protocol v1 is the implemented wire protocol between the workbench UI and server.

- Strict envelopes, operation/event catalogs, routing, and lifecycle tables: complete.
- Shared client/server handshake, heartbeat, goodbye, and reconnect: complete.
- Required exact-set subscriptions and per-stream recovery: complete.
- Dense sequenced batches with replay-before-live buffering: complete.
- Unsequenced `event.notify` with bounded coalescing: complete.
- Snapshot-required recovery and cursor installation: complete.
- Bounded delivery with `resync_required` overflow close: complete.
- Workbench `workspace` and `conv/<id>` StreamLogs, retention, and migration: complete.
- Producer/client lifecycle guards for tool state and interrupted recovery facts: complete.
- HTTP/WebSocket typed handler parity for shared RPC surfaces: complete.

Large binary/file/log bodies, OAuth redirects, secrets, bootstrap configuration, health, and static assets intentionally remain outside protocol RPC.
