---
title: Connect to a remote daemon
description: Point the Electron workbench at an existing authenticated daemon.
sidebar:
  order: 3
---

Use remote mode when a daemon already runs on another host or in a separately managed local profile.

```sh
npx @nervekit/desktop@latest -- \
  --connect https://nerve-host.example:3748 \
  --pair-code ABCD-EFGH
```

Create the one-time code on the daemon's side: **Settings → Devices → Pair a device** in a signed-in client, or `nerve pair --purpose desktop` on the host. The desktop redeems it once and stores a device credential for that origin, encrypted with the operating system's keychain (Electron `safeStorage`). Later launches only need `--connect <url>`. If the device is revoked or expires, the desktop asks for a new code.

`--connect` accepts an HTTP(S) origin; WebSocket URLs are rejected and paths are normalized to the origin. The older `--token <token>` flag and `NERVE_DAEMON_TOKEN` still work, but are deprecated: the desktop exchanges the token for a device credential when it can. Use `--pair-code` instead.

Remote mode is **monitor-only**. The desktop shell health-checks and reconnects but never spawns, restarts, or stops the remote daemon. Local legacy-home migration is skipped because the shell is not taking ownership of remote storage.

The shell also treats a healthy pre-existing local daemon as unowned. Quit stops only a child the current Electron process started.

## Failure behavior

Owned daemons receive bounded automatic restart attempts after failed health checks. Existing and remote daemon failures become reconnecting states instead; fix or restart the daemon at its owner.

:::caution
A pairing code or token grants daemon API and WebSocket access. Protect it in process lists, shell history, environment inspection, and support logs. Device credentials are refused over plain HTTP from other machines, so use HTTPS or a secure network tunnel. For a server behind a reverse proxy, see [Hosted server](/operations/hosted-server/).
:::

## Next steps

- [Configuration and ports](/operations/configuration/)
- [Connectivity troubleshooting](/troubleshooting/connectivity/)
