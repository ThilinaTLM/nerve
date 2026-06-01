# nerve Storage Model

## Core decision

`nerve` uses a file-first local data directory under the user's home directory.

```txt
${HOME}/.nerve
```

Human-relevant durable data should be stored as readable files. SQLite is used as an index/cache/query accelerator, not as the only source of truth.

```txt
files = canonical durable records and artifacts
SQLite = fast lookup, active state, UI queries, recovery index
```

This follows the spirit of Pi's `~/.pi` layout while giving `nerve` its own namespace.

## Goals

- easy to inspect and debug with normal shell tools
- easy to back up, copy, archive, or delete selectively
- crash-safe append-only logs where possible
- readable session, plan, handover, and process artifacts
- rebuildable indexes if SQLite is lost or corrupted
- secure handling for secrets and API keys

## Proposed directory layout

```txt
~/.nerve/
  config.json
  state.sqlite
  daemon.json

  auth/
    sessions.json
    tokens.json.enc

  keys/
    providers.json
    providers.json.enc

  projects/
    <project-id>/
      project.json

  sessions/
    <session-id>/
      session.json
      entries.jsonl
      harness.jsonl
      events.jsonl
      artifacts/
      summaries/
      attachments/

  agents/
    <agent-id>/
      agent.json
      runs/
        <run-id>/
          run.json
          stdout.log
          stderr.log
          events.jsonl

  workers/
    <worker-id>/
      worker.json

  plans/
    <plan-id>.md
    <plan-id>.json

  handovers/
    <handover-id>.md
    <handover-id>.json

  proc/
    <process-id>/
      process.json
      stdout.log
      stderr.log
      logs.jsonl

Process records include the selected `workerId` when launched through a worker.

  approvals/
    approvals.jsonl

  logs/
    orchestrator.log
```

The exact layout can evolve, but the key principle is stable: durable artifacts are files, and SQLite is not the only copy.

## Data directory resolution

Default:

```txt
~/.nerve
```

Allow override by config/env/CLI later:

```txt
NERVE_HOME=/path/to/data nerve daemon
nerve --data-dir /path/to/data daemon
```

The orchestrator should expose the active data directory through `GET /api/status`.

## Files as source of truth

### Sessions

Sessions should remain readable and append-friendly.

```txt
sessions/<session-id>/
  session.json
  entries.jsonl
  events.jsonl
```

`session.json` stores metadata:

- session id
- project id
- title
- created/updated timestamps
- default mode and permission level
- active agent id / active branch metadata

`entries.jsonl` stores the durable conversation/session tree:

- user messages
- assistant messages
- tool messages
- mode changes
- permission changes
- model changes
- compaction entries
- branch summaries
- sub-agent summary artifacts

Entries have a `kind` field (`message`, `compaction`, `branch_summary`, or `subagent_summary`). Summary/compaction entries are stored as readable system entries with optional metadata such as `summary`, `tokensBefore`, `firstKeptEntryId`, `fromEntryId`, and implementation-specific `details`.

`harness.jsonl` is a compatibility mirror that uses the copied Pi agent harness JSONL session format. Nerve's API reads and writes `entries.jsonl`, while the orchestrator also appends matching message, compaction, and branch-summary records to the mirror so harness context-building helpers can preserve compacted context.

`events.jsonl` stores runtime events associated with the session:

- tool calls
- policy evaluations
- approval requests/results
- child-agent lifecycle
- process events
- artifacts

### Agents

Agents are isolated workers with their own metadata and run history.

```txt
agents/<agent-id>/
  agent.json
  runs/<run-id>/
    run.json
    stdout.log
    stderr.log
    events.jsonl
```

`agent.json` stores stable agent metadata:

- agent id
- session id
- project id
- worker id
- parent agent id
- root agent id
- mode
- permission level
- workspace scope
- child-agent budget (`depth`, `maxDepth`, `maxRuns`, `usedRuns`)
- model config
- status

Each `run.json` stores one process execution attempt. Logs are ordinary files for easy inspection.

### Workers

Workers are durable execution targets. The foundation implementation creates a single `local` worker record and marks it online on daemon startup.

```txt
workers/<worker-id>/worker.json
```

`worker.json` stores:

- worker id
- kind (`local` initially)
- name
- status
- capabilities (`agent`, `process`)
- endpoint metadata such as local daemon PID
- created/updated timestamps

Agent and process records may reference `workerId`. Older records without `workerId` are assigned to the local worker during hydration.

