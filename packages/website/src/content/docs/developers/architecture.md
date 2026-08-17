---
title: Architecture overview
description: Understand Nerve's desktop, browser, daemon, runtime, storage, and protocol boundaries.
sidebar:
  order: 1
---

Nerve's main product is a desktop workbench built from an Electron shell, a browser workbench, a local daemon, and shared transport-neutral foundations. The diagrams on this page are generated from the editable sources in the website package's [`diagrams/`](https://github.com/ThilinaTLM/nerve/tree/main/packages/website/diagrams/) directory.

## System context

The Electron desktop launches or connects to a selected daemon. The browser workbench talks directly to that daemon over authenticated HTTP and Nerve Protocol v1 WebSocket; application data does not flow through broad Electron IPC. The daemon owns the workbench runtime, persistence, tools, model access, and external resource boundaries.

<figure>
  <img src="/diagrams/01-system-context.svg" alt="System context diagram showing the user, Electron desktop, browser workbench, local daemon, NERVE_HOME, model providers, and project resources." loading="lazy" />
  <figcaption>System context: the daemon is the application boundary while Electron owns desktop lifecycle.</figcaption>
</figure>

## Runtime and daemon ownership

The shell chooses exactly one daemon mode:

1. adopt a healthy existing local daemon (unowned);
2. spawn and supervise a local child (owned);
3. connect to a configured remote daemon (unowned).

Quit stops only the owned child. Existing local and remote daemons are monitored but never spawned or stopped by the desktop shell.

<figure>
  <img src="/diagrams/03-desktop-runtime.svg" alt="Desktop runtime diagram showing the Electron main process, browser renderer, workbench daemon, existing local daemon, remote daemon, NERVE_HOME, and external services." loading="lazy" />
  <figcaption>Desktop runtime: ownership and monitoring differ for spawned, existing-local, and remote daemons.</figcaption>
</figure>

The startup path acquires a single-instance lock, prepares the active home, selects the daemon, installs the authenticated browser session, and loads the bundled workbench. Health monitoring can restart only a child owned by this launch.

<figure>
  <img src="/diagrams/05-desktop-startup.svg" alt="Sequence diagram showing Nerve desktop startup, legacy-home migration, daemon selection, browser bootstrap, health monitoring, and owned-daemon shutdown." loading="lazy" />
  <figcaption>Startup and shutdown: migration, authentication, recovery, monitoring, and owned-child cleanup happen in order.</figcaption>
</figure>

## Package boundaries

Shared foundations stay transport- and framework-neutral:

- `@nervekit/contracts` owns API, operation, event, policy, tool, model, and storage schemas.
- `@nervekit/protocol` owns the Protocol v1 codec, sessions, RPC, replay, cursors, snapshots, and bounded delivery.
- `@nervekit/harness` owns model resolution, conversation behavior, the generic agent loop, resources, and compaction.
- `@nervekit/tools` owns the canonical tool catalog, executors, output bounds, artifacts, and Git/GitHub utilities.
- `@nervekit/ui-kit` provides contract-free presentation primitives and renderers.

The product hosts compose those foundations:

- `@nervekit/workbench-server` owns HTTP/WebSocket routes, persistence, authentication, runtime composition, process drivers, and the static web host.
- `@nervekit/workbench-app` owns Svelte presentation and feature adapters/effects.
- `@nervekit/desktop-shell` owns the published launcher, Electron bridge, migration gate, and daemon ownership.

<figure>
  <img src="/diagrams/02-package-dependencies.svg" alt="Package dependency diagram showing shared contracts, protocol, harness, tools, and UI kit foundations and the workbench server, app, and desktop shell hosts." loading="lazy" />
  <figcaption>Package graph: compile-time dependencies are separate from the app-to-server runtime link.</figcaption>
</figure>

See [package responsibilities](/developers/packages/) for the complete ownership map and [contributing](/developers/contributing/) for repository boundary rules.

## State and external boundaries

`NERVE_HOME` is file-first. Conversation entries and sequenced stream events use append-oriented records; SQLite is a rebuildable index/cache. Electron's active Chromium profile stays outside the Nerve home so whole-home backup and migration do not capture live browser caches or profile locks. See [persistence and security boundaries](/developers/persistence-security/) for storage, secrets, authentication, and migration details.

The server reaches project files and processes locally. Model providers, OAuth, voice transcription, Web and Atlassian integrations, and Git remotes are explicit external paths. [Platform reliability](/developers/platform-reliability/) documents the native filesystem, process, and desktop-state rules behind those boundaries.

## Protocol recovery

Nerve Protocol uses typed RPC plus per-stream cursors, replay, snapshots, and resynchronization. It has no wire-level acknowledgement window; cursor advancement happens after reducers successfully process events. Durable events and transient notifications have different delivery guarantees. [Tool output lifecycle](/developers/tool-output-lifecycle/) explains the same distinction for tool execution and live output.

## Next steps

- [Package responsibilities](/developers/packages/)
- [Harness and agent loop](/developers/harness/)
- [Tools and approval policy](/developers/tools-policy/)
- [Protocol overview](/developers/protocol/)
