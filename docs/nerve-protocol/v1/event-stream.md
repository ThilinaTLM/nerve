# Event Stream

The event stream profile carries ordered domain events from the orchestrator to clients. It is optimized for live UI synchronization, reconnect/replay, and high-frequency transient updates.

Version 1 uses the existing Nerve event model as the domain event payload and wraps one or more events in protocol `event.batch` messages.

## Existing domain event envelope

Nerve domain events use this shape:

```ts
type EventEnvelope<TData = unknown> = {
  seq: number;
  id: string;
  ts: string;
  type: string;
  durability: "durable" | "transient";
  data: TData;
};
```

Requirements:

- `seq` MUST be a non-negative safe integer.
- `id` MUST be a stable event identifier and SHOULD use the `evt_` prefix.
- `ts` MUST be an ISO 8601 UTC timestamp.
- `type` MUST be a non-empty domain event name such as `conversation.entry.appended`.
- `durability` MUST be `durable` or `transient`.
- `data` MUST conform to the domain schema for `type`.

## Streams

A stream is an ordered sequence of events. Version 1 defines one REQUIRED stream:

```text
global
```

Unless a capability explicitly defines scoped streams, `seq` always refers to the `global` stream.

Future stream identifiers SHOULD use these formats:

```text
conversation:<conversationId>
task:<taskId>
agent:<agentId>
project:<projectId>
```

If future scoped streams use per-stream sequence numbers, every message involving those streams MUST include the stream identifier to avoid ambiguity.

## Durable and transient events

### Durable events

Durable events represent application state changes that can be replayed.

Requirements:

- Durable events MUST be persisted or otherwise reconstructable before being acknowledged as published by the orchestrator.
- Durable events in a stream MUST have strictly increasing `seq` values.
- Durable events MUST be replayable by cursor while they are within the stream's retention/replay window.
- Clients MUST apply durable events in ascending `seq` order per stream.
- Clients MUST deduplicate durable events by `(stream, seq)`.

Examples:

- `conversation.entry.appended`
- `run.started`
- `run.completed`
- `task.created`
- `approval.requested`
- `settings.updated`

### Transient events

Transient events represent best-effort live updates that are not required to reconstruct durable state.

Requirements:

- Transient events MAY be dropped under backpressure.
- Transient events MAY be coalesced when a capability or domain rule defines how.
- Transient events SHOULD still receive `seq` values if they share the global event bus, but clients MUST NOT require every transient `seq` to be replayable.
- Transient events MUST NOT be the only record of durable application state.

Examples:

- live token/content deltas;
- progress ticks;
- high-frequency tool output chunks;
- subscription usage polling updates;
- UI hints.

### Mixed durability streams

The existing global stream may contain both durable and transient events in the same numeric `seq` space. This creates an important distinction:

- A gap in durable events is fatal for state correctness.
- A missing transient event may be acceptable.
- A numeric jump in `seq` is not, by itself, proof of a durable gap when the skipped events are transient or otherwise not required for state reconstruction.

To make this safe, batches include durable continuity metadata. Clients use that metadata to validate durable ordering without assuming every numeric sequence is replayable.

### Durable continuity

Durable continuity is the proof that a client has all durable events needed to reconstruct state up to a cursor, even when transient events in the same numeric sequence space were omitted.

For v1, the authoritative durable recovery cursor is still a global `seq` value, but it advances only when durable state is known to be complete through that sequence. A client MUST NOT advance its processed cursor merely because it received a transient event.

The orchestrator MUST provide enough continuity metadata for every batch that contains durable events, and for replay batches that omit transient events, so the client can decide whether the first non-duplicate durable event follows the client's processed cursor.

## `event.batch`

Direction: orchestrator → client.

Purpose: deliver one or more events for one stream.

