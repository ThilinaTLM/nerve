# nerve Implementation Progress

This file tracks implementation progress at a high level. Detailed requirements and technical decisions live in `docs/prd/`.

## Current phase

```txt
Phase 2: Minimal agent run
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

- [ ] Copy/adapt the full Pi `packages/agent` harness.
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
- [ ] Add initial CodeMirror composer.
- [ ] Render completed assistant messages through the sanitized markdown pipeline.

### Latest implementation notes

- Added `pnpm-workspace.yaml`, root TypeScript references, Biome config, package scripts, and lockfile.
- Added placeholder `tools` package so the monorepo layout is ready for Phase 5+.
- Orchestrator creates the base file-first data layout, generated local token, `config.json`, `state.sqlite`, `daemon.json`, HTTP APIs, replayable in-memory event buffer, and append-only `logs/events.jsonl`.
- Project, session, agent, and session-entry records are now written under `~/.nerve/projects`, `~/.nerve/sessions`, and `~/.nerve/agents` as readable files.
- CLI supports `nerve daemon`, `nerve status`, `nerve ui [--open]`, and `nerve run [dir] [prompt...]`.
- Web UI can create a minimal project/session/agent and stream a faux-model assistant response over `/ws`.
- Agent prompts now run in an isolated `@nerve/agent/worker` child process over an NDJSON stdio protocol; the orchestrator supervises the run, streams deltas, and sends abort requests across the process boundary.

### Later phases

See [Implementation Plan](implementation-plan.md).
