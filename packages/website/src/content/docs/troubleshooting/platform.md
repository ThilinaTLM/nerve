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
NERVE_ELECTRON_OZONE_PLATFORM=x11 npx @nervekit/desktop
```

Supported values are `x11`, `wayland`, and `auto`. Unset uses Electron's default.

## Process recovery differs by OS

Linux verifies `/proc` start identity and process groups. macOS uses process-start fingerprints/groups. Windows uses process creation time and process-tree termination. If Nerve cannot safely prove identity, a task becomes `recovery_unknown` and destructive PID actions remain blocked.

## File locking

Windows Defender, indexing, sync clients, and briefly open handles can cause transient `EPERM`, `EACCES`, or `EBUSY`. Nerve retries bounded atomic replacements, but persistent locks still fail. Move a test profile away from aggressively synced directories when diagnosing state writes.

## Electron profile versus Nerve home

Resetting `NERVE_HOME` does not clear Electron/browser local storage, and clearing the browser profile does not erase Nerve conversations. Isolate both only when the test requires it.

## Next steps

- [Task recovery](/troubleshooting/tasks-and-recovery/)
- [Storage troubleshooting](/troubleshooting/storage-and-migration/)