```ts
type EventBatchData = {
  stream: string;
  batchId: string;
  reason: "live" | "replay" | "snapshot_delta" | "catchup";
  events: EventEnvelope[];
  range: {
    firstSeq: number | null;
    lastSeq: number | null;
    durableFirstSeq?: number | null;
    durableLastSeq?: number | null;
    durableCount: number;
    transientCount: number;
    previousDurableSeq?: number | null;
    durableCompleteThroughSeq?: number;
    skippedNonDurableRanges?: Array<{
      fromSeq: number;
      toSeq: number;
      reason:
        | "transient_unavailable"
        | "transient_dropped"
        | "coalesced"
        | "not_required";
    }>;
  };
  replay?: {
    replayId: string;
    fromSeq: number;
    toSeq?: number;
    complete?: boolean;
  };
  compression?: {
    algorithm: "none";
  };
};
```

`batchId` SHOULD use a message-like unique ID or the protocol message `id` MAY be reused if the implementation does not need a separate batch identifier.

### Empty batches

`events` SHOULD NOT be empty for ordinary live delivery. An empty batch MAY be sent for replay boundary signaling only if paired with `replay` metadata, but `replay.started` and `replay.complete` are preferred.

If `events` is empty:

- `range.firstSeq` MUST be `null`.
- `range.lastSeq` MUST be `null`.
- `range.durableCount` MUST be `0`.
- `range.transientCount` MUST be `0`.

### Batch ordering

For a single stream, the orchestrator MUST send batches in ascending event order.

Within a batch:

- events MUST be sorted by `seq` ascending;
- duplicate `seq` values MUST NOT appear;
- `range.firstSeq` and `range.lastSeq` MUST match the first and last event `seq` values when events are present;
- `range.durableCount` MUST equal the number of durable events in the batch;
- `range.transientCount` MUST equal the number of transient events in the batch;
- if the batch contains durable events, `range.previousDurableSeq` MUST identify the durable event immediately before `range.durableFirstSeq` or `0` if none exists;
- if present, `range.durableCompleteThroughSeq` MUST be greater than or equal to `range.durableLastSeq` when durable events are present and MUST NOT claim continuity past an unknown durable gap.

### Durable range and continuity metadata

`durableFirstSeq` and `durableLastSeq` describe the durable events inside the batch.

- If the batch contains durable events, both fields MUST be present and non-null.
- If the batch contains no durable events, both fields SHOULD be `null` or omitted.
- `durableCount` MUST always be present.

`previousDurableSeq` is the durable event sequence that immediately precedes `durableFirstSeq` in the stream. If the first durable event in the stream is in this batch, `previousDurableSeq` MUST be `0`. If the sender cannot prove the previous durable sequence for a batch that contains durable events, it MUST send `replay.unavailable` or `flow.update` with `mode: "resync_required"` instead of sending an ambiguous durable batch.

`durableCompleteThroughSeq` is the highest sequence through which the sender asserts durable state is complete after applying this batch and all prior accepted batches for the stream. When a batch contains durable events, it SHOULD be equal to `durableLastSeq`. For transient-only batches it MAY advance over transient-only ranges if the sender can prove no omitted durable events exist in that range.

`skippedNonDurableRanges` is optional diagnostic metadata describing numeric `seq` ranges intentionally omitted from this batch because they are not required for durable state. It MUST NOT be used to hide missing durable events.

Clients use durable range and continuity metadata to detect gaps in state-changing events while allowing missing transient events.

### Computing continuity in the current global stream

The current Nerve global stream assigns `seq` values to both durable and transient events. A protocol adapter that builds `event.batch` messages MUST compute durable continuity from durable events, not from raw numeric adjacency.

For a batch containing durable events, the orchestrator must know the durable event immediately before `durableFirstSeq`. It can derive this from one of these sources:

- the in-memory event ring, when it contains the relevant preceding durable event;
- the persisted durable event index/log;
- a snapshot cursor that proves durable state is complete through a sequence;
- domain-specific knowledge that no durable event exists before the first durable event in the stream.

If the adapter cannot prove `previousDurableSeq` for a durable batch, it MUST NOT send the batch as ordinary live/replay data. It must instead replay from a known cursor, require a snapshot, or send `replay.unavailable` / `flow.update` with `mode: "resync_required"`.

For transient-only batches, the adapter MAY omit durable continuity fields or set `durableCompleteThroughSeq` only when it can prove no durable event was skipped in the advertised range. A client MUST NOT advance its processed durable cursor solely because it received a transient-only batch.

## Client dispatch rules

A client receiving `event.batch` MUST follow these rules for each stream.

