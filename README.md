# Nerve

**A transparent, local-first desktop coding harness with the focus of a small agent and the workflow of a complete workbench.**

Nerve keeps the agent simple, its work visible, and you in control. Follow streaming messages and tool calls, review approvals and plans, manage Git and background tasks, and change the model or permission level without starting over—all from an open-source desktop app that runs with your local projects.

![Nerve desktop workbench showing a conversation, live model controls, and the Git panel](docs/assets/preview-screenshot.webp)

> [!NOTE]
> Nerve is beta software and is distributed under the [Apache-2.0 license](LICENSE).

## Quick start

Nerve requires Node.js `>=24.0.0`. Start the desktop app directly with your package runner:

```sh
npx @nervekit/desktop
# or
pnpm dlx @nervekit/desktop
```

The first run may download Electron's platform binary; later runs use the package manager cache. The npm launcher supports Linux, Windows 11, and macOS. Signed and notarized native installers are not currently part of the release path.

## Why Nerve

Nerve sits between bare command-line harnesses and heavyweight IDE agents: small enough to understand, but complete enough for everyday development.

- **See what the agent sees and does.** Messages, reasoning, tool calls, approvals, questions, plans, task output, and logs remain visible instead of disappearing behind a progress indicator.
- **Change course without restarting.** Switch the model, thinking level, coding or planning mode, and permission level on an active agent. Updated settings apply to its subsequent work.
- **Use a focused harness.** A concise system prompt, curated tool set, bounded output, and automatic context compaction keep the runtime purposeful without stripping away useful capabilities.
- **Enable only what you need.** Configure tools and global or project skills from the UI, with optional web, Python, Jira, Confluence, and Agent Browser capabilities.
- **Keep work local.** The desktop app owns a loopback daemon by default, works directly with local repositories, and stores Nerve data on your machine.

## Everything needed for daily coding

### A workbench for real projects

Open multiple projects and organize their conversations in a navigable tree. Keep conversations, files, pull requests, tasks, logs, settings, and scratch notes in tabs while the composer shows live context-window usage. Search projects and conversations, inspect a conversation's history graph, continue or fork from an earlier point, and edit and resend previous prompts.

The desktop UI also includes light and dark themes, browser notifications, zoom controls, and keyboard shortcuts for pane navigation, sending or stopping work, cycling agent controls, and voice input.

### Live agent control

Choose a provider, model, and supported thinking level for each conversation. Move between coding and planning modes, adjust permission and approval policy, or make the agent read-only. These controls remain available while the agent is active, so a conversation can continue under a different model or authority level without being recreated.

Approvals, user questions, and plan reviews appear directly in the conversation. Defaults, scoped models, custom providers, API keys, subscriptions, and model definitions are managed from the workbench.

### Transparent coding tools

Nerve ships with a curated set of tools for file inspection and editing, shell commands, finite Python execution, search, structured to-dos, and plan review. Tool calls have visible lifecycle states and bounded output. Risk-aware policy and approval gates distinguish reading, workspace writes, commands, network access, destructive actions, and agent spawning.

Automatic context compaction preserves recent work and file-operation context as long conversations approach a model's context window.

### Git and GitHub in the workbench

Inspect repositories, branches, working-tree changes, recent commits, and GitHub pull requests without leaving the conversation. Browse and check out pull requests, then use repository-aware follow-up actions to ask the agent to create a commit, branch, or PR when the current Git state calls for it.

### Background tasks and native sub-agents

Start supervised background processes for servers, watchers, and other long-running work. Nerve keeps task status and streaming logs available in dedicated panes, and the agent can inspect, restart, or stop those tasks as needed.

For larger investigations, the native Explore tool can delegate independent read-only codebase research to parallel sub-agents. The Explore agent has its own configurable model and thinking level, while findings return to the main conversation.

### Models, tools, and skills on your terms

Nerve supports major model-provider families and custom OpenAI-compatible or provider-specific model definitions. Authentication and model configuration stay in the UI, including context windows, costs, and thinking capabilities where available.

Tools can be enabled or disabled from Settings. Markdown skills are discovered globally and per project, can be toggled without deleting their files, and apply to subsequent agent runs. Project definitions take precedence over global skills with the same name.

### Voice input

Record a prompt from the composer and transcribe it directly into text. Voice transcription uses OpenAI's ChatGPT audio service and requires ChatGPT authentication in Nerve.

## How it works

