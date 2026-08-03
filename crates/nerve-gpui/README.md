# Nerve GPUI (experimental)

A native Rust + GPUI client for an **already-running** Nerve daemon. The Svelte workbench and Electron desktop shell remain the primary, supported applications.

Current scope is intentionally read-only: local/remote connection, projects, conversations, transcript snapshots, and Protocol v1 live invalidation/recovery. This client never starts, restarts, stops, migrates, or owns the daemon and never writes to `NERVE_HOME`.

## Run

Start Nerve normally, then use local discovery:

```sh
pnpm dev:gpui
```

Local discovery reads `${NERVE_HOME:-~/.nerve}/daemon.json` and `auth/local-token`.

The interface follows the operating-system appearance. Force a palette for visual review with `--theme light` or `--theme dark`. Use <kbd>Ctrl</kbd>+<kbd>B</kbd> (or click the Conversations activity icon) to toggle the left dock and the arrow keys to move between conversations.

Connect to an existing remote daemon:

```sh
NERVE_DAEMON_TOKEN='<token>' cargo run -p nerve-gpui -- --connect https://nerve.example.test
```

`--token` is also accepted, but the environment variable avoids putting the token in shell history. A token grants daemon access; do not include it in logs or issue reports.

## Prerequisites

- Rust 1.91.1 (installed automatically by rustup from `rust-toolchain.toml`)
- macOS: Xcode command-line tools
- Linux: Vulkan loader, fontconfig, Wayland/X11 and xkbcommon development libraries
- Windows: current Windows SDK/build tools

On Ubuntu/Debian, the core Linux packages are:

```sh
sudo apt-get install build-essential clang libfontconfig-dev libvulkan1 \
  libwayland-dev libx11-xcb-dev libxkbcommon-x11-dev
```

## Validate

```sh
pnpm check:gpui
pnpm test:gpui
```

GPUI is pinned to `0.2.2` because it is pre-1.0. Upgrade it only as a reviewed change with Linux, macOS, and Windows checks.

## Native design system

`packages/ui-kit/src/styles/theme.css` remains the authoritative token source. The native theme mirrors its light/dark OKLCH values, converts them to sRGB for GPUI, and has a conformance test that fails on token drift. The app embeds the same Outfit and Iosevka web-font subsets for deterministic native typography. Bundled fonts retain their OFL licenses; bundled interface icons retain Lucide's ISC license.

Zed is an implementation reference for focus, shell, list, and component patterns only. This crate does not depend on Zed's workspace crates.

Current limitations remain intentional: no composer or mutations, no Git/tasks/settings/right-dock data, no persisted layout, no custom window decorations, and no daemon ownership.
