---
title: Tool output lifecycle
description: Trace core tool execution, ephemeral output, durable events, and bounded result projections.
sidebar:
  order: 7
---

Tool output crosses separate execution, storage, model and presentation boundaries. Live output is never the recovery source for process truth.

## Execution lifecycle

Conversation-core's `ToolCallService` creates unfinished calls from a persisted assistant message. Calls pass through `supervising`, optional `awaiting_approval`, `ready`, `running`, and optional `awaiting_input`. Draft arguments before persistence are memory-only.

The host permission port evaluates authority; core persists supervision and interactions. Execution uses a registered core handler or the host tool port. Settlement appends one `tool_call_response` event and deletes the unfinished row in the same transaction. Terminal outcomes are `completed`, `failed`, `denied`, `cancelled` or `indeterminate`; they are response outcomes, not retained active rows.

A running call has an execution claim. Recovery retries only tools declared safe to replay; uncertain effects settle as `indeterminate`. Suspended interactions survive restart. Independent calls progress separately, but the next model request waits for all unfinished calls in the turn to settle.

## Output boundaries

| Boundary              | Responsibility                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Process capture       | Preserve captured stdout/stderr in managed files, reporting capture truncation.                     |
| Live updates          | Send ephemeral text, argument, progress and output deltas; bounded delivery may merge or drop them. |
| Complete result       | Preserve recoverable payload bytes in owner-scoped assets when bounding requires them.              |
| Agent projection      | Apply the catalog's semantic result policy and byte/line/item strategy.                             |
| Transcript projection | Transfer at most six tool-appropriate lines/items; retrieve details on demand.                      |

The contracts define the durable facts and live delta shapes. `packages/tools/src/result-projection/` owns semantic candidates, profiles and strategies; conversation-core owns settlement, asset references and history transfer. The app renders these projections rather than maintaining another execution lifecycle.

## Final results and process logs

Every active catalog tool declares a semantic result policy. A fitting canonical candidate is unchanged. Overflow uses a strategy such as continuation-aware source heads, process diagnostics, whole-item listings or artifact indexes. Exact payload recovery is owner/digest verified; managed result files live beneath `data/conversations/<conversationId>/tool-calls/<toolCallId>/`.

Foreground Bash, promotion, async Bash notices, process log reads and launch exit notices share the `process_diagnostics` projection. Up to 84 lines and 12 KB stays inline without a file path. Larger output uses a 16-line, 4 KB summary with head, tail and diagnostic lines selected from the whole captured file, plus paths for `read`/`grep`. Capture truncation at 16 MiB is reported. These are candidate-payload budgets, not strict total response caps: status, truncation and path formatting can add text. They are not performance claims.

Async Bash captures `stdout.txt`, `stderr.txt` and interleaved `output.txt` as conversation-owned assets. Launch logs live under `data/launches/<launchId>/`. `async_bash logs` and `launch logs` use a 0-based `offset` and `limit` (default 100, maximum 500); omitted offset returns the last lines. Pages report ranges, status, a next offset when needed and a path when the page does not cover all output.

A promoted Bash call settles with its async run identity; later completion arrives as a queued `async_bash_event`, not another settlement of the original tool call. Sub-agent final responses have a separate notice cap, spilling the full text to the child's report file.

## Transcript presentation

Tool cards share one lifecycle presentation from streamed arguments through execution and settlement. Tool-specific argument regions, result placeholders, bounded previews, and on-demand details keep the requesting work and its outcome together. User-question cards retain their questions, options, and recorded answers after resolution.

Motion is budgeted per conversation rather than applied to every update: bursts of calls can fall back to plain rendering. List-like results such as `read`, `grep`, `find`, and `ls` animate their live arrival only when the motion budget permits; reduced-motion preferences suppress those effects. Animation is presentation only and never establishes completion or recovery state.

## Durable versus ephemeral delivery

`conversation.event` replays directly from SQLite event sequences on `/ws/conversations`. Tool-call state, queue changes and `conversation.live` are ephemeral notifications; snapshots restore current state after reconnect. The `/ws/workbench` channel carries launch and other workbench invalidations without durable replay. There is no separate run-event publisher or notification journal.

The transcript activity island presents navigation, sub-agents and background commands using current conversation state. It is a view of the runtime, not a durable execution or recovery store.

## Related pages

- [Tools and approval policy](/developers/tools-policy/)
- [Harness and conversation runtime](/developers/harness/)
- [Persistence and security boundaries](/developers/persistence-security/)
- [Protocol v1](/developers/protocol/v1/)
