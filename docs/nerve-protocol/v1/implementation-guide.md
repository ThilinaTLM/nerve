# Implementation guide

Use `@nervekit/contracts` for all transport-neutral types and catalogs and `@nervekit/protocol` for codecs, message factories, HTTP helpers, client/server sessions, connection lifecycle, ACK tracking, queues, and replay state.

A host composition supplies:

- authenticated transport adapters;
- peer descriptors and accepted target roles;
- a catalog-backed operation handler registry;
- a single event writer per stream;
- durable replay source and processed-cursor persistence;
- snapshot loading and state-first atomic installation;
- queue limits and redacted diagnostics.

A reducer must finish applying a durable event before the client persists or sends its processed cursor. On gaps or unavailable replay, use the shared snapshot recovery port. Do not paper over correctness with polling; host polling may refresh optional Git/task presentation but is not protocol recovery.

Use the protocol conformance suite and host integration tests for handshake, invalid frames, target validation, retries/idempotency, replay/live interleaving, ACK bounds, overflow, snapshots, reconnect, and clean shutdown.
