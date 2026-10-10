# Events and context

Part of the [conversation core redesign](README.md).

## Event types

The five event types describe application facts, independent of how providers package messages. No transcript `role` column is needed: message event types identify transcript roles; tool and system events identify their own semantics. Tool requests are not events: their arguments live in the assistant message content and, while unfinished, in [`TOOL_CALL`](tool-call-lifecycle.md).

| Event                | Canonical contribution                                                   | Payload                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_message`       | `user`                                                                   | Delivered prompt, original submitted text, submitter and command-preparation receipts.                                                                                                                         |
| `assistant_message`  | `assistant`                                                              | Ordered text, thinking and tool-call blocks with arguments, usage, stop reason and response provenance.                                                                                                        |
| `system_event`       | `none` or `user`                                                         | Typed notice or execution transition. Application provenance grants no provider-system authority.                                                                                                              |
| `tool_call_response` | `tool_result` for model calls; `user` or `none` for direct user commands | Internal and provider call IDs, tool name, final `arguments`, origin, originating assistant event and content index, outcome, agent projection, user projection, supervision record, interaction resolution and asset references. The complete result is an asset, not part of the event; see [tool-result projection](../tool-result-projection.md). |
| `compaction`         | `user`                                                                   | Summary text and retained-history boundary.                                                                                                                                                                    |

`llm_representation` states how an event can contribute, not whether it appears in a given request; the selected branch and compaction decide inclusion. Because it restates what `event_type` and payload imply, validation rejects contradictory combinations.

## Projection to Pi

The configured system prompt is supplied separately. The context projection produces Pi-compatible messages, and Pi's provider adapter builds the wire request. Provider switching rebuilds messages without rewriting history.

- Tool-call blocks in an assistant message become Pi `toolCall` content; a tool call never creates another assistant message.
- Tool responses become Pi `toolResult` messages built from their agent projection, ordered by originating content index, not completion order. Every tool-call block is followed by exactly one result. Image blocks reference assets; their bytes are inlined only while building the request.
- Direct user commands included in context are projected as user content, not as orphan tool results.
- Neither Anthropic's user-role result packaging nor OpenAI's tool-role packaging is persisted as application meaning.

Pi AI 0.99.1 maps these as follows:

| Provider API            | Tool request               | Tool response                |
| ----------------------- | -------------------------- | ---------------------------- |
| Anthropic Messages      | Assistant `tool_use` block | User `tool_result` block     |
| Google Gemini           | Model `functionCall` part  | User `functionResponse` part |
| OpenAI Chat Completions | Assistant `tool_calls`     | Tool-role message            |
| OpenAI Responses        | `function_call` item       | `function_call_output` item  |

## System events

Closed payload subtypes:

```text
async_bash_event | sub_conversation_event | user_intervention | notification | execution_state
```

The first four arrive through the [input queue](input-queue.md). `execution_state` is a lifecycle fact written directly, never queued. It covers provider failure before any tool exists, retries, waiting and completion of text-only processing:

```text
started | waiting | retrying | completed | failed | cancelled | interrupted
```

- Retry metadata can indicate exhaustion.
- Waiting details identify the tool call awaiting approval or input, or the child assignment being awaited.
- An execution is identified by its `started` event ID; later transitions reference it. Queue execution targets reference the same ID. This supports executions spanning several turns without an execution table or an execution-ID column on every event.

Child results:

- A waiting delegation tool such as Explore receives its children's reports in its `tool_call_response`.
- An asynchronous assignment notifies its parent with a queued `sub_conversation_event` identifying the exact assignment, not only the child's current state.
- There is no `explore_report` event and no separate obligation tracking.

## Compaction

Compaction appends an event; earlier history is never mutated or deleted. The payload holds the summary, `firstKeptEventId` for retained context, `tokensBefore` and optional details.

Context assembly on the selected branch uses the latest applicable compaction:

1. Current configured system prompt.
2. Compaction summary as a user message.
3. Retained context from `firstKeptEventId` up to the compaction.
4. Context-bearing events after the compaction.

Retained boundaries must keep assistant tool-call blocks with their results; no orphan responses.

```text
History:      A → B → C → D → Compaction → E → F
Summarized:   A and B
First kept:   C
LLM context:  current system prompt → summary → C → D → E → F
```

## Event tree and branching

Every event joins the tree through `previous_event_id`, including operational events. Each append links to `head_event_id` and becomes the new head. Transcript history walks that path; `llm_representation = none` omits operational facts from model context. Sequence replay includes all branches.

- Selecting a branch changes `head_event_id`, not configuration.
- A branch that needs a summary of the history it leaves appends a compaction on the new branch. There is no branch-summary event type.
- Execution facts stay in append order and are never replayed as actions because an older context was selected.
- Branch changes require a quiescent runner, no unfinished tool calls and no unfinished input command preparation.
- Parent and child histories branch independently; coordinated rewind is a non-goal.
