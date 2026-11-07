# Conversation fork

> **Status:** Proposal. Split out of the conversation history and rewind work.

## Problem

Rewinding a conversation moves its head to an earlier entry and continues on a new branch, in the same conversation. The old branch is kept and can be selected again, so rewind already covers "keep a copy before an experiment". What it cannot do is run two variants at the same time, because a conversation has one head and one run.

## Proposal

Add **Fork from here** next to **Rewind to here** on top-level conversations. It creates a new, idle, top-level conversation whose history is the active path from the root to the chosen entry. The source conversation is not changed.

The fork copies the lead agent's conversation only. Sub-agents are disconnected, not copied. The parent already holds everything the model saw from them: the `subagent_prompt` calls, their results and the reports delivered as input events.

### Database rows

- **Events: one branch.** Copy only the events on the path from the root to the fork point. Side branches stay in the source. The fork starts with a single straight branch.
- **Conversation row.** New ID, same project, `parent_conversation_id` and `parent_tool_call_id` null, `working_directory` copied, title as described below. Reset the run state: `status` idle, `paused` 0, `next_input_sequence` 1, `status_cleared_at` null. `pinned_at` and `completed_at` are null. `last_user_message_at` is taken from the last copied user message. `created_at` and `updated_at` are the fork time.
- **Asset rows** linked to copied events, with new IDs and `logical_path` rewritten from `conversations/{sourceId}/` to `conversations/{forkId}/`. Keep `tool_call_id`, because it is not a foreign key and the asset ownership check expects it in the path. Clear `async_bash_id`, because `async_bash` rows are not copied; the asset stays alive through its event link.
- **Conversation references** (`conversation_reference`) whose `source_event_id` is on the path.
- **Not copied:** `tool_call`, `input_queue` and `async_bash` rows, pending approvals and questions, and the sub-agent conversations. `assertQuiescent` already guarantees there are no `tool_call` rows on the source.

### Files

Per-conversation configuration is not in SQL anymore: schema v2 dropped `conversation_config`, and only `working_directory` is a column. The scoped configuration service reads documents under `$NERVE_HOME/data/conversations/{id}/`. The fork copies, from `conversations/{sourceId}/` into `conversations/{forkId}/` with the same relative path:

