# Project configuration chains

Home steps 0001/0002 never open project files. Runtime project chains use local frozen source shapes, not migration-step imports. Each chain reads and writes the **same file**; nothing merges harness files, generates profiles from catalogs/Markdown, stages DB tasks, orders prerequisites or persists reset-suppression state.

## Runtime ownership

Bootstrap creates the shared migration service and descriptor/trust-kind registry. Feature loaders prepare their independent resources on demand. The scoped store validates current documents and publishes immutable generations; project saves, profile deletion and explicit repair use framework transactions. Invalid or newer files remain unavailable for ordinary writes, even when resolution omits optional project layers and successfully uses lower-precedence settings.

Health Reload/Reset republishes loaded generations and invalidates capability/policy caches. There are no filesystem watchers, startup project scans, new schema fields or trust kinds.

## Descriptors

Paths are relative to project `.nerve/`. All descriptors declare labels, reset descriptions, fresh fallbacks and confirmed resets.

| Type                           | Path                                | Version field / absent / current    | Same-file conversion                                                            | Fallback                                         | Reset                               | Trust kind             |
| ------------------------------ | ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------- | ---------------------- |
| `agent-settings`               | `config/agent.json`                 | `schemaVersion` / 1 / 1             | None                                                                            | Lower-precedence settings                        | Remove override                     | `project_capabilities` |
| `conversation-defaults`        | `config/conversation-defaults.json` | `schemaVersion` / 1 / 1             | None                                                                            | Lower-precedence defaults                        | Remove override                     | None                   |
| `capabilities`                 | `config/capabilities.json`          | `schemaVersion` / 2 / 3             | v2 tools/skills → v3 sparse overrides                                           | Lower-precedence settings                        | Remove override                     | `project_capabilities` |
| `integrations`                 | `config/integrations.json`          | `version` / 1 / 2                   | Retain accounts; drop old tool-selection fields, without copying them elsewhere | User integration settings                        | Remove override                     | None                   |
| `subagents`                    | `config/subagents.json`             | `version` / 1 / 2                   | Enablement map/released catalog → v2 catalog; no profile expansion              | Empty catalog                                    | Remove catalog                      | `agent_profile`        |
| `agent-profile:<name>`         | `agent-profiles/<name>.json`        | `version` / 1 / 2                   | Rename description/remove old profile defaults in that file                     | Invalid entry hidden; no lower-entry fallthrough | Remove entry                        | `agent_profile`        |
| `permission-overlay`           | `config/permissions.json`           | `version` / 1 / 2                   | Planning-tool selector conversion                                               | Tool execution blocked; model-only replies work  | Remove overlay; user policy applies | `project_permissions`  |
| `prompt-suggestion:<filename>` | `suggestions/<filename>`            | Frontmatter `schemaVersion` / 1 / 2 | `enable.js` → `enable-js`                                                       | Omit entry                                       | Quarantine/remove entry             | `prompt_suggestion`    |

Project profile/catalog `version` is independent of DTO `schemaVersion: 1`; permission `version` is independent of DTO `schemaVersion: 2`. Current validators never normalize invalid current files. Capabilities remain a separate scoped layer below explicit project agent settings; child snapshots never consult it.

Only exact-byte approval of the same file can survive a bump. The adapter rechecks the original binding and output bytes, updates that record only, and recognizes the owning feature's digest convention. It neither creates trust records nor derives approval for other paths or kinds. Predicate-only prompt consent does not become file approval. Reset/removal revokes approval and never grants it.

## Old filenames are notices, not sources

Agent settings/defaults declare `config/harness.json`; the subagent catalog declares `subagents/*.md`; launches declare `tasks/definitions.json`. A feature load aggregates discovered files into **one legacy project issue**, even if current files are healthy or independently corrupted. Old bytes are never decoded, merged or converted.

The header item lists paths and offers Open folder and confirmed Remove old files. Removal preserves originals in home quarantine, then deletes only those old files. Current settings and sibling entries stay unchanged. The notice vanishes because the files are gone, including after restart; no durable dismissal/reset receipt exists. See [framework details](../../project-migration/README.md).

Optional project fallback remains a resolution projection: `applicableAgentLayers` omits unavailable/untrusted project overrides without clearing health or making bad documents writable. Required user/conversation documents remain strict. Subagent ownership comes from conversation metadata, not from configuration-source presence.
