# Conversation core redesign

Status: **proposal**. Target design, not current behavior. Implementation is incremental; see [phases](#implementation-phases).

## Goal

Make the conversation the single, portable core of Nerve, with a small storage model and its own client channel. IDE features (files, git, GitHub, scratch notes, launch configurations, logs) become a separate workbench layer that depends on the core, never the reverse.

Today's storage has 62 SQLite tables (about 30 populated), 26 document namespaces and a 15 GB development database dominated by duplicated snapshots and derived history. Lifecycle, journal, obligation and projection machinery accumulated incrementally. This proposal replaces it with 11 tables and two channels.

## Documents

| Document | Covers |
| --- | --- |
| [Data model](data-model.md) | ER diagram for all tables, deletion, indexes |
| [Events and context](events-and-context.md) | Event types, Pi projection, compaction, branching |
| [Tool-call lifecycle](tool-call-lifecycle.md) | State machine, parallel calls, recovery, cancellation, approval grants |
| [Input queue](input-queue.md) | Merged queue, command preparation, identities, idempotency |
| [Async bash and launch configurations](async-bash-and-launches.md) | Conversation-owned background commands versus user-started launches |
| [Channels](channels.md) | Conversation channel versus workbench channel, replay, client state |
| [Migration](migration.md) | Current database analysis, mapping, effort and cutover strategy |

## Principles

- **The conversation is the agent.** An agent is runtime behavior of a conversation, not a stored entity. Child agents are child conversations with the same structure.
- **History is append-only and branchable; configuration is current-only.** Rewinding history never restores old settings.
- **Tables hold current state or unfinished work; events hold facts.** Unfinished tool calls and undelivered inputs live in tables and become events when they finish.
- **Live progress is not persisted.** Streaming deltas, argument drafting and workbench changes are in-memory.
- **Permissions are rule sets plus overlay files.** No permission levels, workspace scopes, ceilings or grant tables.
- **Layering:** workbench → conversation core → foundation. Lower layers never depend on higher ones.
- **Add later, not now.** Budgets, depth limits, orchestration policies and similar controls wait for a concrete need.

## Glossary

| Term | Meaning |
| --- | --- |
| Conversation | Persistent entity with configuration, branchable history, queue and unfinished tool calls |
| Child conversation | Conversation with a parent; created by delegation tools |
| Turn | One model invocation plus the processing of the tool calls it issued |
| Execution | A span of turns started by an input or assignment, bounded by `execution_state` events |
| Event | Append-only durable fact in a conversation's history |
| Async bash | A bash tool call promoted to a background process, owned by the conversation |
| Launch configuration | A user-defined command started from the UI, independent of conversations |

## Decisions

| Area | Decision |
| --- | --- |
| Projects | Conversations belong to a project (`project_id` required). |
| Conversation state | `pinned_at`, `completed_at`, `last_user_message_at`, `status_cleared_at`, `created_at`, `updated_at`. |
| Last user message | Updated only by delivered `user_message` events, human or parent submitted. Never by compaction, tool results or notices. |
| Status dismissal | `status_cleared_at` keeps a dismissed failed or interrupted badge hidden across status rebuilds. |
| Child policy | None stored. Deliberately stopping a parent stops its children. No budgets, depth or concurrency limits, grants or orchestration policies. |
| Configuration | Model, reasoning level, system prompt, permission rule set, mode, tools, skills, working directory. No `instructions`, permission level, workspace roots, read-only flag or revisions. |
| Permissions | Baseline rule set plus overlays at user, project (`.nerve/`) and conversation (conversation data directory) level. |
| Approval grants | "Always allow" writes a rule into the matching overlay file. No table. |
| Event types | `user_message`, `assistant_message`, `system_event`, `tool_call_response`, `compaction`. No tool-request, branch-summary or explore-report events. |
| Tool calls | Unfinished calls live in `TOOL_CALL`; settling appends one response event and deletes the row. |
| Input queue | One queue for user prompts, parent prompts and system notices. |
| Force push | Stop the current turn, then drain the queue. No stored state. |
| Branch summary | Not an event type; a new branch may append a compaction. |
| Idempotency | Every mutation is idempotent by client-supplied ID or set semantics. No RPC idempotency table. |
| Trust | One `TRUSTED_RESOURCE` table for prompt suggestions, skills and project permission/capability files. |
| Background work | Promoted bash calls become conversation-owned async bash. User-started launch configurations are a workbench feature; running instances are in memory. |
| Channels | Separate conversation and workbench connections. Conversation replay uses event sequence; workbench and global list updates are in-memory snapshots plus change notices. |
| Assets | `ASSET` tracks conversation-owned files only. |

## Implementation phases

1. **Workbench channel.** Move files, git, GitHub, notes, launch and log updates off the persisted workspace stream onto an in-memory workbench channel. Independent of the storage change; also addresses the client recomputation in [#393](https://github.com/ThilinaTLM/nerve/issues/393).
2. **Foundation and storage.** New schema in a fresh database file, repositories, and a read-only importer exercised against copied homes.
3. **Conversation runtime.** Event appends, Pi context projection, input queue, tool-call lifecycle, recovery and child conversations on the new storage.
4. **Conversation channel and client stores.** Per-conversation replay by sequence, live deltas, child navigation.
5. **Cutover.** Import, switch the daemon, delete the old persistence, lifecycle and journal code.

Phases 2–5 change storage and runtime together and are cut over at once; running old and new tool lifecycles side by side is not planned.

## Non-goals

- Exactly-once external effects. Uncertain outcomes are recorded as indeterminate, not retried blindly.
- Coordinated parent/child rewind.
- Persisting live progress or workbench state.
- Agents depending on workbench features such as launch configurations.
