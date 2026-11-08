# Data model

A conversation owns its history and pending work, while its project groups conversations and shared resources. The storage model separates relational records, configuration files and large result files so each has a clear lifecycle. This page explains those ownership boundaries and how deletion follows them.

Part of [conversation core](README.md).

## Storage boundaries

SQLite owns relational identity, branchable facts and unfinished work. Scoped JSON owns agent configuration and permission files; managed files hold large outputs and images. Live progress and launch instances remain in memory. Each authority has its own lifecycle, keeping mutable settings and large payloads out of the event log; see [storage](../storage.md) and [configuration](../configuration.md).

Working directory belongs to the conversation, while agent settings live in files, so history selection and configuration changes remain independent. The physical schema is owned by conversation core's own storage migrations (`coreMigrations`); the server's migration steps only import legacy homes into it. Contracts validate application shapes.

## Relationships

This diagram emphasizes identity and ownership. Non-key fields, constraints and indexes remain authoritative in the schema. `parent_tool_call_id` and producer `tool_call_id` are logical associations, not foreign keys: settled calls leave no row.

```mermaid
erDiagram
    SCHEMA_MIGRATIONS {
        int version PK
    }
    CONVERSATION {
        string id PK
        string head_event_id FK "Nullable selected head"
        string working_directory
    }
    CONVERSATION_EVENT {
        string id PK
        string previous_event_id FK "Nullable predecessor"
        int sequence "Replay order within conversation"
    }
    PROJECT ||--o{ CONVERSATION : contains
    PROJECT ||--o{ SCRATCH_NOTE : contains
    PROJECT o|--o{ TRUSTED_RESOURCE : scopes
    CONVERSATION o|--o{ CONVERSATION : parents
    CONVERSATION ||--o{ CONVERSATION_EVENT : owns
    CONVERSATION_EVENT o|--o{ CONVERSATION_EVENT : predecessor
    CONVERSATION o|--o| CONVERSATION_EVENT : selects_head
    CONVERSATION ||--o{ TOOL_CALL : executes
    CONVERSATION_EVENT o|--o{ TOOL_CALL : issues
    CONVERSATION ||--o{ INPUT_QUEUE : receives
    CONVERSATION o|--o{ INPUT_QUEUE : submits
    CONVERSATION_EVENT o|--o{ INPUT_QUEUE : targets_execution
    CONVERSATION ||--o{ ASYNC_BASH : owns
    CONVERSATION ||--o{ ASSET : owns
    CONVERSATION ||--o{ CONVERSATION_REFERENCE : links
    CONVERSATION_EVENT o|--o{ ASSET : references
    ASYNC_BASH o|--o{ ASSET : produces
```

Event predecessors, selected heads, tool-call assistant references and asset references are constrained to the owning conversation. Parent relationships stay within the project, keeping recursive ownership inside one project. Event sequence replay includes every branch independently of the selected head, so clients can observe durable changes even outside the active transcript.

## Non-obvious tables

The schema lists every table; these need a note:

- `trusted_resource` records approval of file content by digest (a hash of those exact bytes), scoped to user or project.
- `async_bash` tracks conversation-owned background commands beyond foreground tool completion.
- `asset` tracks managed files and their producers so results can be referenced and cleaned up.
- `conversation_reference` links a conversation to external resources; see [discovery](../conversation-discovery.md).
- `scratch_note` holds project-owned workbench notes independent of agent history.

## Durability and identity

A storage transaction is the atomic boundary for [tool settlement](tool-call-lifecycle.md) and [input delivery](input-queue.md): pending rows become events with no window in which both representations exist. Execution claims fence late writes from stale workers. External effects stay outside SQLite, so a claim cannot prove an interrupted command did not run; see [recovery](tool-call-lifecycle.md#recovery).

Trust decisions identify approved content by digest, so changing a file requires renewed approval; scope keeps user and project resources independent.

## Deletion

Conversation deletion collects descendants, stops work, cancels async bash, removes managed conversation files, then deletes the conversation. Foreign keys cascade relational ownership. Deletion removes the conversation's configuration and permission overlay—a scoped file extending permission rules—along with its assets, so no conversation-owned files remain after removal.

Orphan cleanup removes unreferenced assets only when no pending tool or async-bash producer remains. This protects files produced before settlement attaches them to an event.

Project deletion deletes conversations before the project row; project-owned scratch notes and trust decisions cascade. The project's working files are not deleted.

## Where it lives

| Concern                      | Owner                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Physical schema and versions | [`coreMigrations`](../../../packages/conversation-core/src/storage/migrations.ts) (SQL in `schema*.ts` beside it) |
| Event reads and writes       | [`ConversationEventRepository`](../../../packages/conversation-core/src/storage/conversation-event.repository.ts) |
| Trust decisions              | [`TrustedResourceRepository`](../../../packages/conversation-core/src/storage/trusted-resource.repository.ts)     |
| Application shapes           | [Core contracts](../../../packages/contracts/src/domains/core/)                                                   |
| Atomic updates               | [`CoreStorage.transaction`](../../../packages/conversation-core/src/storage/core-storage.ts)                      |
| Conversation deletion        | [`ConversationService.delete`](../../../packages/conversation-core/src/conversations/conversation.service.ts)     |
| File cleanup                 | [`AssetStore.cleanupOrphans`](../../../packages/conversation-core/src/assets/asset-store.ts)                      |
| Project deletion             | [`ProjectService.delete`](../../../packages/conversation-core/src/conversations/project.service.ts)               |
