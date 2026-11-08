# Events and context

A conversation stores durable facts as events, then selects some of those facts as context for a model request. The selected history can branch, and compaction can summarize older context while preserving the original events. Separating stored meaning from provider formatting lets the same history work across model providers.

Part of [conversation core](README.md).

The event tree preserves both branches. Here the new branch ends at compaction `K`, the selected head:

```mermaid
flowchart TD
    A[Event A] --> B[Event B]
    B --> C[Event C: original branch]
    B --> D[Event D: new branch]
    D --> K[Compaction K: selected head]
```

## Canonical facts, projected context

Events describe application meaning independently of provider message packaging. Tool requests are blocks in an assistant event; [unfinished calls](tool-call-lifecycle.md) checkpoint their execution, and settlement appends responses. Complete results live in managed files, with separate [agent and user projections](../tool-result-projection.md), so large outputs need not travel through every history read.

Each event type declares whether and how it can appear in model context. Branch selection and compaction decide actual inclusion. Operational facts remain available for lifecycle reconstruction even when they contribute no model context. Application-generated notices become ordinary context rather than provider-system instructions, preserving the authority boundary.

Execution transitions are written directly as durable lifecycle facts; notices arrive through the [input queue](input-queue.md). An execution is a span of model turns identified by its start event, so later transitions and targeted inputs need no separate execution table. Child completion arrives as a queued notice; [delegation](delegation.md) explains how a parent associates it with assigned work.

## Projection to provider requests

Projection converts the selected path into model messages. The harness converts application notices and summaries, and the provider adapter builds the wire request. The current system prompt is supplied separately, so provider switching rebuilds a request without rewriting history.

Tool results follow the originating assistant's blocks in content order, even when responses persisted in completion order. Missing or mismatched responses produce synthetic interrupted results so the provider receives valid assistant/result pairs. Direct user-command results included in context become user content because they have no model-issued tool request to answer. Image files are resolved during request preparation to keep binary content out of event payloads.

## Compaction

Compaction appends a summary and a retained-history boundary. Original events stay available for browsing and branching, because it changes context selection, not stored history.

The next request holds the current system prompt, a summary of the events before the boundary, the retained events and anything appended since. The latest compaction on the selected path controls this. Planning keeps assistant tool calls and their responses together, moving the cut backward when completion order crosses it, so a retained response never loses its request.

## Branching

Each append links to the selected head, the event currently ending the active branch. Walking predecessor links defines the transcript; event sequence order defines replay across all branches. Selecting a head changes future context while leaving configuration and performed effects intact, because browsing old facts must not execute them again.

A branch can append a compaction to summarize context it leaves behind. Head selection requires a quiescent runner, no unfinished calls and no unfinished prompt-command preparation, so in-flight work cannot land on an unexpectedly changed branch. Parent and child histories branch independently; selecting a parent head does not rewind child effects.

## Forking

Forking runs a variant in parallel, which a single head cannot. It copies the active path up to a chosen event of an idle top-level conversation into a new idle conversation, leaving the source unchanged. IDs and file paths are remapped so the fork owns copies of its files and survives deletion of the source. Sub-agents are not copied: the parent's history already holds what the model saw from them. An appended `fork` system event tells the model which earlier sub-agent names no longer resolve to their old context.

Files are copied before the rows commit in one transaction; a crash in between leaves an orphan directory that startup removes.

## Where it lives

| Concern                                | Owner                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Event shapes and valid representations | [`conversationEventSchema`](../../../packages/contracts/src/domains/core/event.ts)                                     |
| Context selection and projection       | [`selectContextEvents`, `projectModelMessages`](../../../packages/conversation-core/src/context/context-projection.ts) |
| Harness message conversion             | [`convertToLlm`](../../../packages/harness/src/messages/messages.ts)                                                   |
| Compaction planning and settings       | [`prepareCompaction`, `runCompaction`](../../../packages/conversation-core/src/context/compaction.ts)                  |
| Append order and branch reads          | [`ConversationEventRepository`](../../../packages/conversation-core/src/storage/conversation-event.repository.ts)      |
| Head-selection safety                  | [`ConversationService.selectHead`](../../../packages/conversation-core/src/conversations/conversation.service.ts)      |
| Forking                                | [`ConversationForker`](../../../packages/conversation-core/src/conversations/conversation-fork.ts)                     |
| Execution transitions                  | [`StatusService`](../../../packages/conversation-core/src/runtime/status.ts)                                           |
