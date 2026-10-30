# Lazy project configuration migration

`ProjectMigrationService` classifies **one file**, runs its pure N → N+1 version chain, validates, quarantines the original and atomically replaces **that same file**. Feature loaders invoke it on demand. It never enumerates projects, reads a home migration staging source, watches files or imports another project file.

## Descriptors

Register types and their existing trust kinds in `descriptors.ts`. A descriptor declares its relative `.nerve` path, version field and absent-field default, current version/schema, frozen migrators, UI label/reset description, fresh fallback and confirmed-reset replacement (`null` removes an override). Markdown types may provide `decode`/`encode`; the framework owns IO.

The supported bumps are launch definitions v1 → v2, permission overlay v1 → v2, capabilities v2 → v3, integrations v1 → v2, subagent catalog v1 → v2, individual profile v1 → v2, and prompt suggestion v1/unversioned → v2. Agent settings and conversation defaults have current-schema validation but no import chain.

There are no composite inputs, prerequisites, alternate/ordered sources, home staging, catalog-to-profile expansion, cross-file trust derivation or reset-suppression receipts.

## Writes and trust

Before a same-file bump the service acquires a persistent `.lock`, preserves and syncs exact source bytes in:

```
<home>/quarantine/project-configuration/<sha256(projectId)>/<sha256(absolute path)>/<sha256(original bytes)>.original
```

It rechecks the source before atomic mode-0600 replacement. Concurrent edits abandon the candidate and reload with bounded retries. Locks are never stolen by age/PID; cleanup checks inode identity. Noncooperating external writers cannot be made transactional by a rename.

`projectMigrationTrust` carries over only an existing approval of the exact original bytes, at the same path and resource kind. It rechecks the approval and output bytes. It never creates approvals or derives approval for another file. Reset/removal revokes current-file approval and never grants trust.

`transact` is the feature-write entrypoint. It validates under the same lock, detects concurrent changes and rejects corrupted/incompatible resources before invoking the mutation callback. Fallbacks never overwrite originals. Confirmed reset alone may replace corrupted bytes; newer-version files are read-only. Explicit validated repair also checks the expected source digest.

## Health and recovery

Contracts live in `@nervekit/contracts/projects`. Issues carry absolute paths, labels, descriptions and classifications:

- `migrated`: informational until explicit reload.
- `corrupted`: safe resource fallback; manual fix/reload or confirmed reset.
- `incompatible`: safe fallback; open/reload/upgrade, never reset.
- `legacy`: one aggregate project notice listing known old filenames, separate from current-file failures.

Invalid UTF-8 and escaping/dangling configuration links are never silently repaired. Resource-specific fallback descriptions explain lower-precedence settings or tool-only permission blocking.

Types may declare `legacyFiles` (exact relative names or a filename wildcard such as `subagents/*.md`). A feature load discovers these in that project only. **Nothing is decoded or converted.** One header activity item says “Project settings from an older Nerve weren't imported; configure them again.” It lists the files and offers **Open folder**, **Reload**, and confirmed **Remove old files**. Removal preserves all originals in home quarantine before deleting them, without touching current settings or granting trust. Link/path confinement and byte checks apply. No dismissal state is stored: absent files mean no notice, including after restart; newly added old files are noticed again.

Operations are `project.configuration.health` and `project.configuration.resolve` with `reload`, confirmed `reset`, or confirmed `remove-legacy` (`type: "legacy-files"`). Both HTTP `/api/protocol/v1` and WebSocket dispatch use the same handlers. The health event publishes the complete project health. `onResolved` refreshes loaded domain generations; `onHealthChanged` invalidates permission caches. There are no filesystem watchers.

## Home boundary

0001 and 0002 never open project files. 0001 no longer stages DB-only legacy task definitions in the home; those definitions are not carried over. Old project `tasks/definitions.json`, `config/harness.json` and `subagents/*.md` generate notices, not imports. Same-file chains use domain-local frozen source shapes, never migration-step imports.

See [the domain chains](../agent-configuration/project-chains/README.md) for paths, fallbacks and trust kinds.
