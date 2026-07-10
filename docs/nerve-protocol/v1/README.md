# Nerve Protocol v1

Status: **proposed specification**  
Scope: transport-neutral application protocol for communication between the Nerve orchestrator, UI clients, desktop shells, CLIs, and future local/remote clients.

Nerve Protocol v1 defines the application-level messages used to coordinate sessions, stream events, resume after disconnects, acknowledge delivered work, apply backpressure, and optionally map request/response APIs onto a common envelope. WebSocket is the first streaming transport, but the protocol is designed so the same message model can be carried over future transports such as WebTransport, Electron IPC, local pipes, HTTP streaming, or server-sent events where appropriate.

## Reading order

1. [Overview](./overview.md) — goals, non-goals, layering, invariants, terminology.
2. [Message Envelope](./message-envelope.md) — common message shape, IDs, kinds, metadata, validation, encoding.
3. [Session Lifecycle](./session-lifecycle.md) — handshake, capability negotiation, liveness, reconnect behavior.
4. [Event Stream](./event-stream.md) — ordered event batches, durable/transient event semantics, dispatch rules.
5. [Replay and Acknowledgements](./replay-and-ack.md) — cursors, replay, processed acknowledgements, gap handling.
6. [Backpressure](./backpressure.md) — batching, queues, slow clients, degradation, transient event dropping.
7. [Feature Coverage](./feature-coverage.md) — how current Nerve route families, event families, snapshots, and out-of-band flows fit v1.
8. [HTTP Mapping](./http-mapping.md) — optional use of the same protocol envelope for HTTP request/response APIs.
9. [Errors and Security](./errors-and-security.md) — error model, auth, secret handling, robust parsing.
10. [Extension Model](./extension-model.md) — capability, method, event, snapshot, stream, transport, and attachment evolution rules.
11. [Implementation Guide](./implementation-guide.md) — incremental migration plan from the existing `/ws` event stream.
12. [Examples](./examples.md) — concrete JSON examples for common flows.

## Normative language

The words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** are used as normative terms. When a section is explicitly labeled as implementation guidance, those words describe recommended project behavior rather than wire compatibility requirements.

## Protocol summary

Nerve Protocol v1 has five core ideas:

- **Transport neutrality**: protocol messages are plain application messages, independent from WebSocket, HTTP, or any future carrier.
- **Schema-first envelopes**: every protocol frame has a versioned envelope with a stable `kind`, message ID, timestamp, and payload.
- **Ordered event streaming**: durable domain events retain the existing monotonic `seq` model and can be replayed by cursor.
- **Explicit flow control**: acknowledgements, batching, queue limits, and degradation states are part of the protocol instead of hidden transport behavior.
- **Current-feature coverage with incremental adoption**: current REST/resource endpoints, out-of-band binary/secret flows, and domain event reducers can continue to work while WebSocket streaming moves to protocol messages and selected APIs optionally adopt protocol envelopes.

## Current implementation context

The existing Nerve implementation already has most of the lower-level primitives needed for this protocol:

- `packages/contracts/src/domains/events/envelope.schema.ts` defines the current durable event envelope.
- `packages/orchestrator/src/infrastructure/events/event-bus.ts` owns event sequencing, persistence, and replay.
- `packages/orchestrator/src/main.ts` exposes the current `/ws` WebSocket event stream.
- `packages/workbench-app/src/lib/core/events/websocket-client.svelte.ts` connects, tracks the current `lastEventSeq`, and reconnects with `since`; protocol migration must split this into received and processed durable cursors.
- `packages/orchestrator/src/routes/status-routes.ts` exposes current HTTP event replay through `/api/events?since=...`.

Those files are implementation references, not wire-protocol constraints. The normative protocol is defined by these documents.

## Implementation readiness scope

This specification is ready to guide implementation of the v1 WebSocket event-stream profile once shared schemas and adapter modules are added. That first implementation target includes handshake, `event.batch`, processed acknowledgements, replay, snapshot recovery hooks, heartbeat/liveness, and backpressure observability.

The specification does **not** require an all-at-once HTTP rewrite. Existing REST/resource endpoints remain valid v1 participants when they use shared schemas, publish/consume domain events as needed, include cursor metadata for protocol-compatible snapshots, and keep large/binary/secret-sensitive payloads out of protocol metadata. See [Feature Coverage](./feature-coverage.md) and [Extension Model](./extension-model.md) for the coverage and future-evolution rules.
