# nerve

`nerve` is a UI-first personal AI coding harness: a small, explicit agent core behind a
local orchestrator daemon, with CLI and Web UI clients.

It reuses Pi's LLM provider package (`@earendil-works/pi-ai`) and an adapted agent
harness so Nerve can own its orchestration model, session semantics, UI event protocol,
planning modes, process manager, and sub-agent behavior.

## Architecture

```txt
nerve CLI ─────┐
               │
Web UI ────────┼──> Nerve orchestrator / daemon
               │        ├── agent process: project A
API clients ───┘        ├── agent process: project B
                        └── child agent processes
```

The orchestrator owns sessions, tools, auth, process management, permissions,
approvals, and agent lifecycle. Storage is file-first under `~/.nerve` (SQLite is only
a rebuildable index/cache). Agent processes use `@earendil-works/pi-ai` for provider
access.

## Packages

- `packages/orchestrator` — local daemon (HTTP + WebSocket), sessions, tools, auth.
- `packages/agent` — agent harness adapted from Pi.
- `packages/web` — Svelte 5 Web UI and design system (see `DESIGN.md`).
- `packages/cli` — terminal client.
- `packages/desktop` — Electron shell.
- `packages/tools` / `packages/shared` — coding tools and transport-neutral schemas.

## Develop

```sh
pnpm install
pnpm dev        # orchestrator daemon
pnpm desktop    # desktop shell
pnpm --filter @nerve/web dev   # web UI (proxies /api + /ws to the daemon)
```

Validate with `pnpm check`; use `pnpm lint` and `pnpm test` when relevant.

See `DESIGN.md` for the UI design system and `AGENTS.md` for engineering conventions.
