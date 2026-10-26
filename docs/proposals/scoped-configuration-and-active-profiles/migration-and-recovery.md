# Migration and recovery

## Availability and validation

Application-shell availability is distinct from readiness of a configuration-dependent feature. A bad scoped configuration must not make history/settings inaccessible or break unrelated valid conversations. A genuine storage-wide migration/database failure can still require the existing startup recovery screen; this proposal does not promise history access when underlying storage is unreadable.

Validate user documents during initialization. Validate project/conversation dependencies on first opening or other use, including background execution and child creation. Cache the result. Do not scan every project/conversation on every startup. Agent execution waits for valid required dependencies; a missing configured model is a setup-required state.

Supported registered migrations run automatically. Repair/reset of invalid content requires explicit confirmation. During runtime, non-security preferences may retain an already validated in-memory value; there is no separately persisted last-known-good store. At first load with no valid in-memory state, the dependent feature waits for repair. Unrelated UI/history remain available.

Permission failures never use an approval bypass: invalid selected ruleset, applicable trusted policy or required profile contribution pauses affected execution until repaired. Untrusted project content is unapplied under existing trust rules, not silently trusted or treated as permission to weaken an already applicable policy. Corrupt unrelated catalog entries are isolated with diagnostics.

## Readiness matrix

| Condition                                    | Activation                                                                         | Recovery                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Missing optional preference/overlay file     | Inherit/no overlay; do not write defaults                                          | None required                                                               |
| Missing existing conversation agent document | Block dependent execution; preserve history                                        | Explicit recovery or complete interrupted migration; no silent new defaults |
| Supported old document version               | Convert before activation                                                          | Automatic registered migration with backup/verification                     |
| Unknown property on supported version        | Reject affected document, retain valid in-memory non-security version if available | Preview removal; explicit confirmation                                      |
| Invalid known value or malformed JSON        | Same unavailable/retained-memory behavior; policy always blocks                    | Edit/reload or previewed reset; retain original bytes                       |
| Unsupported future version                   | Do not activate, downgrade or rewrite                                              | Upgrade application or explicitly restore/reset with backup                 |
| Missing selected model/account               | Retain reference; block only dependent action                                      | Choose available resource, restore it or reset selection                    |
| Missing catalog profile definition           | Block selection/reapplication/new launch; valid applied snapshots keep working     | Restore/select a definition when needed                                     |
| I/O error                                    | Not absence; affected scope unavailable unless valid non-security memory remains   | Repair storage/access; retry                                                |
| Corrupt disposable summary cache             | Treat as empty; no agent execution blockage                                        | Rebuild incrementally                                                       |

An invalid atomic field cannot be salvaged by combining fragments with defaults. An unknown field is not silently stripped; repair preview must show what will be removed. Domain classification determines whether the failure affects security, execution or only presentation.

## Existing UI and APIs to extend

Verified sources:

- `workbench-app/src/lib/app/shell/SettingsHealthWatcher.svelte`: health fetch on connection, warning toast with View, reset confirmation. Despite its name, it is not filesystem watching.
- `workbench-app/src/lib/presentation/activity/SettingsHealthItem.svelte`: persistent activity entry with path/reason and Reload/Reset actions.
- `workbench-server/src/adapters/http/routes/settings-health-routes.ts`: currently six user documents; extend health and recovery to typed scope/document identities.
- `workbench-app/src/lib/features/storage-upgrade/views/UpgradeReportNotice.svelte`: bottom-right Details/Dismiss report for migration losses/quarantine. Its `.seen` acknowledgement is not repair consent.
- `StartupErrorView.svelte` and migration recovery APIs: retain storage-wide retry/discard/rollback behavior; do not confuse it with ordinary scoped repair.

Replace the existing authorization-recovery approval safeguard and its UI wording with configuration-blocked admission. Reuse notification surfaces, not their current permission fallback semantics.

