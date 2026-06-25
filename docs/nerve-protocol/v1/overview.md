# Overview

Nerve Protocol v1 is the application protocol used by Nerve clients and the orchestrator. Its primary use is live UI synchronization over WebSocket, but it is intentionally transport-neutral so the same message model can be reused over other carriers.

The first implementation target is:

- **Transport**: WebSocket.
- **Primary peer roles**: browser UI client and local orchestrator.
- **Primary traffic**: orchestrator-to-client event batches, client-to-orchestrator acknowledgements, heartbeat/liveness, replay negotiation, and flow-control notices.

The protocol also defines an optional HTTP mapping so request/response APIs can gradually share the same envelope, error model, idempotency model, and tracing metadata.

## Goals

Nerve Protocol v1 aims to provide:

1. **Robust reconnects**
   - A client can resume from its last processed durable event sequence.
   - The orchestrator can replay missing durable events from memory, index, or log-backed storage.
   - Duplicate events are safe and expected around reconnect boundaries.

2. **Fast live event delivery**
   - Events are sent in batches to reduce frame overhead and JSON parse pressure.
   - Transient bursty events can be coalesced or dropped under load.
   - Durable state-changing events remain ordered and replayable.

3. **Explicit delivery state**
   - Clients acknowledge what they have processed, not merely what they have received.
   - The orchestrator can detect slow clients and make backpressure decisions.
   - Clients can detect gaps and request replay or resynchronization.

4. **Transport neutrality**
   - Protocol messages do not depend on WebSocket-specific concepts.
   - Each transport binding defines how messages are encoded, authenticated, and framed.
   - Future transports can reuse the same application semantics.

5. **Schema-first evolution**
   - Shared protocol schemas live in shared code.
   - Unknown capabilities, metadata, and message kinds can be ignored safely where allowed.
   - Version and capability negotiation makes additive evolution explicit.

6. **Operational clarity**
   - Error codes are stable and machine-readable.
   - Flow state is visible through `flow.update` messages.
   - Logging/tracing metadata can correlate client and orchestrator behavior without leaking secrets.

7. **Incremental adoption**
   - The current raw event WebSocket can be migrated without an all-at-once rewrite.
   - Existing REST-style HTTP APIs can remain while new APIs adopt the protocol envelope gradually.

## Non-goals

Nerve Protocol v1 does not attempt to provide:

1. **A replacement for domain schemas**
   - The protocol envelope describes delivery, ordering, and control messages.
   - Domain-specific event payloads remain owned by their domain schemas.

2. **A distributed consensus protocol**
   - Nerve currently has a local-first orchestrator model.
   - The protocol supports reconnect and replay; it does not define multi-writer conflict resolution.

3. **Exactly-once execution semantics**
   - Durable events are delivered at-least-once across reconnects.
   - Clients MUST handle duplicate durable events by `seq` and/or event `id`.
   - Request idempotency is available for operations that opt into it.

4. **A mandatory HTTP rewrite**
   - The HTTP mapping is an optional profile for new or migrated APIs.
   - Existing REST endpoints can coexist with protocol-enveloped endpoints.

5. **A mandatory binary encoding**
   - JSON is the required baseline encoding.
   - MessagePack, CBOR, or other encodings can be negotiated in future versions or capabilities.

6. **Transport-level security replacement**
   - Authentication, authorization, TLS, origin restrictions, and token handling remain transport-binding responsibilities.
   - Protocol messages MUST NOT carry secrets unless a domain API explicitly requires secret input and the transport/security profile permits it.

## Layering model

Nerve Protocol v1 is divided into layers. Implementations SHOULD keep these layers separate in code.

```text
+--------------------------------------------------------------+
| Domain payloads                                               |
| conversation.*, task.*, agent.*, approval.*, settings.*, ...   |
+--------------------------------------------------------------+
| Event stream profile                                          |
| event.batch, replay.*, ack, flow.update, stream cursors        |
+--------------------------------------------------------------+
| Session protocol                                              |
| hello, welcome, ready, heartbeat, goodbye, error               |
+--------------------------------------------------------------+
| Common message envelope                                       |
| protocol, version, id, kind, ts, correlation, meta, data       |
+--------------------------------------------------------------+
| Transport binding                                             |
| WebSocket, HTTP, WebTransport, Electron IPC, pipe, SSE, ...    |
+--------------------------------------------------------------+
```

### Transport binding

The transport binding defines how protocol messages are carried. For WebSocket, each text frame contains exactly one JSON-encoded protocol message. For HTTP, the request body and response body can each contain one protocol message, unless a streaming response profile is used.

A transport binding is responsible for:

- connection establishment;
- authentication material placement;
- origin and TLS policy;
- frame/body limits;
- transport-specific liveness behavior;
- mapping transport close/error conditions to protocol errors where possible.

### Common message envelope

The envelope provides a stable outer shape for all protocol messages. It includes the protocol name, version, message ID, kind, timestamp, optional correlation fields, optional metadata, and a typed `data` payload.

See [Message Envelope](./message-envelope.md).

### Session protocol

The session protocol establishes peer identity, selected protocol version, negotiated capabilities, resume cursors, heartbeat behavior, and shutdown semantics.

See [Session Lifecycle](./session-lifecycle.md).

### Event stream profile

The event stream profile carries ordered batches of domain events. It defines the use of sequence numbers, durable and transient delivery semantics, stream identifiers, batch boundaries, and client dispatch rules.

See [Event Stream](./event-stream.md).

### Domain payloads

