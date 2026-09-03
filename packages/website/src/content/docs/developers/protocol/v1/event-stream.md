---
title: Event streams
description: Understand sequenced stream batches, ephemeral notifications, routing, and cursor ownership.
sidebar:
  order: 5
---

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

| Stream                  | Owner and contents                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `workspace`             | Workbench workspace facts such as conversation lifecycle, settings, agents, projects, and plans |
| `conv/<conversationId>` | Conversation, run, turn, live-message, and tool-call events carrying that conversation ID       |

One WebSocket can carry several subscribed streams. Opening a conversation changes the exact subscription set; it does not open another socket.

A client skips exact duplicates, rejects gaps, applies each event, and advances that stream's cursor only after the reducer succeeds. A reducer invariant violation triggers snapshot recovery rather than cursor advancement.

## Notifications

Catalog events with `delivery: "ephemeral"` use `event.notify`:

```ts
type NotifyEvent = { id: string; type: string; ts: string; data: unknown };
```

Notifications are never persisted in stream logs, never replayed, and never consume sequence numbers. Catalog-approved `latest_by_scope` or `concat_delta` notifications may coalesce while queued. Concatenated deltas preserve their exact text and first offset; latest-value updates preserve the newest cumulative snapshot.

All `conversation.live.*` updates are notifications. They project in-progress turns, messages, tool drafts, progress, and bounded output from the server's active-run state. Reconnect recovery fetches the authoritative conversation snapshot instead of replaying presentation frames. Completed entries, run transitions, tool-call lifecycle records, supervision decisions, checkpoints, and final results remain sequenced durable facts.

## Persistence and retention

Workbench logs are per stream and maintain dense local high-water metadata. The current host defaults group supersedable deltas for up to 25 ms or 64 events; lifecycle events force an immediate flush and fsync. On restart, the next sequence is `max(meta.lastSeq, logTailSeq) + 1`.

These are host storage defaults, not wire guarantees. The owning [`StreamLog` implementation](https://github.com/ThilinaTLM/nerve/blob/main/packages/workbench-server/src/infrastructure/events/stream-log.ts) appends group commits until a journal reaches its current high-water mark (normally 6,250 events or 10 MiB), then atomically compacts it back to the latest 5,000 events and at most 8 MiB. Truncation never renumbers retained events. A cursor below `earliestAvailableSeq - 1` therefore requires a repository-derived snapshot followed by a new subscription.
