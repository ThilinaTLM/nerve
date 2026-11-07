# `@nervekit/desktop-shell`

Private implementation package behind the published `@nervekit/desktop` npm package. The only distribution is `npx @nervekit/desktop`: `bin.ts` is a Node launcher that spawns the `electron` npm binary on this package directory. There is no electron-builder/ASAR packaging.

**Release mode.** `app.isPackaged` is always false under `electron .`, so `bin.ts` sets `NERVE_DESKTOP_RELEASE=1` for the spawned Electron; `src/release-mode.ts` reads it once at startup and removes it from `process.env` so it never reaches the daemon. Repo entrypoints (`pnpm desktop:dev`, `pnpm desktop:prod`, `scripts/start-electron.ts`) never set it and stay in development mode (`desktop:prod` only uses real `~/.nerve` data with a source build). The daemon serves the UI from `workbench-server/dist/web`.

The desktop runtime uses Electron 45. macOS builds require macOS 13 (Ventura) or later; desktop native targets are x64 and arm64 only.

- `bin.ts`, `main.ts`, `preload.cjs`: explicit launcher, thin Electron composition entrypoint, and isolated preload entrypoint. `preload-api.cjs` owns the testable renderer capability factory.
- `app/`: `DesktopRuntime` owns mutable Electron/daemon lifetime state, registered listener disposers, idempotent `start()`, and asynchronous idempotent `dispose()`. `desktop-runtime-ports.ts` defines injected lifecycle capabilities and `create-desktop-runtime.ts` is their sole concrete composition point; adjacent modules own CLI, configuration, startup/recovery, migration, and quit contracts.
- `daemon/`: connection and supervision policy; `adapters/` separates direct process spawning, systemd scope policy, diagnostic capture, health, discovery, and Node port composition.
- `ipc/`: capability-grouped window, daemon, settings, notification, clipboard, and file channels.
- `platform/electron` and `platform/chromium`: Electron/Chromium-specific boundaries, including injected network-session configuration.
- `window`, `tray`, `settings`, `performance`: focused desktop capabilities. `window/main-window.ts` owns hardened window policy through an injected constructor/theme/navigation port, and tray controllers expose explicit disposal.

Keep renderer access behind the preload capability object and keep daemon lifecycle code port-driven. Runtime tests use fakes only; they must not launch Electron or a daemon.
