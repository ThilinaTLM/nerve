# Storage and evidence setup

Use this first for every persistence investigation. Default to `data/storage-1/` relative to the repository root. For production investigations, use `~/.nerve` unless an explicit production home is provided. Confirm the affected daemon endpoint, its actual `NERVE_HOME`, conversation ID, and incident UTC window before querying. Your shell environment is not proof of the daemon's configuration; do not silently fall back to another home if the expected database is missing.

## Open the right database

Run from the repository root after confirming the target home; replace the default if the daemon uses a different home. For production, set `NERVE_HOME="$HOME/.nerve"` instead (or the confirmed production path). Do not print credentials while checking configuration.

```bash
NERVE_HOME="$(pwd)/data/storage-1"
DB="$NERVE_HOME/data/nerve.sqlite"
test -f "$DB" || { printf 'Expected database missing: %s\n' "$DB" >&2; exit 1; }
sqlite3 -readonly "$DB" '.tables'
```

Key locations:

- `data/nerve.sqlite`: canonical database, including lifecycle authority and transcript records.
- `data/nerve.sqlite-wal` and `-shm`: SQLite handles these automatically. Do not copy just the main database during active WAL writes or use `immutable=1` against a live database.
- `cache/query-cache.sqlite`: rebuildable read model, not lifecycle authority.
- `logs/application-YYYY-MM-DD.jsonl`: structured daemon logs.
- `data/conversations/`, `data/tasks/`, `data/plans/`, `data/reports/`, `data/images/`: retained artifacts. Resolve ownership through `file_assets`; do not guess storage IDs from public IDs.
- `data/state.sqlite` or `state.sqlite`, if present: do not assume legacy/empty files are authoritative.

Create a private, unique forensic snapshot using SQLite backup:

```bash
DEBUG_DIR="$(mktemp -d /tmp/nerve-debug.XXXXXX)"
chmod 700 "$DEBUG_DIR"
sqlite3 -readonly "$DB" ".backup '$DEBUG_DIR/nerve.sqlite'"
DB="$DEBUG_DIR/nerve.sqlite"
printf 'Snapshot ready at %s; observed UTC: ' "$DB"
date -u +%Y-%m-%dT%H:%M:%SZ
sqlite3 -readonly "$DB"
```

The backup is for inspection, **not a complete runnable Nerve home**. Reproduction may require selected artifacts/configuration and proper home initialization. Keep the evidence backup separate from a writable reproduction copy; do not blindly copy secrets or enable real integrations. Report the temporary location and remove sensitive copies when no longer needed.

## Discover schema before querying

```sql
.tables
.schema conversation_records
.schema domain_documents
SELECT version, name, checksum, applied_at_ms,
       datetime(applied_at_ms / 1000, 'unixepoch') AS applied_utc
FROM schema_migrations ORDER BY version;
```

Run `.schema TABLE_NAME` for each table in the chosen guide. Missing newer tables may indicate an older home: do not migrate evidence to make queries work. Canonical JSON is a UTF-8 BLOB; these guides cast it to TEXT for SQLite JSON-function portability. Inspect `json_valid`, `json_type`, or top-level keys before extracting unfamiliar envelopes.

## Bind the investigation

In the SQLite CLI, set parameters once:

```sql
.parameter init
.parameter set :conversation_id conv_REPLACE_ME
.parameter set :run_id run_REPLACE_ME
.parameter set :agent_id agent_REPLACE_ME
.parameter set :project_id proj_REPLACE_ME
.parameter set :tool_call_id tool_REPLACE_ME
.parameter set :task_id task_REPLACE_ME
.parameter set :scope_id scope_REPLACE_ME
.parameter set :request_id request_REPLACE_ME
.parameter set :row_start 0
.parameter set :row_end 0
.parameter set :observed_at_ms 0
.parameter list
.headers on
.mode column
```

Replace every parameter used by your chosen query; an unbound parameter evaluates to NULL and can silently hide evidence. Set `:observed_at_ms` to the incident/snapshot time in Unix milliseconds (not the later inspection time for an old backup). For event windows, first find relevant row IDs, then set `:row_start` and `:row_end`; the initial zero window intentionally returns no events.

## Identify the entities

```sql
SELECT namespace, scope_id, document_id, revision,
       json_extract(CAST(data AS TEXT), '$.id') AS id,
       json_extract(CAST(data AS TEXT), '$.projectId') AS project_id,
       json_extract(CAST(data AS TEXT), '$.conversationId') AS conversation_id,
       json_extract(CAST(data AS TEXT), '$.status') AS status,
       datetime(updated_at_ms / 1000, 'unixepoch') AS updated_utc
FROM domain_documents
WHERE document_id IN (:conversation_id, :agent_id)
   OR json_extract(CAST(data AS TEXT), '$.conversationId') = :conversation_id
ORDER BY updated_at_ms DESC
LIMIT 50;
```

First list namespaces if the entity type is unknown:

```sql
SELECT namespace, count(*) AS documents,
       datetime(max(updated_at_ms) / 1000, 'unixepoch') AS latest_utc
FROM domain_documents
GROUP BY namespace
ORDER BY namespace;
```

## Read the latest timeline

```sql
SELECT sequence, id, kind, status, revision, agent_id, run_id, parent_id,
       datetime(created_at_ms / 1000, 'unixepoch') AS created_utc,
       datetime(updated_at_ms / 1000, 'unixepoch') AS updated_utc
FROM conversation_records
WHERE conversation_id = :conversation_id
ORDER BY sequence DESC
LIMIT 50;
```

For a smaller timeline view (results are newest first):

```sql
SELECT sequence, id, kind, status, revision, run_id,
       datetime(updated_at_ms / 1000, 'unixepoch') AS updated_utc
FROM conversation_records
WHERE conversation_id = :conversation_id
ORDER BY sequence DESC
LIMIT 50;
```

## Evidence authority

- Lifecycle records/work/attempts/interactions explain execution decisions and recovery.
- Conversation records explain ordered transcript/runtime history; they are not the sole lifecycle authority.
- Projections, entity documents, query cache and daemon/client state describe different layers. Revisions from independent aggregates are not interchangeable.
- Durable events corroborate persistence order; artifacts corroborate retained outcomes. Missing retained evidence does not prove an external action never happened.

For invariant comparisons use one snapshot, or a short `BEGIN`/`COMMIT` read transaction in one read-only connection. Do not hold live WAL read transactions open. Files/logs are not transactionally snapshotted with SQLite. Record raw millisecond times as well as UTC and event order.

## Correlate logs without exposing payloads

```bash
rg -l -F -e 'conv_REPLACE_ME' -e 'run_REPLACE_ME' "$NERVE_HOME/logs" -g '*.jsonl'
```

This prints filenames only. Parse selected JSONL files locally, filter a narrow incident window and stable IDs, and emit a bounded number of verified metadata fields. The current timestamp field is `ts`; verify shape in `packages/workbench-server/src/infrastructure/diagnostics/logging.ts`. Logging can be disabled, level-filtered, or expired (default retention: 14 days). Missing logs alone do not prove a transition did not occur. Messages and nested errors may contain secrets; review/redact before sharing.

## Next step and source checks

Open the symptom guide linked from [SKILL.md](../SKILL.md). If identity or schema is uncertain, stop and request the confirmed target rather than guessing.

Verify schema in `packages/workbench-server/src/infrastructure/persistence/canonical-sqlite/schema.ts`, envelopes in `payload-codecs.ts` in that directory, and paths in `packages/workbench-server/src/infrastructure/storage-bootstrap/paths.ts`. Installed migrations take precedence over checkout assumptions.