### 1. Validate envelope and payload

The client validates:

- protocol envelope;
- `event.batch` payload shape;
- stream name;
- batch range and durable continuity metadata;
- event envelope fields;
- event sorting and duplicate `seq` within the batch.

If validation fails, the client SHOULD send `error` with code `INVALID_MESSAGE` and MAY close or request resync depending on severity.

### 2. Ignore duplicate durable events

If a durable event has `seq <= processedSeq` for the stream, the client MUST NOT apply it again.

The client MAY still inspect the duplicate for diagnostics, but application state reducers MUST be idempotent with respect to duplicate durable events.

### 3. Detect durable gaps

A client detects durable gaps using continuity metadata, not raw numeric adjacency.

For each stream, let `processedSeq` be the client's durable recovery cursor. For the first non-duplicate durable event in a batch:

- if `range.previousDurableSeq` is present, it MUST be less than or equal to `processedSeq` for the client to apply that durable event;
- if `range.previousDurableSeq` is greater than `processedSeq`, the client is missing at least one durable event and MUST treat this as a gap;
- if `range.previousDurableSeq` is missing for a batch that contains durable events, the client MUST treat the batch as ambiguous and request replay or resynchronization;
- duplicate durable events with `seq <= processedSeq` remain safe to ignore.

A client MUST NOT infer a durable gap solely because `durableFirstSeq > processedSeq + 1`. The skipped numeric sequences may be transient events that are not required for recovery.

On a durable gap or ambiguous continuity, the client MUST stop applying later durable events for that stream and request replay from `processedSeq`, or load a snapshot if instructed.

The orchestrator SHOULD avoid ambiguous gaps by replaying all available events, including transient events still in memory, during short reconnects. If transient events are not replayable, the orchestrator MUST include continuity metadata proving that durable continuity is still valid, or require snapshot/resync recovery.

### 4. Apply in order

The client MUST apply durable events in ascending `seq` order.

For transient events:

- If a transient event belongs to an active live operation and arrives in order, the client SHOULD apply it.
- If it arrives after the durable state that supersedes it, the client MAY ignore it.
- If applying it would conflict with current durable state, the client MUST ignore it.

### 5. Advance processed cursor

The client advances its processed cursor only after successfully applying all durable events up to that cursor, or after applying a snapshot/replay batch whose continuity metadata proves durable state is complete through that cursor.

The processed cursor MUST NOT advance past a durable event that failed validation or failed application. It also MUST NOT advance solely because a transient event was received.

### 6. Acknowledge

The client sends `ack` according to [Replay and Acknowledgements](./replay-and-ack.md).

## Event type naming

Domain event `type` names SHOULD use lowercase dot-separated names:

```text
<domain>.<entity_or_action>[.<detail>]
```

Examples:

```text
conversation.entry.appended
run.started
conversation.live.content.delta
task.output
approval.requested
auth.providers_changed
settings.updated
```

Guidelines:

- Use nouns for entities and past-tense verbs for completed durable changes.
- Use `.started`, `.updated`, `.completed`, `.failed`, `.cancelled` consistently.
- Use `.live.*` for transient streaming details.
- Avoid transport names in event types.
- Avoid UI component names in event types.

Current Nerve event names that contain underscores, such as `userQuestion.*`, `planReview.*`, and `prompt_suggestions.*`, are valid existing domain event names. They do not need to be renamed for Protocol v1. New event families SHOULD prefer the dot-separated style above.

## Current Nerve event families

The following current event families are in scope for Protocol v1. This table is a coverage guide; exact payload schemas remain owned by their domains.

