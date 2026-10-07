---
title: Develop Nerve
description: Set up the monorepo, run desktop/browser development, and validate changes.
sidebar:
  order: 8
---

Requirements: Node.js 24+, pnpm 11.20.0, and rustup. The repository's `rust-toolchain.toml` installs the pinned Rust toolchain (currently 1.97.1).

```sh
git clone https://github.com/ThilinaTLM/nerve.git
cd nerve
pnpm install
pnpm desktop:dev
```

## Development commands

```sh
pnpm desktop:dev            # isolated source desktop (slot 1)
pnpm desktop:prod           # source desktop against real user data
pnpm dev                    # daemon + Vite workbench
pnpm dev:ui                 # UI against a running slot daemon
pnpm storage:copy --slot 2   # stopped ~/.nerve -> unused slot 2
pnpm build                  # TypeScript packages and staged Workbench assets
pnpm build:native           # host Rust addon in packages/native/prebuilds/local
pnpm fix                    # Rust, TypeScript, Svelte, and ESLint fixes
pnpm check                  # formatting, lint, boundaries, package and Rust checks
pnpm test:focused           # select relevant tests with conservative fallbacks
pnpm run test:full          # run the complete package and Rust test suite
```

`pnpm dev` and `pnpm desktop:dev` build the host native addon automatically. The desktop command builds only the native addon, Workbench runtime, and desktop shell; use `pnpm build` when you need every workspace, including the public website. Release prebuilds are separate architecture-specific files and are produced by GitHub Actions.

Development uses `data/storage-N` and a separate `data/desktop-profile-N`, with slot 1 as the default. `desktop:dev`, `dev`, and `dev:ui` accept `--slot N` (1–100). HTTP uses `43967 + 2*(N-1)`; HTTPS uses the next port; Vite uses `5173 + (N-1)`. Full development ignores ambient home/profile/target overrides, binds loopback, and refuses occupied ports or mismatched daemon ownership.

For real-data feature/migration testing, stop the production desktop/daemon, run `pnpm storage:copy --slot 2`, then `pnpm desktop:dev --slot 2`. Copies require an unused destination, reject symlinks, exclude transient ownership and backup state, and are marked disposable. Copied credentials and project paths can still access real services/files. Stop the slot owner before discarding/recopying it. Automated tests continue using fresh temporary homes.

`desktop:prod` is an explicit source-build launch against `~/.nerve` (or an overridden `NERVE_HOME`), not a release build. It may migrate or change your real data. Installed/npm desktop defaults remain unchanged. See [Contributing](https://github.com/ThilinaTLM/nerve/blob/main/CONTRIBUTING.md) for safe slot cleanup and ownership rules.

Enable trusted-LAN and mobile HTTPS access from **Settings → System → Network**, then restart the owned daemon when prompted.

For UI-only development against a running daemon:

```sh
NERVE_HOME="$HOME/.nerve" NERVE_API_TARGET=http://127.0.0.1:3747 pnpm dev:ui
```

For the public site:

```sh
pnpm --filter @nervekit/website dev
pnpm --filter @nervekit/website check
pnpm --filter @nervekit/website build
```

## Isolation

Use explicit `NERVE_HOME`, ports, and Electron profile overrides for tests that can migrate or mutate state. The normal profile intentionally sits outside `NERVE_HOME`; changing only one does not fully isolate a desktop test.

Before completing code changes, repository policy requires `pnpm fix && pnpm check && pnpm test:focused`. Fix failures and rerun the chain. Docs-only changes need diff/path/command review, not code validation. Use `pnpm test:focused --base HEAD` to select tests for uncommitted changes; the default includes branch changes against `origin/main`. Broader validation belongs in CI; run `pnpm test:full` locally only for a specific concern or explicit request. Run `pnpm test:browser` separately when browser behavior is relevant.

## Next steps

- [Package responsibilities](/developers/packages/)
- [Code quality and architecture checks](/developers/code-quality/)
- [Contributing](/developers/contributing/)