Use one persistent health item per failing scoped document and a deduplicated toast linking to it. Dismissing a toast does not clear health or authorize execution. Health resolves only after valid reload/repair. Diagnostic payload includes scope IDs, document ID/path, schema version if readable, issue code and JSON Pointer, affected capability and recovery choices; do not expose secret values in notifications.

## Confirmed repairs

1. Load and preserve exact original bytes; prepare a validated candidate and effective-value/source diff.
2. Present affected scope/feature and the proposed resets. Removing a preference inherits; do not fill a sparse document with all defaults.
3. Require confirmation bound to original digest and candidate digest. User edits since preview invalidate confirmation.
4. Under the file mutation lock, recheck content, write a protected original-byte backup and durable repair receipt, then atomically replace the document.
5. Publish and acknowledge using the configuration service. After a crash, source/candidate digests in the receipt determine whether replacement occurred; never overwrite unrelated later edits.

Reuse `<NERVE_HOME>/quarantine/settings/` for originals, with scoped unique names and restricted permissions. Receipts record source identity/digests and candidate version, not embedded secrets in logs. Keep originals until explicitly deleted; do not invent automatic retention or use them as runtime fallback settings. Resetting required policy requires an explicitly valid target/profile selection, not silent removal of constraints. Repair consent does not automatically grant trust to changed project content.

Existing atomic-write primitives can be reused: serialized mutation, exclusive temporary file, fsync and rename. Add parent-directory synchronization where supported and distinguish unsupported-platform durability limits. Revision/digest checks are optimistic, not protection against an arbitrary external editor writing between check and rename.

## Migration ownership

The baseline is the last release, **v0.37.0**. Formats introduced after it never shipped and are not migration inputs: agent-profile v2 files, `applied-agent-profile.json`, `retired-agent-profiles.json`, aggregate `config/agent-profiles.json`, capabilities v3, harness v4, integrations v2 and the core SQL v2 `mode` → `agent_profile` rebuild. Unsupported SQL/intermediate home layouts require fresh released copies. Unsupported scoped documents follow D12 below; they are not silently downgraded.

Replace the unreleased `0002-agent-profiles` step and unreleased core SQL v2 with one step that converts v0.37.0 state directly into this design. Never alter released step 0001. Conversions in the unreleased step that are unrelated to agent configuration (for example integrations v2 accounts, trusted-resource kinds and planning-tool metadata renames) carry over into the replacement step. The replacement step converts user configuration and all projects known to storage at upgrade time. A project first encountered later (for example a fresh clone of a repository with released `.nerve/config` files) is converted by the same registered converters before its first activation. The global ledger must not claim that unseen projects were converted. Converting project files rewrites them; trust for a file the application converted from a previously trusted original is re-granted for the converted bytes and listed in the upgrade report. Untrusted originals stay untrusted. Rehearse on copied/fresh storage, never slot 1.

### D12 — scoped invalid-file isolation

Malformed, unsupported or otherwise unconvertible user/project legacy configuration remains byte-for-byte untouched. The report records its actual path and reason. Scoped agent-configuration publication/retirement waits for repair; valid source contributions can still freeze mandatory conversation-row exports. Conversation exports and reviewed SQL verification remain strict. Other projects, history and application startup continue; no trust is granted for a held contribution.

The same converters guard lazy first use and explicit runtime Reload/Retry. Health exposes the original legacy path and reason instead of manufacturing default-ready configuration. After a manual fix, Reload/Retry clears the failed attempt and reruns conversion. Already loaded scopes retain the normal explicit-reload policy; this adds no polling or watchers.

Existing repair preview pins the blocked legacy filename and exact source digest. Reset means removing that legacy contribution (inherit/default), not writing new-format JSON into an old filename. Apply requires the preview's deletion candidate and saves exact originals plus a protected receipt before removal; changed bytes invalidate confirmation. Retry is idempotent and repair never grants trust. Target collisions remain scoped repair-needed failures, never permission to overwrite canonical files.

### Released v0.37.0 inputs

