# nerve Implementation Progress

This file tracks implementation progress at a high level. Detailed requirements and technical decisions live in `docs/prd/`.

## Current phase

```txt
Phase 3: Durable file-first state and event replay — in progress
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
- [ ] Add SQLite orchestrator index store.
- [x] Persist canonical project, session, session-entry, and agent files.
- [ ] Index canonical state in SQLite.
- [x] Add startup hydration from file-first records.
- [x] Add listing/opening endpoints for projects, sessions, and agents.
- [x] Add event replay from persisted `logs/events.jsonl` through HTTP and WebSocket.
- [x] Persist session-associated events to `sessions/<session-id>/events.jsonl`.
- [x] Add initial session tree endpoint and branch navigation endpoint.
- [ ] Add a rebuild path from files to SQLite indexes.
- [ ] Enable JSONL session storage from the copied agent harness.
- [ ] Surface previous sessions/branch navigation in the UI.

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

### Later phases

See [Implementation Plan](implementation-plan.md).
