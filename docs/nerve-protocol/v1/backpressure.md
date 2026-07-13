# Backpressure

Protocol limits are negotiated in `welcome`: maximum message bytes, batch events/bytes, inflight batches, and unacknowledged durable events. Local queue implementations also enforce event-count and byte budgets.

`flow.update` communicates queue scope, mode, reason, statistics, and requested action. Under pressure:

- coalescible transient updates may replace older updates for the same key;
- other transient updates may be dropped and reported;
- durable events are never silently dropped;
- durable hard overflow, invalid ACK progress, or inability to preserve ordering terminates the session so reconnect/replay or snapshot recovery can restore correctness.

Batching and replay are chunked to negotiated bounds. Heartbeat load fields are diagnostic only and never authorize clients to exceed server limits.