Domain payloads are the contents of events or request/response messages. They are validated by domain schemas in shared code. Domain payloads MUST remain transport-neutral and MUST NOT assume a specific UI framework or carrier.

## Peer roles

The protocol defines these peer roles:

- `orchestrator`: the local Nerve daemon/orchestrator that owns tools, storage, agents, policies, and durable event sequencing.
- `ui`: a browser or desktop UI client rendering workspace state and sending user actions through HTTP or a protocol request profile.
- `desktop`: a desktop shell or main process that may broker local lifecycle and native integration.
- `cli`: a command-line client.
- `agent`: a future peer role for external agents or worker processes if needed.

A peer MAY advertise one or more roles during `hello`, but each connection SHOULD have one primary role for logging and policy.

## Streams

A stream is an ordered event sequence. Version 1 defines one REQUIRED stream:

- `global`: the orchestrator-wide event stream using the existing monotonic event `seq`.

Future versions or capabilities MAY add scoped streams such as:

- `conversation:<conversationId>`;
- `task:<taskId>`;
- `agent:<agentId>`;
- `workspace:<workspaceId>`.

Scoped streams MUST define whether their `seq` values are global or per-stream. Unless explicitly negotiated otherwise, all event sequences in v1 are interpreted as the `global` stream sequence.

## Core invariants

Implementations MUST preserve these invariants:

1. **Protocol version is explicit**
   - Every protocol message MUST identify `protocol: "nerve"` and `version: 1`.

2. **Message kind determines payload schema**
   - The `kind` field selects the schema for `data`.
   - Unknown required message kinds are errors; unknown optional messages can be ignored only when the sender indicated they are optional or the spec says they are advisory.

3. **Durable event order is monotonic**
   - Durable events in the `global` stream MUST have strictly increasing integer `seq` values.
   - Clients MUST process durable events in ascending `seq` order per stream.

4. **Durable events are at-least-once delivered**
   - Replays may include events the client already processed.
   - Clients MUST deduplicate by stream and `seq`; event `id` can be used as a secondary guard.

5. **Transient events are best-effort**
   - Transient events MAY be dropped or coalesced under backpressure.
   - Transient events SHOULD NOT be required to reconstruct durable application state.

6. **Acknowledgements mean processed**
   - An `ack` cursor means the client has applied all durable events up to that cursor for that stream.
   - A client MUST NOT acknowledge a durable event sequence before the effects are safely reflected in its local application state.

7. **Gaps are explicit failures**
   - If a client observes a durable sequence gap, it MUST stop applying later durable events for that stream and request replay or resynchronization.

8. **Backpressure is explicit**
   - A peer that intentionally degrades, drops transient events, or requires resync MUST communicate this through protocol messages when the transport is still usable.

9. **No secrets in protocol metadata**
   - Metadata MUST be safe for logs unless explicitly marked and redacted by the implementation.

10. **Schema evolution is additive by default**
    - Receivers SHOULD ignore unknown metadata fields.
    - Receivers MUST NOT ignore unknown fields inside strict domain payloads unless that payload schema allows it.

## Compatibility with the current architecture

The current Nerve architecture already separates:

- HTTP request/response APIs;
- a WebSocket event stream;
- durable event persistence and replay;
- frontend event dispatch and state reduction.

Nerve Protocol v1 keeps this architecture but replaces ad-hoc WebSocket frames with explicit protocol messages:

- current raw event frame → `event.batch` containing one event;
- current heartbeat frame → `heartbeat`;
- current `?since=` reconnect cursor → `hello.resume` and/or transport query compatibility;
- current HTTP `/api/events?since=` replay → protocol replay endpoint or `replay.request` over the stream;
- current `lastEventSeq` tracking → processed `ack` cursor.

## Versioning model

Protocol versioning has two levels:

1. **Major protocol version**
   - `version: 1` identifies the Nerve Protocol major version.
   - Major versions MAY introduce incompatible envelope or semantic changes.

2. **Capabilities**
   - Capabilities advertise optional features within the major version.
   - Capabilities MUST be named strings.
   - Capability-specific payload extensions MUST be ignored by peers that did not negotiate that capability.

Example capabilities:

- `event.batch`;
- `event.replay`;
- `event.ack.processed`;
- `flow.backpressure`;
- `http.envelope`;
- `encoding.json`;
- `snapshot.workspace`.

The baseline v1 WebSocket profile requires `encoding.json`, `event.batch`, `event.replay`, and `event.ack.processed`.

## Failure model

The protocol assumes common local-app failures:

- browser tab sleeps or loses network;
- laptop sleeps/wakes;
- orchestrator restarts;
- UI reloads;
- client is slow to render bursts;
- event backlog exceeds in-memory buffers;
- replay index is unavailable and storage fallback is slower;
- transient live events outpace rendering.

The protocol responds with:

- heartbeat/liveness detection;
- reconnect with resume cursor;
- durable event replay;
- duplicate-safe event application;
- batching;
- acknowledgements;
- backpressure/degradation messages;
- resync-required messages when replay cannot satisfy the client cursor.

## Document organization

This overview defines the conceptual model. Normative wire shapes are in [Message Envelope](./message-envelope.md), [Session Lifecycle](./session-lifecycle.md), [Event Stream](./event-stream.md), [Replay and Acknowledgements](./replay-and-ack.md), [Backpressure](./backpressure.md), and [Errors and Security](./errors-and-security.md). The [HTTP Mapping](./http-mapping.md) and [Implementation Guide](./implementation-guide.md) describe profiles and rollout guidance. Concrete examples are in [Examples](./examples.md).
