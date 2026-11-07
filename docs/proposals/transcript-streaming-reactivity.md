# Transcript streaming: reactivity and layout costs

> **Status:** Follow-up to the transcript performance work in #539 and #541. Measured on dev slot 1 with `scripts/development/transcript-bench.ts`.

## Where we are

Streaming is much better than before, but the target of no long task above 50 ms is not met yet.

| Metric (Claude Haiku 5.5, about 50 s, 16–18 tool calls) | Before #539                         | After #541                |
| ------------------------------------------------------- | ----------------------------------- | ------------------------- |
| Long tasks > 50 ms                                      | 65 in 70 s, 4.2 s total, max 125 ms | 2–7 per run, max 62–79 ms |
| Frame gaps > 50 ms                                      | 136, max 230 ms                     | 23–65, max 138–176 ms     |
| Layouts per second                                      | not measured                        | about 140                 |

Single runs on a real model vary a lot, so compare several runs before drawing conclusions.

## Remaining costs

From a 52 s CPU profile (production bundle):

1. **Svelte reactivity on live updates.** `mark_reactions` takes 3.9 s self time, and `flush` 11.5 s inclusive. Callers are the store's live-delta writes in `features/conversations/state/core-conversation-store.svelte.ts` (`applyLive` about 1.25 s, `applyNotice`, `flushPending` about 0.5 s; see also `frame-coalescer.ts`). Each streamed token marks many reactions.
2. **Virtual-list layout reads.**
   - `getMaxScrollOffset` in `@tanstack/virtual-core`: 966 ms, from the library's `reconcileScroll` and `scrollToEnd` → `getOffsetForIndex`. Our own at-end checks are already cached per frame (`virtual-list/scroll-metrics.ts`); these calls are inside the library.
   - `getClientRects`: 616 ms, from virtual-list measurement code. This is now probably the main forced-layout source.
3. **Timeline arrays rebuilt every update.** `conversationTranscript` keeps row and `toolCall` objects stable, but still returns new `entries` and `toolCalls` arrays, so the committed timeline projection rebuilds on every update.

## Proposed work

1. **Coalesce live updates.** Apply streamed deltas to the store at most once per frame, and write only the block that changed instead of replacing larger structures. Check how much `frame-coalescer.ts` already does and why `mark_reactions` stays high.
2. **Stable timeline arrays.** Return the previous `entries` / `toolCalls` arrays when nothing in them changed, or split committed rows (stable) from the live tail (changing), so only the tail re-renders while streaming.
3. **Virtual-list layout.**
   - Find the `getClientRects` caller and batch it with the scroller's other reads.
   - Decide how to handle the reads inside virtual-core: a `pnpm patch` that caches `getMaxScrollOffset` per frame, an upstream fix, or replacing `scrollToEnd`/`reconcileScroll` for follow mode with our own code.
   - Check whether our `followOutput` handling and virtual-core's `followOnAppend` (set from `followOutput` in `virtual-scroller.svelte`) both follow on the same append.
4. **Deterministic benchmark.** The streaming scenario needs a real model today. A scripted provider that a running dev daemon can use (registered in-process today by `registerAgentScriptedProvider`) would make runs cheap and repeatable, and allow comparing several runs.

## Targets

- No long task above 50 ms in steady-state streaming, over at least three benchmark runs.
- Frame gaps above 50 ms reduced by half from the #541 numbers.
