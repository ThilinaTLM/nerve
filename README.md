# nerve

`nerve` is a UI-first personal AI coding harness: a small, explicit agent core behind a
local orchestrator daemon, with CLI and Web UI clients.

It reuses Pi's LLM provider package (`@earendil-works/pi-ai`) and an adapted agent
harness so Nerve can own its orchestration model, conversation semantics, UI event protocol,
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

The orchestrator owns conversations, tools, auth, process management, permissions,
approvals, and agent lifecycle. Storage is file-first under `~/.nerve` (SQLite is only
a rebuildable index/cache). Agent processes use `@earendil-works/pi-ai` for provider
access.

## Deliverables

- `nerve` — primary CLI. It runs the daemon, serves the bundled Web UI, manages auth/provider credentials, reports status, and exposes terminal agent workflows.
- `nerve-desktop` — Electron app. It can use/start a local daemon or connect to an explicit remote daemon with `--connect <url> --token <token>`.

## Packages

- `packages/orchestrator` — local daemon (HTTP + WebSocket), conversations, tools, auth.
- `packages/agent` — agent harness adapted from Pi.
- `packages/web` — Svelte 5 Web UI and design system (see `DESIGN.md`).
- `packages/cli` — `nerve` terminal client and daemon entrypoint.
- `packages/desktop` — `nerve-desktop` Electron shell.
- `packages/tools` / `packages/shared` — coding tools and transport-neutral schemas.

## Develop

```sh
pnpm install
pnpm dev              # orchestrator daemon
pnpm serve -- --open  # serve the bundled Web UI from the daemon and open it
pnpm desktop          # desktop shell (local daemon mode)
pnpm desktop -- --connect http://host:3747 --token <token>  # remote daemon mode
pnpm --filter @nerve/web dev   # web UI (proxies /api + /ws to the daemon)
pnpm --filter @nerve/desktop package:linux   # Linux AppImage + deb for nerve-desktop
make install    # user-space Linux desktop launcher for this checkout
make uninstall  # remove the user-space Linux desktop launcher
```

Validate with `pnpm check`; use `pnpm lint` and `pnpm test` when relevant.

Early development storage schemas are not migrated. After breaking schema changes, use a fresh
`NERVE_HOME` or delete old local `~/.nerve` data.

## License

Nerve is licensed under the Apache License, Version 2.0.

Copyright © 2026 ThilinaTLM. See `LICENSE` and `NOTICE` for details.

See `DESIGN.md` for the UI design system and `AGENTS.md` for engineering conventions.
