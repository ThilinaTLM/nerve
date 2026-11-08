# Startup and reconnection

Startup brings a Nerve home into a usable state and connects the user to it. The daemon owns storage initialization and upgrades; the web app shows progress and recovery actions. The desktop shell launches or attaches to a daemon and supervises its process, so browser and desktop users share the same storage recovery flow.

```mermaid
sequenceDiagram
  participant S as Desktop shell
  participant D as Daemon
  participant M as Migration worker
  participant A as Web app
  S->>D: Spawn or attach
  D->>D: Lock home, resolve token, bind boot HTTP
  D-->>S: HTTP reachable, discovery published
  S->>A: Load daemon URL
  D->>M: Run pending storage upgrades
  A->>D: Poll lifecycle
  alt Storage succeeds
    M-->>D: Upgrades complete
    D->>D: Finish initialization, mount runtime, publish ready
    D-->>A: Ready
    A->>D: Connect application channels
  else Storage fails
    M-->>D: Failure and recovery details
    D-->>A: Failed, with available actions
    A->>D: Request retry or rollback
    D->>M: Apply recovery decision
    Note over D,A: Retry repeats initialization, successful rollback stays failed
  end
```

A browser starts at the web-app participant; it does not need a shell.

## Why HTTP starts early

The daemon binds a small boot application before opening normal storage. This makes a slow or failed upgrade observable over HTTP instead of looking like an unreachable process. Once storage succeeds, the daemon constructs the runtime and switches the existing listener to the full application.

Migration work runs in a worker thread so synchronous database conversion cannot starve lifecycle requests. A **lifecycle** is the server's reported startup state and available recovery actions. The home startup lock excludes other storage writers through initialization and daemon publication, so offline tools cannot enter midway through that transition.

The initial listener uses bootstrap settings. If migration changes the configured bind address or port, those changes apply on the next restart; keeping the listener stable lets clients finish observing the current upgrade.

## Failures and recovery

Admission failures happen before any upgrade runs. The daemon reports a typed kind, and the desktop startup screen shows the home path and the choices that apply instead of a retry that cannot succeed. Failures attributable to one conversation or settings document are set aside during the upgrade and reported after startup, so they never reach the user as startup failures. Home-level storage failures leave the daemon reachable so the web app can offer retry or rollback when available. What each decision preserves is in [storage migrations](migrations.md).

A successful rollback leaves the daemon alive in a terminal failed state until the process is quit, so a supervisor does not immediately upgrade the restored home again. Runtime construction failures are fatal because the normal application could not be mounted. Invalid runtime-owned home settings use a separate, non-blocking [settings recovery](storage.md#settings-health) path, and an unreadable conversation is skipped rather than failing startup; see [unreadable conversations](storage.md#unreadable-conversations).

## Connecting and reconnecting

The web app waits for readiness before normal startup, so application channels never connect to a daemon that has no runtime. After a disconnect it checks lifecycle again: a changed server version reloads the page, while a same-version restart lets protocol reconnection resynchronize state. Polling works here because it survives server restarts without requiring a live session.

The shell hands off when HTTP is reachable, rather than waiting for full readiness, so migration progress remains visible. Its error page handles failure to reach a daemon; storage decisions stay in the web app. Normal conversation status and notifications are covered by [conversation state and attention](conversation-state-and-attention.md).

## Where it lives

| Concern                            | Owner                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lifecycle contract                 | [`ServerLifecycle`](../../packages/contracts/src/domains/status/lifecycle.ts)                                                                                                                                                  |
| Early bind and runtime handoff     | [`main`](../../packages/workbench-server/src/main.ts); [`createBootApp`](../../packages/workbench-server/src/app/lifecycle/boot-app.ts)                                                                                        |
| Storage/fatal failure split        | [`createStartupSequence`](../../packages/workbench-server/src/app/lifecycle/startup-sequence.ts)                                                                                                                               |
| Initialization and worker boundary | [`initializeStorage`](../../packages/workbench-server/src/infrastructure/storage-bootstrap/initialize.ts); [`runMigrationsInWorker`](../../packages/workbench-server/src/infrastructure/migrations/framework/worker-client.ts) |
| Recovery actions                   | [`storageRecoveryControls`](../../packages/workbench-server/src/app/lifecycle/storage-recovery.ts)                                                                                                                             |
| Web boot gate and reconnection     | [`waitForServerReady`](../../packages/workbench-app/src/lib/application/startup/server-lifecycle.svelte.ts) and its lifecycle monitor                                                                                          |
| Admission failure page             | [`errorHtml`](../../packages/desktop-shell/src/window/loading-pages.ts)                                                                                                                                                        |
| Shell supervision                  | [`DesktopRuntime`](../../packages/desktop-shell/src/app/desktop-runtime.ts)                                                                                                                                                    |
