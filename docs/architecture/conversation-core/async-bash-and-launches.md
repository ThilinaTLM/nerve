# Async bash and launches

Part of the [conversation core redesign](README.md).

> **Status:** Current implementation. Tool catalog, core handlers and workbench launch adapters are authoritative.

## Goals

- Agents never block on a shell command for longer than a user-controlled limit.
- One small, token-efficient tool set: `bash`, `async_bash`, `launch`.
- Agents can see, start, restart and stop the user's launches, but never create or edit launch definitions.
- Large output never floods the context: it is summarized, and the full output's file path is given for `read`/`grep`.
- One term, **launch**, for user-defined run configurations everywhere: code, contracts, RPC, events, IDs, UI text, file paths and stored data. No compatibility mappings; old data is converted by the migration.

## Non-goals

- Agents creating, editing or deleting launch definitions.
- A wait/poll tool. Completion notices wake the agent.
- Restart recovery of processes after a daemon restart (async bash still becomes `lost`; launches are still memory-only).
- Database schema changes.
- Changes to `python_exec`, sub-agent or todo tools. Their "task" wording is a different concept and is not renamed.

## Ownership

|             | Async bash                                          | Launch                                                                                      |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Started by  | The agent (`bash`), in the foreground or background | The user (UI) or the agent (`launch start`)                                                 |
| Defined by  | The tool call                                       | The user, in `.nerve/launches/definitions.json`                                             |
| Layer       | Conversation core                                   | Workbench                                                                                   |
| Run storage | `ASYNC_BASH` row                                    | Memory only                                                                                 |
| Output      | `ASSET` rows owned by the conversation              | Log files under `data/launches/<launchId>/`                                                 |
| Completion  | Queued `async_bash_event` notice                    | Workbench notice to the UI; a queued notice to the conversation that started it (see below) |

The [launch definitions architecture](../launch-definitions.md) owns the project catalog schema, folder hierarchy, ordering, management operations, and conversion rules. Folder organization does not change the execution and tool-selection boundaries described here.

Conversation core does not depend on launches. The `launch` tool is a host tool executed by workbench-server through the existing `ToolHostPort`; core never imports workbench code.

## Tools

Tool definitions live in the `packages/tools` catalog. Descriptions below are the exact agent-facing text. Do not add parameters, actions or prose.

### `bash`

The schema and description are built per turn from the bash settings.

| Setting                      | Default  | Bounds    |
| ---------------------------- | -------- | --------- |
| `bash.autoPromotion.enabled` | `true`   |           |
| `bash.autoPromotion.afterMs` | `120000` | existing  |
| `bash.maxTimeoutMs`          | `900000` | 1 s – 1 h |

| Promotion | Foreground call                                                                                      | `background: true` |
| --------- | ---------------------------------------------------------------------------------------------------- | ------------------ |
| Enabled   | No `timeout` parameter. Still running after `afterMs` → becomes async bash.                          | Returns at once    |
| Disabled  | `timeout` (seconds) is **required**, 1 – `maxTimeoutMs`. The process tree is killed when it expires. | Returns at once    |

Background runs (explicit or promoted) have no time limit. They end on exit, `async_bash stop`, conversation stop/delete, or daemon shutdown. Async Bash settlement commits terminal state and its queued completion notice together; pause may defer delivery.

Parameters:

- `command` (string, required)
- `cwd` (string): project-relative or absolute; must resolve inside the project.
- `background` (boolean)
- `ready` (string, only with `background`): an `http(s)://` URL to poll until it responds, otherwise a regex matched against stdout and stderr. Waits at most 60 s; a readiness timeout does not stop the process.
- `timeout` (integer seconds): present only when promotion is disabled.

Description (promotion enabled):

```text
Run a shell command. Moves to background after {afterS}s if still running; background:true returns at once. Background runs notify you on exit; don't poll. Large output is summarized with file paths for read/grep. Use launch for the user's dev servers.
```

Promotion disabled: the second sentence becomes `Requires timeout (max {maxS}s); the process is killed when it expires. background:true returns at once.`

Results:

