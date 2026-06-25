# Replay and Acknowledgements

Replay and acknowledgements make the event stream robust across reloads, sleeps, reconnects, slow rendering, and orchestrator restarts.

The key rule is:

> A client acknowledges the highest durable event sequence it has **processed**, not the highest event sequence it has merely received.

## Cursor model

A cursor identifies progress in a stream.

```ts
type StreamCursor = {
  stream: string;
  processedSeq: number;
};
```

Version 1 defines the `global` stream. A v1 shorthand `lastProcessedSeq` MAY be used where the stream is unambiguous, but protocol messages SHOULD use `streams` arrays for future compatibility.

### Cursor semantics

For a stream `S`, `processedSeq = N` means:

- the client has successfully applied all durable events for stream `S` up to and including sequence `N` that are required to reconstruct state;
- the client can safely ignore duplicate durable events with `seq <= N`;
- the client needs durable events with `seq > N` to catch up;
- transient events at or below `N` are not required for state recovery.

A client MUST NOT advance a processed cursor past a durable event that failed validation or application.

## Received, persisted, rendered, and processed

Implementations SHOULD distinguish these concepts:

| State | Meaning | Suitable for ack? |
| --- | --- | --- |
| Received | Transport frame arrived and parsed. | No. |
| Validated | Envelope and payload schema passed. | No. |
| Queued | Event is waiting in client-side dispatch queue. | No. |
| Applied | Event reducer updated local application state. | Usually yes. |
| Rendered | Browser painted the resulting UI. | Not required. |
| Persisted locally | Client stored cursor in durable local state. | Optional. |
| Processed | Client considers the durable event effects safely applied. | Yes. |

For the UI, `processed` usually means event reducers have completed and the in-memory state used by the UI is updated. It does not require waiting for a browser paint.

## `ack`

Direction: client → orchestrator.

Purpose: report processed durable cursors and optional delivery statistics.

```ts
type AckData = {
  sessionId: string;
  ackId: string;
  streams: StreamCursor[];
  received?: Array<{
    stream: string;
    highestSeq: number;
  }>;
  stats?: {
    appliedEvents?: number;
    duplicateEvents?: number;
    droppedTransientEvents?: number;
    pendingEvents?: number;
    processingLatencyMs?: number;
  };
};
```

Requirements:

- `ackId` SHOULD be unique and SHOULD use the `ack_` prefix if that prefix is introduced in shared ID helpers.
- `streams` MUST include every stream whose processed cursor changed since the previous ack, unless the ack is a periodic full ack.
- A client SHOULD send an ack after applying a durable event batch.
- A client MAY coalesce acknowledgements to reduce traffic.
- A client SHOULD send a final ack in `goodbye.finalCursors` or as a standalone `ack` before intentional close.
- The orchestrator MUST treat a lower or equal ack cursor as idempotent.
- The orchestrator MUST NOT move a session's processed cursor backwards.
- The orchestrator MUST NOT treat one client's ack as another client's ack.

### Ack cadence

Recommended UI ack behavior:

- send ack immediately after replay completion if any durable events were applied;
- send ack after each durable batch in low-volume periods;
- during high-volume periods, coalesce acks for up to 250 ms;
- send ack when pending unacked durable events reaches 100;
- send ack before requesting replay, closing intentionally, or reloading if possible.

The ack cadence is a performance optimization. Correctness depends on the client using its own latest processed cursor when reconnecting, not on the server remembering every ack.

## `replay.request`

Direction: client → orchestrator.

Purpose: request durable event replay from a processed cursor.

```ts
type ReplayRequestData = {
  sessionId: string;
  replayId: string;
  streams: Array<{
    stream: string;
    fromSeq: number;
    toSeq?: number;
  }>;
  reason:
    | "resume"
    | "gap_detected"
    | "client_recovery"
    | "snapshot_delta"
    | "manual_refresh";
  preferences?: {
    maxEvents?: number;
    maxBytes?: number;
    preferSnapshot?: boolean;
    includeTransientIfAvailable?: boolean;
  };
};
```

