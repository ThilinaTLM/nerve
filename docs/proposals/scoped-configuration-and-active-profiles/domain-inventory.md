# Domain and storage registry

This registry distinguishes changed storage from preserved domains. Existing schemas cited below remain normative for preserved documents; do not redesign them merely to make every file sparse or to move every catalog into `config/`.

## Resulting layout

```text
<NERVE_HOME>/
  config/
    agent.json                         # NEW: sparse agent preferences
    conversation-defaults.json         # NEW: creation/picker preferences
    daemon.json                        # preserved
    ui.json                            # preserved
    permissions.json                   # preserved policy composition
    providers.json                     # preserved user-owned catalog
    integrations.json                  # preserved user-owned catalog
    prompt-suggestions.json            # preserved user-only enablement
    rule-sets/<id>.json                 # preserved user-only definitions
  data/
    agent-profiles/<name>.json          # same location, new profile schema
    conversations/<id>/config/
      agent.json                       # NEW agent configuration + conversation-only prompt context
      permissions.json                 # preserved overlay document
  cache/
    conversation-agent-summaries.json   # NEW disposable display cache
  agent/suggestions/*.md                # preserved definitions
  secrets/                             # preserved protected credentials
  quarantine/settings/                 # preserved recovery location

<project>/.nerve/
  config/
    agent.json                         # NEW: sparse agent preferences
    conversation-defaults.json         # NEW: sparse creation/picker preferences
    permissions.json                   # preserved overlay document
  agent-profiles/<name>.json            # same location, new profile schema
  suggestions/*.md                      # preserved definitions
  launches/definitions.json             # preserved project-only catalog
```

Released v0.37.0 `harness.json`, `capabilities.json` and `subagents.json` at user, project and conversation scope are migrated, verified and retired (see [migration](migration-and-recovery.md)). Unreleased intermediate files such as `applied-agent-profile.json` are never migration inputs. Runtime readers do not retain dual authoritative representations. Projects encountered later are upgraded before first activation.

## Domain behavior retained

Paths are relative to their stated root. Schemas are defined under `packages/contracts/src/domains/` unless otherwise noted.

| Domain                 | Scope and schema                                                                                              | Behavior                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daemon                 | User `config/daemon.json`; `settings/home-configuration.ts:daemonConfigSchema` v1                             | Network, diagnostics, process, logging, Electron settings. Preserve environment/CLI precedence and restart metadata.                               |
| UI                     | User `config/ui.json`; `uiConfigSchema` v1                                                                    | Appearance, desktop, notifications, transcription preferences. Not agent inheritance.                                                              |
| Providers              | User `config/providers.json`; `providersConfigSchema` v1                                                      | Provider/model/authentication catalogs; literal header values and credential references retain their distinction.                                  |
| Integrations           | User `config/integrations.json`; `integrationsConfigSchema` v2                                                | Atlassian/Tavily account metadata and credential references. Scoped agent tools select account IDs only.                                           |
| Permissions            | All three `config/permissions.json`; `permissions/permission-rule-sets.ts:permissionOverlayDocumentSchema` v2 | Ruleset-keyed overlays; not generic JSON preference merging.                                                                                       |
| Ruleset definitions    | User `config/rule-sets/*.json`, bundled built-ins; `permissionRuleSetSchema` v1                               | Preserve baseline/selected ruleset and enforcement/scope/priority semantics and authored-guardrail restrictions.                                   |
| Suggestion enablement  | User `config/prompt-suggestions.json` v1                                                                      | `enabled` map keyed by current definition keys; no new project/conversation preference scope.                                                      |
| Suggestion definitions | Existing Markdown locations above                                                                             | Preserve frontmatter/body, project shadowing, and predicate-based trust. No conversation definitions.                                              |
| Launch definitions     | Project `.nerve/launches/definitions.json` v2                                                                 | Preserve folders/definitions, IDs, command/cwd/port, run policy, ordering, revision checks and locks. Execution records/logs remain runtime state. |
| Secrets                | User `secrets/`                                                                                               | Existing encrypted credentials, master key and daemon token; never included in agent snapshots or profile JSON.                                    |

Trust identity is domain-specific: permission/project profile content uses exact-byte identity; suggestion trust uses executable predicate identity. Repairs and migrations do not grant trust implicitly. Explicit UI authoring may retain existing separately consented trust behavior.

Untrusted project content stays unapplied with a diagnostic; it is not equivalent to an applicable trusted policy becoming invalid. Isolate malformed unused catalog entries rather than making every agent unusable. Invalid selected policy or required applied contribution blocks affected execution.

## Ownership outside agent preferences

- Conversation IDs, parent relationships, messages, runs, approvals, events and usage stay in SQLite.
- **D10:** Drop `conversation_config` entirely after verified export. Move `working_directory` to `conversation` as NOT NULL; rebuild that table preserving every released column, constraint, self/event FK (including deferrability), STRICT and all three indexes. Preserve inbound FK targets and require `foreign_key_check` to pass.
- Conversation `instructions` and custom `system_prompt` move to conversation `agent.json.context` (`instructions?`, `systemPrompt?`). These are non-inheritable context, not settings/profile merge units; profile switches preserve them and profile instructions contribute separately each turn. Extend unreleased v1 without a version bump. Keep `conversation.configure` behavior, backed by JSON plus SQL working directory. History/snapshots remain available with SQL working directory and unknown JSON fields when that document is unavailable.
- SQL agent columns have no retained summary projection. No settings/index tables are introduced; the only added SQL column is the D10 working-directory relocation.
- The remember-last-selection option is removed. Default start profile and model-picker list are creation settings, not another effective-agent layer. See [schemas](schemas.md).
- Browser-local tabs, drafts, shell layout, viewer/list/Git preferences and onboarding progress retain their existing local/session-storage ownership. They are not conversation configuration.
- Host resource controls exposed by runtime contracts but missing from persisted daemon conversion are a separately identified issue. Do not add them to agent settings or silently expand this migration; preserve existing behavior and track persistence correction separately.

## Implementation evidence

Review covered: `infrastructure/configuration/{scope-paths,home-configuration,project-configuration}.ts`, storage-bootstrap paths/file mutations, profile service/policy, capability service, permission adapters and `packages/tools/src/policy/permission-policy.ts`, suggestion services/trust repository, launch repository, and SQLite conversation repositories. The shared runtime `Settings` object is a projection, not itself an authoritative file schema.
