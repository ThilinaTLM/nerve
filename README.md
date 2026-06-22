# nerve

Nerve is a UI-first local AI coding harness with an Electron desktop app, local daemon, Web UI, and CLI.

> Status: alpha. APIs, storage formats, and packaging may change without migration support.

## Use Nerve from source

Requirements:

- Node.js `>=22.19.0`
- pnpm `11.x` (`packageManager` pins `pnpm@11.8.0`)

Install dependencies once:

```sh
pnpm install
```

### Desktop app recommended

The desktop app is the primary way to use Nerve locally. It builds the required internal packages, bundles the Web UI, starts an owned local daemon, and opens the Electron shell.

```sh
pnpm desktop
```

Pass desktop/daemon options after `--`:

```sh
pnpm desktop -- --host 0.0.0.0 --allow-remote
pnpm desktop -- --connect http://127.0.0.1:3747 --token <token>
```

For opt-in self-signed HTTPS LAN sharing for mobile browsers:

```sh
pnpm desktop:mobile-https
```

To install or remove a user-space desktop launcher for this checkout:

```sh
pnpm desktop:install
pnpm desktop:uninstall
```

Useful desktop development commands:

```sh
pnpm desktop:build   # build desktop dependencies and Electron main process
pnpm desktop:fast    # start Electron using existing build output
pnpm desktop:check   # type-check the desktop package
```

#### Linux Wayland troubleshooting

Electron may emit Chromium/Ozone Wayland messages such as `Frame latency is negative` or `Invalid state when trying to start drag`. If native Wayland also causes copy/drag freezes on your desktop environment, run the desktop shell through XWayland:

```sh
NERVE_ELECTRON_OZONE_PLATFORM=x11 pnpm desktop
```

Supported values are `x11`, `wayland`, and `auto`. Leave it unset for Electron's default platform selection.

## Browser, daemon, and CLI usage

Run the daemon and Web UI dev servers together:

```sh
pnpm dev
```

Run only the daemon:

```sh
pnpm daemon
```

Serve the bundled Web UI and open it in your browser:

```sh
pnpm serve
```

Run CLI commands from source:

```sh
pnpm cli -- help
pnpm cli -- status
pnpm cli -- run . "Summarize this project"
```

## Root scripts

Common repository commands:

```sh
pnpm build       # build all packages
pnpm check       # type-check/check all packages
pnpm lint        # run Biome checks
pnpm format      # format the repository
pnpm test        # run package tests
pnpm web         # start only the Svelte Web UI dev server
```

Release scripts are documented in `docs/release.md`.

## Resource directories

Nerve loads project resources from `.nerve/` and shared agent skills from `.agents/skills/` in the current directory or its ancestors.

Global Nerve resources live under `<NERVE_HOME>/agent/` (`~/.nerve/agent/` by default). Global shared agent skills live under `~/.agents/skills/`.

Legacy `.pi` directories are not loaded. Move old resources to `.nerve/` for Nerve-specific files or `.agents/skills/` for portable skills.

## Packages

- `packages/desktop` — Electron desktop shell.
- `packages/orchestrator` — local HTTP/WebSocket daemon, auth, conversations, tools, and agent lifecycle.
- `packages/web` — Svelte Web UI.
- `packages/cli` — terminal client and daemon entrypoint.
- `packages/agent` — agent harness and conversation runtime.
- `packages/tools` and `packages/shared` — coding tools and shared schemas.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