### Projects

Projects are tracked by stable id rather than raw path-derived directory names.

```txt
projects/<project-id>/project.json
```

`project.json` stores:

- project id
- name
- absolute directory path
- created/updated timestamps
- optional default mode/permission overrides
- workspace roots

By default, `nerve` should avoid writing project-local config files. Project-local files such as `.nerve.json` can be added later as explicit opt-in.

### Plans

Planning mode may write only to the plan sandbox when policy allows.

```txt
plans/<plan-id>.md
plans/<plan-id>.json
```

Markdown is the human-readable plan. JSON stores metadata:

- plan id
- originating session/agent
- project id
- title
- status
- created/updated timestamps

### Handovers

Handovers are durable context transfer artifacts.

```txt
handovers/<handover-id>.md
handovers/<handover-id>.json
```

They can be used to resume work, brief another agent, or archive a session state.

### Processes

Long-running processes have file-backed logs.

```txt
proc/<process-id>/
  process.json
  stdout.log
  stderr.log
  logs.jsonl
```

`process.json` stores process identity, owner refs, cwd, command, status, readiness detection/outcome, timestamps, exit metadata, and log file paths. Raw stdout/stderr logs live in ordinary files. `logs.jsonl` stores structured log events with sequence numbers, stream, derived level, and line text so recent/error/warning/cursor/first-failure queries can be rebuilt from files. SQLite may index process status and summarized incidents, but should not be the only place logs exist.

### Approvals

Approval decisions should be append-only and auditable.

```txt
approvals/approvals.jsonl
```

Each line records:

- approval id
- agent id
- tool call id
- requested action
- decision
- timestamp
- optional user message

## SQLite responsibilities

SQLite should store indexes and active-state snapshots for fast UI/API queries.

Initial implemented tables:

- `projects`
- `sessions`
- `agents`
- `events_index`
- `tool_calls`
- `approvals`
- `processes`

Future tables:

- `agent_runs`
- `artifacts`
- `settings_index`

SQLite is useful for:

- list recent sessions quickly
- find active agents
- find pending approvals
- query process status
- search/filter events by type and timestamp
- recover daemon state quickly after restart

SQLite should be rebuildable from files as much as practical.

## Secrets and API keys

Secrets must not be stored as plaintext JSON.

Preferred order:

1. OS keychain
   - macOS Keychain
   - Windows Credential Manager
   - Linux Secret Service/libsecret
2. encrypted file fallback
   - `~/.nerve/keys/providers.json.enc`

Readable metadata is okay:

```txt
keys/providers.json
```

Example metadata:

```json
{
  "anthropic": {
    "configured": true,
    "source": "keychain",
    "lastValidatedAt": "2026-06-01T00:00:00.000Z"
  }
}
```

The metadata file must not contain raw secrets.

## Local auth sessions

The local orchestrator should require a client token even on localhost.

Long-term suggested files:

```txt
auth/sessions.json
auth/tokens.json.enc
```

Foundation phase shortcut:

```txt
auth/local-token
```

The foundation token file may store a generated bearer token with user-only file permissions. This keeps CLI/Web UI integration simple while avoiding an unauthenticated local API. Later phases should move token storage to keychain or encrypted files.

Local CLI and Web UI clients receive/use a generated token. Remote binding must be explicit and should require stronger auth.

## Config and settings

Global readable config:

```txt
config.json
```

Example:

```json
{
  "defaultMode": "planning",
  "defaultPermissionLevel": "supervised",
  "defaultSubagentMode": "planning",
  "defaultSubagentPermissionLevel": "read_only",
  "server": {
    "host": "127.0.0.1",
    "port": 0
  },
  "ui": {
    "theme": "system"
  }
}
```

Settings that contain secrets should reference keychain/encrypted secret ids rather than embedding values.

## Write safety

Use crash-safe write patterns:

- append JSONL for event/session logs
- atomic JSON writes via temp file + rename
- fsync important files/directories where practical
- never partially overwrite critical state
- tolerate and report corrupt JSONL lines without losing the whole file

## Rebuild behavior

If `state.sqlite` is missing or invalid, the orchestrator should be able to rebuild indexes from:

- `projects/*/project.json`
- `sessions/*/session.json`
- `sessions/*/entries.jsonl`
- `sessions/*/events.jsonl`
- `agents/*/agent.json`
- `proc/*/process.json`
- `approvals/approvals.jsonl`

Full rebuild can be slower; normal startup can use SQLite for speed.
