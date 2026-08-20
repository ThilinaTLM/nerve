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
pnpm desktop
```

## Development commands

```sh
pnpm desktop                # Electron app from source
pnpm dev                    # daemon + Vite workbench
pnpm dev:ui                 # UI against an existing daemon
pnpm build                  # TypeScript packages and staged Workbench assets
pnpm build:native           # host Rust addon in packages/native/prebuilds/local
pnpm fix                    # Rust, TypeScript, Svelte, and ESLint fixes
pnpm check                  # formatting, lint, boundaries, package and Rust checks
pnpm test                   # build the host addon, then run package and Rust tests
```

`pnpm dev` and `pnpm desktop` build the host native addon automatically. Release prebuilds are separate architecture-specific files and are produced by GitHub Actions.

Enable trusted-LAN and mobile HTTPS access from **Settings → System → Network**, then restart the owned daemon when prompted.

For UI-only development against a running daemon:

```sh
NERVE_API_TARGET=http://127.0.0.1:3747 pnpm dev:ui
```

For the public site:

```sh
pnpm --filter @nervekit/website dev
pnpm --filter @nervekit/website check
pnpm --filter @nervekit/website build
```

## Isolation

Use explicit `NERVE_HOME`, ports, and Electron profile overrides for tests that can migrate or mutate state. The normal profile intentionally sits outside `NERVE_HOME`; changing only one does not fully isolate a desktop test.

Before completing code changes, repository policy requires `pnpm fix && pnpm check && pnpm test`, then a rerun after fixes.

## Next steps

- [Package responsibilities](/developers/packages/)
- [Contributing](/developers/contributing/)
