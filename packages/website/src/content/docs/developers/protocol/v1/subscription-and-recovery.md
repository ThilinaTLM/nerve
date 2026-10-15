---
title: Subscriptions and recovery
description: Resume streams with exact subscriptions, cursors, replay, snapshots, and resynchronization.
sidebar:
  order: 6
---

A `StreamCursor` is `{ stream, processedSeq }`. It means every sequenced event through `processedSeq` has been successfully applied for that stream.

## Resume

Reconnect does not carry cursors in `hello`. After ready, the client sends its current exact cursor set through `stream.subscription.set`. The server resolves each cursor against `{ latestSeq, earliestAvailableSeq }`:

- equal to `latestSeq`: `live`;
- behind but still retained: `replay`;
- ahead of `latestSeq`, or older than `earliestAvailableSeq - 1`: `snapshot_required`;
- unknown to the server (for example a deleted conversation): `unavailable`.

For replay, the server reads from `processedSeq + 1` in bounded dense pages. Events arriving while that stream replays are buffered and released afterward. Streams recover independently.

An `unavailable` stream is excluded from activation without rejecting the rest of the set. The client drops its cursor and dependent state; a stale stream must never be able to silence live delivery for the remaining streams. Client subscription synchronization is self-healing: a sync that cannot run (session not ready) or fails stays dirty and is retried until the desired set is acknowledged.

## Defensive gaps

The client validates dense continuity even after the server accepted a subscription. If a batch starts after the expected next sequence, the client does not advance its cursor and automatically reinstalls subscriptions from the last applied cursor.

## Snapshots

For `snapshot_required`, load the authorized conversation snapshot, install its state and `lastSequence`, then resubscribe from that cursor. Reducer invariant violations use the same recovery boundary rather than advancing a cursor over corrupt state.

Current-state notices (`conversation.head`, `conversation.config`, `conversation.toolCall`, `conversation.queue`, `conversation.asyncBash`) and `conversation.live` are ephemeral. Reconnect re-fetches list/detail snapshots and starts with empty live state; durable `conversation.event` replay is separate. Selected-head history drives transcript rendering even though replay covers all branches.

## Workbench recovery

The independent `/ws/workbench` connection does not have durable streams or replay. Panels reload snapshots and restore monitor demand after reconnect. Conversation connections recover first so workbench panels can resolve project/conversation state.

## Storage boundary

Conversation replay reads core SQLite sequences, not legacy journals. Unknown or deleted conversations make only their stream unavailable. There is no runtime legacy journal reader or separate durable workspace notification store.
