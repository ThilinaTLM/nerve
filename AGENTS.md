**Development and validation**

- Testing: run only unit tests for touched code: `cd packages/<pkg> && pnpm exec tsx --test <file>.test.ts`. Add/update tests for important behavior only (not exports, pass-through adapters, cosmetics, or behavior covered at its owning layer).
- Suites (`test:focused`, `test:full`, `test:browser`, `*.integration.test.ts`): only when the user asks. CI covers them.
- Completion: code changes: `pnpm fix:focused && pnpm check:focused` plus relevant unit tests; fix and rerun until green. Docs-only: review diff, no validation.
- Focused validation: default `--base origin/main` uses the merge-base with HEAD plus local changes (staged, unstaged, untracked nonignored); `--base HEAD` selects local changes only. `--dry-run` prints each stage's scope, reasons, and commands without execution. Formatting, linting, package/type checks, and Rust scopes are independent: root metadata/ordinary scripts stay narrow; unknown ownership broadens package checks only. Config changes broaden relevant stages; lockfile/workspace resolution uncertainty broadens formatting, linting, and package checks, not Rust. See `scripts/README.md` for details.
- Only unavailable Git/base or change inventory triggers full `pnpm fix`/`pnpm check` fallback, with a warning that full fix can mutate files repository-wide. Broad format/lint autofix also warns; repository-wide lint autofix requires a final full formatting pass. Use full commands for explicit broad validation. Focused checks are not full-validation equivalence; CI/release validation is unchanged.
- Dev instances: `pnpm dev` / `pnpm desktop:dev` use repo-local `data/storage-1` (HTTP `43967`, HTTPS `43968`), never `~/.nerve`; `--slot N` picks another slot, `pnpm dev:ui --slot N` targets it. Other daemon: set `NERVE_HOME` + `NERVE_API_TARGET`. Only `pnpm desktop:prod` uses real data.
- Never stop the daemon you are running in. Every daemon (desktop, dev, demo/screenshots) runs `packages/workbench-server/dist/main.js`, so `pkill -f`/`killall`/port kills hit the live one too. Stop only processes you started, by PID, or let their owner (`launch`, `async_bash`, `scripts/screenshots/run.mjs`) stop them.
- DB schema changes are sensitive; the schema must stay small. Before planning any table/column change, discuss alternatives (files, memory, existing columns) and justify the change with the user, and get explicit approval.
- DB schema/migration changes only: test on a copied/fresh slot (`pnpm storage:copy --slot N`), not slot 1.
- The root `package.json` version is the latest release. All unreleased data changes since then belong in a single migration step; extend it instead of adding another.
- Use `gh` for GitHub operations.

**Architecture**

- Prefer clean, simple architecture over compatibility layers and workaround shims.
- Shared API/event/policy/storage schemas belong in `packages/contracts`; session/RPC/replay/transport lifecycle mechanics in `packages/protocol`. Both remain transport-neutral.

**UI and styling**

- Create planning wireframes with shared UI components and styles as local, mock-only Svelte files in the gitignored `packages/workbench-app/src/lib/app/design-lab/wireframes/` directory (kebab-case filenames, served at `/dev/wireframes/<name>` in development), rather than standalone HTML files.

- Use official shadcn-svelte components from `packages/ui-kit/src/lib/components/ui` and `@lucide/svelte` icons. Improve core components rather than adding wrappers, one-off variants, or size levels.
- Use theme-token Tailwind utilities, including `success`/`warning`/`info`. Use `destructive` for readable red text/tints; opaque fills use `destructive-solid` with `destructive-solid-foreground`.
- Surface ladder: `panel` (shell chrome) < `background` < `card` < `popover`; `well` (recessed output) insets one step below whichever surface holds it. Controls use two height tokens, `--spacing-control` (28px) and `--spacing-control-sm` (24px), enlarged on coarse pointers: Button `default`/`sm`/`icon`/`icon-sm`, ToggleGroup `default`/`sm`, one-size fields/Switch/Checkbox/Radio/IconAction, underline-only Tabs. Never add a size level or patch control heights via class. Monospace is only for code, logs, and paths.
- Shared CSS/tokens live in `packages/ui-kit/src/styles/` (`app.css` entrypoint). Global classes must be deliberate contracts used by at least two components; `scripts/checks/style-policy.mjs` owns the partial allowlist. Follow `packages/workbench-app/AGENTS.md` for the full styling model.
