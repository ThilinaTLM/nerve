# `@nervekit/desktop-shell`

Private implementation package used to assemble the published `@nervekit/desktop` artifact.

- `bin.ts`, `main.ts`, `preload.cjs`: explicit launcher, thin Electron composition entrypoint, and isolated preload entrypoint. `preload-api.cjs` owns the testable renderer capability factory.
- `app/`: `DesktopRuntime` owns mutable Electron/daemon lifetime state, registered listener disposers, idempotent `start()`, and asynchronous idempotent `dispose()`. `desktop-runtime-ports.ts` defines injected lifecycle capabilities and `create-desktop-runtime.ts` is their sole concrete composition point; adjacent modules own CLI, configuration, startup/recovery, migration, and quit contracts.
- `daemon/`: connection and supervision policy; `adapters/` separates direct process spawning, systemd scope policy, diagnostic capture, health, discovery, and Node port composition.
- `ipc/`: capability-grouped window, daemon, settings, notification, clipboard, and file channels.
- `platform/electron` and `platform/chromium`: Electron/Chromium-specific boundaries, including injected network-session configuration.
- `window`, `tray`, `settings`, `performance`: focused desktop capabilities. `window/main-window.ts` owns hardened window policy through an injected constructor/theme/navigation port, and tray controllers expose explicit disposal.

Keep renderer access behind the preload capability object and keep daemon lifecycle code port-driven. Runtime tests use fakes only; they must not launch Electron or a daemon.
