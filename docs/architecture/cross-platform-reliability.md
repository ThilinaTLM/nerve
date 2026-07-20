# Cross-platform reliability

Nerve's native npm launcher and source desktop runtime support Linux, Windows 11, and macOS. Sandbox images remain Linux runtimes. Signed/notarized native installers are not currently part of the release path.

## Native-host invariants

### Filesystem mutations

- Build paths with `node:path`; do not concatenate separators or assume `/tmp`.
- Write replacement files as unique, exclusively-created siblings of the target. Keeping the temp file beside the destination preserves same-filesystem rename semantics.
- Sync and close the temporary handle before replacement.
- Retry bounded transient `EPERM`, `EACCES`, and `EBUSY` rename failures. Windows Defender, indexing, sync clients, and briefly open handles can produce these errors even when permissions are correct.
- Always remove an uncommitted temporary file in `finally`.
- Serialize appends and replacements to the same target within a process.
- Do not silently turn `EXDEV` into copy/delete where an operation relies on atomic movement. Design an explicit recoverable migration instead.
- POSIX modes do not provide Windows ACL enforcement. Treat `0o600`/`0o700` as Unix hardening, not as a portable authorization boundary.

Workbench-server native state uses the primitives in `packages/workbench-server/src/infrastructure/storage/file-mutations.ts`. New workbench persistence must use those primitives rather than adding another temp-plus-rename implementation.

### Processes and commands

- Keep executable discovery platform-aware. The Bash tool resolves Git Bash on Windows and standard shells on Unix; Python resolves Windows launchers and Unix executables separately.
- Do not assume POSIX process groups or signals on Windows. Process-tree shutdown must retain the `taskkill` path and bounded fallback behavior.
- Use argument arrays with `spawn()` whenever a shell is not required. Keep `windowsHide: true` for desktop child processes.
- Tests for path parsing, process groups, cancellation, and executable discovery must run on native Windows and macOS runners, not only through Linux simulations.

### Electron state

`NERVE_HOME` defaults to `~/.nerve` and contains portable Nerve state. Electron's active Chromium profile intentionally remains in Electron's platform-default `userData` directory outside `NERVE_HOME`. This keeps whole-home Nerve backup and migration safe from live browser caches and profile locks. Tests that require isolation must override both locations explicitly.

## Continuous validation

Pull requests and pushes to `main` run:

- the complete checks and tests on Ubuntu;
- tools, host-runtime, workbench-server, and desktop-shell tests on native Windows and macOS after building the desktop runtime.

Tagged release package smoke also runs those host tests and desktop packaging on all three operating systems. Container and image smoke remains Linux-only because the shipped sandbox artifacts are Linux images.

Failure-injection tests remain required in addition to native runners. Native CI catches path and operating-system behavior, while deterministic injection verifies retry limits, cleanup, and non-retriable errors reliably.

## Follow-up backlog

1. Make SQLite database plus WAL/SHM replacement in `packages/workbench-server/src/infrastructure/index-store/index-store.ts` transactional and resilient to transient native-host file contention.
2. Consolidate the duplicate sandbox-manager and sandbox-agent atomic-write implementations when Linux container persistence is revisited.
3. Harden sandbox JSONL replacement and archival paths with the consolidated container primitive.
4. Configure macOS signing/notarization and macOS installation integration after Apple credentials and distribution requirements are chosen.
5. Configure Windows code signing if native installers become a supported release artifact.
6. Periodically test on real machines with Defender/cloud sync enabled, long user paths, case-insensitive filesystems, and nested process cancellation. Hosted CI cannot reproduce every external file-lock or endpoint-security interaction.
