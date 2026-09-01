---
title: Tool output lifecycle
description: Trace tool execution, live output, durable events, and bounded result projections.
sidebar:
  order: 7
---

Tool output crosses several boundaries with different responsibilities. A limit at one boundary must not be reused as a substitute for another, and live projections are never the recovery source for process truth.

## Execution lifecycle

`ToolExecutorService` updates the persisted tool-call record to `running`, emits the lifecycle update, and delegates execution to `OrchestrationToolDispatcher`. It validates producer artifact claims and prepares the complete result before recording `completed`. Execution errors become `failed`; an approval or interaction suspension leaves the current interaction state for the run to resume.

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
| Complete result          | Tool-result preparation            | Preserve exact JSON before storage bounding whenever projection needs payload recovery.              |
| Agent projection         | Adaptive result projector          | Select one semantic representation, then apply the catalog profile's byte/line/item strategy.        |
| Transcript projection    | Tool-call transcript projection    | Keep six tool-appropriate lines/items and load complete details only on demand.                      |

The shared live-output budgets are defined by the contracts package:

- one live event carries at most **8 KiB of UTF-8 output** before event metadata;
- the rolling projection retains at most **32,000 characters**;
- the rolling projection retains at most **400 chunks**.

These values come from [`conversation.schema.ts`](https://github.com/ThilinaTLM/nerve/blob/main/packages/contracts/src/domains/conversations/conversation.schema.ts). They are protocol and UI projection limits, not claims about the amount of output Nerve preserves in its source log or artifacts.

## Final-result contract

Every active catalog tool declares one semantic result policy. The projector first builds a canonical candidate, preserving status, continuation, media, and validated artifact facts. A fitting candidate is returned unchanged. Overflow then uses the profile strategy—for example continuation-aware source heads, compact process diagnostics, whole-item listings/searches, artifact indexes, or independent per-task Explore reports. Profile budgets are centralized in `packages/tools/src/result-projection/profiles.ts`; the conservative unknown-tool fallback remains 200 lines and 24,000 UTF-8 bytes.

Only the host artifact validator can issue an agent-readable descriptor. It accepts managed regular files, rejects symlink chains and unsafe roots, and never opens artifact content during projection. When no exact artifact or continuation exists, preparation writes the complete result before bounding at `data/conversations/<bare-conversation-id>/tool-calls/<bare-tool-call-id>/result.json`. The payload reference remains owner/digest verified and version 2.

Task output uses a per-task bundle with `events.jsonl`, distinct `stdout.txt` and `stderr.txt`, and an optional labeled `combined.txt`. Events carry stream byte ranges. Internally, task queries preserve separate `beforeSeq` and `sinceSeq` boundaries; the model-facing `task_logs` adapter exposes one mode-specific `cursor` without weakening exact backward or forward recovery.

The UI contract is independent: transcript events contain at most six lines/items with existing tool-specific head/tail semantics and omit validated artifacts and projection snapshots. Each call has its own model budget; Explore applies one budget per child report and no additional call-level ceiling.

## Durable and live publication

Run lifecycle events use `WorkbenchRunEventPublisher` and strictly awaited, idempotently sequenced publication. Progress notifications use `WorkbenchRunNotifyPublisher`; they are queued and intentionally lossy because a transient observer or transport failure must not change the durable run record.

`LiveToolOutputPublisher` similarly publishes transient conversation output through the best-effort event boundary while applying the same delta to the local runtime projection. It serializes updates per tool call and drains before a caller requires completion. A live publication failure is diagnosed at its explicit async boundary; it cannot orphan the supervised process or replace the durable output.

New streamed tools and provider integrations must use the canonical UTF-8 chunker and live-output publisher. Detached promises need an explicit diagnostic boundary, while genuine daemon programming errors remain subject to the fail-fast unhandled-rejection policy.

## Related pages

- [Tools and approval policy](/developers/tools-policy/)
- [Harness and agent loop](/developers/harness/)
- [Persistence and security boundaries](/developers/persistence-security/)
- [Protocol v1](/developers/protocol/v1/)
