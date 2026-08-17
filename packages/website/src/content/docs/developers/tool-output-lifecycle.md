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

| Boundary                     | Owner                              | Responsibility                                                                                       |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Process bytes                | `@nervekit/tools` process adapters | Decode UTF-8 incrementally and preserve full output in the task/result store.                        |
| Live framing                 | `splitLiveOutputChunks`            | Split output into UTF-8-safe events before publication.                                              |
| Task output                  | `TaskService`                      | Append durable output first, then publish bounded live updates and observers.                        |
| Conversation live output     | `LiveToolOutputPublisher`          | Serialize each tool call's output queue, publish offsets, and update the rolling runtime projection. |
| Final result                 | Tool-result preparation            | Keep an inline head/tail preview and write a full-output artifact when required.                     |
| Model/transcript projections | Tool-result and transcript bounds  | Apply purpose-specific byte, line, and preview limits rather than reusing live limits.               |

The shared live-output budgets are defined by the contracts package:

- one live event carries at most **8 KiB of UTF-8 output** before event metadata;
- the rolling projection retains at most **32,000 characters**;
- the rolling projection retains at most **400 chunks**.

These values come from [`conversation.schema.ts`](https://github.com/ThilinaTLM/nerve/blob/main/packages/contracts/src/domains/conversations/conversation.schema.ts). They are protocol and UI projection limits, not claims about the amount of output Nerve preserves in its source log or artifacts.

## Durable and live publication

Run lifecycle events use `WorkbenchRunEventPublisher` and strictly awaited, idempotently sequenced publication. Progress notifications use `WorkbenchRunNotifyPublisher`; they are queued and intentionally lossy because a transient observer or transport failure must not change the durable run record.

`LiveToolOutputPublisher` similarly publishes transient conversation output through the best-effort event boundary while applying the same delta to the local runtime projection. It serializes updates per tool call and drains before a caller requires completion. A live publication failure is diagnosed at its explicit async boundary; it cannot orphan the supervised process or replace the durable output.

New streamed tools and provider integrations must use the canonical UTF-8 chunker and live-output publisher. Detached promises need an explicit diagnostic boundary, while genuine daemon programming errors remain subject to the fail-fast unhandled-rejection policy.

## Related pages

- [Tools and approval policy](/developers/tools-policy/)
- [Harness and agent loop](/developers/harness/)
- [Persistence and security boundaries](/developers/persistence-security/)
- [Protocol v1](/developers/protocol/v1/)