- Foreground completion: output through the [output projection](#output-projection).
- Promotion: `Still running; continues as async bash {id}. You will be notified on exit.` followed by the projected output so far.
- Background start: `Started async bash {id}.` plus `Ready: {url}` / `Ready: matched` / `Not ready after 60s` / `Exited: {status}` when `ready` was given.

`env` is not a parameter; use `FOO=1 cmd`.

### `async_bash`

| Action | Arguments                 | Risk    |
| ------ | ------------------------- | ------- |
| `list` | `all?`                    | read    |
| `logs` | `id`, `offset?`, `limit?` | read    |
| `stop` | `id`                      | command |

Risk is classified per action (`classifyRisk`), so reads never ask for approval.

```text
Manage your background bash runs. list: running runs (all:true includes finished). logs: output lines from offset (default: last lines). stop: kill the process tree.
```

`list` result, one line per run: `{id} {status}[ exit {code}] {duration} {command, max 80 chars}`. Empty: `No running async bash.`

### `launch`

| Action    | Arguments                             | Risk    |
| --------- | ------------------------------------- | ------- |
| `status`  | —                                     | read    |
| `logs`    | `name`, `runId?`, `offset?`, `limit?` | read    |
| `start`   | `name`                                | command |
| `restart` | `name`, `runId?`                      | command |
| `stop`    | `name`, `runId?`                      | command |

`name` is the trimmed saved label, falling back to the trimmed command when the label is absent or blank. Selector whitespace is trimmed; matching is exact, case-sensitive, and project-local. Definition IDs remain internal to storage and RPCs, not tool arguments or output. Historical ID-based tool calls remain readable in transcripts, but `id` is not accepted for new executions. No storage or schema migration is needed for name-first selection.

For `logs`/`stop`/`restart`, optional `runId` selects a specific execution belonging to the supplied name. Without it, the existing latest-run selection applies. `start` does not accept `runId`. Permission matching binds action and name, plus run ID when supplied; old ID-bound grants do not match new name-based calls.

The tool lists names and commands, starts by name, and reads logs, stops, or restarts by name with an optional execution selector. Agents cannot create or edit definitions.

Behavior:

- `status` lists each definition's quoted name, current command, status, readiness/port/exit details, and available run IDs, then ad-hoc launches. Each retained run gets a status line so concurrent and historical run IDs are discoverable. Never-run definitions show `idle`. If a run executed a different command, show that run command separately from the current definition command. Definition IDs are never listed.
- Resolve saved definitions by name first; only when none matches, resolve ad-hoc launches by display name, then run name, falling back to command. Multiple runs of one definition are not ambiguous. Distinct definitions or ad-hoc lineages sharing a name fail with commands and guidance to rename or, for ad-hoc runs where applicable, supply `runId`. A run ID never disambiguates duplicate saved definitions.
- Reject a run ID belonging to another name or project. After a name edit, agents must refresh status to discover the new selector.
- `start` honors the run policy: for `single`, an active launch is reported instead of starting another. Start, already-running, stop, and nothing-running responses, log headers, and exit notices identify the quoted name and command; run IDs are secondary diagnostics.

Example calls (name and execution identity are separate):

```ts
launch({ action: "status" });
launch({ action: "start", name: "Web dev" }); // saved command: pnpm dev
launch({ action: "logs", name: "Web dev", runId: "launch_…", limit: 100 });
launch({ action: "restart", name: "Web dev" }); // latest run, current command
launch({ action: "stop", name: "pnpm preview", runId: "launch_…" }); // unnamed definition
```

Additional behavior:

- A port conflict is reported with the listener's PID and process name. The agent never terminates foreign listeners; only the user can, from the UI.
- If the definition has a port, `start`/`restart` wait up to 30 s for it to listen and report `Ready :{port}` or `Not listening after 30s`.
- `restart` stops the launch and starts the **current** definition. With nothing running it starts.
- While the daemon retains the in-memory starting-conversation ownership, a launch started by the agent that exits on its own queues a notice (status, exit code, projected tail). Launch instances and ownership are not durable across restart; this is not a guaranteed post-shutdown notification.
- Agents cannot create or edit definitions: there is no action for it, and the default permission rule set asks before writes to `.nerve/launches/**`.

### Prompt guidance

The only guideline for these tools: `Check launch status before starting a server; prefer launch definitions over bash for servers.`

## Output projection

One function in `packages/tools` result projection projects process output for every path: foreground `bash`, promotion, async bash completion notices, `async_bash logs`, `launch logs`, and launch exit notices. It reuses the existing `process_diagnostics` profile, candidates and strategies; it is not a second projector. Budgets stay code constants.

- Within the inline budget (84 lines, 12 KB): the output as is. **No file path.**
- Larger: the overflow budget (16 lines, 4 KB): status and line counts, head and tail lines, and diagnostic lines (errors, failures, exceptions, tracebacks) selected from the **whole** file, then the output file path(s) and `Use read/grep for details.`
- When capture itself was truncated (16 MiB), say so.

Log pages (`logs` actions): `offset` is a 0-based line index; omitted means the last `limit` lines. `limit` defaults to 100, max 500. The page is capped at the inline budget (lines over 2,000 chars are cut). Result:

```text
Lines {from}-{to} of {total} ({running|status}).
{lines}
Next offset: {n}        (only if more lines exist)
File: {path}            (only if the page did not cover the whole output)
```

Async bash pages read a combined `output.txt` (stdout and stderr interleaved in arrival order) written by the host next to `stdout.txt` and `stderr.txt`. Launch pages read the existing launch log files.

The foreground `bash` host path supplies captured output and file references to the shared projector so diagnostics and paths use the same policy as background output.

## Naming

Rename rule for the user-defined run feature: `Task` → `Launch`, `task` → `launch`, `TaskDefinition` → `LaunchDefinition`, `tasks` → `launches`.

| Before                                                                                                               | After                                                                            |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `contracts/src/domains/tasks`, `…/task-definitions`                                                                  | `…/launches`, `…/launch-definitions` (package export paths too)                  |
| `workbench-server/src/domains/tasks`, `…/task-definitions`                                                           | `…/launches`, `…/launch-definitions`                                             |
| `workbench-app/src/lib/features/tasks`                                                                               | `…/features/launches`                                                            |
| `TaskService` + current `LaunchService`                                                                              | one `LaunchService`                                                              |
| `TaskRecord`, `TaskSupervisor`, `TaskLogService`, …                                                                  | `LaunchRecord`, `LaunchSupervisor`, `LaunchLogService`, …                        |
| RPC/events `taskDefinition.*`                                                                                        | `launchDefinition.*`                                                             |
| `launch.*` payload fields `taskId`, `task`, `tasks`                                                                  | `launchId`, `launch`, `launches`                                                 |
| Internal `task.*` events and the `task.*`→`launch.*` mapping                                                         | removed; publish `launch.*` directly                                             |
| IDs `task_`, `taskdef_`, `taskgrp_`                                                                                  | `launch_`, `launchdef_`, `launchgrp_`                                            |
| `sourceTaskId`, `restartedFromTaskId`, `restartRootTaskId`                                                           | `sourceLaunchId`, `restartedFromLaunchId`, `restartRootLaunchId`                 |
| `.nerve/tasks/definitions.json`                                                                                      | `.nerve/launches/definitions.json`                                               |
| `data/launches/task_*`                                                                                               | `data/launches/launch_*`                                                         |
| `data/tasks` path and its storage-usage entry                                                                        | removed                                                                          |
| UI "Tasks" panel, mobile section, tour copy, aria labels, DOM IDs                                                    | "Launches"                                                                       |
| Agent tools `task_start/status/logs/control`, `packages/tools` task runtime, `task.tools.ts`, group `taskManagement` | `bash` (`background`), `async_bash`, `launch`; group `process`; old code removed |

## Migration

All data changes since the latest release (root `package.json` version) extend the single unreleased step `0001-conversation-core`.

- **Transcripts:** rewrite the assistant `toolCall` content, the `tool_call_response` event and the full `result.json` asset (digest and length) together:

  | Old                                            | New                                                                                                                        |
  | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | `task_start` linked to async bash              | `bash` with `background: true`                                                                                             |
  | `task_status`                                  | `async_bash` `list`                                                                                                        |
  | `task_logs`                                    | `async_bash` `logs` (captured output kept, no offset)                                                                      |
  | `task_control` `stop`                          | `async_bash` `stop`                                                                                                        |
  | Anything else (restart, names, modes, cursors) | generic historical call: original name, arguments and result in generic `content`/`details`, rendered by `GenericToolView` |

  Old pending calls are never resumed. `bash` calls lose `timeout` where promotion applied.

- **Permission rules** (user, project, conversation, custom rule sets): `task_*` names → `bash`/`async_bash`; group `taskManagement` → `process`. Never grant new permissions.
- **Settings:** add `bash.maxTimeoutMs` with its default.
- **Launch logs:** rename `data/launches/task_*` directories.
- **Known projects:** move `.nerve/tasks/definitions.json` to `.nerve/launches/definitions.json`, rewriting `taskdef_` IDs. Projects unknown to the home get the same one-time migration when first opened. If both files exist, keep `.nerve/launches`, leave the old file and report a diagnostic; never overwrite.
- **Browser storage:** one-time rewrite of `"tasks"` dock/view IDs and `"task"` tab kinds, IDs and MRU keys, then bump the storage key versions.

Test on a copied slot (`pnpm storage:copy --slot N`), covering pre- and post-redesign transcripts, the generic fallback, call/response pairing, permission rules and rerun after a crash.

## Process host

One workbench-server module owns process mechanics for both systems: shell resolution, native managed spawn, capture to stdout/stderr/combined files under the 16 MiB cap, readiness (URL polling, regex on both streams), port inspection and process-tree termination (SIGTERM, grace period, SIGKILL). The core-host process adapter and the launch supervisor use it; ownership, events and notices stay in their own layers.
