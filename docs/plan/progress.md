# nerve Implementation Progress

This file tracks implementation progress at a high level. Detailed requirements and technical decisions live in `docs/prd/`.

## Current phase

```txt
Phase 8: Compaction and branch summaries — complete
```

## Locked foundation decisions

- Node.js 22+ required.
- Strict ESM across all packages.
- pnpm workspace monorepo.
- Plain Svelte 5 + Vite SPA for Web UI.
- Hono orchestrator with HTTP JSON + WebSocket events.
- File-first storage under `~/.nerve`.
- SQLite is a rebuildable index/cache, not the canonical store.
- Durable entity ids use prefixed ULIDs.
- Initial local daemon auth may use a generated local bearer token file with user-only permissions.

## Phase checklist

### Phase 1: Foundation

- [x] Create pnpm workspace package structure.
- [x] Add TypeScript, strict ESM configuration, Biome, and `svelte-check`.
- [x] Create `packages/shared` with base schemas/types.
- [x] Create `packages/orchestrator` with Hono server.
- [x] Create `packages/cli` with `nerve` command.
- [x] Create `packages/web` as plain Svelte 5 + Vite SPA.
- [x] Initialize `~/.nerve` layout.
- [x] Implement daemon discovery via `~/.nerve/daemon.json`.
- [x] Implement local token auth for CLI/Web UI.
- [x] Implement `GET /api/status`.
- [x] Implement `WS /ws` with event envelope.
- [x] Serve Web UI static build from orchestrator.

### Phase 2: Minimal agent run

- [x] Copy/adapt the full Pi `packages/agent` harness.
- [x] Add npm dependency on `@earendil-works/pi-ai`.
- [x] Create a minimal agent runtime path that streams through `@earendil-works/pi-ai`.
- [x] Move agent execution behind an isolated process launcher.
- [x] Implement initial project/session/agent endpoints:
  - `POST /api/projects`
  - `GET /api/projects`
  - `POST /api/sessions`
  - `GET /api/sessions`
  - `GET /api/sessions/:sessionId/messages`
  - `POST /api/agents`
  - `GET /api/agents`
  - `POST /api/agents/:id/prompt`
  - `POST /api/agents/:id/abort`
  - `GET /api/models`
- [x] Broadcast prompt, status, delta, completion, and error events over WebSocket.
- [x] Add a minimal Svelte prompt UI with live streaming response text.
- [x] Add CLI shortcut `nerve run [dir] [prompt...]`.
- [x] Add initial CodeMirror composer.
- [x] Render completed assistant messages through the sanitized markdown pipeline.

### Phase 3: Durable file-first state and event replay

- [x] Add storage service rooted at `~/.nerve` or `NERVE_HOME`.
- [x] Add crash-safe write helpers for append JSONL and atomic JSON writes.
- [x] Add SQLite orchestrator index store.
- [x] Persist canonical project, session, session-entry, and agent files.
- [x] Index canonical state in SQLite.
- [x] Add startup hydration from file-first records.
- [x] Add listing/opening endpoints for projects, sessions, and agents.
- [x] Add event replay from persisted `logs/events.jsonl` through HTTP and WebSocket.
- [x] Persist session-associated events to `sessions/<session-id>/events.jsonl`.
- [x] Add initial session tree endpoint and branch navigation endpoint.
- [x] Add a rebuild path from files to SQLite indexes.
- [x] Enable JSONL session storage from the copied agent harness.
- [x] Surface previous sessions/branch navigation in the UI.

### Latest implementation notes

