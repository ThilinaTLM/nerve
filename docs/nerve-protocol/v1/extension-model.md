# Extension Model

Nerve Protocol v1 is intentionally small at the core. New features should extend the protocol through capabilities, registered methods, registered domain events, snapshots, streams, or transport bindings without weakening the baseline invariants.

## Goals and constraints

Extensions MUST preserve these constraints:

- **Additive by default**: new optional fields, message kinds, methods, events, and capabilities must not break peers that did not negotiate them.
- **Schema-first**: shared schemas live in `packages/contracts` before multiple clients depend on them.
- **Transport-neutral payloads**: domain payloads must not assume WebSocket, browser APIs, Svelte state, or a specific transport.
- **Orchestrator-owned safety**: tools, filesystem access, shell commands, credentials, OAuth tokens, and storage policy remain enforced in the orchestrator/tool layer.
- **No secrets in metadata**: protocol `meta`, tracing fields, ordinary event payloads, and logs must remain safe after redaction.
- **Explicit recovery**: state that affects UI correctness must be recoverable through durable replay or snapshots.
- **Clean foundation**: because Nerve is early-stage foundation work, avoid long-lived compatibility shims when a clean migration is feasible.

## Capability naming and lifecycle

Capabilities are string identifiers exchanged during `hello`/`welcome`. A peer MUST NOT use a capability-specific extension unless that capability was accepted.

### Naming rules

Capability names SHOULD be lowercase dot-separated strings:

```text
<area>.<feature>[.<variant>]
```

Examples:

```text
encoding.json
event.batch
event.replay
event.ack.processed
flow.backpressure
snapshot.workspace
snapshot.conversation
http.envelope
transport.websocket.v1
experimental.event.scoped_streams
```

Use these top-level areas unless there is a good reason to add another:

| Area             | Purpose                                                  |
| ---------------- | -------------------------------------------------------- |
| `encoding.*`     | Message encodings such as JSON or future binary formats. |
| `event.*`        | Event-stream delivery, replay, ordering, scoped streams. |
| `flow.*`         | Backpressure and delivery quality extensions.            |
| `snapshot.*`     | Snapshot recovery profiles.                              |
| `http.*`         | HTTP envelope, streaming, replay, or request profiles.   |
| `transport.*`    | Transport-binding-specific behavior.                     |
| `attachment.*`   | Future large/binary resource transfer profiles.          |
| `experimental.*` | Temporary capabilities that may change or be removed.    |

### Stable capabilities

A stable capability must define:

- name;
- purpose;
- required or optional status;
- message kinds or payload fields it enables;
- validation and error behavior;
- interaction with replay/snapshots if it affects state;
- security implications.

Stable capability names SHOULD NOT be reused with incompatible semantics.

### Experimental capabilities

Experimental capabilities MUST use the `experimental.` prefix. They are useful for development builds, but they are not compatibility promises.

Rules:

- An experimental capability MAY change or be removed without a major protocol version bump.
- It MUST NOT be required by the baseline v1 WebSocket event-stream profile.
- It SHOULD be converted to a stable capability before external clients depend on it.

### Deprecation

When replacing a stable capability:

1. Add a new capability name for the replacement behavior.
2. Support both capabilities only for the planned migration window.
3. Document client/server fallback behavior.
4. Remove the old capability once all first-party clients migrate.

Do not silently change semantics under the old name.

## Method registry governance

Protocol `request` methods are optional and incremental. Existing REST/resource endpoints can remain canonical. When a method is added, it SHOULD be registered in shared code with request and response schemas.

### Method naming

Method names MUST be non-empty dot-separated strings:

```text
<domain>.<action>
<domain>.<entity>.<action>
```

Examples:

```text
conversation.create
conversation.sendPrompt
agent.abortRun
task.cancel
approval.grant
snapshot.workspace.get
providerCatalog.model.upsert
filesystem.listDirectories
```

### Method addition checklist

Before a protocol method is used by more than one client, define:

- method name;
- request params schema;
- response result schema;
- idempotency expectations;
- authorization/policy requirements;
- expected events emitted by the operation;
- whether the operation is read, mutation, long-running, or accepted-async;
- whether response data represents materialized state and therefore needs `cursor.streams`;
- safe error codes.

### Read methods

Read methods MAY use protocol RPC when they benefit from common envelope metadata, but ordinary REST reads are often clearer. If a read returns materialized state used for recovery, it SHOULD include cursor metadata whether it is REST or protocol RPC.

### Mutation methods

Retryable mutation methods SHOULD support `idempotencyKey`. If a mutation emits events, clients MUST tolerate the event arriving before or after the response.

### Long-running methods

Long-running methods SHOULD return an accepted result with an operation ID and publish progress/completion through events. They SHOULD NOT keep HTTP requests open unless a streaming profile is explicitly selected.

### Method removal

A method should not be removed until:

- first-party clients no longer call it;
- a replacement route/method exists if the feature remains;
- docs and shared schemas have been updated;
- server errors for old clients are clear (`METHOD_NOT_FOUND` or a documented replacement error).

## Domain event registry governance

Domain events are the canonical incremental sync mechanism for UI state. Protocol v1 carries events; it does not own every domain payload schema.

### Event naming