| Event family                                                                                                                                      | Typical durability                                              | Purpose and recovery notes                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `daemon.*`                                                                                                                                        | durable                                                         | Daemon lifecycle/status diagnostics.                                                                                                                               |
| `project.*`                                                                                                                                       | durable                                                         | Project creation, deletion, and project-level maintenance such as conversation pruning.                                                                            |
| `conversation.created`, `conversation.updated`, `conversation.deleted`, `conversation.imported`                                                   | durable                                                         | Workspace conversation list updates.                                                                                                                               |
| `conversation.entry.appended`                                                                                                                     | durable                                                         | Transcript entry state; reducers should be idempotent by entry ID.                                                                                                 |
| `conversation.run.*`                                                                                                                              | durable for lifecycle; transient only for non-required progress | Run start/completion/failure/suspension must be recoverable. Retry/progress details may be transient if final durable state reconstructs the view.                 |
| `conversation.prompt.*`                                                                                                                           | durable                                                         | Queued prompt state.                                                                                                                                               |
| `toolCall.updated`                                                                                                                                | durable                                                         | Tool call transcript and approval-related updates.                                                                                                                 |
| `conversation.compaction.*`, `conversation.compacted`, `conversation.context.updated`, `conversation.navigated`, `conversation.branch_summarized` | durable or transient by domain semantics                        | Conversation refresh/context/compaction state. Final materialized changes must be durable or snapshot-backed.                                                      |
| `conversation.live.*`                                                                                                                             | transient                                                       | Streaming assistant content, thinking, tool drafts, tool output, and live progress. May be coalesced/dropped when durable final entries or snapshots repair state. |
| `agent.*`                                                                                                                                         | durable, except explicit progress-style events may be transient | Agent lifecycle, configuration, mode/status, subagent/explore progress.                                                                                            |
| `agent.suspension.*`                                                                                                                              | durable                                                         | Suspended/awaiting-user state.                                                                                                                                     |
| `worker.*`                                                                                                                                        | durable                                                         | Worker inventory/lifecycle.                                                                                                                                        |
| `task.*`                                                                                                                                          | durable for lifecycle; transient only for non-required progress | Task list, foreground state, logs, readiness, cancellation, orphan cleanup.                                                                                        |
| `approval.*`                                                                                                                                      | durable                                                         | Pending and resolved approval state.                                                                                                                               |
| `userQuestion.*`                                                                                                                                  | durable                                                         | Human question request/answer/dismiss state.                                                                                                                       |
| `planReview.*`                                                                                                                                    | durable                                                         | Plan review lifecycle and decisions.                                                                                                                               |
| `settings.*`                                                                                                                                      | durable                                                         | Settings refresh; payloads must not include secrets.                                                                                                               |
| `auth.*`                                                                                                                                          | durable metadata only                                           | Auth/provider metadata refresh and OAuth flow status; no provider tokens.                                                                                          |
| `secrets.*`                                                                                                                                       | durable metadata only                                           | Secret state changed; payloads must identify provider/key metadata only, never secret values.                                                                      |
| `providers.*`                                                                                                                                     | durable                                                         | Provider/model catalog refresh.                                                                                                                                    |
| `prompt_suggestions.*`                                                                                                                            | durable                                                         | Prompt suggestion trust/status refresh.                                                                                                                            |
| `usage.subscription.updated`                                                                                                                      | transient                                                       | Subscription usage display; polling can repair missed updates.                                                                                                     |
| `policy.*`                                                                                                                                        | durable or diagnostic by domain                                 | Policy/approval diagnostics; payloads must be redacted and bounded.                                                                                                |

### Event registration checklist

When adding or changing a domain event, document and test:

- event `type` string;
- durability (`durable` or `transient`);
- payload schema owner in `packages/contracts`;
- required entity IDs for reducers and correlation;
- reducer idempotency behavior for duplicate durable events;
- whether the event affects workspace, conversation, task, settings/auth, or notification materialized state;
- snapshot relationship for recovery;
- coalescing/drop policy if transient;
- safe logging/redaction behavior;
- expected producer and consumer modules.

## Event payload rules

Domain event payloads MUST be transport-neutral and schema-owned by shared domain packages.

Payloads SHOULD:

- include stable entity IDs;
- include enough data for reducers to update local state incrementally;
- avoid secrets and raw credentials;
- avoid huge embedded blobs;
- include references to files/artifacts where possible;
- distinguish durable records from presentation hints.

Payloads SHOULD NOT:

- require access to orchestrator-only secrets;
- contain transport-specific fields such as WebSocket IDs;
- assume a particular frontend framework;
- include unbounded logs without pagination or truncation metadata.

## Batching strategy

The orchestrator SHOULD batch events to balance latency and throughput.

Recommended default live batching targets:

