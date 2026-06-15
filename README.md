# nerve

Nerve is a UI-first local AI coding harness with a daemon, CLI, Web UI, and Electron desktop shell.

> Status: alpha. APIs, storage formats, and packaging may change without migration support.

## Packages

- `packages/orchestrator` — local HTTP/WebSocket daemon, auth, conversations, tools, and agent lifecycle.
- `packages/agent` — agent harness and conversation runtime.
- `packages/web` — Svelte Web UI.
- `packages/cli` — terminal client and daemon entrypoint.
- `packages/desktop` — Electron desktop shell.
- `packages/tools` and `packages/shared` — coding tools and shared schemas.

## Resource directories

Nerve loads project resources from `.nerve/` and shared agent skills from `.agents/skills/` in the current directory or its ancestors. Global Nerve resources live under `<NERVE_HOME>/agent/` (`~/.nerve/agent/` by default), while global shared agent skills live under `~/.agents/skills/`.

Legacy `.pi` directories are not loaded. Move old resources to `.nerve/` for Nerve-specific files or `.agents/skills/` for portable skills.

## Development

Requirements: Node.js `>=22.19.0` and pnpm `11.3.0`.

```sh
pnpm install
pnpm dev              # run the orchestrator daemon
pnpm serve -- --open  # serve/open the bundled Web UI
pnpm desktop          # run the desktop shell
pnpm check
pnpm test
```

### Linux Wayland desktop troubleshooting

Electron may emit Chromium/Ozone Wayland messages such as `Frame latency is negative` or `Invalid state when trying to start drag`. If native Wayland also causes copy/drag freezes on your desktop environment, run the desktop shell through XWayland:

```sh
NERVE_ELECTRON_OZONE_PLATFORM=x11 make desktop
```

Supported values are `x11`, `wayland`, and `auto`. Leave it unset for Electron's default platform selection.

## Release

See `docs/release.md` for the Linux desktop and npm CLI/daemon release checklist. Tag pushes matching `v*` build AppImage, deb, and rpm artifacts and create a GitHub Release.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