New event types SHOULD use lowercase dot-separated names:

```text
<domain>.<entity_or_action>[.<detail>]
```

Current Nerve event names that contain underscores, such as `user_question.*`, `plan_review.*`, and `prompt_suggestions.*`, remain valid domain event names. They do not need to be renamed to implement protocol v1.

### Event addition checklist

Every new event family or event type SHOULD document:

- event `type` string;
- durability (`durable` or `transient`);
- payload schema owner in `packages/contracts`;
- entity IDs included in payload;
- reducer/idempotency behavior;
- whether it affects materialized workspace/conversation/task state;
- snapshot relationship for recovery;
- whether it can be coalesced or dropped if transient;
- secret-safety and logging policy;
- expected producers and consumers.

### Durability rules

Use `durable` when missing the event would make recovered application state incorrect. Use `transient` for live visual updates, progress ticks, or hints that can be missed because a durable event or snapshot reconstructs final state.

A transient event MUST NOT be the only record of durable state.

### Payload schemas

Payload schemas SHOULD live with the domain in `packages/contracts`, not in protocol control schemas. The protocol event payload remains `data: unknown` at the envelope level until validated by event type.

## Snapshot extension rules

Snapshots are materialized state plus recovery cursors.

Every snapshot that participates in event recovery MUST define:

- snapshot method or resource path;
- result schema;
- affected domains/entities;
- included stream cursors;
- whether the snapshot replaces or patches local state;
- follow-up replay/delta behavior;
- authorization and secret-safety policy.

The cursor contract is mandatory:

```ts
type SnapshotCursor = {
  streams: Array<{
    stream: string;
    processedSeq: number;
  }>;
};
```

A client that applies a snapshot sets its processed cursor for affected streams to the snapshot cursor and ignores older duplicate durable events.

### Adding narrow snapshots

Narrow snapshots are encouraged when they make recovery cheaper or cleaner. Examples:

```text
snapshot.conversation.get
snapshot.task.get
snapshot.approvals.get
snapshot.settings.get
snapshot.providerCatalog.get
```

A narrow snapshot MUST state whether it is safe to combine with other snapshots and which event types update it afterward.

## Stream extension rules

Version 1 defines the `global` stream. Future scoped streams can reduce replay volume or improve isolation, but they must be explicit.

Before adding a stream capability, define:

- stream identifier format, such as `conversation:<conversationId>`;
- whether `seq` is global or per-stream;
- cursor shape and storage;
- replay source and retention;
- how events map to one or multiple streams;
- ordering rules across streams;
- snapshot cursor behavior;
- what happens when a client supports only `global`.

If scoped streams use per-stream sequence numbers, every message involving those streams MUST include the stream identifier. Clients MUST NOT compare sequence numbers across streams unless the capability defines a global order.

## Transport binding extension rules

A new transport binding carries the same application messages but must define transport-specific behavior.

A transport binding MUST specify:

- connection/session establishment;
- authentication material placement;
- origin/TLS or local IPC policy;
- message framing;
- encoding and content type;
- maximum frame/body size;
- liveness behavior;
- backpressure signals available from the transport;
- close/error mapping;
- whether bidirectional streaming is supported;
- how request/response correlation is carried if the transport is not ordered.

### WebSocket

WebSocket is the first streaming binding. Each text frame contains exactly one JSON protocol message after protocol mode is selected.

### HTTP streaming and SSE

HTTP streaming/SSE style transports may be useful for non-browser or constrained clients. They must define whether the stream is server-only or bidirectional, and how acks/replay requests are sent if the stream is one-way.

### Electron IPC and local pipes

IPC/pipe bindings can reuse the envelope directly. They still need explicit authentication/trust boundary policy because local IPC can cross process boundaries.

### WebTransport

A future WebTransport binding must specify stream/datagram use, ordering guarantees, and how durable event ordering is preserved when multiple transport streams are available.

## Attachment and binary capability boundary

Protocol v1 has no generic attachment or binary-body profile. This is intentional.

A future `attachment.*` capability MUST define:

- attachment/resource identifier format;
- upload/download initiation messages or resource endpoints;
- maximum sizes and chunking;
- content type and checksum metadata;
- auth and authorization checks;
- lifetime and cleanup semantics;
- whether content is stored under `~/.nerve`;
- progress events;
- how cancellation works;
- redaction/logging rules;
- relationship to snapshots/events.

Until such a capability exists, audio, images, exports, large files, and other binary bodies SHOULD remain resource-oriented HTTP flows.

## Compatibility and versioning checklist

When adding a protocol feature, answer these questions:

1. Is it a domain event, protocol control message, HTTP method, snapshot, transport binding, or capability?
2. Can peers that do not support it ignore it safely?
3. Which capability gates the behavior?
4. Are schemas in `packages/contracts`?
5. Does it affect durable state, transient state, or diagnostics only?
6. How does a client recover after reload/reconnect?
7. Does it need cursor metadata?
8. Does it need idempotency?
9. Does it carry or reference secrets, binary data, files, logs, or tool output?
10. What are the stable error codes?
11. What tests prove old and new clients behave correctly during migration?

If the feature cannot be added safely under v1 capabilities, define a future major protocol version instead of stretching v1 semantics.