- Added `pnpm-workspace.yaml`, root TypeScript references, Biome config, package scripts, and lockfile.
- Added placeholder `tools` package so the monorepo layout is ready for Phase 5+.
- Orchestrator creates the base file-first data layout, generated local token, `config.json`, `state.sqlite`, `daemon.json`, HTTP APIs, replayable in-memory event buffer, and append-only `logs/events.jsonl`.
- Project, session, agent, and session-entry records are now written under `~/.nerve/projects`, `~/.nerve/sessions`, and `~/.nerve/agents` as readable files.
- CLI supports `nerve daemon`, `nerve status`, `nerve ui [--open]`, and `nerve run [dir] [prompt...]`.
- Web UI can create a minimal project/session/agent and stream a faux-model assistant response over `/ws`.
- Agent prompts now run in an isolated `@nerve/agent/worker` child process over an NDJSON stdio protocol; the orchestrator supervises the run, streams deltas, and sends abort requests across the process boundary.
- Web UI prompt input now uses a CodeMirror Markdown composer with keyboard submit, and completed assistant messages render through a sanitized unified/remark/rehype markdown pipeline.
- Copied/adapted Pi `packages/agent` harness core into `@nerve/agent`, including agent loop, harness, session repositories, compaction helpers, skills, proxy utilities, and Node execution environment. The existing Nerve worker runtime remains exported through `runtime.ts` for the current isolated prompt path.
- Orchestrator startup now hydrates projects, sessions, agents, entries, reconstructed conversations, and the event sequence from file-first storage.
- `GET /api/events` and `WS /ws?since=` now replay persisted events rather than only the current process buffer.
- Added opening endpoints (`GET /api/projects/:projectId`, `GET /api/sessions/:sessionId`, `GET /api/agents/:agentId`) plus initial `GET /api/sessions/:sessionId/tree` and `POST /api/sessions/:sessionId/navigate` support.
- Session entries now include parent links and sessions track `activeEntryId`, enabling append-only branch metadata for later UI branch navigation.
- Added a `node:sqlite`-backed `IndexStore` for projects, sessions, agents, process placeholders, and event indexes. Startup and `POST /api/storage/rebuild-index` rebuild SQLite from canonical files.
- Added harness-compatible `sessions/<session-id>/harness.jsonl` mirrors using the copied `JsonlSessionStorage`, while keeping Nerve's readable `entries.jsonl` as the current API source.
- Web UI now lists durable sessions, can reopen prior session messages, and exposes basic branch navigation over the session tree endpoint.

### Phase 4: Web UI foundation

- [x] Add CSS variable design tokens and light/dark themes.
- [x] Configure TailwindCSS to consume design tokens.
- [x] Add Nerve-owned UI abstractions for buttons, inputs, cards, badges, and a Bits UI primitive façade for dialog, dropdown menu, popover, tooltip, tabs, select, checkbox, and switch.
- [x] Add Paneforge-based resizable application shell with sidebar, conversation area, and inspector panel.
- [x] Add TanStack Svelte Query client and API helpers.
- [x] Add Svelte rune state modules for selection, layout, event buffers, composer draft, and theme.
- [x] Add sanitized markdown renderer with Shiki code highlighting.
- [x] Add CodeMirror composer wrapper with slash-command and file mention completions.
- [x] Add initial completion endpoints/client hooks for slash commands and project file/folder suggestions.

### Latest Phase 4 notes

- Rebuilt the web app around a resizable Nerve Workbench shell with durable session navigation, a conversation pane, and an inspector with session, branch, and event tabs.
- Added dark/light/system theme state backed by CSS variable design tokens.
- Added reusable Nerve UI components and a Bits UI primitive façade for the required accessible primitives.
- Added TanStack Query wiring, API helper modules, and Svelte rune state modules to separate UI state from orchestration calls.
- Upgraded the composer with CodeMirror autocompletion for `/` slash commands and `@` project file/folder mentions.
- Added orchestrator completion endpoints: `GET /api/completions/slash` and `GET /api/completions/files`.
- Added Shiki-powered highlighted code blocks to the sanitized markdown renderer.
- Tested the UI in Chrome via `agent-browser` against the local orchestrator.

### Phase 5: Tool layer + policy engine

- [x] Implement/adapt tools for read, write, edit, bash, list, and search.
- [x] Classify tools by risk, including read-only shell command detection and destructive shell pattern detection.
- [x] Enforce permission levels: autonomous, supervised, and read_only.
- [x] Enforce primary modes: planning and coding.
- [x] Add plan sandbox writes under `~/.nerve/plans/`.
- [x] Add an encrypted-file secret provider abstraction under `~/.nerve/keys/`.
- [x] Enforce workspace root boundaries for filesystem and shell tools.
- [x] Add approval queue for supervised and destructive actions.
- [x] Persist approval audit trail to `~/.nerve/approvals/approvals.jsonl`.
- [x] Add UI approval prompts in the inspector.
- [x] Add durable events for policy evaluation, approval lifecycle, and tool call lifecycle.

### Latest Phase 5 notes

- Added shared tool-call and approval schemas and durable `tool_` / `approval_` ids.
- Expanded `@nerve/tools` from placeholders into executable local tools with bounded filesystem, search, edit, and shell behavior.
- Added an orchestrator policy layer that combines mode, permission level, tool risk, workspace scope, plan sandbox boundaries, and shell command classification.
- Added orchestrator endpoints for listing tools, listing tool calls, requesting agent tool execution, and granting/denying approvals.
- Tool calls now emit `agent.tool_call.*` events; policy checks emit `policy.evaluated`; approvals emit `approval.requested`, `approval.granted`, and `approval.denied`.
- The web inspector now surfaces pending approvals with approve/deny actions and refreshes on tool/approval events.

