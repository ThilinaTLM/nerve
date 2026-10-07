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

Do not routinely follow focused testing with `test:affected` or `test:full`; broader validation belongs in CI. Run those suites locally only for a specific concern (such as suspected selection gaps, cross-package runtime coupling, or reproducing a CI failure) or an explicit request. The selector's automatic conservative fallbacks still apply. Import graphs cannot capture all runtime coupling; run `pnpm test:browser` separately when browser behavior is relevant.

Repository tooling follows the [scripts placement guide](scripts/README.md); keep scripts and their tests in the owning domain.

### Isolated desktop development

```sh
pnpm run desktop:dev
```

This builds and opens a separate desktop using the repository's `data/storage-1` as `NERVE_HOME` and `data/desktop-profile-1` as Electron's profile, regardless of ambient home/profile settings. HTTP uses `43967`; mobile HTTPS uses `43968`. The root `/data/` directory is ignored by Git. The command takes no arguments; `pnpm desktop` keeps its existing behavior.

Only an authenticated daemon recorded in this development home with matching paths and ports can be reused. Occupied ports or mismatched metadata fail without stopping other processes. A reused daemon remains externally owned and is not stopped when this desktop quits. Credentials come from the development home; the launcher does not copy credentials from `~/.nerve`.

Quit the development desktop normally before cleanup. If it reused an external daemon, stop that daemon through its original owner first. Once neither is running, remove `data/desktop-profile-1` to reset Electron state, or `data/storage-1` to discard development storage. Never remove a live home or stop a process solely because it occupies one of these ports.

## Guidelines

- Keep changes scoped. Add automated tests for important behavior: public contracts, security and redaction, persistence and migrations, destructive operations, concurrency and state machines, recovery and failure handling, and complex parsing or orchestration.
- Do not add tests solely for static exports or constants, pass-through adapters or routes, cosmetic presentation, animation details, or behavior already covered at its owning layer.
- Prefer representative boundary cases over exhaustive permutations. Extend an existing relevant test file instead of adding another test worker when practical.
- Do not commit secrets, local data, build output, or machine-specific paths.
- Keep user-facing text and documentation concise.
- For security issues, follow `SECURITY.md` instead of opening a public issue.
