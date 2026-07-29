---
title: Connectivity, ports, and tokens
description: Diagnose daemon startup, port collisions, authentication, LAN certificates, and remote reconnects.
sidebar:
  order: 3
---

## Local daemon does not become ready

Check `<NERVE_HOME>/logs`, then confirm whether 3747 is already in use. The shell can adopt a healthy recorded daemon; an unrelated listener or stale daemon metadata can prevent readiness. Use an explicit `--port`/`NERVE_PORT` for isolation rather than killing an unknown process.

Owned readiness polls every 200 ms and defaults to a 60-second startup timeout. Health checks run every 5 seconds; three failures trigger bounded owned-daemon restart attempts. Existing and remote daemons are never restarted by the shell.

## Saved port appears ignored

Configuration precedence is CLI → environment → saved settings → defaults. The source desktop launcher sets default port environment values when absent, which can outrank saved settings. Inspect launch environment and use an explicit override.

## Browser shows unauthorized

Use the URL produced by the owning daemon/tray. A LAN URL's query token should redirect into a Strict HttpOnly cookie. Clearing site cookies requires token bootstrap again. API clients can use `Authorization: Bearer <token>`.

## Mobile HTTPS fails

Install the generated local CA on the device, not merely the leaf certificate. Host changes can rotate the leaf. Confirm the address is included in the generated certificate and that Cloud/firewall rules permit the HTTPS port.

## Remote desktop reconnects forever

Confirm the daemon independently, URL origin, certificate trust, and token. Remote mode is monitor-only; restart the daemon at its owner.

:::danger
Redact tokens from commands, URLs, screenshots, browser history, and logs before asking for help.
:::
