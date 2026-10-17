# Startup performance and native compilation

## Goal

Make an unchanged, up-to-date home usable quickly, while retaining blocking migrations and recovery guarantees. Prefer finishing essential initialization quickly over exposing partially initialized services. No database schema changes are needed.

## Current startup path

1. Electron shows the loading window and connects to the daemon. Network setup overlaps daemon launch; authentication, desktop settings, and cache prerequisites precede navigation.
2. The daemon acquires its startup lock, resolves the local token and bind settings, opens a boot HTTP listener, and publishes a boot lease.
3. Storage validates the migration ledger and applies pending migrations. It then prepares directories, configuration, and encrypted secrets.
4. Runtime composition initializes logging, retention, skill catalogs, authentication/models, conversation recovery, maintenance, and optional mobile TLS.
5. The runtime app replaces the boot app, listeners and daemon metadata are published, and lifecycle status becomes ready.
6. The renderer connects protocol channels and loads core settings/workspace state before revealing the workbench. Ancillary refreshes and lazy feature modules follow.

A listening socket or completed desktop navigation is **not** the same as a usable workbench. The boot app and renderer already have loading/progress/error views. Do not remove those gates just to improve a timing number.

Key implementation locations:

- `packages/desktop-shell/src/app/startup-sequence.ts`
- `packages/workbench-server/src/main.ts`
- `packages/workbench-server/src/app/lifecycle/{boot-app,startup-sequence}.ts`
- `packages/workbench-server/src/infrastructure/storage-bootstrap/initialize.ts`
- `packages/workbench-server/src/infrastructure/migrations/framework/`
- `packages/workbench-app/src/lib/application/startup/workbench-client.svelte.ts`

## Evidence and first changes

Historical local slot-4 records include no-migration starts around 10–11 seconds in the daemon, despite storage taking around 80 ms and skill discovery around 130 ms. These records are from earlier builds and are not a current benchmark, but they show why eliminating migration overhead alone cannot justify a claim that startup is fixed.

The initial implementation targets avoidable worker/module-loading overhead when the migration ledger is current, without bypassing migration validation. Fresh, legacy, and pending-upgrade homes continue through the migration worker. Interrupted cleanup uses the same recovery routine as the worker, under the caller's startup lock. Runtime readiness remains blocking; no new partially ready feature state is introduced.

Additional daemon startup timings isolate retention, browser skills, runtime hydration, mobile TLS, and app mounting. Previously the startup record grouped much of this work into the total. These are diagnostic timings, not a performance guarantee.

## Slot-4 measurement (development)

A monitored current-code run against the user-approved slot 4 measured **17,639 ms** from daemon main entry to the listening record:

| Stage                                       |      Duration |
| ------------------------------------------- | ------------: |
| Storage, including current-ledger fast path |          4 ms |
| Logger hydration                            |          9 ms |
| Retention                                   |          1 ms |
| Skill catalogs                              |        115 ms |
| Runtime hydration                           | **17,423 ms** |
| Mobile TLS                                  |         14 ms |
| App mounting                                |          6 ms |

Read-only aggregate counts: 1,219 conversations, 169,569 events, no open tool calls, one queued input. The original recovery derived each conversation's status by repeatedly loading and validating its complete transcript; checking deliverable input also read history even when no input was queued.

The implementation now selects only the latest execution event and final sequence for status projection, reuses that execution lookup within status refresh, and skips history reads for empty input queues. The query uses an existing conversation-event index; no schema change or deferred recovery is required.

Two optimized restarts measured **348 ms** and **399 ms** total. Runtime hydration measured **134 ms** and **149 ms** (132 ms and 147 ms conversation recovery), while storage initialization measured **4 ms** and **7 ms**. This is about a **98% reduction** in the recorded daemon startup duration compared with the baseline run. HTTP health reached `ready`; Agent Browser confirmed the workbench rendered and reported no browser errors.

The `pnpm dev --slot 4` wrapper separately spent about 27 seconds preparing/building dependencies before the daemon became available. That developer-workflow cost is not part of the daemon timings and has not been optimized here.

