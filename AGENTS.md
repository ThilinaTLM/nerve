**Development and validation**

- Testing: run only unit tests for touched code: `cd packages/<pkg> && pnpm exec tsx --test <file>.test.ts`. Add/update tests for important behavior only (not exports, pass-through adapters, cosmetics, or behavior covered at its owning layer).
- Suites (`test:focused`, `test:full`, `test:browser`, `*.integration.test.ts`): only when the user asks. CI covers them.
- Completion: code changes: `pnpm fix && pnpm check` plus relevant unit tests; fix and rerun until green. Docs-only: review diff, no validation.
- Dev instances: `pnpm dev` / `pnpm desktop:dev` use repo-local `data/storage-1` (HTTP `43967`, HTTPS `43968`), never `~/.nerve`; `--slot N` picks another slot, `pnpm dev:ui --slot N` targets it. Other daemon: set `NERVE_HOME` + `NERVE_API_TARGET`. Only `pnpm desktop:prod` uses real data.
- DB schema/migration changes only: test on a copied/fresh slot (`pnpm storage:copy --slot N`), not slot 1.
- Use `gh` for GitHub operations.

**Architecture**

- Prefer clean, simple architecture over compatibility layers and workaround shims.
- Shared API/event/policy/storage schemas belong in `packages/contracts`; session/RPC/replay/transport lifecycle mechanics in `packages/protocol`. Both remain transport-neutral.

**UI and styling**

- Use official shadcn-svelte components from `packages/ui-kit/src/lib/components/ui` and `@lucide/svelte` icons. Improve core components rather than adding wrappers, one-off variants, or size levels.
- Use theme-token Tailwind utilities, including `success`/`warning`/`info`. Use `destructive` for readable red text/tints; opaque fills use `destructive-solid` with `destructive-solid-foreground`.
- Surface ladder: `well` (recessed output) < `panel` (shell chrome) < `background` < `card` < `popover`. Controls share heights `xs`/`sm`/`default`/`lg`; Button's `icon-xs`/`icon-sm`/`icon`/`icon-lg` match them. Monospace is only for code, logs, and paths.
- Shared CSS/tokens live in `packages/ui-kit/src/styles/` (`app.css` entrypoint). Global classes must be deliberate contracts used by at least two components; `scripts/checks/style-policy.mjs` owns the partial allowlist. Follow `packages/workbench-app/AGENTS.md` for the full styling model.