| Parameter                             | Default |
| ------------------------------------- | ------: |
| Maximum batch delay under light load  |   16 ms |
| Maximum batch delay under heavy load  |   50 ms |
| Target max encoded batch size         |   1 MiB |
| Hard max encoded batch size           |   4 MiB |
| Target max durable events per batch   |     500 |
| Target max transient events per batch |   2,000 |

The orchestrator SHOULD flush a batch immediately when:

- it contains a user-visible durable event that should render promptly;
- it reaches size or event-count limits;
- a replay boundary requires ordering clarity;
- the session is about to close gracefully.

The orchestrator MAY use shorter batch windows for foreground conversations and longer windows for background task logs.

## Coalescing transient events

Transient events MAY be coalesced only when the domain defines safe semantics.

Examples of safe coalescing:

- multiple progress ticks → latest progress tick;
- repeated subscription usage updates → latest usage value;
- task output chunks → combined chunk preserving text order;
- live content deltas → combined adjacent text delta for the same message/content index.

Coalescing MUST preserve any ordering required by the domain. If coalescing cannot preserve user-visible correctness, transient events SHOULD be dropped only after sending `flow.update` indicating degraded mode or requiring resync.

## Replay batches

When an `event.batch` is part of replay:

- `reason` MUST be `replay` or `catchup`.
- `replay.replayId` MUST be present.
- `replay.fromSeq` MUST be the cursor requested by the client or selected by the orchestrator.
- Batches MUST be sent in ascending sequence order.
- The replay operation MUST end with `replay.complete` or `replay.unavailable`.

Live events that occur during replay can be handled in one of two ways:

1. **Buffered live mode**
   - Orchestrator buffers live events for the session until replay completes.
   - After replay, buffered live events are sent in order.
   - This is simplest for the client.

2. **Marked catchup mode**
   - Orchestrator sends replay batches and live catchup batches with explicit metadata.
   - Client must not apply out-of-order durable events.
   - This mode requires careful range validation.

Version 1 RECOMMENDS buffered live mode for the WebSocket implementation.

## Gap handling

If the client detects a gap or ambiguous sequence condition, it SHOULD:

1. Stop applying further durable events for that stream.
2. Continue reading control messages if safe.
3. Send `replay.request` from its last processed cursor.
4. Enter a local `catching_up` or `replaying` state.
5. If replay succeeds, resume normal processing.
6. If replay is unavailable, load a snapshot or reload the workspace.

The client MAY continue applying transient events that are known not to affect durable state, but UI implementations SHOULD prefer consistency over live visual effects during gap recovery.

## Idempotency

Reducers and event handlers SHOULD be idempotent for durable events. At minimum, they MUST ignore duplicates where `seq <= processedSeq`.

Domain handlers SHOULD also use entity-level IDs to make repeated events safe. For example:

- appending a conversation entry should be safe if the entry ID already exists;
- updating a task should replace by task ID;
- resolving an approval should replace by approval ID/status.

## Event retention and replay window

The protocol does not mandate a fixed retention size. The orchestrator MUST advertise enough replay state for the client to decide whether resume is possible:

- latest stream sequence;
- earliest replayable durable sequence when known;
- whether snapshot recovery is required.

If the client asks for replay older than available retention, the orchestrator MUST send `replay.unavailable` or `flow.update` with mode `resync_required`.

## Relationship to snapshots

Events are deltas. Snapshots are compact representations of current state.

The protocol supports snapshot-assisted recovery but does not define every domain snapshot shape in this document.

Recommended model:

1. Client loads a snapshot through HTTP or a protocol `request`.
2. Snapshot response includes `cursor.streams`, the durable stream cursors at which the snapshot is valid.
3. Client applies the snapshot and sets its processed cursor for each affected stream to the snapshot cursor.
4. Client requests or receives event batches with `seq` greater than the relevant snapshot cursor.
5. Client acknowledges after applying deltas.

Snapshots SHOULD be used when:

- replay would be too large;
- replay history is unavailable;
- the client is initializing a complex workspace;
- domain state can be loaded more efficiently as a materialized view.

## Event stream examples

See [Examples](./examples.md) for live batch, replay batch, transient coalescing, and gap recovery examples.
