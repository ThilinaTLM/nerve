# Event streams

## Sequenced events

An `event.batch` carries one stream and a dense ordered list of catalog-valid envelopes:

```ts
type EventBatch = {
  stream: string;
  batchId: string;
  reason: "replay" | "live" | "snapshot_delta";
  events: Array<{
    id: string;
    seq: number;
    type: string;
    ts: string;
    data: unknown;
  }>;
  firstSeq: number | null;
  lastSeq: number | null;
};
```

Every adjacent event satisfies `next.seq === previous.seq + 1`. Empty batches use null bounds. Only catalog events with `delivery: "sequenced"` may appear.

Implemented stream routing is deterministic:

| Stream                  | Owner and contents                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `workspace`             | Workbench workspace facts such as conversation lifecycle, settings, agents, projects, and plans    |
| `conv/<conversationId>` | Conversation, run, turn, live-message, and tool-call events carrying that conversation ID          |
| `manager`               | Sandbox-manager lifecycle and fleet facts                                                          |
| `sandbox:<id>`          | Sequenced events written by one authenticated sandbox daemon and stored without sequence rewriting |

One WebSocket can carry several subscribed streams. Opening a conversation or selecting a sandbox changes the exact subscription set; it does not open another socket.

A client skips exact duplicates, rejects gaps, applies each event, and advances that stream's cursor only after the reducer succeeds. A reducer invariant violation triggers snapshot recovery rather than cursor advancement.

## Notifications

Catalog events with `delivery: "ephemeral"` use `event.notify`:

```ts
type NotifyEvent = { id: string; type: string; ts: string; data: unknown };
```

Notifications are never persisted in stream logs, never replayed, and never consume sequence numbers. Catalog-approved `latest_by_scope` notifications may coalesce while queued. Examples include task output, usage updates, activity, and streaming progress whose authoritative state is available from a snapshot or query.

## Persistence and retention

Workbench logs are per stream and maintain dense local high-water metadata. Supersedable deltas use a 25 ms/64-event group-commit window; lifecycle events force an immediate flush and fsync. On restart, the next sequence is `max(meta.lastSeq, logTailSeq) + 1`.

Retention truncates whole prefixes, normally keeping the latest 5,000 events and at most 8 MiB per workbench stream. Truncation never renumbers retained events. A cursor below `earliestAvailableSeq - 1` therefore requires a repository-derived snapshot followed by a new subscription.

The manager stores dense `manager` and `sandbox:<id>` histories. A sandbox outbox assigns numbers only to sequenced events, reconciles the manager cursor through stream subscriptions, and prunes the confirmed prefix. Legacy sparse/global epochs are archived and reset instead of being translated through a compatibility layer.
