# Project migration and recovery

Part of [Migration and configuration resilience](./README.md).

Project configuration is migrated lazily, one file at a time, when a feature loads it. Examples include opening the Launches tab, building the agent profile catalog, and resolving a permission overlay for a run. Nothing scans projects in the background and nothing runs at startup.

## Classifying a file on load

Each configuration type declares its current schema version and an ordered chain of migrators. On load, the file's `version` is compared with the current version:

| File state                               | Classification  | Action                                                                                                                                                                                                          |
| ---------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current version, valid                   | Healthy         | Use it.                                                                                                                                                                                                         |
| Older version                            | Needs migration | Run the chain from the file's version to the current one, and validate the result against the current schema. If it succeeds, preserve the original, write the result, and post an informational activity item. |
| Older version, migration or result fails | Corrupted       | Leave the file unchanged; fall back and notify (below).                                                                                                                                                         |
| Current version, fails validation        | Corrupted       | Leave the file unchanged; fall back and notify (below).                                                                                                                                                         |
| Unparseable, or no recognisable version  | Corrupted       | Leave the file unchanged; fall back and notify (below).                                                                                                                                                         |
| Newer version than this installation     | Incompatible    | Do not migrate, write, or offer reset; the file probably belongs to a teammate on a newer Nerve. Fall back and show a read-only notice suggesting an upgrade.                                                   |

A failed migration is a symptom, not a reason to try harder. The file is treated as corrupted, and no partial or heuristic repair is attempted.

### Versions and legacy files

- **Files without a `version` field today.** Agent profiles, scoped agent settings, and similar files gain a field in the next format change. Until then, an absent field means version 1 for that type.
- **Same-file bumps only:** launches v1 → v2, permissions v1 → v2, capabilities v2 → v3, integrations v1 → v2, subagent catalog v1 → v2, individual profile v1 → v2, prompt suggestion v1/unversioned → v2. Each chain reads one file and writes that same file. There are no composite inputs or migration prerequisites.
- **Legacy files under old names**, such as `tasks/definitions.json`, `config/harness.json` and `subagents/*.md`, are never imported. Types declare known filenames. On feature load, one header activity issue lists the old files: “Project settings from an older Nerve weren't imported; configure them again.” **Open folder** opens their folder; confirmed **Remove old files** moves them to home quarantine without changing current settings. Removing files resolves the notice permanently; no dismissal/reset-suppression state is stored. Catalog entries and Markdown never generate profile files, and home staging is not a source.

### Migrator rules

- Migrators use frozen local shapes, like home steps, so later refactors cannot change the meaning of an old conversion.
- Each migrator is a pure function from version N to version N+1. The framework handles reading, validation, preserving the original, atomic writes, and conflict detection: if the file changed during migration, the framework abandons the write and reloads.
- **Feature loaders contain no conversion code.** The launch repository delegates its same-file v1 → v2 conversion to the framework and preserves originals in home quarantine, not project backup files.

### Where originals go

The original file is preserved in the home quarantine, keyed by project and path, and not inside the project. A copy in the project would show up in Git status and could be committed by accident.

### Project trust

Project trust is tied to exact file bytes, so a migration write changes what was trusted. **Rule:** if the original bytes were trusted, the migrated bytes are trusted too, because they are a deterministic output of trusted input (this is the same intent as 0002's trust carry-over). An untrusted original stays untrusted. Carry-over only updates an existing approval for the same file and resource kind; no cross-file fan-out or cross-kind derivation exists. A reset never grants trust.

## Fallback and notification for corrupted files

While a file is corrupted or incompatible, the feature keeps working with that resource's safe fallback:

| Resource                                        | Fallback while invalid                                            | Confirmed reset                               |
| ----------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Launch definitions                              | No launches in this project                                       | Empty catalog                                 |
| Permission overlays                             | **Tool execution blocked; model-only replies work** (fail-closed) | Remove the overlay; user-level policy applies |
| Agent settings / conversation defaults (scoped) | Lower-precedence settings apply, and the notice says so           | Remove the override file                      |
| Agent profiles / subagents                      | Invalid entry hidden; it does not fall through to a lower one     | Remove the invalid entry or file              |
| Capabilities (scoped)                           | Lower-precedence settings apply                                   | Remove the override file                      |
| Prompt suggestions                              | Invalid suggestion omitted                                        | Quarantine that suggestion file               |

Collection resources isolate per entry where the format allows it, so one bad profile or suggestion hides only that entry.

Notices use the header activity list. A short toast appears when the set of failing files changes, following the existing [Settings Health watcher](../../../packages/workbench-app/src/lib/app/shell/SettingsHealthWatcher.svelte) pattern. The same notice also appears inline where the resource is used. For example, the Launches tab shows "Launch definitions are invalid" instead of an empty list or an error page. Each notice offers:

- **Open file**, to fix it manually.
- **Reload**, to re-validate after a manual fix.
- **Reset**, which always asks for confirmation first. The confirmation states what will stop being active, for example "All 6 launch definitions in this project will be removed". The original goes to quarantine.

Incompatible (newer-version) files show only **Open file** and **Reload**.

Repair with a validated replacement preview already exists for [scoped agent configuration](../../../packages/workbench-server/src/infrastructure/configuration/agent-configuration/scoped-repair.ts). It can stay as an extra action there but is not required elsewhere.

## Runtime safety net

The same classification applies every time a file is loaded, not only on first migration. A file that is hand-edited into an invalid state after migration becomes corrupted and follows the same fallback, notice, and reset path. Nothing is converted.

User-level settings already follow this model through home Settings Health: invalid document, in-memory defaults, notice, and confirmed reset with quarantine ([`home-configuration.ts`](../../../packages/workbench-server/src/infrastructure/configuration/home-configuration.ts)). Project resources should behave the same way.

**No file watchers.** A file is validated when it is loaded. Cached resources such as the [scoped document store](../../../packages/workbench-server/src/infrastructure/configuration/scoped-store/scoped-document-store.ts) and agent profiles are re-validated on explicit reload, on restart, or when the feature reopens the file. The notice's **Reload** action covers the "I just fixed it" case.

## Known gaps

- **Permission rule-set listing throws.** [`permission-rule-sets.ts`](../../../packages/workbench-server/src/core-host/permission-rule-sets.ts) parses each file directly, so one malformed custom rule set can break the permission settings view and edit paths. The execution-side [scoped permission source](../../../packages/workbench-server/src/core-host/scoped-permission-source.ts) already isolates invalid files, and listing should do the same.
- **Inventory.** Not every loader of files under project `.nerve/` has been reviewed. Each needs a declared type, a version, a chain (possibly empty), and a fallback from the table above.