| Location                                                         | Released format                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User `config/harness.json`, project `.nerve/config/harness.json` | `version: 3`: `defaults` and `lastSelection` (`mode`, `permissionRuleSetId`, `model?`, `thinkingLevel`), `rememberLastSelection`, `compaction`, `retry`, `execution`, `tools`, `skills`, `scopedModels`                                   |
| User/project/conversation `config/capabilities.json`             | `schemaVersion: 2`: `tools`, detached `toolSettings`, `skills.{file,nerve,agentBrowser}`                                                                                                                                                  |
| User/project/conversation `config/subagents.json`                | `schemaVersion: 1` sparse entries layered builtin → user → project → conversation: label, description, enabled, model (`"lead"` copies the parent), thinking, permission, compaction, tools, skills (inherit/disable/patch), instructions |
| Conversation `config/harness.json`                               | Optional `compaction` only                                                                                                                                                                                                                |
| SQLite `conversation_config`                                     | `model`, `reasoning_level`, `permission_rule_set_id`, `mode` (`planning`/`coding`), plus conversation context `system_prompt`, `instructions`, `working_directory`                                                                        |

### Conversion map

| Released source                                                                        | Target                                                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harness `defaults` permission/model/thinking, `compaction`, `retry`                    | Same-scope `agent.json.overrides`; `thinkingLevel` → `reasoningLevel`                                                                                                               |
| Harness `rememberLastSelection: true` with `lastSelection`                             | Its permission/model/thinking replace the corresponding same-scope defaults in `agent.json`; option and state are discarded. When disabled, `lastSelection` is discarded            |
| Harness `defaults.mode` (or `lastSelection.mode` when remembering was enabled)         | `conversation-defaults.json` `defaultAgentProfile` (`planning`/`coding`)                                                                                                            |
| Harness `scopedModels`                                                                 | `conversation-defaults.json`                                                                                                                                                        |
| Harness `execution`/`tools`/`skills`, capabilities `tools` + `toolSettings` + `skills` | Same-scope `agent.json` tools/skills, joining detached settings into typed tool entries; preserve stored choices and skill source identities                                        |
| Conversation harness `compaction`                                                      | Conversation `agent.json.overrides.compaction`                                                                                                                                      |
| SQLite `model`/`reasoning_level`/`permission_rule_set_id`                              | Conversation `agent.json.overrides` as ordinary explicit choices                                                                                                                    |
| SQLite `mode`                                                                          | Conversation `appliedProfile` snapshot of the bundled Planning/Coding definition (`source: "builtin"`, its digest)                                                                  |
| SQLite `instructions` / `system_prompt`                                                | Conversation-only `agent.json.context.instructions` / `.systemPrompt`; null becomes omission, exact strings preserved                                                               |
| SQLite `working_directory`                                                             | NOT NULL `conversation.working_directory`; still exposed in API config/history                                                                                                      |
| User/project `subagents.json` entry `enabled`/`model`/`thinking`                       | Same-scope `agent.json.overrides.subagents.<name>` launch overrides                                                                                                                 |
| User/project `subagents.json` entry with other edited fields                           | Complete same-scope profile file: the bundled definition (or the entry itself for a custom name) merged with the edits. Settings become **recommendations**; `usableBy: "subagent"` |
| Conversation `subagents.json`                                                          | `enabled`/`model`/`thinking` → conversation `overrides.subagents`; other fields are dropped and listed in the upgrade report                                                        |
| Sub-agent model `"lead"` or thinking `"lead"`                                          | Omitted (Use settings) per field; reported as a removed parent-copy behaviour                                                                                                       |
| Sub-agent skills `"none"` / boolean map (`"inherit"` omitted)                          | All three source defaults false / named entries; never empty maps                                                                                                                   |
| Existing child conversations                                                           | `frozenDefaults` from the child's released effective settings (columns, capabilities, compaction); no requirements; behaviour unchanged                                             |

