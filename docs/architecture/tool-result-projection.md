# Tool-result projection

> **Status:** Being reworked on `feat/conversation-core`. This document is the target design.

A tool can return anything from one line to megabytes of output or an image. Neither the model nor the UI should receive that raw. Every tool call therefore has three forms of its result, one per reader:

| Form                 | Reader                 | Purpose                                             |
| -------------------- | ---------------------- | --------------------------------------------------- |
| **Complete result**  | Details view, recovery | Exact data, never truncated.                        |
| **Agent projection** | The model              | Useful context without flooding the context window. |
| **User projection**  | The transcript         | A small, fast, real-time view of what the call did. |

The three forms have different limits and must not share one.

## Agent projection

The agent projection is what the model sees in every later request. Its purpose is to protect the context window: each oversized result costs context on every following turn, crowds out the conversation's instructions and history, brings compaction closer, and makes the agent noticeably less capable.

- A result that fits its tool's budget is returned unchanged.
- A larger result is reduced to the useful part (status, errors, the relevant lines, counts) and states that the complete result is saved, where it is, and how to read more with `read` or `grep`.
- Status, errors, exit codes and continuation hints are kept before bulk output.
- Each call has its own budget; parallel calls do not share one.

### When a result is reduced

Each tool has a profile with two budgets: an **inline** budget and an **overflow** budget. The projector first builds the tool's candidate text, then:

1. If the call failed, was denied, was cancelled or was interrupted, it uses the `terminal_outcome` profile (40 lines, 4 KB) to report the outcome.
2. Otherwise, if the candidate fits the inline budget, it is sent unchanged. Fitting means at most that many lines **and** bytes of text, and at most that many items where the profile counts items. Images do not count towards the budget.
3. Otherwise the tool's reduction strategy cuts it down to the overflow budget, for example the head of a file with a continuation offset, the first matches of a search, or the diagnostic lines of a failed command.

Explore is the exception: every requested report is checked separately against the `delegated_reports` budget, and a report that does not fit is replaced by a pointer to its file.

| Profile | Tools | Inline budget | Overflow budget |
| --- | --- | --- | --- |
| `source_text` | `read` | 202 lines, 24 KB (200 content lines) | same |
| `human_response` | `ask_user`, plan review | 202 lines, 24 KB (200 content lines) | same |
| `process_diagnostics` | `bash`, `python_exec` | 84 lines, 12 KB | 16 lines, 4 KB (8 items of up to 1 KB) |
| `search_matches` | `grep` | 80 lines, 16 KB | same |
| `file_listing` | `find`, `ls` | 120 lines, 12 KB, 120 items | same |
| `search_summaries` | `web_search`, Jira/Confluence search | 120 lines, 12 KB, 10 items | same |
| `network_prose` | `web_fetch` without a saved page | 120 lines, 16 KB | 12 lines, 3 KB |
| `primary_file_result` | `web_fetch` with a saved page, `kroki_export`, downloads | 80 lines, 8 KB | 12 lines, 3 KB |
| `resource_detail` | Jira issue/project/board, Confluence page | 160 lines, 16 KB | same |
| `mutation_acknowledgement` | `edit`, `write`, plan mode, Jira/Confluence changes | 40 lines, 4 KB | same |
| `lifecycle_state` | async bash, subagents, todos | 80 lines, 8 KB | same |
| `task_logs` | `task_logs` | 60 lines, 10 KB, 60 items of up to 512 bytes | same |
| `delegated_reports` | `explore` (per report) | 60 lines, 6 KB | 12 lines, 3 KB (512-byte items) |
| `vision_explanation` | `explain_image`, `generate_image` | 100 lines, 12 KB | same |
| `terminal_outcome` | any failed, denied, cancelled or interrupted call | 40 lines, 4 KB | same |
| `conservative_fallback` | unknown tools | 200 lines, 24 KB | same |

The numbers live in [`profiles.ts`](../../packages/tools/src/result-projection/profiles.ts) and the tool-to-profile mapping in [`policies/index.ts`](../../packages/tools/src/result-projection/policies/index.ts); update this table when they change.

## User projection

The user projection is what a transcript card shows. Its purpose is a fast UI: the transcript renders hundreds of calls, updates live, and pages through long histories, so each card's data must be small and ready to draw.

- Usually six lines or items of output, the first or the last six depending on the tool, plus counts of what was hidden (lines, characters, items) and the status. Web results show up to ten items. Each preview text is capped at 8 KB.
- Tools with a better summary use it, for example the diff of an `edit`.
- It is built once, when the call finishes. While a call runs, live output deltas show progress and are not stored.

## Complete result

The complete result is written once to the conversation's managed files (`data/conversations/<id>/tool-calls/<toolCallId>/result.json`, plus any files the tool produced) and tracked by `ASSET` rows. It is never copied into an event. The details view and the agent's own `read`/`grep` use it.

## Storage

A `tool_call_response` event stores the agent projection, the user projection, the call's metadata (tool, arguments, outcome, supervision) and the IDs of its assets. Binary content such as images is stored as an asset and referenced by ID from both projections, never inlined as base64.

## Transfer

| What                               | When                                 | Contains                                                          |
| ---------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| History pages, replay, live events | Always                               | Events with the user projection; the agent projection is left out |
| `toolCall.getDetails`              | When the user opens a card's details | Agent projection and complete result for one call                 |

Pages are limited by size as well as count, so one large conversation cannot exceed the channel's message limit. An oversized reply fails that request with a clear error; it never ends the session.

## Images

The model sees an image only when it asked for one: a `read` of an image file, or a tool such as `explain_image`. Nothing attaches images to a request implicitly. The image is stored once as an asset; when the core builds the model request it inlines that asset's bytes into the tool result the model asked for. Transcript cards show a thumbnail loaded from the asset.

## Ownership

- Projection contracts: [`tool-agent-projection.ts`](../../packages/contracts/src/domains/tools/tool-agent-projection.ts)
- Agent projection strategies: [`packages/tools/src/result-projection/`](../../packages/tools/src/result-projection/)
- Building both projections and writing the complete result: [`tool-result.service.ts`](../../packages/conversation-core/src/tool-calls/tool-result.service.ts) and [`asset-store.ts`](../../packages/conversation-core/src/assets/asset-store.ts)
- Building model requests from events: [events and context](conversation-core/events-and-context.md)
