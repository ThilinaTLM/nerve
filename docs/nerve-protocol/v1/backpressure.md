# Backpressure

Backpressure is the protocol's mechanism for keeping event delivery robust when a client, network, transport, or renderer cannot keep up with event production.

Nerve Protocol v1 treats backpressure as an application-level concern. Transport buffers alone are not enough because the orchestrator needs to choose between preserving durable events, coalescing transient events, replaying later, asking the client to resync, or closing a slow session.

## Principles

1. **Durable events are preserved**
   - Durable events MUST NOT be intentionally dropped for a connected client if replay remains possible.
   - If durable delivery cannot continue, the orchestrator MUST require replay or resync.

2. **Transient events are best-effort**
   - Transient events MAY be dropped or coalesced under load.
   - Dropping transient events SHOULD be communicated through `flow.update` when user-visible.

3. **Acks measure client progress**
   - Server-side flow control SHOULD use processed acknowledgements, not only transport write completion.

4. **Batches reduce overhead**
   - Batching is the first-line performance tool before dropping or disconnecting.

5. **Degradation is explicit**
   - Peers SHOULD communicate `normal`, `catching_up`, `degraded`, and `resync_required` modes.

6. **Recovery is deterministic**
   - When a client falls behind, recovery MUST be based on replay or snapshot, not on guessing which events were missed.

## Flow modes

A session's flow mode describes delivery quality for a stream or the whole session.

| Mode | Meaning | Client behavior |
| --- | --- | --- |
| `normal` | Live delivery is healthy. | Apply batches and ack normally. |
| `catching_up` | Client is behind, but durable replay/live catchup is in progress. | Prioritize ordered durable processing; UI may show syncing state. |
| `degraded` | Transient events may be dropped/coalesced, but durable state remains valid. | Continue applying durable events; reduce expensive rendering if possible. |
| `resync_required` | Server cannot guarantee continuity for this session. | Stop applying affected durable stream; load snapshot or reconnect as instructed. |

## `flow.update`

Direction: either.

Purpose: communicate flow-control state, degradation, queue pressure, drops, and recovery instructions.

```ts
type FlowUpdateData = {
  sessionId: string;
  scope: {
    stream?: string;
    domain?: string;
    entityId?: string;
  };
  mode: "normal" | "catching_up" | "degraded" | "resync_required";
  reason:
    | "client_backpressure"
    | "server_backpressure"
    | "transport_buffer_high"
    | "ack_lag_high"
    | "replay_in_progress"
    | "transient_events_dropped"
    | "queue_limit_exceeded"
    | "snapshot_required"
    | "manual";
  stats?: {
    serverQueueEvents?: number;
    serverQueueBytes?: number;
    clientPendingEvents?: number;
    unackedDurableEvents?: number;
    unackedBytes?: number;
    droppedTransientEvents?: number;
    coalescedTransientEvents?: number;
    oldestUnackedSeq?: number;
    latestSeq?: number;
    processedSeq?: number;
  };
  action?: {
    type:
      | "none"
      | "reduce_rate"
      | "pause_transient"
      | "request_replay"
      | "load_snapshot"
      | "reconnect"
      | "close";
    retryAfterMs?: number;
    message?: string;
  };
};
```

Requirements:

- The orchestrator SHOULD send `flow.update` when transitioning between flow modes.
- The orchestrator MUST send `flow.update` or `replay.unavailable` before requiring resync if the transport remains usable.
- A client MAY send `flow.update` with reason `client_backpressure` if its local dispatch queue exceeds thresholds.
- Receivers SHOULD treat `flow.update` as advisory unless `mode` is `resync_required`.
- Receivers MUST treat `resync_required` as authoritative for the affected stream/scope.

## Server-side queues

The orchestrator SHOULD maintain per-session delivery queues rather than writing unbounded data directly to the transport.

Recommended queue categories:

1. **Durable queue**
   - Ordered durable events that must be delivered or replayed.
   - Never intentionally dropped while the session remains valid.

