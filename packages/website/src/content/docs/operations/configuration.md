---
title: Configuration and ports
description: Understand desktop flags, environment variables, saved settings, and daemon ownership.
sidebar:
  order: 4
---

Defaults are `NERVE_HOME=~/.nerve`, host `127.0.0.1`, HTTP port `3747`, remote access off, and mobile HTTPS port `3748` when enabled.

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

Remote URL and token select monitor-only mode. Local bind flags configure an owned daemon.

## Environment

Common overrides include:

- `NERVE_HOME`
- `NERVE_HOST`, `NERVE_PORT`, `NERVE_HTTPS_PORT`
- `NERVE_ALLOW_REMOTE=1`, `NERVE_MOBILE_HTTPS=1`
- `NERVE_DAEMON_TOKEN` for remote connection
- `NERVE_WEB_DIST`
- `NERVE_DAEMON_STARTUP_TIMEOUT_MS` (60 seconds default)
- `NERVE_DAEMON_MAX_OLD_SPACE_MB` (4096 default)
- `NERVE_ELECTRON_OZONE_PLATFORM`
- `NERVE_DEBUG_PROXY=1`

See the [complete CLI/environment reference](/reference/cli-environment/).

## Precedence and source launch

The daemon resolves host configuration from command-line flags, then environment, then saved settings, then defaults. The source Electron launcher sets HTTP/HTTPS defaults through environment when absent, so those values can outrank saved port settings.

Use explicit environment overrides for isolated development. Keep Electron's active profile outside `NERVE_HOME` so complete Nerve-home backup/migration remains safe.

## Next steps

- [CLI and environment reference](/reference/cli-environment/)
- [Connectivity troubleshooting](/troubleshooting/connectivity/)
