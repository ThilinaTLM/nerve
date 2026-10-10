# Contributing

Thanks for your interest in Nerve. The project is currently beta, so small, focused changes are easiest to review.

## Setup

Install Node.js 24+, pnpm 11.20.0, and rustup (toolchain pinned in `rust-toolchain.toml`), then run `pnpm install`.

## Testing

- While developing, run unit tests for the code you touched: `cd packages/<pkg> && pnpm exec tsx --test <file>.test.ts`.
- Before submitting: `pnpm fix && pnpm check` plus those unit tests.
- Broader suites (`pnpm test:focused`, `pnpm test:full`, `pnpm test:browser`, `*.integration.test.ts`) run in CI. Run them locally only when needed, e.g. to reproduce a CI failure.

Keep scripts and their tests in the owning domain (see [scripts/README.md](scripts/README.md)).

## Development storage

```sh
pnpm dev                     # slot 1: daemon + browser UI
pnpm desktop:dev             # slot 1: desktop
pnpm dev --slot 2            # another slot
pnpm dev:ui --slot 2         # UI against the running slot 2 daemon
pnpm storage:copy --slot 3   # copy stopped ~/.nerve into unused slot 3
```

- Slot `N` (1–100, default 1) uses `data/storage-N` (daemon home) and `data/desktop-profile-N` (Electron profile) under the checkout root; `/data/` is gitignored. Ports: HTTP `43967 + 2*(N-1)`, HTTPS the next port, Vite `5173 + (N-1)`. Occupied ports fail instead of picking another.
- Dev launchers ignore ambient `NERVE_HOME`/profile/target overrides and never touch `~/.nerve`.
- DB schema or migration changes: test against a copied or fresh slot, then delete and recopy it as needed. Stop the slot's daemon/desktop before deleting it. Copied homes keep real credentials and project paths, so a slot is not a sandbox.
- `pnpm desktop:prod` runs source against your real `~/.nerve` and Electron profile, including pending migrations.
- UI against another daemon: `NERVE_HOME="$HOME/.nerve" NERVE_API_TARGET=http://127.0.0.1:3747 pnpm dev:ui`.

## Guidelines

- Keep changes scoped. Test important behavior: public contracts, security/redaction, persistence/migrations, destructive operations, concurrency/state machines, recovery, and complex parsing/orchestration.
- Don't test static exports, pass-through adapters, cosmetics, or behavior covered at its owning layer. Prefer representative boundary cases; extend existing test files when practical.
- Do not commit secrets, local data, build output, or machine-specific paths.
- Keep user-facing text and documentation concise.
- For security issues, follow `SECURITY.md` instead of opening a public issue.
