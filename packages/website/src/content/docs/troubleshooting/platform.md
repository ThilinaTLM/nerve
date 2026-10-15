---
title: Platform-specific problems
description: Work around Linux display issues and understand native process behavior.
sidebar:
  order: 5
---

Nerve's npm launcher supports Linux, Windows 11, and macOS. This means the source/Electron runtime is supported; signed/notarized installers are not currently released.

## Linux Wayland copy or drag freezes

Chromium/Ozone can emit `Frame latency is negative` or `Invalid state when trying to start drag`. If native Wayland freezes during copy or drag, use XWayland:

```sh
NERVE_ELECTRON_OZONE_PLATFORM=x11 npx @nervekit/desktop@latest
```

Supported values are `x11`, `wayland`, and `auto`. Unset uses Electron's default.

## Processes do not recover after restart

Nerve does not reattach background processes after daemon restart on any supported OS. Async Bash becomes `lost`; launch instances are memory-only, while saved configurations and log files remain. Inspect output and process identity before starting a replacement. Process-tree termination is platform-specific and can be affected by detached children or security software; see [process recovery](/troubleshooting/tasks-and-recovery/).

## File locking

Windows Defender, indexing, sync clients, and briefly open handles can cause transient `EPERM`, `EACCES`, or `EBUSY`. Nerve retries bounded atomic replacements, but persistent locks still fail. Move a test profile away from aggressively synced directories when diagnosing state writes.

## Electron profile versus Nerve home

Resetting `NERVE_HOME` does not clear Electron/browser local storage, and clearing the browser profile does not erase Nerve conversations. Isolate both only when the test requires it.

## Next steps

- [Launch recovery](/troubleshooting/tasks-and-recovery/)
- [Storage troubleshooting](/troubleshooting/storage-and-migration/)
- [Platform reliability for contributors](/developers/platform-reliability/)
