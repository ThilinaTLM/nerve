# Backpressure and overflow

`welcome.limits` negotiates maximum message bytes, batch event count, and batch bytes. Server sessions also enforce local event-count and byte budgets for pending replay/live delivery.

- Sequenced events are never silently dropped or coalesced by transport.
- Ephemeral notifications may use catalog-declared `latest_by_scope` coalescing and a bounded queue; oldest best-effort notifications may be discarded under pressure.
- Replay and live batches are chunked to negotiated limits.
- If preserving sequenced ordering would exceed the outgoing budget, the server sends goodbye with `resync_required` and closes. The client reconnects, loads a snapshot when required, and reinstalls subscriptions.

There is no wire-level flow-control message and no event-progress acknowledgement window. Subscription cursors and bounded reconnect recovery are the only event-stream control plane.
