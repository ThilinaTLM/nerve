---
title: Architecture overview
description: Understand Nerve's desktop, browser, daemon, runtime, and storage boundaries.
sidebar:
  order: 1
---

Nerve's main product is a desktop workbench built from three runtime layers and shared foundations.

## Desktop runtime

The Electron main process owns app lifecycle, local-home migration, proxy handling, tray/window IPC, and daemon selection. The renderer is hardened with context isolation, no Node integration, and sandboxing.

The shell chooses exactly one daemon mode:

1. adopt a healthy existing local daemon (unowned);
2. spawn and supervise a local child (owned);
3. connect to a configured remote daemon (unowned).

Quit stops only the owned child.

## Workbench and daemon

`workbench-app` is the Svelte browser host. It talks directly to `workbench-server` over authenticated HTTP and Nerve Protocol v1 WebSocket. Application data does not flow through broad Electron IPC.

The server owns project/conversation persistence, protocol handlers, authentication, models, the agent harness, tools/policy, Git/GitHub, background tasks, diagnostics, and bundled web assets.

## State

`NERVE_HOME` is file-first. Conversation entries and stream events use append-oriented records; SQLite is a rebuildable index/cache. Electron's active profile stays outside the Nerve home.

## External boundaries

The server accesses selected project files and processes locally. Model providers, OAuth, Web/Atlassian tools, voice transcription, and Git remotes are explicit external paths.

## Reliability

Nerve Protocol uses typed RPC plus per-stream cursors, replay, snapshots, and resynchronization. It has no wire-level acknowledgement window; cursor advancement happens after reducers successfully process events.

## Next steps

- [Package responsibilities](/developers/packages/)
- [Harness and agent loop](/developers/harness/)
- [Protocol overview](/developers/protocol/)