Semantics:

- `fromSeq` is the client's processed cursor. The orchestrator sends events with `seq > fromSeq`.
- `toSeq` is optional. If omitted, the orchestrator replays through a consistent latest cursor and then continues live delivery.
- `includeTransientIfAvailable` asks the orchestrator to include transient events still available in memory. It does not require transient persistence.

Requirements:

- `replayId` MUST be unique within the session.
- The client MUST stop applying later durable events for the requested stream until replay resolves, unless a future capability defines concurrent ordered catchup.
- The orchestrator MUST respond with `replay.started`, `replay.unavailable`, or `error`.
- The replay MUST eventually end with `replay.complete`, `replay.unavailable`, or a terminal session error.

## `replay.started`

Direction: orchestrator → client.

Purpose: mark replay start and communicate selected replay ranges.

```ts
type ReplayStartedData = {
  sessionId: string;
  replayId: string;
  streams: Array<{
    stream: string;
    fromSeq: number;
    toSeq: number;
    latestSeq: number;
    estimatedEvents?: number;
    source: "memory" | "index" | "log" | "snapshot" | "mixed";
  }>;
};
```

Requirements:

- `fromSeq` MUST match the cursor after which events will be sent.
- `toSeq` MUST identify the replay high-water mark selected by the orchestrator.
- Live events with `seq > toSeq` MUST be buffered or delivered later in a way that preserves durable order.
- `source` is informational and useful for diagnostics.

## Replay event batches

Replay events are delivered using `event.batch` with `reason: "replay"` and `replay.replayId`.

Requirements:

- Batches MUST be ordered by stream and ascending sequence.
- Each batch MUST contain only events with `seq > fromSeq` and `seq <= toSeq` for the selected replay range, unless the orchestrator marks a subsequent catchup range explicitly.
- The client MUST apply replay batches before later live batches for the same stream.
- Duplicate durable events within replay MUST be ignored if already processed.

## `replay.complete`

Direction: orchestrator → client.

Purpose: mark replay completion and communicate resulting cursors.

```ts
type ReplayCompleteData = {
  sessionId: string;
  replayId: string;
  streams: Array<{
    stream: string;
    fromSeq: number;
    toSeq: number;
    latestSeq: number;
    sentEvents: number;
    sentDurableEvents: number;
    sentTransientEvents: number;
  }>;
  liveDelivery: "continued" | "resuming" | "requires_ready";
};
```

Requirements:

- The orchestrator MUST send `replay.complete` only after all replay batches for the replay range have been sent.
- The client SHOULD validate that it has processed all durable events in the replay range before returning to live mode.
- The client SHOULD send `ack` after processing replay completion if its processed cursor advanced.

`liveDelivery` semantics:

- `continued`: live delivery may already be flowing in order.
- `resuming`: live delivery will resume immediately after replay completion.
- `requires_ready`: client must send `ready` before live delivery resumes.

Version 1 WebSocket implementations SHOULD use `resuming` for replay requested during an active session.

## `replay.unavailable`

Direction: orchestrator → client.

Purpose: report that requested replay cannot be satisfied.

```ts
type ReplayUnavailableData = {
  sessionId: string;
  replayId: string;
  streams: Array<{
    stream: string;
    requestedFromSeq: number;
    earliestAvailableSeq?: number;
    latestSeq: number;
    reason:
      | "cursor_too_old"
      | "cursor_ahead_of_server"
      | "stream_not_found"
      | "storage_unavailable"
      | "range_too_large"
      | "snapshot_required";
  }>;
  recovery: {
    action: "load_snapshot" | "full_reload" | "retry_later" | "fail";
    retryAfterMs?: number;
    snapshotMethod?: string;
  };
};
```

Requirements:

- The orchestrator MUST send `replay.unavailable` instead of silently skipping required durable events.
- The client MUST NOT continue applying later durable events for affected streams until it completes the specified recovery action.
- If `recovery.action` is `load_snapshot`, the snapshot MUST include or lead to a valid post-snapshot event cursor.