- `config/agent.json`: model, reasoning level, permission rule set, applied profile and instructions. Copied byte for byte, including `revision`. The revision is only a compare-and-swap counter for that file, and the applied profile's `sourceDigest` stays valid, so nothing needs resetting. It is the configuration in effect when the fork is made, since the source is idle. The file is required: conversation creation always writes it (with empty `overrides` when nothing is overridden), and the configuration store treats a missing conversation document as `missing-required`, so the fork fails rather than creating a conversation without configuration.
- `config/permissions.json` and `capabilities.json`, when present: conversation-level permission and capability overlays.
- The file of every copied asset row (under `tool-calls/{toolCallId}/`, or legacy `async-bash/{id}/` for imported history).
- `tool-calls/{toolCallId}/files/` for every tool call whose response is on the path. These are unregistered artifact files that tool output may name by path.
- `reports/` when present (reports imported from older storage live in the parent's directory).

Shared data outside the conversation directory, such as `$NERVE_HOME/data/images/` and `$NERVE_HOME/data/plans/`, is referenced as it is and not copied.

**Sub-agent reports.** A long sub-agent report is cut inline in the parent and spilled to the child's directory, `conversations/{childId}/reports/{executionId}.md`, with that absolute path in the inline text (`delegation/child-report.ts`). Children are not copied, so these files would dangle once the source is deleted. Copy each referenced report into the fork's `reports/{executionId}.md` and rewrite `conversations/{childId}/reports/` to `conversations/{forkId}/reports/` in the copied text. This keeps the fork self-contained.

### Identity remapping

New IDs for the conversation, every copied event and every copied asset. Build an old → new map for events and assets, then rewrite:

- columns: event `previous_event_id`, `sequence` (renumbered from 1), conversation `head_event_id`, asset `event_id`, reference `source_event_id`;
- `input_id` is set to null, because it has a global unique index and identifies the source's input queue entry;
- payload JSON: walk each copied payload and replace string values that exactly match an old event or asset ID. IDs are prefixed random strings, so exact matches are safe. This covers `assetId`/`assetIds`, `assistantEventId` (the projection pairs tool responses with `${assistantEventId}:${index}`, so this one is required), compaction `firstKeptEventId` and any future field without listing them;
- conversation file paths inside payload strings: replace `conversations/{sourceId}/` with `conversations/{forkId}/`, and the copied child report paths as above, so paths the model saw point at the fork's own copies.

Not remapped: tool call IDs, provider call IDs and turn IDs. They only need to be unique within a conversation, and keeping them means the tool-call directory names stay the same.

Sub-agent conversation IDs (`subagent_prompt` result `assignments[].agentId`, `execution_state` `waiting.childConversationId`) are left untouched. They keep pointing at the source's children. Nothing in the fork may treat them as its own children: child lookup goes through the conversation's children (`snapshot.children`, matched by title), and the fork has none.

### Fork notice

Nerve has no mid-conversation system-role message: the model receives only `user`, `assistant` and `toolResult` messages, and the system prompt is a separate field. A new role would mean changing every provider adapter. The existing `system_event` already does the job:

```ts
{
  type: "system_event",
  llmRepresentation: "user",
  payload: {
    subtype: "notification",
    producer: "system:fork",
    text: "Forked from «title». Sub-agents from before this point (explore-auth, fix-tests) are not available in this conversation. Using one of those names starts a new agent without its earlier context.",
  },
}
```

It is appended after the copied path and becomes the fork's head. It reaches the model as a `<harness_event>` user message with the standard harness line (see [Harness event wording](#harness-event-wording)). "Not a user request" is what we want: it stops the model from treating the notice as a task. A fork-specific wrapper would need a new subtype or a producer special case in the harness for no behavioral gain, so the generic wrapper is kept (`context-projection.ts`, `harness/src/messages/messages.ts`), and the transcript shows it as a plain message row, which doubles as the visible provenance. No contract, schema, migration or projection change is needed. The producer must not start with `agent-profile:`, because the transcript hides those notifications.

The notice matters because `subagent_prompt` resolves names against the conversation's current children: in the fork, a previously used name silently starts a fresh agent. The listed names are the source's children whose `parent_tool_call_id` is a `subagent_prompt` call on the copied path. Agents created after the fork point are not mentioned. Without such children, the sub-agent sentences are left out.

In the transcript, `subagent_prompt` cards in the fork find no child conversation (`core-context.adapter.ts`, `subagent-task.ts`). They keep the historical status recorded in the tool call (created, queued, rejected) and have no Open link, as for any card without a matching child. The fork can start new sub-agents as usual.

### Harness event wording

`harnessMessageToText` (`packages/harness/src/messages/messages.ts`) prefixes every harness event, for all subtypes and across the whole application, with:

```
This is an asynchronous harness event, not a user request.
```

"Asynchronous" fits background task updates and sub-agent reports, but not profile notifications or the fork notice. Change both occurrences to:

```
This is a harness event, not a user request.
```

Keep "harness" rather than "system": these blocks often carry untrusted text (sub-agent reports, command output), and calling them system events would lend that text system-level authority, which helps prompt injection. Keep "request" rather than "message": the block does arrive as a user-role message, and the point of the line is that it is information, not an instruction from the user.

The existing test in `harness/test/agent/loop/turn-loop.test.ts` matches `not a user request` and keeps passing. Existing conversations that contain harness events get a different history projection, so each misses the prompt cache once on its next request.

### Atomicity

Files cannot be in the database transaction. Copy files first into the fork's conversation directory, then insert every row in one transaction. If anything fails, roll back and delete `conversations/{forkId}/`. A crash between the two steps leaves a directory with no conversation row. The existing `cleanupOrphans` only looks at asset rows of existing conversations and will not remove it, so add a startup sweep that deletes `conversations/*` directories that have no conversation.

Deleting the source later does not affect the fork, because every conversation-scoped file the fork uses is its own copy.

## Constraints

- **Only when not running.** Same rule as rewind: reuse `assertQuiescent` on the source, and disable the action in the UI while it runs. Sub-agents are not copied, so their state does not matter.
- **Top-level only.** Sub-agent transcripts are read-only for history actions.
- **Same working directory.** The fork keeps the source's working directory. No worktree creation or directory choice at fork time; the user can change the directory afterwards like for any conversation.
- **Title.** The source title with a fork-number prefix: `Title` → `F1: Title`. The prefix stays visible when the sidebar truncates long titles. Strip an existing leading `F<n>: ` first and take the next free number among the project's conversations with that base, so forking `Title` again or forking `F1: Title` gives `F2: Title`.
- **No schema change.** The copy uses existing tables and files. Provenance is the title and the fork notice. A `forked_from_conversation_id` column is only worth adding if lineage queries become necessary, which would need separate approval.
- **Cold prompt cache.** The harness passes the conversation ID as the provider `sessionId`, so the fork's first request does not reuse the source's cache. Acceptable.

## Scope

- Storage: one method that inserts the conversation, events, assets and references in a transaction, given the ID maps.
- Service: fork orchestration (quiescence check, file copy, payload rewrite, storage call, notice, cleanup on failure), plus the startup sweep.
- Configuration: copy the conversation's configuration documents through the configuration layer, so its caches see the new conversation.
- RPC/contract: a `fork` call returning the new conversation.
- Harness: the one-line wording change above.
- UI: **Fork from here** action (disabled while running).
