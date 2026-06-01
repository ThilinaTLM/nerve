# nerve Implementation Plan

## Phase 0: Repository setup

Create a TypeScript monorepo:

```txt
packages/cli
packages/web
packages/orchestrator
packages/agent
packages/tools
packages/shared
```

Initial dependencies:

- `@earendil-works/pi-ai` from npm
- TypeScript
- Svelte 5 + Vite for web UI
- TailwindCSS + CSS variable design tokens
- Bits UI and Paneforge for UI primitives/layout
- `@tanstack/svelte-query`
- CodeMirror 6 for the prompt composer
- unified/remark/rehype + Shiki for markdown rendering
- Hono for orchestrator HTTP API
- WebSocket library or framework-native WebSocket support
- Zod for shared schemas
- Biome for formatting/linting
- SQLite library for rebuildable indexes/query state
- file storage helpers for JSON, JSONL, Markdown, and append-only logs
- optional keychain/encryption library for local secrets

## Phase 1: Local orchestrator + CLI bootstrap

Goal: a singleton-ish local daemon that can be started and contacted by CLI and browser.

Tasks:

1. Create workspace/package scaffolding for `cli`, `web`, `orchestrator`, `agent`, `tools`, and `shared`.
2. Add Biome, TypeScript, and `svelte-check` scripts:
   - `pnpm format`
   - `pnpm lint`
   - `pnpm check`
3. Create `packages/cli` with a `nerve` command.
4. Create `packages/orchestrator` with Hono HTTP + WebSocket server.
5. Create `packages/web` as a plain Svelte 5 + Vite SPA.
6. Add initial TailwindCSS + CSS variable token setup.
7. Add `~/.nerve` data directory initialization:
   - `config.json`
   - `daemon.json`
   - `state.sqlite`
   - `auth/`, `keys/`, `projects/`, `sessions/`, `agents/`, `plans/`, `handovers/`, `proc/`, `approvals/`, `logs/`
8. Add daemon discovery:
   - local port file or lock file
   - data directory
   - auth token for local clients
9. Implement CLI commands:
   - `nerve daemon`
   - `nerve ui`
   - `nerve status`
10. Serve the built web app from the orchestrator.
11. Bind to `127.0.0.1` by default.

Success criteria:

- `nerve daemon` starts the orchestrator
- `nerve status` can find it
- `nerve ui` opens or prints the local UI URL
- WebSocket connection works
- `~/.nerve` is created with the expected base layout
- Svelte UI shell loads from the orchestrator
- Biome and `svelte-check` scripts run

## Phase 2: Minimal agent run

Goal: send a prompt from browser/CLI and stream assistant output back.

Tasks:

1. Copy/adapt Pi `packages/agent` into `packages/agent`.
2. Add npm dependency on `@earendil-works/pi-ai`.
3. Create an agent process launcher owned by the orchestrator.
4. Add a stable agent/orchestrator protocol for:
   - agent start
   - prompt input
   - output deltas
   - tool call request/result placeholder
   - abort/cancel
5. Implement:
   - `POST /api/projects`
   - `POST /api/sessions`
   - `POST /api/agents`
   - `POST /api/agents/:id/prompt`
   - `POST /api/agents/:id/abort`
   - `GET /api/models`
   - `WS /ws`
6. Broadcast agent events over WebSocket.
7. Create minimal Svelte web UI for prompt + streaming response.
8. Add initial CodeMirror composer without advanced completions.
9. Render completed assistant messages through the sanitized markdown pipeline.
10. Add CLI shortcut:
   - `nerve run [dir]`

Success criteria:

- browser can start an agent for a project directory
- CLI can start or attach to an agent
- assistant text streams live
- completed assistant markdown renders safely
- abort works
- agent process is supervised by the orchestrator

## Phase 3: Durable file-first state and event replay

Goal: sessions, agents, and event history survive restart using readable files as the canonical store and SQLite as a rebuildable index.

Tasks:

1. Add storage service rooted at `~/.nerve` or `NERVE_HOME`.
2. Add crash-safe write helpers:
   - append JSONL
   - atomic JSON writes via temp file + rename
   - append log files
3. Add SQLite orchestrator index store.
4. Persist canonical files:
   - `projects/<project-id>/project.json`
   - `sessions/<session-id>/session.json`
   - `sessions/<session-id>/entries.jsonl`
   - `sessions/<session-id>/events.jsonl`
   - `agents/<agent-id>/agent.json`
   - `approvals/approvals.jsonl`
5. Index in SQLite:
   - projects
   - sessions
   - agents
   - events
   - tool calls
6. Add rebuild path from files to SQLite indexes.
7. Enable JSONL session storage from the copied agent harness.
8. Add listing/opening endpoints:
   - `GET /api/projects`
   - `GET /api/sessions`
   - `GET /api/agents`
9. Add event replay:
   - `GET /api/events?since=`
   - `WS /ws?since=`
10. Add tree endpoint:
   - `GET /api/sessions/:id/tree`
11. Add branch navigation:
   - `POST /api/sessions/:id/navigate`

Success criteria:

- sessions and agent records survive orchestrator restart
- session and event data is inspectable under `~/.nerve`
- SQLite indexes can be rebuilt from files
- UI can replay recent events
- user can reopen a previous session
- active branch is visible in UI

## Phase 4: Web UI foundation

Status: complete.

Goal: establish the reusable UI system before the app becomes complex.

Tasks:

1. Add CSS variable design tokens and light/dark themes.
2. Configure TailwindCSS to consume design tokens.
3. Add Bits UI wrapper components:
   - dialog
   - dropdown menu
   - popover
   - tooltip
   - tabs
   - select
   - checkbox/switch
   - input/textarea/button/card/badge
