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

The conversation channel (`/ws/conversations`) routes durable `conversation.event` envelopes to `conv/<conversationId>`. One conversation socket can subscribe to several retained conversations. The workbench uses its own `/ws/workbench` connection with ephemeral invalidation notices, not a durable `workspace` stream.

A client skips exact duplicates, rejects gaps, applies each event, and advances that stream's cursor only after the reducer succeeds. A reducer invariant violation triggers snapshot recovery rather than cursor advancement.

## Notifications

Catalog events with `delivery: "ephemeral"` use `event.notify`:

```ts
type NotifyEvent = { id: string; type: string; ts: string; data: unknown };
```

Notifications are never persisted in stream logs, never replayed, and never consume sequence numbers. Catalog-approved `latest_by_scope` or `concat_delta` notifications may coalesce while queued. Concatenated deltas preserve their exact text and first offset; latest-value updates preserve the newest cumulative snapshot.

`conversation.live` carries text, thinking, tool-argument and progress deltas. Head, configuration, unfinished tool-call, input-queue and async-Bash changes also have ephemeral notices. Reconnect re-fetches current list/detail snapshots and replays durable history; transient frames are not recovered.

## Persistence and history

Conversation-core's `CONVERSATION_EVENT` is the durable source. Each conversation has its own append sequence, independent of the selected history branch. Tool settlement appends a response and deletes the unfinished call transactionally. There is no separate stream journal, run-event log or durable workbench notification store.

Snapshots carry `lastSequence`; clients subscribe from that boundary to avoid a snapshot/replay race. History transfer is bounded by count and bytes and uses transcript projections for tool responses. Full details are fetched with `toolCall.getDetails`. Retention metadata and replay control are protocol mechanics; do not infer a journal compaction policy from them.