By default, the Electron desktop app starts and owns a local daemon bound to loopback, then opens the bundled Web UI. The UI and daemon communicate through Nerve Protocol v1 over HTTP and WebSocket, with reconnect, replay, and snapshot recovery built in.

Application data lives under `~/.nerve` by default. Electron's active browser profile is deliberately kept outside that directory, so backing up or migrating the Nerve home does not silently capture browser caches and active profile state.

The same workbench can run in a browser, accept opt-in LAN/mobile connections, or connect the desktop shell to an existing daemon.

## Skills and project resources

Nerve loads project resources from `.nerve/` and shared agent skills from `.agents/skills/` in the current directory or its ancestors.

Global Nerve resources live under `<NERVE_HOME>/agent/` (`~/.nerve/agent/` by default). Global shared agent skills live under `~/.agents/skills/`.

Legacy `.pi` directories are not loaded. Move old resources to `.nerve/` for Nerve-specific files or `.agents/skills/` for portable skills.

Use **Settings → Skills** to review and enable or disable discovered skills. Project skills override global skills with the same name.

## Browser, LAN, and remote daemon use

Pass desktop and daemon options after `--`:

```sh
# Allow opt-in LAN access
npx @nervekit/desktop -- --host 0.0.0.0 --allow-remote

# Add self-signed HTTPS for mobile browsers
npx @nervekit/desktop -- --host 0.0.0.0 --allow-remote --mobile-https

# Connect the desktop UI to an existing daemon
npx @nervekit/desktop -- --connect http://127.0.0.1:3747 --token <token>
```

The same options work with `pnpm dlx @nervekit/desktop` and `pnpm desktop` from a source checkout.

> [!WARNING]
> Nerve is beta software. Do not expose its daemon to untrusted networks unless you understand the risks and have configured appropriate access controls. Self-signed HTTPS helps protect transport on a trusted LAN; it does not make public Internet exposure safe by itself.

## Troubleshooting

<details>
<summary><strong>Corporate proxy and Electron download issues</strong></summary>

This applies on Linux, Windows, and macOS. `pnpm install` can succeed while the Electron platform binary is still missing; in that case `pnpm desktop` may fail when the `electron` package tries to download from Electron's release host.

If your network requires a corporate proxy, configure the Electron downloader and rebuild Electron:

```sh
export ELECTRON_GET_USE_PROXY=true
export HTTPS_PROXY=http://proxy.example.com:8080
export HTTP_PROXY=$HTTPS_PROXY
export NO_PROXY=localhost,127.0.0.1,::1
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem  # only for TLS interception
pnpm --filter @nervekit/desktop-shell rebuild electron
pnpm desktop
```

PowerShell:

```powershell
$env:ELECTRON_GET_USE_PROXY = "true"
$env:HTTPS_PROXY = "http://proxy.example.com:8080"
$env:HTTP_PROXY = $env:HTTPS_PROXY
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:NODE_EXTRA_CA_CERTS = "C:\path\to\corporate-ca.pem" # only for TLS interception
pnpm --filter @nervekit/desktop-shell rebuild electron
pnpm desktop
```

If you keep proxy settings in pnpm config, use user-level config rather than a repository `.npmrc` containing secrets:

```sh
pnpm config set proxy http://proxy.example.com:8080
pnpm config set https-proxy http://proxy.example.com:8080
pnpm config set cafile /path/to/corporate-ca.pem
```

If your company mirrors Electron artifacts, set `ELECTRON_MIRROR` before rebuilding. If a partial download was cached, clear Electron's cache and rebuild. Cache locations are `~/.cache/electron` on Linux, `~/Library/Caches/electron` on macOS, and `%LOCALAPPDATA%\electron\Cache` on Windows.

The desktop launcher forces loopback proxy bypass for the local daemon. If macOS System Settings uses a corporate proxy or PAC file, keep `NO_PROXY` set to include `localhost,127.0.0.1,::1` for shell-launched development. Run with redacted proxy diagnostics when needed:

```sh
NERVE_DEBUG_PROXY=1 pnpm desktop
```

Desktop logs are written to `~/.nerve/logs/desktop-YYYY-MM-DD.jsonl`; crash reports are written to `~/.nerve/crashes`.

</details>

<details>
<summary><strong>Linux Wayland copy or drag freezes</strong></summary>

Electron may emit Chromium/Ozone Wayland messages such as `Frame latency is negative` or `Invalid state when trying to start drag`. If native Wayland also causes copy or drag freezes in your desktop environment, run the shell through XWayland:

