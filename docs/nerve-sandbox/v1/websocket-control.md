# Sandbox WebSocket control

The daemon connects as `sandbox_agent` to its authenticated manager endpoint. Both peers require `stream.subscription.v1` and negotiate the shared event-batch and notification capabilities.

After ready, the daemon subscribes to exactly `sandbox:<sandboxId>` using its local high-water cursor. The manager reports its persisted stream bounds. The daemon publishes the missing dense outbox suffix, then reinstalls the subscription to reconcile manager progress and safely truncates the delivered prefix.

Sequenced batches are persisted atomically and must continue at manager sequence + 1; exact duplicate prefixes are accepted only when IDs, sequences, types, and payloads match. Ephemeral events use `event.notify` and bypass both stores.

Manager-to-agent commands use catalog RPC on the same session. The manager verifies endpoint identity and target authorization. Reconnect repeats subscription reconciliation; an unavailable retained range requires snapshot/reset recovery rather than sparse sequence repair.
