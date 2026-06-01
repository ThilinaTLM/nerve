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

- [ ] Create pnpm workspace package structure.
- [ ] Add TypeScript, strict ESM configuration, Biome, and `svelte-check`.
- [ ] Create `packages/shared` with base schemas/types.
- [ ] Create `packages/orchestrator` with Hono server.
- [ ] Create `packages/cli` with `nerve` command.
- [ ] Create `packages/web` as plain Svelte 5 + Vite SPA.
- [ ] Initialize `~/.nerve` layout.
- [ ] Implement daemon discovery via `~/.nerve/daemon.json`.
- [ ] Implement local token auth for CLI/Web UI.
- [ ] Implement `GET /api/status`.
- [ ] Implement `WS /ws` with event envelope.
- [ ] Serve Web UI static build from orchestrator.

### Later phases

See [Implementation Plan](implementation-plan.md).
