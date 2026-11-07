# Progressive loading of large conversations

> **Status:** Follow-up to #539 and #541. Measured on dev slot 1 with `scripts/development/transcript-bench.ts`.

## Where we are

Opening the largest stored conversation (`conv_01M4CZZC4ZNWD98Y824N607GZJ`, 1,959 events, about 7.9 MB of history) now shows its first row in a median of 379 ms, down from 1.4 s. That meets the 500 ms target, but with little margin, and the time grows with conversation size.

Breakdown of the current open:

- **Network:** `getSnapshot` replies in about 64 ms. 17 sequential `conversation.getHistory` pages of about 512 KB each finish by about 670 ms. The first row appears before history completes.
- **Client:** about 350 ms of main-thread work before the first row: scripting about 165 ms, GC and JSON parsing about 155 ms, style and layout about 30 ms. One long task of about 140 ms falls before the first row.
- **Server:** paging is about 8 ms per page after #539. Of the rest, zod parsing in `mapEvent` is about 60 ms for all events, and `byteLimitedEvents` re-serializes each event to count bytes (`conversation-core/src/storage/conversation-event.repository.ts`).

## Problem

The client loads the whole selected path before the store is complete (`fetchCompleteHistory` in `features/conversations/state/conversation-history.ts`). Many consumers assume `store.events` is the full path: `liveTurns.recover`, the `append` dedupe, `conversationContext`, compaction path ids, run/execution derivation in the transcript adapter, and the history tree merge. So every open downloads and processes all history, even though the user sees only the last screen.

## Proposed design

1. Make `fetchCompleteHistory` an async generator that yields cumulative `{ events, hasOlder }`, newest page first.
2. Add a `historyComplete` flag to the store, with a single in-flight load guarded by head event id. A head change mid-load discards the load.
3. Make `publishHistory` merge by event id.
4. Make whole-path consumers wait for `historyComplete`, or work on the partial path when that is safe (rendering the tail is).
5. Keep scroll position when older rows are prepended to the virtual list (scroll anchoring in `virtual-scroller.svelte`).

**Cheaper alternatives to consider first:**

- One `getHistory` call that returns the whole selected path (removes round trips, keeps the full-path assumption).
- Fetch pages concurrently by sequence ranges instead of one after another.
- Skip zod parsing for rows the server itself wrote, and compute page byte sizes without re-serializing.

## Tests

- Generator: ordering, merge by id, and discarding a load when the head changes mid-load.
- Store: deltas arriving while older pages are still loading are neither lost nor duplicated.

## Targets

- First row under 250 ms for the 2,000-event conversation.
- Open time roughly independent of conversation length.
