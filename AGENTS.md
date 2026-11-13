**Development and validation**

- Testing: run only unit tests for touched code: `cd packages/<pkg> && pnpm exec tsx --test <file>.test.ts`. Add/update tests for important behavior only (not exports, pass-through adapters, cosmetics, or behavior covered at its owning layer).
- Suites (`test:focused`, `test:full`, `test:browser`, `*.integration.test.ts`): only when the user asks. CI covers them.
- Completion: code changes: `pnpm fix:focused && pnpm check:focused` plus relevant unit tests; fix and rerun until green. Docs-only: review diff, no validation. Flags, scope rules and fallbacks: `scripts/README.md`.
- Dev instances: `pnpm dev` / `pnpm desktop:dev` use repo-local `data/storage-1` (HTTP `43967`, HTTPS `43968`), never `~/.nerve` (an inherited `NERVE_HOME` overrides this); `--slot N` picks another slot, `pnpm dev:ui --slot N` targets it. Other daemon: set `NERVE_HOME` + `NERVE_API_TARGET`. Only `pnpm desktop:prod` uses real data.
- Never stop the daemon that hosts your session. Every daemon (desktop, dev, demo/screenshots) runs `packages/workbench-server/dist/main.js`, so `pkill -f`/`killall`/port kills hit the live one too. Stop only processes you started, by PID, or let their owner (`launch`, `async_bash`, `packages/website/scripts/screenshots/run.ts`) stop them.
- DB schema changes are sensitive; the schema must stay small. Before planning any table/column change, discuss alternatives (files, memory, existing columns) and justify the change with the user, and get explicit approval. Test schema/migration changes on a copied/fresh slot (`pnpm storage:copy --slot N`), not slot 1.
- The root `package.json` version is the latest release. All unreleased data changes since then belong in a single migration step; extend it instead of adding another.
- Use .worktrees to create additional worktrees only when tasks need to be handled in parallel.

**Architecture**

- Prefer clean, simple architecture over compatibility layers and workaround shims.
- Shared API/event/policy/storage schemas belong in `packages/contracts`; session/RPC/replay/transport lifecycle mechanics in `packages/protocol`. Both stay transport-neutral (protocol's concrete adapters live in `src/adapters/`).

**Agent-facing content**

- When editing anything a model reads (prompts, tool descriptions/results/errors, skills, `AGENTS.md`, agent docs, prompt suggestions), follow `docs/agent-facing.md`.

**UI**

- UI rules live in `packages/workbench-app/AGENTS.md` and `packages/ui-kit/AGENTS.md`; the full styling model is in `docs/ui/`.