## Replay sources

The orchestrator can satisfy replay from multiple sources:

| Source | Typical use | Notes |
| --- | --- | --- |
| `memory` | short disconnects | Fastest; may include recent transient events. |
| `index` | normal durable replay | Bounded and queryable; preferred for durable history. |
| `log` | fallback/recovery | Slower; may require streaming file reads. |
| `snapshot` | large/old recovery | Sends materialized state then deltas. |
| `mixed` | combined sources | Must preserve final ordering. |

The source does not change client semantics. It is diagnostic and can inform progress UI.

## Gap detection

A client detects a gap when it cannot prove durable continuity.

Examples:

- next durable event `seq` is greater than expected;
- `event.batch.range.durableFirstSeq` jumps unexpectedly;
- replay completes but the client did not receive a required durable event;
- batch range metadata is inconsistent;
- client state reducer rejects a durable event due to missing prerequisite state.

On gap detection, the client SHOULD send:

```json
{
  "kind": "replay.request",
  "data": {
    "reason": "gap_detected",
    "streams": [{ "stream": "global", "fromSeq": 120 }]
  }
}
```

The client SHOULD include an `error` or diagnostic `meta` field in the message envelope only if it is safe and useful. Detailed diagnostics can also be logged locally.

## Cursor ahead of server

A client may reconnect with a cursor greater than the orchestrator's latest sequence if:

- the orchestrator data directory was reset;
- the client connected to a different orchestrator instance;
- the client has corrupt local cursor state;
- clock/order assumptions were wrong in implementation.

The orchestrator MUST NOT pretend the cursor is valid. It SHOULD send `replay.unavailable` with reason `cursor_ahead_of_server` and recovery action `load_snapshot` or `full_reload`.

The client SHOULD discard incompatible local event-derived state and load a fresh snapshot.

## Snapshot + delta recovery

For large recovery, snapshots are often faster and more robust than replaying a long event history.

Recommended flow:

1. Client detects it needs recovery from `processedSeq = N`.
2. Client sends `replay.request` with `preferSnapshot: true`.
3. Orchestrator sends `replay.unavailable` with recovery `load_snapshot`, or sends a `response` to a snapshot request if using HTTP/protocol RPC.
4. Client loads snapshot containing `snapshotSeq = M`.
5. Client replaces local materialized state with snapshot state.
6. Client sends `replay.request` from `M` or reconnects with `hello.resume` cursor `M`.
7. Orchestrator sends deltas with `seq > M`.
8. Client applies deltas and acknowledges.

Snapshot responses MUST include the stream cursor at which the snapshot is valid.

## Server use of acknowledgements

The orchestrator SHOULD use acks for:

- detecting slow clients;
- bounding per-session live queues;
- deciding when to coalesce or drop transient events;
- diagnostics and observability;
- avoiding unnecessary replay within an active session;
- optional future per-client notification state.

The orchestrator MUST NOT depend solely on volatile ack state for correctness. Clients reconnect with their own processed cursors.

## Client storage of cursors

A browser UI client SHOULD keep its processed cursor in memory for normal reconnects. It MAY also store cursors in session storage or another local mechanism to survive reloads.

If local cursor storage is used:

- cursors MUST be scoped to the orchestrator identity or data directory identity when possible;
- cursors SHOULD be cleared when auth target changes;
- stale cursors MUST be recoverable through `replay.unavailable` and snapshot reload;
- cursor storage MUST NOT contain secrets.

## Duplicate handling

Duplicate durable events can occur after:

- reconnect;
- replay request from a conservative cursor;
- server retry;
- client ack loss;
- server buffered-live merge.

Clients MUST ignore duplicate durable events with `seq <= processedSeq`. Domain reducers SHOULD also be entity-idempotent.

Duplicate transient events SHOULD be ignored if they can be identified by event `id`, but clients MAY allow harmless repeated presentation updates.

## Acknowledgement examples

See [Examples](./examples.md) for ack, replay, and snapshot recovery examples.
