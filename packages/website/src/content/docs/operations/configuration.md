---
title: Configuration and ports
description: Understand saved application settings, environment overrides, desktop flags, and restart behavior.
sidebar:
  order: 4
---

Nerve program-level configuration has one resolution order:

1. command-line option;
2. environment variable;
3. saved value in `<NERVE_HOME>/config.json`;
4. product default.

The effective value and its source are visible under **Settings → System**. A control is disabled when an environment variable or command-line option owns it; unset that override and restart before editing it in the UI. An explicit boolean `0` or `false` overrides a saved `true` just as `1` or `true` overrides `false`.

Defaults are `NERVE_HOME=~/.nerve`, host `127.0.0.1`, HTTP port `3747`, remote access off, and mobile HTTPS port `3748`.

## Settings → System

The System page persists safe application configuration for:

- bind host, HTTP/HTTPS ports, remote access, and mobile HTTPS;
- application logging and performance diagnostics;
- log policy, owned-daemon startup timeout, and heap cap;
- Linux Electron Ozone platform and font rendering.

Enabling **Allow remote connections** also changes a loopback bind host to `0.0.0.0`, so the next daemon launch can accept LAN clients. Disabling it restores `127.0.0.1` when the host is a wildcard. You can still enter a specific interface address in the advanced host field.

The page distinguishes active and saved values. Network, diagnostics enablement, and heap changes need a daemon restart. Timeout and Electron rendering changes need the desktop app to restart. The page can restart an owned local daemon; browser clients and remote or adopted daemons show manual guidance instead.

## Desktop flags

```text
--local
--connect <http(s) URL>
--token <token>
--host <host>
--port <1-65535>
--https-port <1-65535>
--allow-remote
--mobile-https
```

Remote URL and token select monitor-only mode. Local bind flags configure an owned daemon and lock the corresponding Settings controls for that launch.

## Environment

Common overrides include:

- `NERVE_HOME`
- `NERVE_HOST`, `NERVE_PORT`, `NERVE_HTTPS_PORT`
- `NERVE_ALLOW_REMOTE`, `NERVE_MOBILE_HTTPS`
- `NERVE_LOGGING_ENABLED`, `NERVE_PERFORMANCE_DIAGNOSTICS`
- `NERVE_DAEMON_STARTUP_TIMEOUT_MS`, `NERVE_DAEMON_MAX_OLD_SPACE_MB`

Owned daemons use a 4096 MB old-space limit by default. Legacy saved values or environment overrides below the supported 512 MB minimum are raised to 512 MB before launch.

- `NERVE_ELECTRON_OZONE_PLATFORM`, `NERVE_ELECTRON_FONT_RENDER_HINTING`

`NERVE_HOME`, remote tokens, generated performance session IDs, web asset/build routing, and proxy/toolchain variables are launch context rather than saved UI preferences. Secret values are never returned in the configuration snapshot.

See the [complete CLI/environment reference](/reference/cli-environment/).
