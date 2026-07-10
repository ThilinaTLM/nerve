# Implementation Guide

This guide describes how to implement Nerve Protocol v1 incrementally in the current codebase. It is guidance, not a separate wire specification. Normative protocol behavior is defined in the other documents in this directory.

## Current implementation anchors

Relevant current files:

- `packages/contracts/src/domains/events/envelope.schema.ts` — current `EventEnvelope` schema.
- `packages/orchestrator/src/infrastructure/events/event-bus.ts` — event sequencing, persistence, replay, and subscription.
- `packages/orchestrator/src/main.ts` — current `/ws` WebSocket upgrade and raw event streaming.
- `packages/orchestrator/src/routes/status-routes.ts` — current `/api/events?since=...` replay route.
- `packages/workbench-app/src/lib/core/events/websocket-client.svelte.ts` — current UI WebSocket client.
- `packages/workbench-app/src/lib/core/events/event-bus.ts` — frontend coalesced event dispatch.

The implementation should preserve these strengths while replacing ad-hoc WebSocket frames with protocol messages.

Current implementation status is tracked in `implementation-status.md`. The active implementation uses a clean Protocol v1 `/ws`, cursor-bearing snapshot endpoints, and selected `/api/protocol/v1` HTTP methods while leaving binary, secret, OAuth, upload, export, and large file flows out-of-band.

## Proposed shared package layout

Protocol schemas should live in `packages/contracts` so orchestrator, UI, desktop, CLI, and tests use the same types.

Recommended layout:

```text
packages/contracts/src/domains/protocol/
  index.ts
  envelope.schema.ts
  session.schema.ts
  event-stream.schema.ts
  replay.schema.ts
  backpressure.schema.ts
  http.schema.ts
  errors.schema.ts
```

The existing event envelope should remain in the events domain or be re-exported from protocol schemas:

```text
packages/contracts/src/domains/events/envelope.schema.ts
```

Do not move domain schemas into protocol unless they are protocol-control payloads. Domain event payloads belong to their domains.

## Suggested TypeScript schema groups

### Envelope

- `nerveMessageSchema`
- `peerDescriptorSchema`
- `protocolVersionSchema`
- `messageKindSchema`

### Session

- `helloMessageSchema`
- `welcomeMessageSchema`
- `readyMessageSchema`
- `heartbeatMessageSchema`
- `goodbyeMessageSchema`

### Event stream

- `eventBatchMessageSchema`
- `eventBatchDataSchema`
- `streamCursorSchema`
- `streamStateSchema`

### Replay and ack

- `ackMessageSchema`
- `replayRequestMessageSchema`
- `replayStartedMessageSchema`
- `replayCompleteMessageSchema`
- `replayUnavailableMessageSchema`

### Backpressure

- `flowUpdateMessageSchema`
- `flowModeSchema`
- `flowReasonSchema`

### HTTP mapping

- `protocolRequestMessageSchema`
- `protocolResponseMessageSchema`

### Errors

- `protocolErrorMessageSchema`
- `nerveErrorCodeSchema`

## Orchestrator responsibilities

The orchestrator protocol adapter should own:

1. WebSocket protocol session creation.
2. `hello` validation and `welcome` response.
3. Capability negotiation.
4. Per-session cursors and ack state.
5. Event batching.
6. Replay orchestration from memory/index/log.
7. Backpressure state and `flow.update` messages.
8. Heartbeat messages and liveness cleanup.
9. Protocol error handling and safe logging.
10. Compatibility behavior for legacy clients during migration.

Suggested modules:

```text
packages/orchestrator/src/protocol/
  protocol-session.ts
  protocol-websocket.ts
  event-batcher.ts
  replay-coordinator.ts
  flow-control.ts
  protocol-errors.ts
```

Keep dangerous capabilities and secrets in orchestrator/tool layers. Protocol code should route requests and events; it should not move secret logic into frontend-reachable schemas.

## UI client responsibilities

