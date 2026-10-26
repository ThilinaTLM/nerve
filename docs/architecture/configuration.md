# Scoped configuration

> **Status:** Current architecture. Owning contracts and services implement the [normative specification](../proposals/scoped-configuration-and-active-profiles/README.md).

JSON is authoritative for agent preferences and conversation-only prompt context. SQLite owns identity, relationships, history, lifecycle and `conversation.working_directory`; it has no `conversation_config` or settings index. Resolved memory and conversation-list summaries are disposable.

## Scope files

| Domain                      | User                                             | Project                                              | Conversation                                                   |
| --------------------------- | ------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------- |
| Agent preferences           | `<NERVE_HOME>/config/agent.json`                 | `<project>/.nerve/config/agent.json`                 | `<NERVE_HOME>/data/conversations/<id>/config/agent.json`       |
| Creation/picker preferences | `<NERVE_HOME>/config/conversation-defaults.json` | `<project>/.nerve/config/conversation-defaults.json` | None                                                           |
| Profile definitions         | `<NERVE_HOME>/data/agent-profiles/<name>.json`   | `<project>/.nerve/agent-profiles/<name>.json`        | Applied snapshot in `agent.json`                               |
| Permission overlays         | `<NERVE_HOME>/config/permissions.json`           | `<project>/.nerve/config/permissions.json`           | `<NERVE_HOME>/data/conversations/<id>/config/permissions.json` |

`agent.json.overrides` holds model, reasoning, permission selection, compaction, retry, typed tool settings, skill selection and lead-only sub-agent launch selections. Conversation documents also hold `appliedProfile`, optional child `frozenDefaults`, transition metadata and non-inheritable `context.instructions`/`context.systemPrompt`. Profile switches preserve context. Custom system prompts supply the base; local and applied-profile instructions contribute separately.

The [domain registry](../proposals/scoped-configuration-and-active-profiles/domain-inventory.md) defines preserved domains: daemon/UI, providers, integrations, rule-set definitions, suggestions, launch definitions and secrets retain their own schemas and locations. Credentials never belong in agent snapshots. Skill/context source files stay in discovery locations, not `config/`.

## Resolution and resets

Highest priority wins per declared merge unit: applied requirement → explicit conversation choice → applied recommendation → process-local agent default → project → user → built-in. **Use settings** contributes nothing; **Recommend** yields to conversation choices; **Require** temporarily controls a value without rewriting the underlying choice. Requirements do not override authorization.

Missing fields inherit; explicit false disables. Reset deletes the local override, not writes the inherited value. Atomic values (such as model pairs) reset together; compaction/retry and supported tool fields merge individually, with atomic exceptions defined by contracts. Skill source defaults and named booleans resolve within each layer. Effective source labels identify defaults, conversation choices, recommendation/requirement profiles and frozen child choices; reasoning adjustments are visible.

Profile catalog definitions shadow as complete documents, not sparse fields. Applied snapshots remain unchanged after catalog edits/deletion until explicit switch or **Apply updated profile**. Children freeze independent preferences at creation, including bounded launch model/reasoning choices; they never inherit the lead's effective agent settings. See [profiles](agent-profiles.md) and [delegation](conversation-core/delegation.md).

Permissions remain ordered policy evaluation: baseline, selected ruleset and applicable overlays, not generic preference merging. Project trust is domain-specific; untrusted content remains unapplied with diagnostics. Invalid selected/required policy blocks affected execution, while malformed unused catalog entries are isolated.

## Persistence and activation

Contracts own strict schemas and pure resolution. Host services own scope paths, serialized atomic writes, revision/digest conflicts, health and complete-generation publication. Conversation core consumes captured settings through ports rather than rereading files. Failed persistence does not publish; failed publication makes the affected scope unavailable until authoritative reload. A missing optional preference file means empty overrides; a missing required conversation document is unavailable, never silently recreated.

UI saves publish validated generations directly. There are **no filesystem watchers or polling**. Manual edits require restart for guaranteed activation, or an explicit Reload/Retry operation that re-reads authority. File replacement is atomic per document, not a transaction across all home files; serialization is within one storage instance, not across processes.

| Change                                                                | Activation boundary                                                          |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Model, reasoning, prompt, tools, skills, retry/compaction preferences | Next request preparation, including retries and post-compaction requests     |
| Profile selection/reapplication                                       | Next preparation after the atomic conversation document commit               |
| Launch selections/catalog availability                                | Rechecked when admitting a new-child launch; existing children remain frozen |
| Permission selection, definitions and overlays                        | Next execution admission, including after approval waits                     |

Prepared provider requests and running tools are not retroactively changed. Approval is not permanent authority: execution rechecks current policy. After restart, not-yet-started calls are re-captured and re-admitted; a changed execution target requires fresh approval. Invalid security configuration puts affected calls in **configuration-blocked** waiting with **Retry/Cancel**, not an approval fallback. Retry re-reads configuration.

## Health and recovery

Scoped health diagnostics report malformed/unsupported documents, missing references and conflicts without discarding original bytes. Existing in-memory validated generations may remain available where permitted; there is no persisted last-known-good authority. Health/repair uses existing Settings, activity notices and toasts. Repair requires a source-bound preview and confirmation with backups; dismissing a notice does not repair it or grant trust. History and unrelated UI remain usable when affected execution is blocked.

`cache/conversation-agent-summaries.json` is display-only. Missing/invalid entries yield unknown list fields; lists do not scan all conversation documents at startup or fall back to SQL agent columns. See [storage](storage.md) and [migration/recovery specification](../proposals/scoped-configuration-and-active-profiles/migration-and-recovery.md).