4. Add Paneforge-based application shell:
   - sidebar
   - conversation area
   - inspector panel
5. Add TanStack Svelte Query client and API helpers.
6. Add Svelte stores/runes for selection, layout, event buffers, composer draft, and theme.
7. Add sanitized markdown renderer with Shiki code highlighting.
8. Add CodeMirror composer wrapper.
9. Add initial completion endpoints/client hooks for slash commands and file/folder suggestions.

Success criteria:

- UI has a consistent Nerve design language
- components are wrapped in Nerve-owned abstractions
- markdown renders safely with highlighted code blocks
- composer supports multiline editing and basic suggestions
- app layout supports resizable panels

## Phase 5: Tool layer + policy engine

Status: complete.

Goal: useful coding tools with enforced modes and permission levels.

Tasks:

1. Implement/adapt tools:
   - read
   - write
   - edit
   - bash
   - grep/find/ls or search/list variants
2. Classify tools by risk:
   - `read`
   - `plan_write`
   - `workspace_write`
   - `command`
   - `network`
   - `secret`
   - `destructive`
   - `agent_spawn`
   - `deployment`
3. Add permission levels:
   - `autonomous`
   - `supervised`
   - `read_only`
4. Add primary modes:
   - `planning`
   - `coding`
5. Add plan sandbox writes:
   - default `~/.nerve/plans/`
   - Markdown plan file plus JSON metadata
6. Add secret provider abstraction:
   - OS keychain preferred
   - encrypted file fallback under `~/.nerve/keys/`
7. Enforce workspace root boundaries.
8. Add approval queue for supervised actions.
9. Persist approval audit trail to `~/.nerve/approvals/approvals.jsonl`.
10. Add UI approval prompts.
11. Add durable events:
   - `policy.evaluated`
   - `approval.requested`
   - `approval.granted`
   - `approval.denied`

Success criteria:

- planning mode cannot mutate project files
- planning mode can write plan artifacts to the plan sandbox when policy allows
- coding mode can edit project files when permission allows
- supervised agents prompt before non-read-only actions
- read-only agents receive automatic denial for mutating actions
- UI shows tool call and approval lifecycle

## Phase 6: Background process manager

Status: complete.

Goal: dev servers and long-running commands become first-class.

Tasks:

1. Implement process supervisor in orchestrator.
2. Store process state and logs under `~/.nerve/proc/<process-id>/`.
3. Add process store:
   - id/name
   - owning project/session/agent
   - cwd
   - command
   - status
   - startedAt/exitedAt
   - exitCode
   - log file paths
4. Capture stdout/stderr incrementally into append-only log files.
5. Add readiness detection:
   - URL detection
   - regex pattern
   - timeout outcome
6. Add log querying:
   - recent
   - errors
   - warnings
   - since cursor
   - first failure
7. Add tools:
   - process_start
   - process_stop
   - process_restart
   - process_list
   - process_logs
8. Add UI process/log panel.

Success criteria:

- agent can start a dev server without blocking
- user can see live logs
- agent can inspect logs and errors
- processes can be stopped/restarted
- long-running commands are rejected or redirected from normal bash

## Phase 7: Sub-agents as child agents

Status: complete.

Goal: controlled child agents for research/review/debugging.

Tasks:

1. Implement orchestrator child-agent creation.
2. Add `agent_spawn` / `subagent_run` tool.
3. Represent child agents as normal `agents` rows with:
   - `parentAgentId`
   - `rootAgentId`
   - `mode`
   - `permissionLevel`
   - `workspaceScope`
   - `budget`
4. Default child policy:
   - mode `planning`
   - permission `read_only`
5. Enforce child authority cannot exceed parent authority without user approval.
6. Add depth and budget limits.
7. Return summarized result to parent.
8. Stream child status and events to UI.

Success criteria:

- parent agent can delegate read-only research
- child agent is visible as a real agent in the UI tree
- child result is summarized into parent context
- child cannot mutate files by default
- cancellation propagates from parent/root to children

## Phase 8: Compaction and branch summaries

Status: complete.

Goal: keep long sessions usable.

Tasks:

1. [x] Wire copied compaction helpers into orchestrator actions.
2. [x] Add manual compaction endpoint.
3. [x] Add optional auto-compaction threshold.
4. [x] Add branch summary generation during navigation.
5. [x] Render compaction/summary entries in UI.
6. [x] Ensure child-agent summaries can be attached as durable artifacts/events.

Success criteria:

- long sessions can be compacted
- branch jumps can preserve context via summaries
- parent agents can consume compact child summaries

## Phase 9: Remote-ready worker abstraction

Status: complete.

Goal: keep local MVP simple while preparing for remote agents later.

Tasks:

1. [x] Add `workers` table/type, initially only `local`.
2. [x] Route agent/process launches through a worker abstraction.
3. [x] Keep protocol boundaries transport-neutral where practical.
4. [x] Document future secure remote-worker handshake.

Success criteria:

- local behavior is unchanged
- the code has a clear seam for future remote workers

## Phase 10: Polish and hardening

Tasks:

- auth/token protection for orchestrator
- remote access mode with explicit opt-in
- settings UI
- model picker
- API key management
- import/export sessions
- HTML/markdown export
- crash recovery for unfinished turns/processes/agents
- orphan process detection
- tests for agent loop, session tree, process manager, policy engine, API protocol

## Suggested first milestone

Build this first:

```txt
nerve CLI -> local orchestrator -> agent process -> @earendil-works/pi-ai -> stream events -> Web UI/CLI
```

Do not start with sub-agents or distributed workers. Get the orchestrator, process boundary, event stream, and minimal UI working first.