```sh
NERVE_ELECTRON_OZONE_PLATFORM=x11 npx @nervekit/desktop
```

Supported values are `x11`, `wayland`, and `auto`. Leave the variable unset for Electron's default platform selection.

</details>

<details>
<summary><strong>Upgrading a legacy desktop data directory</strong></summary>

When the desktop finds an unversioned legacy `~/.nerve`, it asks before making changes. If accepted, Nerve renames the complete directory to a retained, timestamped backup such as `~/.nerve-bk-20260716-013229`, initializes a fresh current data directory, and restores only encrypted provider and tool authentication when it can be read.

Conversations, projects, history, custom provider definitions, settings, and all other state are not imported; review your settings after the upgrade.

If legacy credentials cannot be decrypted, startup continues with the complete backup intact and asks you to authenticate again. Nerve never deletes these backups automatically. Unknown, malformed, or future versioned stores are not reset automatically, and remote desktop connections never run this local-home migration.

</details>

Daemon logs are written under `~/.nerve/logs`. Crash diagnostics are written under `~/.nerve/crashes`; the daemon records structured reports for handled fatal errors, enables Node diagnostic reports for native/runtime fatal errors, and writes a fallback report on the next start if the previous daemon exited without a graceful shutdown.

## Develop from source

Requirements:

- Node.js `>=24.0.0`
- pnpm `11.x` (`packageManager` pins `pnpm@11.8.0`)

Install dependencies and start the desktop app:

```sh
pnpm install
pnpm desktop
```

Run the daemon and Web UI development servers together, or run only the Web UI against an existing daemon:

```sh
pnpm dev
pnpm dev:ui
```

Run the sandbox manager and its UI:

```sh
pnpm dev:sandbox
```

For opt-in LAN access with self-signed HTTPS from a source checkout:

```sh
pnpm desktop:remote-enabled
```

For lower-level development, run only the daemon:

```sh
pnpm --filter @nervekit/workbench-server dev
```

### Root scripts

```sh
pnpm desktop                  # Electron desktop app from source
pnpm desktop:remote-enabled   # desktop with LAN/mobile HTTPS flags
pnpm dev                      # local daemon and Web UI
pnpm dev:ui                   # Web UI against an existing daemon
pnpm dev:sandbox              # sandbox manager and manager UI
pnpm build                    # build packages and stage Web assets
pnpm fix                      # format and apply ESLint fixes
pnpm check                    # formatting, lint, boundaries, package checks
pnpm test                     # package tests
pnpm release:verify-tag       # validate a release tag and package versions
```

Release details are documented in [`docs/release.md`](docs/release.md).

## Architecture

The desktop workbench is the main local product:

- `packages/desktop-shell` — Electron launcher, desktop bridge, and local-server owner.
- `packages/workbench-app` — Svelte browser host and app-specific feature adapters.
- `packages/workbench-ui` — reusable workbench, conversation, Git, and task feature hosts.
- `packages/workbench-server` — local HTTP/WebSocket server, persistence, authentication, and built Web assets.

Shared foundations keep contracts and runtime behavior independent of the UI:

- `packages/contracts` — transport-neutral API, event, policy, operation, and storage schemas.
- `packages/protocol` — protocol codec, HTTP mapping, client/server sessions, replay, acknowledgements, and queues.
- `packages/harness` — model conversation, agent loop, skills, and context compaction.
- `packages/tools` — coding tool catalog, executors, and policy enforcement.
- `packages/host-runtime` — environment-neutral Git, task, tool, and run composition.
- `packages/ui-kit` — contract-free shadcn-svelte components, theme, and generic renderers.

Nerve also contains a separate sandbox deployment system:

- `packages/sandbox-manager` — PostgreSQL-backed manager, runtime drivers, protocol routing, and static UI host.
- `packages/sandbox-manager-app` — Svelte manager browser host.
- `packages/sandbox-agent` — isolated agent daemon with file-first state, tools, tasks, Git, and runs.

Nerve Protocol v1 connects the local workbench UI to `workbench_server`, the sandbox manager UI to `sandbox_manager`, and each `sandbox_agent` to its manager. See [`docs/nerve-protocol/v1/`](docs/nerve-protocol/v1/), [`docs/nerve-sandbox/v1/`](docs/nerve-sandbox/v1/), and [`docs/release.md`](docs/release.md).

## Contributing and security

Contributions are welcome; see [`CONTRIBUTING.md`](CONTRIBUTING.md). Report vulnerabilities through the private channels in [`SECURITY.md`](SECURITY.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
