# Transcript performance: follow-up work

> **Status:** Proposal. Follow-up to #544, which replaced the earlier progressive-history and streaming-reactivity proposals. Measured on dev slot 1 (production build) with `scripts/development/transcript-bench.ts`.

## Where we are

After #544, opening the largest conversation (1,959 events) shows the first row in a median 231 ms (target 250 ms) from 5 history requests totaling 5.1 MB. The scripted streaming run has no long tasks, 14–17 frame gaps above 50 ms and a max gap of 76–98 ms.

Compare with the scripted model: its runs are nearly identical, while real-model runs vary a lot. Start the dev instance with `NERVE_DEV_SCRIPTED_PROVIDER=1 NERVE_VALIDATE_TRUSTED_RESULTS=0 pnpm desktop:dev --slot 1`, then run `transcript-bench.ts --scenario stream --project Random --scripted`. Add `--trace` for a Chrome trace with frame-gap timestamps.

#544 deliberately left out progressive history loading (opening already meets the target) and removal of virtual-core's `followOnAppend` (it scrolls in the append frame, while the scroller's settle loop handles later row growth; they complement each other).

## Proposed work

### 1. Stop republishing unchanged summaries in core

`publishSummary` (`conversation-core/src/runtime/publish-summary.ts`) runs on every `tool_call_changed` and publishes the conversation and all its ancestors. In a measured run, 69% of the `conversation.changed` notices were identical to the previous one. Today only `conversation-channel.ts` filters them, per protocol session, and each session keeps a serialized copy of every summary it sends.

Move the check to core: remember the last published summary per conversation and emit only when it differs. Every consumer benefits, including completion dependencies and runtime services. The per-session cache can then be removed. Test it in conversation-core; the protocol session fixture is too heavy.

### 2. Batch incoming notices

The remaining frame gaps are bursts of 5–10 short WebSocket message tasks, each followed by its own Svelte flush (`conversation-connection.ts` → store `notice`/`append`). Apply messages that arrive within one task or microtask as a single batch, so that Svelte flushes once.

Canonical state (approvals, queue, status, cursors) must not wait for an animation frame, so batch per microtask, not per frame.

### 3. The long task before the first row

One long task of about 130 ms still runs before the first row when opening the large conversation. Likely parts: JSON parsing of 1–1.4 MB pages, the first `committedTranscript` pass, and timeline projection. Profile it, then split it (for example, project the visible tail first) or defer parts.

### 4. More accurate page sizing

`byteLimitedRows` (`conversation-event.repository.ts`) sizes pages from the stored payload length, which still includes signatures and `agentProjection` that the client never receives. Pages are underfilled: 5 instead of 3–4 for the large conversation. Options:

- subtract the known stripped fields cheaply, for example with `json_extract` lengths in SQL;
- raise `EVENT_PAGE_BYTES` (2.5 MB; the protocol cap is 4 MB), accepting a worst case near the cap for payloads with nothing to strip.

### 5. Open time still grows with length

Opening is O(conversation). If conversations grow well past about 2,000 events, take up progressive loading:

- yield the newest page first;
- add a `historyComplete` flag;
- have whole-path consumers (`liveTurns.recover`, the `append` dedupe, compaction path ids, run derivation, tree merge) wait for it;
- keep the scroll position when older rows are prepended.

## Smaller items

- **Run id fallback:** with no execution event yet, committed tool records fall back to `runId ?? snapshot.conversation.id` (`core-transcript.adapter.ts`) instead of the first live turn id. Check that tool grouping in the first run is still correct.
- **Picker label:** the model picker shows the scripted model's group as the raw provider id `nerve-dev-scripted`. Add a display name next to `"nerve-faux": "Nerve Faux"` in `presentation/utils/model.ts`.

## Targets

- Scripted stream: max frame gap under 60 ms over three runs, with no long tasks.
- Open: first row under 200 ms for the 2,000-event conversation, with no long task above 100 ms before it.
