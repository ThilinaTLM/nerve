# nerve Implementation Progress

This file tracks implementation progress at a high level. Detailed requirements and technical decisions live in `docs/prd/`.

## Current phase

```txt
Phase 1: Foundation
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

### Latest foundation implementation notes

- Added `pnpm-workspace.yaml`, root TypeScript references, Biome config, package scripts, and lockfile.
- Added placeholder `agent` and `tools` packages so the monorepo layout is ready for Phase 2+.
- Orchestrator now creates the base file-first data layout, generated local token, `config.json`, `state.sqlite`, `daemon.json`, HTTP APIs, replayable in-memory event buffer, and append-only `logs/events.jsonl`.
- CLI supports `nerve daemon`, `nerve status`, and `nerve ui [--open]`.
- Web UI has a minimal Svelte/Vite shell that reads daemon status and connects to `/ws`.

### Later phases

See [Implementation Plan](implementation-plan.md).