Existing per-conversation values are not compared with defaults to infer intent; they stay as explicit choices that the user can reset. The upgrade report lists dropped conversation sub-agent fields, removed parent-copy behaviour, folded remembered selections and re-granted project trust.

Released capability entries and detached tool settings replaced lower objects wholesale, so an omitted account or model meant none. Converted sparse entries omit those fields and therefore inherit lower-scope values. This change is accepted; the upgrade report lists each affected document and field (for example a newly inherited account or image model) for review. Existing children keep their released effective values in `frozenDefaults`.

Bundled profiles are authored explicitly: Planning **requires** the planning permission and `plan_present.enabled`; Coding has no contribution; Explore's no-skills setting uses all three skill source defaults false; Developer uses normal settings rather than parent copying.

### Database boundary

**D10 supersedes the prior context-table design:** drop `conversation_config` entirely. Agent choices and `context: { instructions?, systemPrompt? }` move to each conversation's unreleased v1 `agent.json`; preserve exact non-null prompt strings, including empty strings, and verify them against every original SQL row before destruction. Context is conversation-only, never inherited or changed by profile switches. Move `working_directory` to a NOT NULL column on `conversation` using create-new/copy/drop/rename, preserving all released columns, constraints, self-FK, DEFERRABLE INITIALLY DEFERRED event FK, UNIQUE(project_id,id), CHECKs, STRICT and the three exact indexes. Verify all inbound FK definitions/targets and `foreign_key_check`. Keep lifecycle/history unchanged. No settings/index table is added; this working-directory relocation is the sole added SQL column. The unreleased `agent_profile` column is never created.

Before executing DDL, produce the exact migration diff for explicit review. Replace SQL list joins (`packages/conversation-core/src/storage/conversation.repository.ts`) and all repository consumers of removed columns; split SQL working-directory/history reads from validated conversation JSON context and service-resolved agent views. Update snapshot/list contracts to permit unknown cached agent fields before the new runtime opens a migrated database. History/snapshot contracts permit unknown JSON prompt fields while retaining SQL working directory. Execution constructs the prompt each turn from validated JSON context plus separate applied-profile instructions. `conversation.configure` persists context in JSON and working directory in SQL. Export each conversation agent document, validate it, record source-bound receipts and verify all affected rows before dropping columns. Handle preexisting target collisions without overwriting, preserve rollback data, and test interruption between export, verification and database commit. A document conversion failure must not be falsely marked successful in order to proceed with destructive DDL.

## File/event consistency

Atomic agent-file replacement is not a SQLite/file transaction. Configuration reads and execution always use JSON/in-memory authority. Notifications and list caches are projections and may be repaired after a crash.

For plan approval: persist the user's accepted decision/choices with a unique transition ID in the existing review lifecycle before committing the agent document. Apply only against the expected configuration revision and target profile digest, store the ID in `lastTransition`, then settle the review event. Recovery compares the existing durable decision and file receipt: finish an already committed transition once, or leave an uncommitted/stale decision pending for revalidation. It must not replay implementation twice or overwrite later configuration. A rejected uncommitted attempt releases mutation serialization and leaves the review open, allowing repair/ordinary saves and a new confirmation with a new transition ID. Prior rejected attempts cannot execute. Only a committed unsettled receipt must be reconciled before another mutation. Change the existing interaction behavior that rejects revised resolutions/settles resolver errors as failed: validation conflicts must remain refreshable reviews, not failed-tool settlement. Reuse existing interaction/event payloads; any additional DB schema need must return for approval.

## Acceptance tests

Exercise unsupported versions, unknown/invalid values, malformed JSON, missing references, unreadable files, invalid policy, lazy background access, runtime in-memory retention, preview conflicts, backup-before-replace interruption, post-persist publication failure, migration collisions/rollback, every released v0.37.0 input in the conversion map, re-granted versus still-untrusted converted project files, and plan-transition recovery. Invalid document tests must prove application/history access remains available when storage itself is healthy.
