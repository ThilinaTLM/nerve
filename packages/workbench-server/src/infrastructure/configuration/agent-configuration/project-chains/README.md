# Project configuration chains

Home step 0002 is home-only, including applied-draft profile reruns. Conversation conversion preserves explicit values without project normalization; child reconstruction uses home settings only. Archived plans containing old project-scope receipts are rejected before replay, not resumed against project files. Project directory values remain only as home database receipt metadata.

## Runtime ownership

`create-runtime-services.ts` creates the shared migration service and static descriptor registry. It passes the same service to conversation/agent configuration, permission settings and prompt suggestions. Standalone conversation-core fixtures construct an isolated service using their explicit home. `create-conversation-core.ts` no longer calls or imports `ReleasedProjectMigration` or any step-folder converter.

The scoped store runs domain preparation before each actual disk load, validates current documents, and publishes immutable generations. Project saves/creation use framework transactions; invalid/newer files cannot invoke the mutation callback or be overwritten by a fallback. Per-entry profile deletion uses a framework transaction too. Existing explicit repair remains separate from ordinary feature saves.

Project health Reload/Reset republishes the already loaded scoped generations and invalidates capability/policy caches. No filesystem watchers, startup project scan, new table, column or trust kind were added.

## Descriptors

All paths below are relative to project `.nerve/`. Each descriptor declares `label`, `resetDescription`, a fresh fallback and confirmed reset. `descriptors.ts` contains static registrations, dynamic factory inventory and trust-kind mappings; profile/suggestion factories register each entry on first load.

| Type ID                        | Path                                | Version field / absent / current    | Conversion input                                                                                                                               | Fallback                                                                     | Reset                                                      | Trust kind             |
| ------------------------------ | ----------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------- |
| `agent-settings`               | `config/agent.json`                 | `schemaVersion` / 1 / 1             | Composite harness v3, capabilities v2/v3, subagent catalog, integrations v1/v2; home agent settings are a read-only materialization dependency | Lower-precedence settings                                                    | Remove override                                            | `project_capabilities` |
| `conversation-defaults`        | `config/conversation-defaults.json` | `schemaVersion` / 1 / 1             | Project harness v3 only                                                                                                                        | Lower-precedence defaults                                                    | Remove override                                            | None                   |
| `capabilities`                 | `config/capabilities.json`          | `schemaVersion` / 2 / 3             | v2 tools/skills -> v3 sparse overrides                                                                                                         | Lower-precedence settings                                                    | Remove override                                            | `project_capabilities` |
| `integrations`                 | `config/integrations.json`          | `version` / 1 / 2                   | v1 selections move to agent settings; account document becomes v2                                                                              | User integration settings                                                    | Remove override                                            | None                   |
| `subagents`                    | `config/subagents.json`             | `version` / 1 / 2                   | Pre-JSON enablement map or released catalog                                                                                                    | Empty catalog; individual profiles remain isolated                           | Remove invalid catalog                                     | `agent_profile`        |
| `agent-profile:<name>`         | `agent-profiles/<name>.json`        | `version` / 1 / 2                   | Existing profile description/defaults revision; then ordered legacy sources: catalog entry, Markdown file                                      | Invalid entry hidden, without lower-entry fallthrough                        | Remove entry; suppress retained source for this entry only | `agent_profile`        |
| `permission-overlay`           | `config/permissions.json`           | `version` / 1 / 2                   | Named planning-tool selector conversion                                                                                                        | Tool execution blocked while invalid, including an untrusted invalid overlay | Remove overlay; user policy applies                        | `project_permissions`  |
| `prompt-suggestion:<filename>` | `suggestions/<filename>`            | Frontmatter `schemaVersion` / 1 / 2 | Markdown v1 `enable.js` -> `enable-js`                                                                                                         | Omit that file                                                               | Quarantine/remove that file                                | `prompt_suggestion`    |

Project profile/catalog file `version` is independent of the existing shared DTO `schemaVersion: 1`; permission file `version` is independent of the shared policy DTO `schemaVersion: 2`. Current file validators require the current project version and current DTO shape. Feature projections remove file-envelope metadata; only migrators change older representations. Current-version invalid documents are never normalized/repaired on load.

Capabilities are an independent scoped layer below explicit project agent settings. New legacy agent imports remove capability-owned merge units from their result, avoiding duplicate/pinned capability opinions. Conversation saves normalize against the capability layer too; child snapshots never consult it. Invalid capability/agent/default overrides leave lower-precedence settings usable but remain unavailable for ordinary writes.

The home database migration already normalizes legacy `subagent_profile` trust rows to the current `agent_profile` kind without reading project files. Project catalog/Markdown chains therefore use that current storage kind for their legacy inputs. Deterministic cross-kind/fan-out derivation uses exact original bytes, never entry hashes or predicate-only consent. Predicate-only prompt approvals are not promoted to byte-bound file approval.

## Framework extensions

- Optional descriptor/source codecs for Markdown; atomic custom encoding still belongs to the framework.
- Composite input snapshots, per-input versions and home/project roots; all contributing originals are preserved and rechecked before a write. Declarative migration prerequisites ensure integrations cannot drop v1 tool selections before agent settings have imported them, even when integrations are loaded first.
- Ordered source selection with optional entry selection. A corrupted selected entry never falls through; a genuinely absent catalog entry can use its Markdown source or lower catalog layer.
- Source/target trust-kind derivation and fan-out without consuming a shared catalog approval. Both supported legacy digest encodings are matched; target bindings use the owning feature's digest convention.
- Async validated transaction replacement values and healthy-file removal. Non-healthy files reject callbacks entirely.
- Durable, source-digest-bound reset suppression under the home quarantine. Reset/deletion cannot reactivate a retained unchanged legacy source. Shared catalog entry reset preserves sibling source approval.
- Post-recovery subscriptions invalidate loaded domain generations; successful loads expose the exact source digest for capability trust binding. Permission health changes also invalidate already-published policies when another loader discovers a bad overlay.
- Resource-specific fallback descriptions accompany invalid/incompatible health notices. Invalid UTF-8 is preserved, never decoded with replacement characters. Escaping/dangling symlinks are rejected without reading or overwriting external targets.

Frozen shapes/helpers were copied from 0001/0002 into `project-chains/frozen/`; the new chains do not import checksum-frozen step folders. The obsolete step-folder project coordinator and trust committer have been removed. Legacy repair unit tests use an isolated preparation-port double instead of invoking migration-step code.

## Production-admission worker regression

The production fixture authored `description: "Worker"` but the current shared profile schema requires `whenToUse`. The fixture now authors `whenToUse`; builtin Developer/Explore documents were not edited.

## QA follow-up: optional project overrides

Conversation preparation, inherited-settings reads, preference saves and repair previews
share `applicableAgentLayers`: unavailable project overrides are omitted from resolution,
while required user/conversation documents remain strict. This does not mark a bad
project document writable or clear its health issue. Subagent ownership comes from
conversation metadata, not from the presence of a project configuration generation.

`core-host/execution-admission/scoped-configuration-fallback.test.ts` exercises real
composition with a scripted model for corrupted agent, capability, integration and
conversation-default files: creation, model/tool runs, subagent launch and settings
resolution remain usable; originals and notices remain intact. Permission fail-closed
is specifically **tool execution**: plain model-only replies remain available, and
both the health message and reset description say so.
