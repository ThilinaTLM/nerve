# Nerve Protocol v1 implementation status

This document tracks implementation status. It is descriptive and does not change the normative protocol docs.

| Area | Status | Notes |
| --- | --- | --- |
| Envelope | Implemented | WebSocket and HTTP protocol frames use `protocol`, `version`, `id`, `kind`, `ts`, and `data`; unsupported versions are rejected. |
| Session | Implemented | `/ws` uses `hello` -> `welcome` -> `ready`, negotiated capabilities, heartbeats, ACKs, and goodbye. |
| Snapshots | Implemented | `GET /api/workspace/snapshot`, conversation snapshots, and protocol HTTP snapshot methods return `{ snapshot, cursor.streams }`. |
| Event stream | Implemented | Delivery uses `event.batch`; durable continuity metadata is included. |
| Replay/ACK | Implemented | ACK is based on processed durable cursor. Replay has started/complete/unavailable markers and snapshot recovery. |
| Backpressure | Implemented | Per-session queueing, adaptive batching, queue metrics, flow transitions, transient overflow dropping, and conservative domain-aware transient coalescing are implemented. |
| HTTP mapping | Implemented for safe JSON APIs | `POST /api/protocol/v1` supports snapshots plus safe frontend-used JSON read/mutation methods with protocol response/error envelopes. Bootstrap, secret, OAuth, binary/upload/download, and large log flows remain REST/out-of-band. |
| Idempotency | Implemented for safe JSON RPC mutations | Recommended mutation idempotency keys are cached in-memory with conflict detection. |
| Security/logging | Implemented baseline | Protocol error details are bounded/redacted; binary, provider secrets, OAuth, uploads, exports, and large file flows remain REST/out-of-band. |

## Acceptance checklist

- [x] Protocol messages use v1 envelopes.
- [x] WebSocket requires `hello` first and rejects malformed traffic.
- [x] Client reconnect uses processed durable cursor from snapshot/reducer flushes.
- [x] Snapshot recovery includes cursor metadata.
- [x] Replay unavailable directs clients to `load_snapshot`.
- [x] Durable events are not intentionally dropped.
- [x] Transient overflow is coalesced where safe, then may be dropped with counters under pressure.
- [x] Safe frontend-used JSON APIs use protocol response/error envelopes.
- [x] Idempotent mutation retries return cached responses or conflict.
- [x] Secret/binary flows remain out-of-band.