The UI protocol client should own:

1. Connecting to the WebSocket transport.
2. Sending `hello` with capabilities and resume cursors.
3. Processing `welcome` and `ready`.
4. Parsing and validating protocol messages.
5. Applying `event.batch` in order.
6. Tracking processed durable cursors.
7. Sending `ack` messages.
8. Detecting gaps and requesting replay.
9. Responding to `flow.update` and `replay.unavailable`.
10. Reconnecting with backoff and latest processed cursor.

Suggested modules:

```text
packages/workbench-app/src/lib/core/protocol/
  client.svelte.ts
  websocket-transport.ts
  event-stream.ts
  replay.ts
  ack.ts
  flow.ts
```

The existing frontend event bus can remain the internal dispatch mechanism. Protocol handling should sit before it and feed validated domain events into the existing bus.

## Incremental migration phases

### Phase 0: Coverage alignment

- Use [Feature Coverage](./feature-coverage.md) as the checklist for current route families, event families, snapshots, and out-of-band flows.
- Confirm which REST/resource endpoints remain canonical in v1.
- Identify which initial materialized loads need cursor metadata before they can serve as recovery snapshots.
- Confirm that current event reducers can receive the same `EventEnvelope` domain events after protocol `event.batch` unwrapping.
- Do not block the event-stream implementation on converting every HTTP endpoint to protocol RPC.

Validation:

- current route families are accounted for in docs or issue tracker;
- current event families have durability expectations;
- out-of-band binary/secret flows are explicitly excluded from protocol messages.

### Phase 1: Shared schemas and examples

- Add shared protocol schemas and type exports.
- Add unit tests for envelope validation.
- Keep runtime behavior unchanged.

Validation:

- schema tests for valid/invalid messages;
- type exports compile;
- no frontend/orchestrator runtime change.

### Phase 2: Protocol WebSocket handshake behind existing route

- Keep `/ws` endpoint.
- Detect protocol clients by first message `hello`.
- For protocol clients, respond with `welcome`.
- For legacy clients, continue current raw event behavior temporarily.
- Add server `heartbeat` as protocol message for protocol clients.

Validation:

- protocol client can connect and receive `welcome`;
- legacy UI still works until migrated;
- invalid `hello` receives `error` or close.

### Phase 3: Event batches

- Wrap live events in `event.batch`.
- Start with one event per batch if simpler.
- Then add short-window batching.
- Include range and durable continuity metadata (`previousDurableSeq`, `durableCompleteThroughSeq`).
- UI unwraps batches and feeds existing event bus.

Validation:

- all current UI event reducers still receive the same domain events;
- duplicate and out-of-order tests;
- high-volume run does not overload JSON parsing.

### Phase 4: Processed acknowledgements

- UI tracks processed durable cursor after event bus flush/application.
- UI sends `ack` messages.
- Orchestrator records per-session ack cursors.
- Add debug logging for ack lag.

Validation:

- ack cursor never moves backwards;
- duplicate batches do not advance incorrectly;
- reconnect uses processed cursor.

### Phase 5: Replay protocol

- Replace or supplement `?since=` query replay with `hello.resume` and `replay.request`.
- For resume handshakes with `resume.mode: "replay"`, start replay after client `ready`.
- Orchestrator sends `replay.started`, replay `event.batch`, and `replay.complete`.
- During replay, buffer live events for the session and deliver after replay.
- Replay batches prove durable continuity even when transient events are omitted.

Validation:

- reconnect after missed events catches up;
- replay from memory path works;
- replay from persisted/index path works;
- replay unavailable triggers snapshot/full reload path.

### Phase 6: Backpressure and transient policy

- Add per-session queues and metrics.
- Monitor transport buffered bytes and ack lag.
- Add `flow.update` transitions.
- Coalesce/drop transient events according to domain rules.

Validation:

- slow simulated client enters degraded mode;
- durable events are not dropped;
- transient drops are counted;
- critical slow clients recover or close cleanly.

