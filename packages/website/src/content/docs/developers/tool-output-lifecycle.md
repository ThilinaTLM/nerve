---
title: Tool output lifecycle
description: Trace tool execution, live output, durable events, and bounded result projections.
sidebar:
  order: 7
---

Tool output crosses several boundaries with different responsibilities. A limit at one boundary must not be reused as a substitute for another, and live projections are never the recovery source for process truth.

## Execution lifecycle

`ToolExecutorService` updates the persisted tool-call record to `running`, emits the lifecycle update, and delegates execution to `OrchestrationToolDispatcher`. It prepares the result with the tool-result bounds before recording `completed`. Execution errors become `failed`; an approval or interaction suspension leaves the current interaction state for the run to resume.

Run-owned tool calls send lifecycle updates to the run execution sink so the run coordinator commits and publishes the durable event. Tool calls outside a run publish their lifecycle update directly. Policy denials happen before this execution path and remain distinct from execution failures.

The contract status vocabulary is `committed`, `waiting`, `running`, `completed`, `denied`, `failed`, and `cancelled`. The exact record and event schemas live in [`records.schema.ts`](https://github.com/ThilinaTLM/nerve/blob/main/packages/contracts/src/domains/tools/records.schema.ts).

## Output projections

The source process result remains complete in its durable log or artifact. The live conversation view, stored tool result, model context, and transcript preview are separate bounded projections:

| Boundary                 | Owner                              | Responsibility                                                                                       |
| ------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Process bytes            | `@nervekit/tools` process adapters | Decode UTF-8 incrementally and preserve full output in the task/result store.                        |
| Live framing             | `splitLiveOutputChunks`            | Split output into UTF-8-safe events before publication.                                              |
| Task output              | `TaskService`                      | Append durable output first, then publish bounded live updates and observers.                        |
| Conversation live output | `LiveToolOutputPublisher`          | Serialize each tool call's output queue, publish offsets, and update the rolling runtime projection. |
| Complete result          | Tool-result preparation            | Keep unchanged inline when it fits; otherwise write complete JSON under `NERVE_HOME/payloads`.       |
| Agent projection         | Model result bounds                | Keep 200 logical lines or 24,000 UTF-8 bytes and emit one exact payload-path notice when truncated.  |
| Transcript projection    | Tool-call transcript projection    | Keep six tool-appropriate lines/items and load complete details only on demand.                      |

The shared live-output budgets are defined by the contracts package:

- one live event carries at most **8 KiB of UTF-8 output** before event metadata;
- the rolling projection retains at most **32,000 characters**;
- the rolling projection retains at most **400 chunks**.

These values come from [`conversation.schema.ts`](https://github.com/ThilinaTLM/nerve/blob/main/packages/contracts/src/domains/conversations/conversation.schema.ts). They are protocol and UI projection limits, not claims about the amount of output Nerve preserves in its source log or artifacts.

## Final-result contract

Agent output is bounded line-first at 200 logical lines and then at 24,000 UTF-8 bytes. There is no separate model per-line character cap. The final text, including the notice, remains within both budgets and preserves valid UTF-8. Output that fits is returned unchanged and creates no payload. Truncated output ends with exactly:

```text
Output truncated. Full output: /resolved/path/to/full-output
```

The resolved path is added only to the runtime model result; canonical storage keeps a validated owner/digest descriptor rather than an absolute path. The complete result is written before bounding under `payloads/conversations/<conversationId>/tool-calls/<toolCallId>.json`.

The UI contract is independent: transcript events contain at most six lines/items with existing tool-specific head/tail semantics. Opening details requests the complete canonical result from inline storage or the verified payload. Each call has its own limits even when calls execute sequentially, in parallel, or as a batch; there is no batch-level output budget.

## Durable and live publication

Run lifecycle events use `WorkbenchRunEventPublisher` and strictly awaited, idempotently sequenced publication. Progress notifications use `WorkbenchRunNotifyPublisher`; they are queued and intentionally lossy because a transient observer or transport failure must not change the durable run record.

`LiveToolOutputPublisher` similarly publishes transient conversation output through the best-effort event boundary while applying the same delta to the local runtime projection. It serializes updates per tool call and drains before a caller requires completion. A live publication failure is diagnosed at its explicit async boundary; it cannot orphan the supervised process or replace the durable output.

New streamed tools and provider integrations must use the canonical UTF-8 chunker and live-output publisher. Detached promises need an explicit diagnostic boundary, while genuine daemon programming errors remain subject to the fail-fast unhandled-rejection policy.

## Related pages

- [Tools and approval policy](/developers/tools-policy/)
- [Harness and agent loop](/developers/harness/)
- [Persistence and security boundaries](/developers/persistence-security/)
- [Protocol v1](/developers/protocol/v1/)
