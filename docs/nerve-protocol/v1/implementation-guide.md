# Implementation guide

Use `@nervekit/contracts` for transport-neutral envelopes, catalogs, routing, lifecycle tables, and operation types. Use `@nervekit/protocol` for message factories, client/server sessions, connection lifecycle, subscriptions, dense batching, notification delivery, and RPC.

A host composition supplies:

- authenticated transport adapters and peer/target authorization;
- a catalog-backed operation dispatcher;
- one dense sequence owner per persisted stream;
- `readStream(stream, fromSeq, limit)` and exact-set subscription authorization;
- snapshot loading and state-first cursor installation;
- an unsequenced notification publisher;
- bounded buffers and redacted diagnostics.

Producers derive delivery and stream routing from the public-event catalog. They must not allocate sequences for ephemeral events. Persisted append operations validate lifecycle transitions before commit.

A consumer applies a sequenced event before advancing its cursor. On a gap, retention miss, or reducer lifecycle violation, recover the affected stream through a snapshot and resubscribe. Polling may refresh optional presentation data but is not protocol recovery.

Use focused package tests for dense replay/live ordering, subscriptions, snapshots, reconnect, overflow, notify coalescing, migrations, target validation, and clean shutdown.
