# `@nervekit/desktop-shell`

Private implementation package used to assemble the published `@nervekit/desktop` artifact.

- `bin.ts`, `main.ts`, `preload.cjs`: explicit launcher, Electron main, and isolated preload entrypoints.
- `app/`: CLI, desktop configuration, startup/recovery, migration, and quit orchestration.
- `daemon/`: connection and supervision policy; `adapters/` separates launch/diagnostics, health, discovery, and Node port composition.
- `ipc/`: capability-grouped window, daemon, settings, notification, clipboard, and file channels.
- `platform/electron` and `platform/chromium`: Electron/Chromium-specific boundaries.
- `window`, `tray`, `settings`, `performance`: focused desktop capabilities.

Keep renderer access behind the preload capability object and keep daemon lifecycle code port-driven.
