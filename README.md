# nerve

![Nerve preview screenshot](docs/assets/preview-screenshot.webp)

Nerve is a UI-first local AI coding harness with an Electron desktop app, local daemon, Web UI, and CLI.

## Use Nerve

The desktop app is the primary way to use Nerve locally. It starts an owned local daemon, opens the Electron shell, and serves the bundled Web UI.

Run the beta desktop app with your package runner:

```sh
npx @nervekit/desktop
pnpm dlx @nervekit/desktop
```

The first run may download Electron's platform binary through npm or pnpm; subsequent runs use the package manager cache.

### Corporate proxy / Electron desktop troubleshooting

This applies on Linux, Windows, and macOS. `pnpm install` can succeed while the
Electron platform binary is still missing; in that case `pnpm desktop` (or
`pnpm run desktop`) may fail when the `electron` package tries to download from
Electron's release host.

If your network requires a corporate proxy, configure the Electron downloader and
then rebuild Electron:

```sh
export ELECTRON_GET_USE_PROXY=true
export HTTPS_PROXY=http://proxy.example.com:8080
export HTTP_PROXY=$HTTPS_PROXY
export NO_PROXY=localhost,127.0.0.1,::1
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem  # only for TLS interception
pnpm --filter @nervekit/desktop rebuild electron
pnpm desktop
```

PowerShell:

```powershell
$env:ELECTRON_GET_USE_PROXY = "true"
$env:HTTPS_PROXY = "http://proxy.example.com:8080"
$env:HTTP_PROXY = $env:HTTPS_PROXY
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:NODE_EXTRA_CA_CERTS = "C:\path\to\corporate-ca.pem" # only for TLS interception
pnpm --filter @nervekit/desktop rebuild electron
pnpm desktop
```

If you keep proxy settings in pnpm config, use user-level config rather than a
repo `.npmrc` with secrets:

```sh
pnpm config set proxy http://proxy.example.com:8080
pnpm config set https-proxy http://proxy.example.com:8080
pnpm config set cafile /path/to/corporate-ca.pem
```

If your company mirrors Electron artifacts, set `ELECTRON_MIRROR` to that mirror
before rebuilding. If a partial download was cached, clear Electron's cache and
rebuild. Cache locations are `~/.cache/electron` on Linux,
`~/Library/Caches/electron` on macOS, and `%LOCALAPPDATA%\electron\Cache` on
Windows.

The desktop launcher also forces loopback proxy bypass for the local daemon. If
macOS System Settings uses a corporate proxy or PAC file, keep `NO_PROXY` set to
include `localhost,127.0.0.1,::1` for shell-launched development, then run with
redacted proxy diagnostics when needed:

```sh
NERVE_DEBUG_PROXY=1 pnpm desktop
```

Desktop logs are written to `~/.nerve/logs/desktop-YYYY-MM-DD.jsonl`; crash
reports are written to `~/.nerve/crashes`.

Source development via `pnpm desktop` is supported on macOS. A signed/notarized
macOS `.app` or DMG release package is not configured yet.

Pass desktop/daemon options after `--`:

```sh
npx @nervekit/desktop -- --host 0.0.0.0 --allow-remote
npx @nervekit/desktop -- --connect http://127.0.0.1:3747 --token <token>
pnpm dlx @nervekit/desktop -- --host 0.0.0.0 --allow-remote
```

For opt-in LAN remote access plus self-signed HTTPS for mobile browsers, run with:

```sh
npx @nervekit/desktop -- --host 0.0.0.0 --allow-remote --mobile-https
```

### Linux Wayland troubleshooting

Electron may emit Chromium/Ozone Wayland messages such as `Frame latency is negative` or `Invalid state when trying to start drag`. If native Wayland also causes copy/drag freezes on your desktop environment, run the desktop shell through XWayland:

```sh
NERVE_ELECTRON_OZONE_PLATFORM=x11 npx @nervekit/desktop
```

Supported values are `x11`, `wayland`, and `auto`. Leave it unset for Electron's default platform selection.

## Develop from source

Requirements:

- Node.js `>=24.0.0`
- pnpm `11.x` (`packageManager` pins `pnpm@11.8.0`)

Install dependencies once:

```sh
pnpm install
```

Run the desktop app from a source checkout:

```sh
pnpm desktop
```

Pass desktop/daemon options after `--`:

```sh
pnpm desktop -- --host 0.0.0.0 --allow-remote
pnpm desktop -- --connect http://127.0.0.1:3747 --token <token>
```

For opt-in LAN remote access plus self-signed HTTPS for mobile browsers
(binds to `0.0.0.0`, allows remote clients, and enables self-signed HTTPS):

```sh
pnpm desktop:remote-enabled
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

### Browser, daemon, and CLI usage from source

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

Crash diagnostics are written under `~/.nerve/crashes`. The daemon records
structured reports for handled fatal errors, enables Node diagnostic reports for
native/runtime fatal errors, and writes a fallback report on next start if the
previous daemon exited without a graceful shutdown. Inspect recent reports
without requiring a running daemon:

```sh
pnpm cli -- crashes --limit 5
pnpm cli -- crashes --follow
pnpm cli -- logs --level error --follow
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
