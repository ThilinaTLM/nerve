# Native UI evaluation

Status: **experimental spike; no migration decision**

Nerve is evaluating a Rust/GPUI desktop frontend while retaining the existing TypeScript/Node daemon and Nerve Protocol v1. The Electron/Svelte application remains the supported desktop product and the browser/mobile frontend.

## Why GPUI

The experiment prioritizes responsiveness for a developer-tool workload:

| Candidate | Decision                                                                                                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPUI      | Selected for the first spike. GPU-native, optimized large-list primitives, native text/event integration, and production evidence from Zed. Main risks are pre-1.0 API churn, standalone documentation, accessibility maturity, and recently broadened Windows support. |
| Slint     | Fallback candidate. Strong cross-platform toolkit and accessibility story, but Nerve would own more custom rich transcript/code/diff rendering and its desktop rich-text capabilities are still evolving.                                                               |
| Iced      | Native and cross-platform, but currently describes itself as experimental and requires more workbench widget plumbing.                                                                                                                                                  |
| Dioxus    | Not suitable for this hypothesis because its stable desktop renderer uses a system WebView. It may reduce Electron overhead, but does not test non-WebView rendering.                                                                                                   |

GPUI and the spike are Apache-2.0 licensed. `gpui-component` is used for its native multiline text input and is also Apache-2.0.

## Boundaries

- `packages/workbench-server` remains authoritative for storage, authentication, agent execution, Git, tasks, and all domain behavior.
- `packages/contracts` remains authoritative for wire schemas.
- The Rust application is a bounded Protocol v1 client. It may create a conversation and default-configured agent, and start text runs for the native conversation/chat vertical slice. It does not create projects, resolve approvals/questions/plans, mutate settings, or control other daemon domains.
- The spike discovers `NERVE_HOME` (default `~/.nerve`) and reads `daemon.json` plus `auth/local-token`, or accepts `--connect` and `--token`. Credentials are sent as Bearer authentication and redacted from `Debug` output.
- The spike does not launch, supervise, restart, migrate, package, or terminate the Node daemon.
- No active native UI profile or cache is stored inside `NERVE_HOME`.
- Electron and GPUI are parallel frontends. Native widgets are not embedded into Electron and no WebView is embedded into GPUI.

## Implemented evaluation surface

`native/nerve-gpui` currently provides:

- a GPUI native window with project-grouped conversation navigation modeled on the supported workbench;
- draft-first new conversations from an existing project: the durable conversation and default-configured agent are created on first send;
- selectable conversation snapshots, a lazily rendered durable/streaming text transcript, and first/subsequent text runs;
- a native multiline composer supporting the platform text input path, selection, clipboard, IME, a send button, and secondary-Enter submission through `gpui-component`;
- a separate variable-height, lazily rendered 10,000-row evaluation scene using GPUI `ListState`;
- local/explicit daemon discovery with authenticated HTTP/WebSocket endpoints;
- a persistent Protocol v1 session with capability negotiation, request correlation, heartbeat replies, workspace/conversation subscriptions, bounded reconnect, cursor/recovery logic, and snapshot refresh;
- workspace/conversation snapshot and live-event reducers with cursor advancement only after reducer completion;
- generated cross-language conformance fixtures in `packages/contracts/schemas/native-spike-v1.fixtures.json`, validated by both TypeScript/Zod and Rust tests;
- deterministic model-generation benchmark output and a manual interactive-comparison report scaffold.

Full tool-card rendering, approvals, user questions, plan review, attachments, model/settings controls, run steering/cancellation, project creation, production daemon ownership, packaging, notifications, tray behavior, and installers remain outside this implementation. Runs requiring an unsupported interaction must be completed in the supported Web UI.

## Run

Start the existing daemon first:

```sh
pnpm --filter @nervekit/workbench-server dev
```

Then run the native client:

```sh
pnpm native:dev
```

Run without a daemon against deterministic content:

```sh
pnpm native:dev --evaluation
```

Connect explicitly without persisting the token:

```sh
pnpm native:dev --connect http://127.0.0.1:3747 --token <token>
```

Validate authenticated Protocol v1 negotiation and a workspace snapshot without opening a window:

```sh
pnpm native:dev --probe-daemon
```

The token must not be copied into logs, benchmark artifacts, issue reports, or shell history shared with others.

## Validation

```sh
pnpm --filter @nervekit/contracts schema:native-spike:generate
pnpm native:check
pnpm native:test
pnpm native:build
pnpm native:benchmark
```

The repository gate also runs Rust formatting, Clippy, and tests:

```sh
pnpm fix && pnpm check && pnpm test
```

Linux, Windows, and macOS CI compile and test the spike. Interactive GPU, IME, clipboard, accessibility, X11/Wayland, and screen-reader checks remain manual because they are not reliable in hosted CI.

## Benchmark method

Compare release builds only, on the same machine, with identical transcript data, viewport, window scale, theme, and streaming cadence. Exclude the shared daemon from both client memory totals. Include all Electron browser/renderer/GPU processes in the Electron control.

Run at least three repetitions and report median plus p95 for:

- first interactive frame;
- idle client RSS;
- typing-to-paint latency;
- scroll frame time and frames over 33.3 ms;
- controlled streaming-update cost;
- conversation-switch latency.

`pnpm native:benchmark` builds the native release executable, records deterministic CPU model-fixture timing and binary size, and writes ignored local output under `native/benchmark-results/`. It explicitly marks interactive and Electron-control measurements as pending; CPU model timing is not evidence of UI responsiveness.

## Go/no-go gates

A **go** requires all of the following:

- no Protocol v1 contract fork and passing session/replay/recovery tests;
- stable selection/copy and virtualization for 10,000 variable-height rows during streaming;
- primary-platform p95 typing and scroll frames within 16.7 ms, with fewer than 1% over 33.3 ms;
- at least 30% lower median idle client RSS and at least 50% fewer frames over 33.3 ms than Electron, with no first-interactive or conversation-switch regression;
- usable builds on Windows 11, macOS, Linux X11, and Linux Wayland;
- working keyboard-only paths, IME, clipboard, focus semantics, and inspectable accessibility roles/actions;
- no private GPUI fork and no credential leakage.

A bounded upstream issue can produce **conditional**, with an owner and deadline. Missing performance benefit, protocol compromises, a required private fork, or blocking platform/text/accessibility defects produce **no-go**.

No gate has been declared passed yet. This document must be updated with hardware, raw reports, platform checklist evidence, and a final `go`, `conditional`, or `no-go` decision before production migration starts.

## Possible migration after a go decision

A separate reviewed plan would first establish production cross-language contract generation and a Rust launcher that safely packages/supervises the existing Node daemon. Complete vertical slices would then move behind an experimental channel: shell/navigation; transcript/composer/run controls; approvals/questions/plans; files/Git/tasks/logs; settings/auth/audio/platform integration. Electron would remain until desktop parity is complete, while Svelte remains for browser/mobile access.
