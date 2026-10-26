# Conversation core redesign

Status: **implemented**. Code and owning contracts are authoritative.

## Goal

Make the conversation the single, portable core of Nerve, with a small storage model and its own client channel. IDE features (files, git, GitHub, scratch notes, launch configurations, logs) become a separate workbench layer that depends on the core, never the reverse.

The legacy storage had 62 SQLite tables (about 30 populated), 26 document namespaces and a 15 GB development database dominated by duplicated snapshots and derived history. Lifecycle, journal, obligation and projection machinery accumulated incrementally. The implementation now uses 10 tables in `data/nerve.sqlite`, scoped JSON configuration and two channels.

## Documents

| Document                                              | Covers                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Data model](data-model.md)                           | ER diagram for all tables, deletion, indexes                                                    |
| [Events and context](events-and-context.md)           | Event types, Pi projection, compaction, branching                                               |
| [Tool-call lifecycle](tool-call-lifecycle.md)         | State machine, parallel calls, recovery, cancellation, approval grants                          |
| [Delegation](delegation.md)                           | Sub-agents, profiles, completion notices, child configuration, instructions, layered compaction |
| [Input queue](input-queue.md)                         | Merged queue, command preparation, identities, idempotency                                      |
| [Async bash and launches](async-bash-and-launches.md) | Agent background commands, launches and process output                                          |
| [Channels](channels.md)                               | Conversation channel versus workbench channel, replay, client state                             |
| [Migration](migration.md)                             | Legacy database analysis, importer and production prerequisites                                 |

## Principles

- **The conversation is the agent.** An agent is runtime behavior of a conversation, not a stored entity. Child agents are child conversations with the same structure.
- **History is append-only and branchable; configuration is current-only.** Rewinding history never restores old settings.
- **Tables hold current state or unfinished work; events hold facts.** Unfinished tool calls and undelivered inputs live in tables and become events when they finish.
- **Live progress is not persisted.** Streaming deltas, argument drafting and workbench changes are in-memory.
- **Permissions are rule sets plus overlay files.** No permission levels, workspace scopes, ceilings or grant tables.
- **Layering:** workbench → conversation core → foundation. Lower layers never depend on higher ones.
- **Add later, not now.** Budgets, depth limits, orchestration policies and similar controls wait for a concrete need.

## Glossary

| Term               | Meaning                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation       | Persistent entity with configuration, branchable history, queue and unfinished tool calls                                                   |
| Child conversation | Conversation with a parent; created by `subagent_prompt`                                                                                    |
| Sub-agent          | A child conversation configured from a profile; see [delegation](delegation.md)                                                             |
| Profile            | Complete catalog definition with recommendations/requirements, captured as an applied snapshot; children also freeze underlying preferences |
| Instructions       | Persona and working rules rendered as their own section of a conversation's system prompt                                                   |
| Turn               | One model invocation plus the processing of the tool calls it issued                                                                        |
| Execution          | A span of turns started by an input or assignment, bounded by `execution_state` events                                                      |
| Event              | Append-only durable fact in a conversation's history                                                                                        |
| Async bash         | A conversation-owned background command from a background or promoted `bash` call                                                           |
| Launch             | A run of a user-defined launch definition, started from the UI or the `launch` tool                                                         |

## Decisions