2. **Transient queue**
   - Best-effort events that can be coalesced/dropped.
   - Domain-specific coalescing rules apply.

3. **Control queue**
   - Heartbeats, errors, flow updates, replay markers.
   - Should remain small and high priority.

4. **Replay queue**
   - Events being read from memory/index/log for catchup.
   - Should not starve live durable events indefinitely; live events may be buffered until replay completes.

Recommended initial limits per session:

| Limit | Default |
| --- | ---: |
| Max queued durable events before catchup mode | 1,000 |
| Max queued durable events before resync consideration | 10,000 |
| Max queued transient events | 2,000 |
| Max queued encoded bytes | 16 MiB |
| Max unacked durable events | 5,000 |
| Max unacked encoded bytes | 32 MiB |
| Max replay batch size target | 1 MiB |
| Max replay events per batch | 1,000 |

These are recommended starting points. Implementations SHOULD tune using real event volumes and UI rendering measurements.

## Transport buffer monitoring

For transports that expose buffered bytes, such as WebSocket implementations with `bufferedAmount`, the sender SHOULD monitor transport buffer pressure.

Recommended WebSocket thresholds:

| State | Threshold |
| --- | ---: |
| Normal | `< 1 MiB` buffered |
| Warning | `>= 1 MiB` buffered |
| High | `>= 8 MiB` buffered |
| Critical | `>= 32 MiB` buffered |

Suggested behavior:

- Warning: increase batch size modestly, reduce flush frequency.
- High: enter `degraded`, pause/drop/coalesce transient events.
- Critical: stop writing transient events, consider replay/resync, and close if no recovery occurs.

Transport buffer thresholds are hints. Processed ack lag is more important for durable correctness.

## Ack lag

Ack lag is the difference between the latest durable recovery cursor sent or queued and the client's processed cursor.

```text
ackLag = max(0, latestDurableRecoveryCursorSentOrQueued - processedSeq)
```

Ack lag indicates how far the client is behind in durable application processing. In mixed durable/transient streams, it is a cursor-distance heuristic rather than an exact count of durable events.

Recommended thresholds:

| State | Ack lag |
| --- | ---: |
| Normal | `< 500` durable events |
| Catching up | `>= 500` durable events |
| Degraded | `>= 2,000` durable events or slow growth over time |
| Resync consideration | `>= 10,000` durable events or queue byte limits exceeded |

Ack lag thresholds SHOULD be adjusted by event size and domain. A few huge events may be more expensive than thousands of small status events.

## Batching under pressure

When pressure increases, the orchestrator SHOULD adjust batching before forcing resync:

1. Increase max batch delay from low-latency target to throughput target.
2. Increase batch event count up to configured maximum.
3. Coalesce transient events using domain rules.
4. Drop non-essential transient events.
5. Send `flow.update` describing degradation.
6. If durable lag still grows, request snapshot/replay recovery or close the session.

Batching MUST NOT violate durable ordering.

## Transient event dropping policy

The orchestrator MAY drop transient events when:

- transport buffer is high;
- ack lag is high;
- transient queue exceeds its limit;
- replay is in progress and transient events are not needed after replay;
- a newer transient event supersedes an older one.

The orchestrator SHOULD prefer this order:

1. Drop stale presentation-only hints.
2. Coalesce progress/status updates to latest value.
3. Combine adjacent text/log deltas for the same target.
4. Drop intermediate live deltas if a durable final event will reconstruct state.
5. Enter `resync_required` only if durable continuity cannot be preserved.

The orchestrator SHOULD include drop counts in the next `flow.update` or heartbeat stats when drops are significant.

## Durable event pressure

Durable event pressure cannot be solved by dropping events. Options are:

1. **Catch up with larger replay/live batches**
   - Use efficient batch sizes and reduce per-event overhead.

2. **Pause low-priority producers**
   - If domain policy allows, reduce frequency of background updates.

3. **Require snapshot**
   - If the client is too far behind, a snapshot plus deltas may be cheaper.

4. **Close and reconnect**
   - If transport state is bad but replay is available, closing can be simpler.

