# Contributing

Thanks for your interest in Nerve. The project is currently beta, so small, focused changes are easiest to review.

## Development

Install Node.js 24+, pnpm 11.20.0, and rustup. The repository pins its Rust toolchain in `rust-toolchain.toml`.

```sh
pnpm install
pnpm fix
pnpm check
pnpm test:focused
```

Focused testing is the default for local development and completion. Run `pnpm fix && pnpm check && pnpm test:focused` before completing code changes; fix failures and rerun the chain. Docs-only changes need diff/path/command review, not code validation.

For faster feedback on uncommitted changes while editing:

```sh
pnpm test:focused --base HEAD --dry-run
pnpm test:focused --base HEAD
```

Without `--base`, selection includes branch changes since the merge-base with `origin/main`, plus staged, unstaged, and nonignored untracked files. `--base HEAD` selects current uncommitted changes. Dry-run prints selected tests, reasons, fallbacks, and prerequisites without running builds or tests.

The selector follows JavaScript/TypeScript imports across workspace source exports. Filesystem/process-driven tests are selected conservatively; configuration, assets, fixtures, native code, unsupported formats, deleted files, and sources without known tests fall back to complete affected package suites. Global/unknown changes or an unavailable base fall back to `test:full`. Root script tests remain a baseline; native and emitted workspace APIs are built when required.

Do not routinely follow focused testing with `test:full`; broader validation belongs in CI. Run the full suite locally only for a specific concern (such as suspected selection gaps, cross-package runtime coupling, or reproducing a CI failure) or an explicit request. The selector's automatic conservative fallbacks still apply. Import graphs cannot capture all runtime coupling; run `pnpm test:browser` separately when browser behavior is relevant.

Repository tooling follows the [scripts placement guide](scripts/README.md); keep scripts and their tests in the owning domain.

### Isolated development storage

```sh
pnpm desktop:dev             # slot 1: desktop with checkout-local storage
pnpm dev --slot 2            # slot 2: daemon + browser UI
pnpm dev:ui --slot 2         # UI against the running slot 2 daemon
pnpm storage:copy --slot 3   # stopped ~/.nerve -> unused slot 3
pnpm desktop:dev --slot 3
```

Slots accept integers 1–100 (default 1). Paths resolve from the checkout root, not the current directory: `data/storage-N` is the daemon home and `data/desktop-profile-N` is Electron's separate profile. Git ignores `/data/`. HTTP uses `43967 + 2*(N-1)`, mobile HTTPS uses the next port, and Vite uses `5173 + (N-1)`. Occupied ports fail rather than silently choosing another port. Concurrent slots share build outputs; avoid concurrent rebuilds.

`desktop:dev` and `dev` ignore ambient home/profile/target overrides and bind loopback. New homes use normal storage initialization. Manually copied homes with supported manifests are accepted regardless of home class and left unchanged for the daemon/desktop startup migration workflow; malformed layouts are still refused. No disposable label or special copy command is required. Only an authenticated daemon recorded in this slot with matching paths and ports can be reused; it remains externally owned and is not stopped on exit. Mismatched metadata and occupied ports fail without stopping other processes. Development launchers use credentials from the slot, not from `~/.nerve`.

`storage:copy` always reads `~/.nerve`, regardless of ambient `NERVE_HOME`. Stop its owning desktop/daemon first. Copying holds startup locks, refuses live owners or malformed ownership metadata, excludes daemon records/backups/migration work, rejects linked storage content, and marks the result disposable. Existing destinations are refused even when empty; nothing is overwritten. Copied credentials and absolute project paths can still access real providers and files: storage isolation is **not** a sandbox.

Manual filesystem copies into `data/storage-N` are supported without editing manifests or removing `daemon.json`. The launcher automatically discards the destination's copied daemon record when it names another home, without contacting or stopping the source daemon or changing its files. Matching slot records still permit authenticated reuse. Copy into a real directory, not a symlink to the source, and do not overwrite a running destination slot. Stop the source first or use a consistent snapshot when copying SQLite data; copying live database/WAL files independently may produce an inconsistent copy. `storage:copy` handles offline copying and exclusions automatically but is optional.

Quit the development desktop/daemon before resetting a slot. Stop a reused daemon through its original owner. Once neither is running, remove `data/desktop-profile-N` to reset Electron state or `data/storage-N` to discard storage and recopy. Never delete a live home or stop a process merely because it occupies a slot port. For manual migration iteration, copy a slot, run the development build, inspect its logs, then discard/recopy when needed. Automated tests retain fresh temporary homes rather than shared persistent slots.

### Explicit production-data launch

`pnpm desktop:prod` builds and runs source code against `~/.nerve` and the normal Electron profile by default. It respects explicit `NERVE_HOME` and launch arguments. This is not a release build; pending finalized migrations and new features may affect your real data. Installed/npm desktop apps retain their normal `~/.nerve` default. The ambiguous `pnpm desktop` command is removed.

To run only the UI against an existing non-slot daemon, explicitly pair its home and target so Vite reads the correct local token:

```sh
NERVE_HOME="$HOME/.nerve" NERVE_API_TARGET=http://127.0.0.1:3747 pnpm dev:ui
```

UI-only overrides do not initialize or mutate the chosen external home. Without overrides, `dev:ui` requires a running authenticated slot daemon.

## Guidelines

- Keep changes scoped. Add automated tests for important behavior: public contracts, security and redaction, persistence and migrations, destructive operations, concurrency and state machines, recovery and failure handling, and complex parsing or orchestration.
- Do not add tests solely for static exports or constants, pass-through adapters or routes, cosmetic presentation, animation details, or behavior already covered at its owning layer.
- Prefer representative boundary cases over exhaustive permutations. Extend an existing relevant test file instead of adding another test worker when practical.
- Do not commit secrets, local data, build output, or machine-specific paths.
- Keep user-facing text and documentation concise.
- For security issues, follow `SECURITY.md` instead of opening a public issue.