| Area               | Decision                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects           | Conversations belong to a project (`project_id` required).                                                                                                                                                                                                                                                                   |
| Conversation state | `pinned_at`, `completed_at`, `last_user_message_at`, `status_cleared_at`, `created_at`, `updated_at`.                                                                                                                                                                                                                        |
| Last user message  | Updated only by delivered `user_message` events, human or parent submitted. Never by compaction, tool results or notices.                                                                                                                                                                                                    |
| Status dismissal   | `status_cleared_at` keeps a dismissed failed or interrupted badge hidden across status rebuilds.                                                                                                                                                                                                                             |
| Child policy       | None stored. Deliberately stopping a parent stops its children. Rules every child obeys (allowed rule sets, no user prompts, no nested delegation or human-in-the-loop tools) are enforced by the host and core; see [delegation](delegation.md). No budgets, depth or concurrency limits, grants or orchestration policies. |
| Configuration      | Scoped JSON `agent.json` owns model, reasoning, prompt context, permission selection, applied profile, tools, skills and compaction. SQLite `conversation` owns working directory; host services capture effective settings and provenance.                                                                                  |
| Permissions        | Baseline rule set plus overlays at user, project (`.nerve/`) and conversation (conversation data directory) level.                                                                                                                                                                                                           |
| Approval grants    | "Always allow" writes a rule into the matching overlay file. No table.                                                                                                                                                                                                                                                       |
| Event types        | `user_message`, `assistant_message`, `system_event`, `tool_call_response`, `compaction`. No tool-request, branch-summary or delegation-report events.                                                                                                                                                                        |
| Tool calls         | Unfinished calls live in `TOOL_CALL`; settling appends one response event and deletes the row.                                                                                                                                                                                                                               |
| Input queue        | One queue for user prompts, parent prompts and system notices.                                                                                                                                                                                                                                                               |
| Stop and pause     | Stop cancels the current execution, sets `paused`, and cascades to child conversations and their async bash. A new user prompt clears pause; parent and system inputs never do. `continue` restarts processing without a new prompt.                                                                                         |
| Force push         | Stop the current turn without pausing, then drain the queue. No stored force-push state.                                                                                                                                                                                                                                     |
| Branch summary     | Not an event type; a new branch may append a compaction.                                                                                                                                                                                                                                                                     |
| Idempotency        | Retries are safe through caller-supplied IDs (entities, inputs, interaction resolutions) and set-style updates. No RPC receipt table; no exactly-once guarantee for external effects.                                                                                                                                        |
| Trust              | One `TRUSTED_RESOURCE` table: a resource is trusted for the exact file content approved.                                                                                                                                                                                                                                     |
| Prompt suggestions | Kept. Markdown definitions from built-ins, user and project; trust via `TRUSTED_RESOURCE`; served on the workbench channel.                                                                                                                                                                                                  |
| Background work    | Background and promoted bash calls become conversation-owned async bash. Launches are a workbench feature reached through the `launch` host tool; running launches are in memory.                                                                                                                                            |
| Channels           | Separate conversation and workbench connections. Conversation replay uses event sequence; workbench and global list updates are in-memory snapshots plus change notices.                                                                                                                                                     |
| Assets             | `ASSET` tracks conversation-owned files only.                                                                                                                                                                                                                                                                                |

### Capabilities

The host captures tools and skills from scoped `agent.json` preferences and the applied profile at each request preparation. Requirements beat conversation choices, which beat recommendations and defaults. Typed tool fields merge at their declared units; skills support source defaults and named booleans. Reset removes an editable override and inherits, rather than deleting choices merely because they match defaults. Core tools remain subject to permission policy.

Children capture their own underlying preferences and applied profile, never the parent's conversation file or effective tools/skills. Follow-ups retain those choices; current authorization is still checked. See [configuration](../configuration.md) for resolution, activation and health, [delegation](delegation.md) for children, and [storage](../storage.md#files-and-permissions) for paths.

## Implementation status

The portable core, host ports, conversation channel, workbench channel and app cutover are implemented. The old journal, agent/run storage and `/ws` endpoint are removed.

Existing 0.34.1 homes are converted automatically at startup by migration step 0001; see [storage migrations](../migrations.md) and [migration](migration.md).

Prompt suggestions are kept and evaluate against the conversation (title, rule set, reasoning level, status) and git state; they are served on the workbench channel.

## Non-goals

- Exactly-once external effects. Uncertain outcomes are recorded as indeterminate, not retried blindly.
- Coordinated parent/child rewind.
- Persisting live progress or workbench state.
- Conversation core depending on workbench features such as launches (the `launch` tool is a host tool).
