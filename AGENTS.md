**Development and validation**

- Isolation: for SQLite schema, storage-layout, or migration changes, test/debug with a fresh/copied `NERVE_HOME` under `/tmp` and explicit ports. Otherwise, the existing home is fine. Fully isolated desktop tests also need separate Electron `userData` outside `NERVE_HOME`.
- Test important behavior, not static exports, pass-through adapters, cosmetics, or behavior already covered at its owning layer.
- Inner loop: use `pnpm test:focused --base HEAD` for uncommitted changes; omit `--base` to include branch changes against `origin/main`. Add `--dry-run` to preview scope. This does not replace completion checks. Browser tests: `pnpm test:browser`. See `CONTRIBUTING.md` for selection details.
- Completion: docs-only changes (including `AGENTS.md`) need diff/path/command review, not code validation. Otherwise run `pnpm fix && pnpm check && pnpm run test:affected` in one Bash invocation. Substitute `test:full` for root/workspace/test-infrastructure changes, broad validation, or missing `origin/main`. Fix failures and rerun the chain.
- UI: `NERVE_API_TARGET=http://127.0.0.1:3747 pnpm dev:ui` targets an existing daemon (default HTTP `3747`, optional mobile HTTPS `3748`). For an isolated daemon, set its `NERVE_HOME` and target its port; Vite reads the token from that home.
- Use `gh` for GitHub operations.

**Architecture**

- Prefer clean, simple architecture over compatibility layers and workaround shims.
- Shared API/event/policy/storage schemas belong in `packages/contracts`; session/RPC/replay/transport lifecycle mechanics in `packages/protocol`. Both remain transport-neutral.

**UI and styling**

- Use official shadcn-svelte components from `packages/ui-kit/src/lib/components/ui` and `@lucide/svelte` icons. Improve core components rather than adding wrappers, one-off variants, or size levels.
- Use theme-token Tailwind utilities, including `success`/`warning`/`info`. Use `destructive` for readable red text/tints; opaque fills use `destructive-solid` with `destructive-solid-foreground`.
- Surface ladder: `well` (recessed output) < `panel` (shell chrome) < `background` < `card` < `popover`. Controls share heights `xs`/`sm`/`default`/`lg`; Button's `icon-xs`/`icon-sm`/`icon`/`icon-lg` match them. Monospace is only for code, logs, and paths.
- Shared CSS/tokens live in `packages/ui-kit/src/styles/` (`app.css` entrypoint). Global classes must be deliberate contracts used by at least two components; `scripts/lib/style-policy.mjs` owns the partial allowlist. Follow `packages/workbench-app/AGENTS.md` for the full styling model.
