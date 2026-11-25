---
title: Browser and PWA use
description: Run the same Nerve workbench in a browser and understand what the PWA contains.
sidebar:
  order: 1
---

The workbench is a browser application served by the Nerve daemon. Electron is the default host, but the same UI can open in a normal browser and be installed as a Progressive Web App.

The service worker registers outside Electron only. Electron deliberately disables it to avoid stale packaged assets and profile migration complexity. Installing the PWA caches the web interface; it does **not** install or host the daemon.

## Desktop-only path drops

Dragging files or folders onto the composer requires Electron's native path bridge, so it is unavailable in a normal browser or installed PWA. Browser users can type `@` to reference files and directories inside the active project instead.

## Local browser development

From a source checkout:

```sh
pnpm dev
# or point only the UI at an existing daemon
NERVE_HOME="$HOME/.nerve" NERVE_API_TARGET=http://127.0.0.1:3747 pnpm dev:ui
```

Repository development defaults to disposable `data/storage-1`, daemon HTTP `43967`, and Vite `127.0.0.1:5173`. Use `--slot N` for another home and port tuple. `pnpm dev:ui` without overrides requires a running slot daemon. Pair explicit local targets with their `NERVE_HOME` so the proxy reads the correct bearer token. Installed desktop/daemon defaults are unchanged.

## Mobile and responsive use

The UI switches to drawer-based compact navigation below 1024px and a phone layout below 640px. The phone layout focuses on work: conversations, Git changes, pull requests, launches, files, and notes, in three tabs (Inbox, Projects, Activity). Providers, agents, tools, extensions, and project settings stay on the desktop; links into them open an "Available on desktop" screen. The phone's own **Settings** screen offers sign out (which revokes that device), Devices, Notifications, theme, and the read-only status of private access.

An installed PWA can receive [Web Push notifications](/operations/lan-mobile/#notifications-on-your-phone) from the daemon when a conversation needs you, fails, is interrupted, or finishes. The service worker handles the push and opens the conversation when you tap it. To access it from another device, pair it through [Tailscale private access](/operations/lan-mobile/#private-access-with-tailscale), which needs no LAN binding, or let the daemon bind beyond loopback with explicit permission. Follow [LAN and mobile HTTPS](/operations/lan-mobile/) rather than exposing a development server casually.

## Next steps

- [LAN and mobile HTTPS](/operations/lan-mobile/)
- [Remote daemon mode](/operations/remote-daemon/)