These are development samples on one Linux machine, not a packaged performance guarantee or a statistically meaningful cold-start distribution. Build preparation time is separate.

## Next measurement and optimization steps

Use `logs/startup.jsonl` on a dedicated development slot, never production data for experiments. Separate:

- packaged cold start versus warm restart;
- daemon spawn versus attachment to an existing daemon;
- current ledger versus a real pending upgrade;
- small versus large conversation/workspace stores;
- mobile HTTPS enabled versus disabled.

Record multiple samples and compare median and tail time to **renderer core-ready**, not just HTTP bind. The daemon timer begins after static module evaluation, so it does not measure all process-launch/module-loading overhead. Renderer process uptime also is not an isolated renderer initialization duration.

Use the new stage timings to choose the next change. Possible follow-ups, requiring dependency and failure-path checks:

- Overlap independent filesystem/catalog work while retaining the catalog-before-recovery boundary.
- Move retention pruning off the critical path with owned shutdown/error handling.
- Optimize conversation recovery if runtime hydration dominates; do not skip recovery or allow runs before it completes.
- Bundle the daemon's JavaScript to reduce module resolution/file reads if process launch dominates. Retain worker entry points, native addon resolution, and resource paths.

Do not introduce background initialization merely to hide latency. If a genuinely slow optional feature must be deferred, give it an explicit loading/ready/failed state, gate its operations, provide retry/error UI, and own its cancellation during shutdown. Existing whole-app lifecycle progress is not a substitute for per-feature readiness once the app is usable.

## Ahead-of-time compilation feasibility

### What is shipped today

Production TypeScript is already compiled to JavaScript (`tsc -b`); it is not executed through the development TypeScript loader. The UI is built with Vite, the desktop uses Electron, and the daemon runs in a Node-compatible process. Electron Builder packages the compiled code and assets. `@nervekit/native` is already a Rust N-API addon with platform-specific release binaries.

These are different operations:

| Option                                         | Meaning                                             | Likely relevance                                                                              |
| ---------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| JavaScript bundling                            | Combine/transform modules                           | May reduce filesystem/module-loading startup overhead; benchmark first                        |
| Runtime bytecode/code cache                    | Engine-specific precompiled representation          | May reduce parsing/compilation; does not remove I/O, recovery, or UI startup                  |
| Standalone executable (Bun compile / Node SEA) | Package code with a JavaScript runtime              | Distribution experiment, not evidence of native machine-code AOT or faster execution          |
| Native implementation (existing Rust addon)    | Compile selected functionality to machine code      | Appropriate for measured CPU-heavy work; does not automatically improve storage/network waits |
| Whole-app native rewrite/AOT                   | Replace or constrain the JavaScript execution model | High compatibility/maintenance cost; not recommended without compelling measurements          |

A standalone daemon would still need compatibility with Node APIs, worker loading, native addons, package/resource paths, child processes, and all supported OS/architectures. It would not replace Electron/Chromium or compile the renderer into a native UI. A second runtime can also increase the desktop distribution footprint rather than reduce it.

**Recommendation:** retain Electron/Node and the existing Rust boundary. First optimize the measured startup path; then try a production JavaScript bundle in a separate benchmark if module loading is significant. Consider a Bun/SEA executable only as an isolated daemon packaging experiment, not a runtime migration or a promised speedup. Move work to Rust only when CPU profiling identifies a suitable bottleneck.

Official references for a follow-up feasibility spike:

- Bun executables: <https://bun.sh/docs/bundler/executables>
- Node single executable applications: <https://nodejs.org/api/single-executable-applications.html>

External documentation access was denied during this investigation. Current support details (including bytecode, ESM, workers, and addon loading) have therefore **not** been verified; no compatibility claim or runtime switch is justified by this research alone.

## Validation limits

Unit tests should cover the unchanged-home fast path and the safety fallbacks, including ledger mismatches and interrupted cleanup. Focused repository checks cover touched code. End-to-end startup improvements still need packaged, multi-platform cold/warm benchmarks; code inspection and historical logs are not substitutes for those measurements.
