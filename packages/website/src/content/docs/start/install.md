---
title: Install Nerve
description: Launch the Nerve desktop app from npm.
sidebar:
  order: 2
---

Nerve requires **Node.js 24 or newer**. The supported npm launcher runs on Linux, Windows 11, and macOS.

## Launch from npm

Choose the command for your package manager.

**npm**

```sh wrap
npx @nervekit/desktop@latest
```

**pnpm**

```sh wrap
pnpm dlx @nervekit/desktop@latest
```

The first launch downloads Electron's platform binary and the native package for your operating system and CPU only (about 25 MB for Nerve itself). Later launches use the package manager cache. Nerve currently ships through npm; signed and notarized native installers are not part of the release path.

On launch, the desktop app starts a local background service (the daemon) on `127.0.0.1:3747`, or reuses one that is already running, and then opens the workbench.

Closing the window quits Nerve and stops the daemon it started. (To keep Nerve running in the tray instead, turn on **Close to system tray** in **Settings → Appearance → Desktop**.) A daemon that was already running, or a remote one, is left alone.

## Where Nerve keeps your data

Nerve stores settings, credentials, conversations, and logs in `~/.nerve`. Your code stays in your project folders. Set `NERVE_HOME` to use a separate home, for example when testing.

:::note
If Nerve finds a supported older Nerve home, it asks before migrating it. Read [Back up, move, and upgrade data](/operations/storage-migration/) first if you need your old conversations.
:::

## Release channels

Every release is published to the **staging** channel (npm `next`) first and is later promoted to the **stable** channel (npm `latest`), once it has had time to show bugs. The commands above install stable. To try new versions early, launch `@next`. The same tags apply to the other packages, such as the `@nervekit/extension-sdk` that [extensions](/guides/build-extensions/) build on. To try them early, launch `@next`:

```sh wrap
npx @nervekit/desktop@next
```

`npm view @nervekit/desktop dist-tags` shows which version each channel points at.

:::caution
A home opened by a staging version may be migrated to a storage format that the current stable version cannot open, and there is no way back. Use a separate home for staging, with its own port and Electron profile so it can run next to stable:

```sh wrap
NERVE_HOME="$HOME/.nerve-staging" NERVE_PORT=3757 NERVE_ELECTRON_USER_DATA="$HOME/.nerve-staging-electron" npx @nervekit/desktop@next
```

`NERVE_ELECTRON_USER_DATA` must be an absolute path outside `NERVE_HOME`.
:::

Want to run Nerve from source? See [Development setup](/developers/development/).

## If installation fails

Corporate proxies can allow package installation while blocking the separate Electron binary download. See [Install and proxy troubleshooting](/troubleshooting/install-and-proxy/). Linux users who experience Wayland copy or drag freezes should see [Platform troubleshooting](/troubleshooting/platform/).

## Next steps

- [Connect a provider](/start/providers/)
- [Open your first project](/start/first-project/)