### Phase 6: Background process manager

- [x] Implement process supervisor in orchestrator.
- [x] Store process state and logs under `~/.nerve/proc/<process-id>/`.
- [x] Add process store with id/name, owner refs, cwd, command, status, timestamps, exit metadata, and log paths.
- [x] Capture stdout/stderr incrementally into append-only stdout/stderr files and structured JSONL log events.
- [x] Add readiness detection by URL, regex pattern, and timeout outcome.
- [x] Add log querying modes for recent, errors, warnings, cursor-based reads, and first failure context.
- [x] Add process tools: `process_start`, `process_stop`, `process_restart`, `process_list`, and `process_logs`.
- [x] Add UI process/log panel with stop, restart, status, readiness, and recent logs.

### Latest Phase 6 notes

- Added shared process schemas and durable `proc_` process records.
- Added `ProcessManager` in the orchestrator, with shell process supervision, process-group termination on Unix, durable `process.json`, `stdout.log`, `stderr.log`, and `logs.jsonl` files.
- Added process APIs under `/api/processes`, including start, stop, restart, and log query endpoints.
- Integrated process tools into the existing tool-call/policy/approval lifecycle, so supervised process starts/stops prompt like other command/destructive actions.
- Normal `bash` tool calls now deny likely long-running dev/watch/server commands and instruct agents to use `process_start` instead.
- Added a web inspector Processes tab that lists supervised processes, displays readiness state and live logs, and exposes stop/restart controls.
- Smoke-tested URL readiness, recent log query, and stop behavior against a temp `NERVE_HOME` daemon.

### Phase 7: Sub-agents as child agents

- [x] Implement orchestrator child-agent creation.
- [x] Add `subagent_run` / `agent_spawn` tool support.
- [x] Represent child agents as normal agent records with parent/root ids, mode, permission level, workspace scope, and bounded budgets.
- [x] Default child policy to planning + read-only.
- [x] Enforce child authority, workspace scope, depth, and run-budget limits.
- [x] Return summarized child results through the tool-call result.
- [x] Stream child lifecycle/status events and cancellation propagation.
- [x] Surface child agents in the UI agent tree.

### Latest Phase 7 notes

- Added durable agent budget metadata (`depth`, `maxDepth`, `maxRuns`, `usedRuns`) with backward-compatible hydration defaults.
- Added `subagent_run` as an `agent_spawn` risk tool; default read-only planning delegation is allowed when within parent authority, while authority escalation requires approval.
- Child agents are created as ordinary agents with `parentAgentId` / `rootAgentId`, inherit parent workspace/model by default, and cannot request workspace roots outside the parent scope.
- Parent child-run budgets are consumed when children are created; max depth and run budget are enforced in both direct child creation and tool execution.
- `subagent_run` launches the child through the same isolated agent process path, emits subagent lifecycle events, restores the parent as active agent afterward, and returns the child summary in the tool-call result.
- `abortAgent` now propagates abort requests recursively to child agents.
- The Web UI session inspector now includes an agent tree showing root/child agents, status, mode, permission level, and parent relationships.
- Smoke-tested `subagent_run` against a temp `NERVE_HOME` daemon, including default read-only child execution and approval gating for authority escalation.

### Phase 8: Compaction and branch summaries

- [x] Wire copied compaction helpers into orchestrator actions.
- [x] Add manual compaction endpoint.
- [x] Add optional auto-compaction threshold.
- [x] Add branch summary generation during navigation.
- [x] Render compaction/summary entries in UI.
- [x] Ensure child-agent summaries can be attached as durable artifacts/events.

### Latest Phase 8 notes

- Added durable session entry kinds for message, compaction, branch summary, and sub-agent summary artifacts.
- Added `POST /api/sessions/:sessionId/compact` for manual compaction, using the copied harness compaction preparation/context helpers and appending matching harness JSONL compaction records.
- Added compaction settings for optional auto-compaction by token threshold.
- Added branch-summary generation during navigation when requested, with matching durable events and harness branch-summary entries.
- Future prompt context is rebuilt through harness session context helpers so compaction and branch summaries are consumed by agents.
- Sub-agent completion now records a durable `subagent_summary` artifact in the parent session.
- The Web UI renders system context entries and exposes a compact action from the Branch inspector.

### Later phases

See [Implementation Plan](implementation-plan.md).
