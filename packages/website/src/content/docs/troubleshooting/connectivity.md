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

A browser or phone that is not paired sees the pairing screen. Create a code in **Settings → Devices → Pair a device** on a signed-in client, or run `nerve pair` on the host, and enter it (or open the link with `#pair=CODE`). Codes are single use, expire after about two minutes, and are locked after five wrong guesses; `RATE_LIMITED` means wait and retry. Pairing over plain HTTP from another machine is refused (`TLS_REQUIRED`); use the mobile HTTPS address. If a device was revoked, expired (180 days, or 30 idle), or its cookies were cleared, pair it again. Behind a reverse proxy with a public URL, sign in with a passkey; if every passkey is lost, run `nerve access reset` on the server. A `421` response means the `Host` header is not allowed; use the machine's address or add the name to `NERVE_ALLOWED_HOSTS`.

## Mobile HTTPS fails

Install the generated local CA on the device, not merely the leaf certificate (the **First time on this device** pairing QR opens a setup page that does this). A network that joined after the daemon started is offered once the daemon restarts. Host changes can rotate the leaf. Confirm the address is included in the generated certificate and that Cloud/firewall rules permit the HTTPS port.

## Remote desktop reconnects forever

Confirm the daemon independently, URL origin, certificate trust, and that this desktop is still paired (revoked devices need a new `--pair-code`). Remote mode is monitor-only; restart the daemon at its owner.

:::danger
Redact tokens from commands, URLs, screenshots, browser history, and logs before asking for help.
:::
