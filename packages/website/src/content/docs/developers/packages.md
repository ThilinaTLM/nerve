---
title: Package responsibilities
description: Learn the workspace dependency boundaries and ownership model.
sidebar:
  order: 2
---

## Shared foundations

- `packages/contracts` — transport-neutral API, operation, event, policy, model/provider, tool, and storage schemas/catalogs. It has no internal Nerve dependency.
- `packages/protocol` — protocol codec, HTTP mapping, RPC, client/server sessions, subscriptions, replay, snapshots, reconnect, and queues. Depends on contracts.
- `packages/harness` — model resolution, conversation facade, agent loop, streaming/tool primitives, resources, and generic compaction. Depends on contracts and native.
- `packages/skills` — built-in skills and harness resource integration.
- `packages/conversation-core` — portable SQLite-backed conversation runtime, history/context, inputs, tool lifecycle, delegation and async Bash. Depends on contracts, native, harness, skills and tools; never protocol or the workbench hosts.
- `packages/tools` — canonical tool definitions, local executors, output bounds, artifacts, and Git/GitHub utility service. Depends on contracts and native.
- `packages/native` — normalized TypeScript façades over the Rust N-API Git, managed-process, platform, and runtime primitives. Its raw bindings and prebuild paths remain private.
- `packages/ui-kit` — contract-free shadcn-svelte primitives, theme, generic Markdown/code/terminal rendering, and utilities.

## Product hosts

- `packages/workbench-server` — HTTP/WebSocket daemon, persistence, auth, use cases, runtime composition, process drivers, and static web host. It composes conversation-core with contracts, protocol, harness, skills, tools and native runtime primitives, implementing the core environment ports.
- `packages/workbench-app` — Svelte workbench presentation plus feature adapters/state/effects. It depends on contracts, protocol, and UI kit.
- `packages/desktop-shell` — published npm/Electron launcher, desktop bridge, migration gate, and daemon ownership. It depends on contracts and server packaging.
- `packages/website` — static public marketing/documentation site. It intentionally imports no product runtime package.

`scripts/checks/check-package-boundaries.mjs` enforces workspace-level edges. Package-local AGENTS instructions enforce finer boundaries, such as keeping presentation free from feature/application state and keeping UI kit contract-free.

## Ownership principle

Put shared schemas and mutable catalogs in contracts, transport mechanics in protocol, generic agent behavior in harness, executor behavior in tools, normalized OS primitives in native, durable conversation lifecycle/storage in conversation-core, environment integration and workbench services in server, and user interaction in app. Avoid compatibility shims that duplicate an owning layer.

## Next steps

- [Development setup](/developers/development/)
- [Extension model](/developers/extensions/)