### Phase 7: HTTP mapping for selected APIs

- Add protocol error schema to HTTP errors where useful.
- Add optional `/api/protocol/v1` endpoint or resource-specific protocol endpoints.
- Start with replay/snapshot or complex operations that benefit most.
- Keep binary upload/download endpoints as resource-oriented HTTP unless a future attachment profile is added.

Validation:

- HTTP protocol request/response schemas validate;
- idempotency tests for selected mutations;
- events caused by HTTP operations correlate with request IDs.

## Migration compatibility rules

During migration:

- A WebSocket connection that sends `hello` is protocol v1.
- A WebSocket connection that does not send `hello` may be treated as legacy only during the compatibility window.
- Protocol and legacy frames MUST NOT be mixed on the same connection.
- The UI should migrate to protocol mode before legacy server support is removed.
- Once the project is ready, remove legacy raw event frames rather than keeping permanent compatibility shims.

This project is early foundation work, so prefer a clean final design over long-lived compatibility layers.

## Event batching implementation notes

A simple batcher can start with:

- per-session pending event array;
- max delay timer, e.g. 16 ms;
- max event count;
- max estimated encoded bytes;
- immediate flush for replay boundaries and close.

Pseudo-flow:

```text
on event published:
  classify durable/transient
  enqueue for each subscribed session
  if high-priority durable: schedule near-immediate flush
  if limits reached: flush
  else ensure flush timer

flush session:
  sort by seq if needed
  build event.batch payload with range and durable continuity metadata
  send protocol message if transport buffer below hard limit
  update sent cursor metrics
```

Avoid serializing the same large batch separately for every client if many clients are connected. A future optimization can share encoded payloads where per-session metadata is identical.

## Replay implementation notes

The current event bus already supports:

- in-memory replay through `replaySince`;
- persisted replay through `replayPersistedSince`;
- latest sequence tracking;
- buffered floor sequence.

The protocol replay coordinator should:

1. Select replay source based on cursor and buffered floor.
2. Capture a replay high-water mark before reading persisted history.
3. Subscribe/buffer live events that arrive after the high-water mark.
4. Send `replay.started`.
5. Send replay batches up to the high-water mark.
6. Send `replay.complete`.
7. Flush buffered live events in order.

This mirrors the current server logic but makes replay state explicit to the client.

## Ack implementation notes

The UI currently updates `workspaceState.lastEventSeq` when receiving events. Protocol v1 should distinguish:

- highest received sequence;
- highest enqueued sequence;
- highest applied/processed durable sequence.

The ack cursor should follow the applied/processed value.

If the frontend event bus batches delivery by animation frame or microtask, send ack after the flush completes, not when the WebSocket frame arrives.

## Gap detection implementation notes

Initial protocol implementation should use durable continuity metadata, not raw numeric adjacency:

- if a durable event arrives with `seq <= processedSeq`, ignore it as a duplicate;
- for the first non-duplicate durable event in a batch, require `range.previousDurableSeq <= processedSeq`;
- if `range.previousDurableSeq > processedSeq`, request replay from `processedSeq`;
- if a durable batch omits required continuity metadata, treat it as ambiguous and request replay or resync;
- while replay is pending, buffer or ignore later live durable events for that stream;
- if replay returns duplicates, ignore duplicates;
- if replay unavailable, reload the relevant snapshot/workspace.

Do not use `seq > processedSeq + 1` as a gap test in the mixed durable/transient global stream. Transient events may legitimately occupy skipped numeric sequence values and may not be replayable.

## Backpressure implementation notes

Start with observability before aggressive behavior:

1. Track `ws.bufferedAmount` or equivalent.
2. Track events queued per session.
3. Track latest sent durable seq and latest acked processed seq.
4. Log ack lag and queue bytes.
5. Add `flow.update` when thresholds are crossed.
6. Only then add transient coalescing/drop policies.

Recommended first transient policy:

- never drop durable events;
- coalesce repeated subscription usage updates to latest;
- coalesce progress updates to latest per task/run;
- combine adjacent live text deltas for same conversation message when safe;
- drop presentation-only transient events during replay.

## Testing strategy

### Shared schema tests

- valid message fixtures for every kind;
- invalid envelope fixtures;
- unknown version/kind behavior;
- size limit helpers;
- strict payload validation.

### Orchestrator protocol tests

- handshake success/failure;
- capability negotiation;
- event batch range and durable continuity metadata;
- ack cursor monotonicity;
- replay from memory;
- replay from persisted/index;
- replay unavailable;
- slow-client queue thresholds;
- heartbeat close behavior.

### UI protocol tests

- handshake messages;
- batch validation;
- duplicate durable events ignored;
- gap triggers replay;
- ack after processed flush;
- flow update state changes;
- reconnect uses processed cursor.

### Integration tests

- start orchestrator and UI protocol client;
- create conversation via HTTP;
- observe event batch;
- disconnect/reconnect with missed events;
- simulate slow client and verify degradation;
- simulate old cursor and verify snapshot/full reload path.

## Validation commands

For documentation-only changes, no build is required. For future schema/runtime implementation, use the project checks:

```bash
pnpm fix
pnpm check
pnpm test
```

Run targeted tests as they are added for shared protocol schemas and orchestrator/web protocol clients.

## Definition of done for v1 event-stream implementation

The v1 WebSocket event-stream profile is implemented when:

- shared protocol schemas exist in `packages/contracts` and are imported by orchestrator/UI code;
- the server accepts protocol clients through `hello` and replies with `welcome` or protocol `error`;
- the client sends `ready` before high-volume event delivery;
- live domain events are delivered as `event.batch` messages;
- event batches include valid range counts and durable continuity metadata;
- current UI event reducers receive equivalent domain `EventEnvelope` objects after batch unwrapping;
- the UI tracks highest received sequence separately from processed durable cursor;
- the UI advances processed cursor only after reducers apply durable events or after a trusted snapshot cursor;
- the UI sends `ack` after processing durable events and uses processed cursors on reconnect;
- replay works for cursors served from memory and persisted durable history;
- replay unavailability triggers snapshot/full reload recovery instead of skipping durable events;
- protocol heartbeat/liveness behavior replaces the legacy `{ type: "heartbeat" }` frame for protocol clients;
- initial backpressure metrics and flow-state logging exist, even before aggressive transient dropping is enabled;
- current REST/resource endpoints remain functional throughout migration;
- protocol and legacy WebSocket frames are not mixed on the same connection.

HTTP protocol RPC support is **not** required for this definition of done. Selected HTTP endpoints can adopt protocol envelopes later when it reduces duplication or improves idempotency/correlation.

## Rollout checklist

Current implementation status is tracked in [Implementation Status](./implementation-status.md). The original rollout checklist is now complete for the v1 WebSocket profile and safe JSON HTTP RPC coverage:

- [x] Shared schemas committed.
- [x] Protocol docs linked from relevant developer docs.
- [x] WebSocket server supports `hello`/`welcome`.
- [x] UI client sends `hello`.
- [x] `event.batch` live delivery enabled.
- [x] UI tracks processed cursor separately from received cursor.
- [x] Ack messages enabled.
- [x] Replay messages enabled.
- [x] Backpressure metrics logged.
- [x] Transient coalescing policy enabled.
- [x] Legacy raw WebSocket mode removed after migration.

## Open design choices for implementation time

These are choices to make when implementing, not gaps in the v1 protocol spec:

- exact threshold values after profiling real event volumes;
- whether initial protocol support uses the same `/ws` path or adds `/ws/v1` during development;
- how much local cursor state the browser persists across reloads;
- which HTTP APIs should adopt protocol envelopes first;
- exact snapshot result shapes per domain, as long as they include the required cursor contract.

The protocol documents define the compatible message semantics for whichever implementation choices are selected.
