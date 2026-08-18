---
title: Platform reliability
description: Understand the native filesystem, process, desktop-state, and cross-platform boundaries contributors must preserve.
sidebar:
  order: 6
---

Nerve's npm launcher and source desktop runtime support Linux, Windows 11, and macOS. Signed or notarized native installers are not part of the current release path.

This page describes implementation boundaries that matter when extending the runtime. It is not an operating-system sandbox guarantee; read the [security model](/operations/security/) before treating any policy or permission as isolation.

## Filesystem mutations

Native-safe persistence follows a small set of rules:

- Build paths with `node:path`; never assume `/tmp` or concatenate path separators.
- Create replacement files as unique siblings of their destination. Sync and close the temporary handle before replacing the destination.
- Retry only bounded transient `EPERM`, `EACCES`, and `EBUSY` rename failures. Defender, indexing, sync clients, and briefly open handles can hold a file on Windows.
- Remove an uncommitted temporary file in `finally` and serialize appends/replacements to the same target within a process.
- Do not turn `EXDEV` into copy/delete when an operation depends on atomic movement. Use an explicit recoverable migration instead.
- Treat Unix `0o600`/`0o700` modes as hardening, not as portable Windows authorization.

Workbench persistence uses the shared primitives in [`file-mutations.ts`](https://github.com/ThilinaTLM/nerve/blob/main/packages/workbench-server/src/infrastructure/storage/file-mutations.ts). New persistence code should use those primitives instead of introducing another temp-and-rename implementation.

## Processes and commands

Executable discovery and shutdown are platform-aware:

- Task drivers resolve Git Bash on Windows and standard shells on Unix; Python launchers are resolved separately for each platform.
- Process-tree shutdown cannot assume POSIX groups or signals. Windows keeps the `taskkill` path and bounded fallback behavior.
- Use argument arrays with `spawn()` whenever a shell is not required, and keep `windowsHide: true` for desktop child processes.
- Path parsing, process groups, cancellation, and executable discovery need native Windows and macOS coverage in addition to Linux simulation and failure-injection tests.

## Desktop state boundary

`NERVE_HOME` defaults to `~/.nerve` and contains portable Nerve state. Electron's active Chromium profile intentionally remains in Electron's platform-default `userData` directory outside `NERVE_HOME`. This keeps whole-home backup and migration safe from live browser caches and profile locks. Tests that need isolation must override both locations explicitly.

## Validation matrix

Pull requests and pushes to `main` run the complete checks, Rust and package tests, and built workbench smoke on Ubuntu. The native-host workflow runs host and desktop suites on Windows and macOS after building the relevant runtime. Tagged releases build and execute architecture-specific addons on Linux x64/ARM64, Windows 11 x64/ARM64, macOS Intel, and macOS Apple Silicon. Representative Linux, Windows, and macOS jobs then validate the merged npm and Electron package; workbench-server native-host coverage remains owned by the native-host workflow.

Native runners catch platform behavior. Deterministic failure injection remains necessary for retry limits, cleanup, and non-retriable errors that hosted machines cannot reproduce reliably.

## Related pages

- [Architecture overview](/developers/architecture/)
- [Persistence and security boundaries](/developers/persistence-security/)
- [Platform troubleshooting](/troubleshooting/platform/)
- [Contributing](/developers/contributing/)
