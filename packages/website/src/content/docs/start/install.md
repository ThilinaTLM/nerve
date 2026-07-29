---
title: Install Nerve
description: Launch the Nerve desktop app from npm or a source checkout.
sidebar:
  order: 2
---

Nerve requires **Node.js 24 or newer**. The supported npm launcher runs on Linux, Windows 11, and macOS.

## Launch from npm

```sh
npx @nervekit/desktop
# or
pnpm dlx @nervekit/desktop
```

The first launch may download Electron's platform binary. Later launches use the package manager cache. Nerve currently ships through npm; signed and notarized native installers are not part of the release path.

The desktop app normally:

1. checks the local Nerve data directory;
2. adopts a healthy existing local daemon or starts an owned one;
3. waits for the daemon at `127.0.0.1:3747`;
4. opens the bundled workbench.

The shell stops only a daemon it owns. An existing local daemon or a configured remote daemon is monitored but not terminated on quit.

## Develop from source

```sh
 git clone https://github.com/ThilinaTLM/nerve.git
 cd nerve
 pnpm install
 pnpm desktop
```

The repository pins pnpm 11.17.0. Use `pnpm dev` to run the daemon and browser UI development servers, or connect the UI to an existing daemon:

```sh
NERVE_API_TARGET=http://127.0.0.1:3747 pnpm dev:ui
```

## Data created on first launch

Nerve uses `~/.nerve` by default for portable application state, credentials, logs, reports, and daemon metadata. Override it with `NERVE_HOME` when you need an isolated test profile. Electron's active Chromium profile is deliberately stored elsewhere, so also isolate Electron user data when a test requires a completely separate browser profile.

:::note
If an unversioned legacy `~/.nerve` is found, the desktop asks before migration. Read [Storage and migration](/operations/storage-migration/) before accepting if you need old conversations or project history.
:::

## If installation fails

Corporate proxies can allow package installation while blocking the separate Electron binary download. See [Install and proxy troubleshooting](/troubleshooting/install-and-proxy/). Linux users who experience Wayland copy or drag freezes should see [Platform troubleshooting](/troubleshooting/platform/).

## Next steps

- [Connect a provider](/start/providers/)
- [Open your first project](/start/first-project/)
