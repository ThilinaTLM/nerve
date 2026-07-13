# Manager–sandbox protocol link

The sandbox daemon connects as `sandbox_agent`; the accepting peer is `sandbox_manager`. Transport authentication precedes the shared `ProtocolClientSession`/`ProtocolServerSession` hello/welcome/ready lifecycle.

The sandbox resumes exactly `sandbox:<sandboxId>` from its persisted processed controller cursor and durable outbox. The manager's replay source is its persisted event store. Live events are buffered during replay; ACK advances only after manager ingestion. Reconnect reuses the exact sandbox cursor.

Requests from the manager target `{ role: "sandbox_agent", id: sandboxId }`. The daemon validates target identity and operation catalog capability. Responses preserve reply/lineage IDs. The manager never rewrites method names or params.

A sandbox event retains the daemon-assigned sequence when ingested and forwarded to the UI. The manager separately emits lifecycle events on `manager`. Snapshot recovery returns cursor-bearing manager and sandbox state; the client installs state before atomically replacing cursors.

Queue, replay, heartbeat, processed ACK, transient coalescing/drop, and durable-overflow behavior are the shared Protocol v1 rules in `docs/nerve-protocol/v1/`.
