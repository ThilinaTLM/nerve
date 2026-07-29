---
title: Browser and PWA use
description: Run the same Nerve workbench in a browser and understand what the PWA contains.
sidebar:
  order: 1
---

The workbench is a browser application served by the Nerve daemon. Electron is the default host, but the same UI can open in a normal browser and be installed as a Progressive Web App.

The service worker registers outside Electron only. Electron deliberately disables it to avoid stale packaged assets and profile migration complexity. Installing the PWA caches the web interface; it does **not** install or host the daemon.

## Local browser development

From a source checkout:

```sh
pnpm dev
# or point only the UI at an existing daemon
NERVE_API_TARGET=http://127.0.0.1:3747 pnpm dev:ui
```

The Vite UI defaults to `127.0.0.1:5173` and proxies API/WebSocket traffic to the configured target or local daemon metadata.

## Mobile and responsive use

The UI switches to drawer-based compact navigation below 1024px and phone density below 640px. To access it from another device, the daemon must bind beyond loopback with explicit permission and authentication. Follow [LAN and mobile HTTPS](/operations/lan-mobile/) rather than exposing a development server casually.

## Next steps

- [LAN and mobile HTTPS](/operations/lan-mobile/)
- [Remote daemon mode](/operations/remote-daemon/)
