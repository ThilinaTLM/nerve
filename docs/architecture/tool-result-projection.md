# Tool-result projection

> **Status:** Being reworked on `feat/conversation-core`. This document is the target design.

A tool can return anything from one line to megabytes of output or an image. Neither the model nor the UI should receive that raw. Every tool call therefore has three forms of its result, one per reader:

| Form | Reader | Purpose |
| --- | --- | --- |
| **Complete result** | Details view, recovery | Exact data, never truncated. |
| **Agent projection** | The model | Useful context without flooding the context window. |
| **User projection** | The transcript | A small, fast, real-time view of what the call did. |

The three forms have different limits and must not share one.

## Agent projection

The agent projection is what the model sees in every later request. Its purpose is to protect the context window: each oversized result costs context on every following turn, crowds out the conversation's instructions and history, brings compaction closer, and makes the agent noticeably less capable.

- A result that fits its tool's budget is returned unchanged.
- A larger result is reduced to the useful part (status, errors, the relevant lines, counts) and states that the complete result is saved, where it is, and how to read more with `read` or `grep`.
- Status, errors, exit codes and continuation hints are kept before bulk output.
- Each call has its own budget; parallel calls do not share one.

Budgets and per-tool strategies are owned by [`packages/tools/src/result-projection/`](../../packages/tools/src/result-projection/) and the tool catalog; this document does not copy them.

## User projection

The user projection is what a transcript card shows. Its purpose is a fast UI: the transcript renders hundreds of calls, updates live, and pages through long histories, so each card's data must be small and ready to draw.

- Usually six lines of output, the first or the last six depending on the tool, plus counts such as lines or entries and the status.
- Tools with a better summary use it, for example the diff of an `edit`.
- It is built once, when the call finishes. While a call runs, live output deltas show progress and are not stored.

## Complete result

The complete result is written once to the conversation's managed files (`data/conversations/<id>/tool-calls/<toolCallId>/result.json`, plus any files the tool produced) and tracked by `ASSET` rows. It is never copied into an event. The details view and the agent's own `read`/`grep` use it.

## Storage

A `tool_call_response` event stores the agent projection, the user projection, the call's metadata (tool, arguments, outcome, supervision) and the IDs of its assets. Binary content such as images is stored as an asset and referenced by ID from both projections, never inlined as base64.

## Transfer

| What | When | Contains |
| --- | --- | --- |
| History pages, replay, live events | Always | Events with the user projection; the agent projection is left out |
| `toolCall.getDetails` | When the user opens a card's details | Agent projection and complete result for one call |

Pages are limited by size as well as count, so one large conversation cannot exceed the channel's message limit. An oversized reply fails that request with a clear error; it never ends the session.

## Images

The model sees an image only when it asked for one: a `read` of an image file, or a tool such as `explain_image`. Nothing attaches images to a request implicitly. The image is stored once as an asset; when the core builds the model request it inlines that asset's bytes into the tool result the model asked for. Transcript cards show a thumbnail loaded from the asset.

## Ownership

- Projection contracts: [`tool-agent-projection.ts`](../../packages/contracts/src/domains/tools/tool-agent-projection.ts)
- Agent projection strategies: [`packages/tools/src/result-projection/`](../../packages/tools/src/result-projection/)
- Building both projections and writing the complete result: [`tool-result.service.ts`](../../packages/conversation-core/src/tool-calls/tool-result.service.ts) and [`asset-store.ts`](../../packages/conversation-core/src/assets/asset-store.ts)
- Building model requests from events: [events and context](conversation-core/events-and-context.md)
