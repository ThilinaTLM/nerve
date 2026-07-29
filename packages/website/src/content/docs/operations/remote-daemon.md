---
title: Connect to a remote daemon
description: Point the Electron workbench at an existing authenticated daemon.
sidebar:
  order: 3
---

Use remote mode when a daemon already runs on another host or in a separately managed local profile.

```sh
npx @nervekit/desktop -- \
  --connect https://nerve-host.example:3748 \
  --token <token>
```

You can supply the token with `NERVE_DAEMON_TOKEN` instead. `--connect` accepts an HTTP(S) origin; WebSocket URLs are rejected and paths are normalized to the origin.

Remote mode is **monitor-only**. The desktop shell health-checks and reconnects but never spawns, restarts, or stops the remote daemon. Local legacy-home migration is skipped because the shell is not taking ownership of remote storage.

The shell also treats a healthy pre-existing local daemon as unowned. Quit stops only a child the current Electron process started.

## Failure behavior

Owned daemons receive bounded automatic restart attempts after failed health checks. Existing and remote daemon failures become reconnecting states instead; fix or restart the daemon at its owner.

:::caution
A token grants daemon API and WebSocket access. Protect it in process lists, shell history, environment inspection, and support logs. Use a secure network tunnel or properly trusted HTTPS for remote transport.
:::

## Next steps

- [Configuration and ports](/operations/configuration/)
- [Connectivity troubleshooting](/troubleshooting/connectivity/)