5. **Resync required**
   - If replay is unavailable or state continuity cannot be proven.

The orchestrator MUST NOT silently skip durable events.

## Client-side backpressure

The client SHOULD monitor its own event-processing queue.

Recommended client metrics:

- pending protocol messages;
- pending domain events;
- time spent in event reducers;
- time between receiving a batch and applying it;
- number of duplicate events ignored;
- number of transient events locally dropped;
- render frame budget impact.

If the client queue grows beyond thresholds, it MAY send `flow.update`:

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ8A7RFPS7S3G3KTTG5W6622",
  "kind": "flow.update",
  "ts": "2026-06-26T12:10:00.000Z",
  "data": {
    "sessionId": "ses_01JZ89ZBDN6K1H83WZB1H43Y37",
    "scope": { "stream": "global" },
    "mode": "degraded",
    "reason": "client_backpressure",
    "stats": {
      "clientPendingEvents": 3500,
      "processedSeq": 12000
    },
    "action": {
      "type": "reduce_rate",
      "message": "Client event queue is behind"
    }
  }
}
```

The server MAY respond by reducing transient traffic or increasing batch size.

## Priority model

Senders SHOULD prioritize messages in this order:

1. Terminal `error` and `goodbye`.
2. `flow.update` with `resync_required`.
3. Replay markers (`replay.started`, `replay.complete`, `replay.unavailable`).
4. Durable event batches.
5. `ack` and `heartbeat`.
6. Important transient event batches.
7. Presentation-only transient event batches.

Priority MUST NOT reorder durable events within a stream.

## Slow-client handling

A slow-client policy SHOULD include stages:

### Stage 1: Observe

Conditions:

- mild transport buffer growth;
- ack lag increasing but below limits.

Actions:

- log debug metrics;
- adjust batch size;
- continue normal mode.

### Stage 2: Catch up

Conditions:

- ack lag above normal threshold;
- replay in progress;
- client recently reconnected.

Actions:

- send `flow.update` mode `catching_up`;
- batch more aggressively;
- buffer live events behind replay;
- avoid unnecessary transient traffic.

### Stage 3: Degrade

Conditions:

- transient queue limit exceeded;
- transport buffer high;
- reducer/application latency remains high.

Actions:

- send `flow.update` mode `degraded`;
- drop/coalesce transient events;
- preserve durable events;
- consider snapshot if durable backlog is large.

### Stage 4: Resync or close

Conditions:

- durable queue/byte limits exceeded;
- replay window cannot cover client's cursor;
- transport buffer critical;
- client remains unresponsive after heartbeat timeout.

Actions:

- send `flow.update` mode `resync_required` if possible;
- send `goodbye` with reason `restart_required`, `idle_timeout`, or `protocol_error` as appropriate;
- close transport;
- client reconnects and uses replay/snapshot recovery.

## Interaction with replay

Replay can create pressure because it sends many events quickly.

Replay implementation SHOULD:

- send bounded batches;
- yield between batches to avoid starving control messages;
- accept acks during replay;
- expose replay progress through `replay.started`, batch counts, and `replay.complete`;
- pause or coalesce transient live events while replaying;
- buffer live durable events until replay reaches its high-water mark.

If replay would exceed configured limits, the orchestrator SHOULD prefer snapshot recovery.

## Fairness across clients

One slow client MUST NOT degrade all clients unnecessarily.

The orchestrator SHOULD keep per-session flow state. Global producer throttling should be used only when the orchestrator itself is under resource pressure.

When global pressure exists, the orchestrator MAY send `flow.update` with reason `server_backpressure` to all affected sessions.

## Observability

Implementations SHOULD log flow transitions with:

- session ID;
- client ID/instance ID;
- stream;
- previous and new mode;
- reason;
- queue sizes;
- ack lag;
- transport buffered bytes;
- dropped/coalesced transient counts.

Logs MUST redact tokens and secrets. Event payloads should be summarized rather than fully logged unless safe.

## Backpressure examples

See [Examples](./examples.md) for degraded mode, dropped transient events, and resync-required flows.
