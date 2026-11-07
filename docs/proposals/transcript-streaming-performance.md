# Transcript performance while streaming and opening large conversations

> **Status:** Bug report with measurements. Found while testing the conversation history work on dev slot 1 (desktop dev build, Electron 45, production-minified workbench bundle).

## Symptoms

- **Jank while an agent runs tool calls.** Scrolling and typing stutter slightly during long runs.
- **Slow first paint for large conversations.** Opening the largest stored conversation (`conv_01M4CZZC4ZNWD98Y824N607GZJ`, 1,959 events, 50 user messages) takes about **1.4 s** from click to the first transcript row.

## Measurements

**Without the profiler.** A 70 s Claude Haiku 5.5 run in a new conversation: build a small Python CLI with tests, 19 tool calls, then a 45 s follow-up with 13 tool calls. Measured with a `longtask` PerformanceObserver and a `requestAnimationFrame` gap counter:

| Metric               | Value                         |
| -------------------- | ----------------------------- |
| Long tasks (> 50 ms) | 65 in 70 s                    |
| Time in long tasks   | 4.2 s (about 6% of wall time) |
| p90 / max long task  | 85 ms / 125 ms                |
| Frame gaps > 50 ms   | 136, max 230 ms               |

**With the profiler.** A 35 s Chrome trace of a similar run (devtools timeline, V8 CPU profiler; the tracing overhead inflates absolute numbers, but the proportions are useful):

| Self time         | Function (minified)                               | What it is                            |
| ----------------- | ------------------------------------------------- | ------------------------------------- |
| 1,576 ms          | `getMaxScrollOffset` (`@tanstack/virtual-core`)   | forced layout via `scrollHeight`      |
| about 5.6 s total | Svelte runtime chunk                              | signal/derived/effect bookkeeping     |
| 1,432 ms incl.    | tool presenter `present(parse(args))`             | tool card presentation                |
| 778 ms self       | `JSON.parse` wrapper used by the tool-args reader | re-parsing `argsText` / `argsPreview` |

Blink also reported 2.9 s of `ForcedStyleAndLayout` and 2.9 s of `ResizeObserver` notifications.

The new History view and message rail are not significant. The rail's scroll tracking cost about 60 ms over the whole trace, and History is not mounted while the transcript is shown.

## Findings

### 1. Tool cards rebuild their presentation on unrelated updates

The hottest application code is the tool-card presentation chain (all under `packages/workbench-app/src/lib/`):

- the tool card component derives `present(toolName, argsReader(toolCall), phase, cwd)`;
- the args reader builds records from `args`, `argsText` and `argsPreview`, which calls `JSON.parse` on each string every time it is constructed;
- the edit/write presenters then walk `edits` (`objectArraySources("edits")`, `stringMetrics("newText"/"oldText")`) to count lines.

These deriveds depend on `node.toolCall` through getters like `get toolCall() { return t.node.toolCall }`. If the transcript adapter rebuilds row and `toolCall` objects on every snapshot or delta, **every** tool card on screen re-derives and re-parses its arguments on every streamed token. The cost then grows with the number of visible cards, not with the one card that changed.

**To confirm.** Count presenter calls per delta with a temporary counter in a dev build, or check object identity across updates in `core-transcript.adapter`.

**Fix direction:**

- Keep `toolCall` and row object identity stable when nothing in them changed, so Svelte deriveds short-circuit.
- Memoize the parsed argument records by `(toolCallId, argsText length/version)` instead of parsing in the reader constructor.
- Only drafting (streaming-args) cards need per-delta recomputation.

### 2. Follow-to-bottom forces layout several times per frame

`getMaxScrollOffset()` reads `scrollHeight - clientHeight`. During streaming it is called from several places each frame, and each call can force a synchronous layout after DOM changes:

- `scrollToEnd → scrollToIndex → getOffsetForIndex`, from the follow-output effect in `packages/ui-kit/src/lib/components/composites/virtual-list/virtual-scroller.svelte`;
- `isAtEnd`, from the `atEnd` update in `scrollToFn` and the raw scroll listener;
- `reconcileScroll → getOffsetForIndex`, inside the virtualizer;
- `setOptions → isAtEnd`.

**Fix direction:**

- Read the scroll metrics once per frame and share them; for example, cache `maxScrollOffset` per frame in the scroller and invalidate it on `ResizeObserver` and scroll events.
- Avoid calling `isAtEnd` in `scrollToFn` for programmatic follow scrolls, where the result is known to be `true`.
- Make sure the follow loop does not run both `scrollToEnd` and `reconcileScroll` in the same frame.

### 3. Global derived state recomputes during streaming

Smaller but visible in the profile:

- the composer Tools/Skills popover models (tool override lists, provenance) recompute while the popovers are closed;
- the conversation list maps every summary (`{ ...row, pinned, activeAgentId, ... }`) on each list change, and running conversations change their summaries often.

**Fix direction:** derive popover models lazily (only while open), and keep list row objects stable for unchanged summaries.

### 4. Large-conversation open time

1.4 s to the first row for 1,959 events has not been broken down yet. **Next step:** trace one cold open and split the time between:

- the server (`conversation.getSnapshot` / transcript fetch, SQLite reads, projection);
- transfer and JSON decode;
- client adapter work (tree build, row model);
- first render.

## Plan

1. Add a repeatable benchmark: a seeded long conversation plus a scripted streaming run (the screenshot and demo tooling can seed data), recording long-task time and frame gaps.
2. Fix 1 (stable identity and memoized args) and re-measure.
3. Fix 2 (per-frame scroll metrics) in ui-kit and re-measure. This affects every virtual list, so check logs and panel trees too.
4. Profile and address 4 separately.

**Target:** no long task above 50 ms in steady-state streaming on the benchmark, and under 500 ms to first row for the 2,000-event conversation.
