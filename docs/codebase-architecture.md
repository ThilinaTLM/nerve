# Codebase architecture

Nerve is a ten-package pnpm workspace. Paths communicate ownership: domain contracts are separate from runtime mechanics, product runtimes compose reusable libraries, and platform shells sit at the edge.

```mermaid
flowchart TD
  contracts --> protocol
  contracts --> harness
  native --> harness
  contracts --> tools
  native --> tools
  contracts --> workbench-server
  protocol --> workbench-server
  harness --> workbench-server
  tools --> workbench-server
  contracts --> workbench-app
  protocol --> workbench-app
  ui-kit --> workbench-app
  workbench-server --> desktop-shell
```

Arrows in the diagram mean “is consumed by.” `website` is standalone.

| Package            | Ownership                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `contracts`        | Transport-neutral schemas, events, operations, snapshots, and domain records                |
| `protocol`         | Sessions, RPC, replay, streams, backpressure, reconnect, and transport adapters             |
| `native`           | Normalized Git and managed-process N-API capabilities                                       |
| `harness`          | Agent loop, conversation harness, compaction, models, resources, and execution environment  |
| `tools`            | Canonical tool catalog, execution, policy, result projection, and Git services              |
| `ui-kit`           | Contract-free shadcn primitives, generic composites, renderers, display helpers, and styles |
| `workbench-server` | HTTP/WebSocket adapters, persistence, host use cases, tasks, tools, and run coordination    |
| `workbench-app`    | Svelte composition, application workflows, vertical features, platform adapters, and UI     |
| `desktop-shell`    | Electron lifecycle, daemon supervision, IPC, windows, tray, and packaging                   |
| `website`          | Standalone Astro marketing and documentation site                                           |

## Naming

- TypeScript paths are kebab-case; Svelte/Astro components are PascalCase; Rust modules are snake_case.
- Name files for concepts, not merely `types`, `state`, `helpers`, `utils`, or `operations`.
- `*.service.ts` is a cohesive multi-operation domain/application service.
- `*.repository.ts` owns authoritative record access; `*.store.ts` owns mutable in-memory/client state.
- `*.adapter.ts` translates across a boundary; `*.policy.ts` makes pure decisions.
- `index.ts` is a curated public boundary, never an internal import shortcut.
- Avoid `common`, `shared`, and broad `utils` directories. Reusable code belongs to a named technical or domain area.
- Small domains remain flat; add layer subdirectories only when they improve navigation.

## Runtime composition boundaries

- `workbench-server` composes domain services in `app/bootstrap`; `RuntimeLifecycle` owns hydration, maintenance, and shutdown only. Protocol and HTTP adapters consume narrow service/capability contexts and cannot use the process lifecycle as a service locator. Run-runtime modules depend only on run-local modules, contracts, and `core/ports`.
- `workbench-app` keeps mutable feature stores private. Workspace workflows consume feature-owned read models and named commands; composition registers selection/tab inputs where a direct feature-to-application import would create a cycle. Presentation remains stateless and isolated from application, feature, and platform state.
- `desktop-shell/main.ts` performs bootstrap safety, single-instance acquisition, and `DesktopRuntime` construction. The runtime owns Electron/daemon lifetime state, while window creation, network configuration, direct process spawning, systemd policy, and diagnostic capture live in focused adapters.

## Enforced surfaces

Package export allowlists live in `scripts/lib/package-export-surfaces.mjs`. Contracts, protocol, harness, and tools expose curated concept subpaths rather than broad implementation roots. `pnpm build` verifies every declared concrete build target and each wildcard target after production artifacts are generated. Website token parity is checked at build/check time without adding a runtime UI-kit dependency.

The canonical package inventory and allowed workspace dependencies live in `scripts/lib/workspace-architecture.mjs`. Package-specific `AGENTS.md` and README files define stricter local ownership rules. `scripts/check-package-boundaries.mjs` enforces package exports, runtime ports, feature privacy, presentation isolation, and cross-owner cycle rules.
