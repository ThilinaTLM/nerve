- Keep changes scoped to `nerve`; read `../pi` and `../pi-toolbelt` only as references unless explicitly asked to modify them.
- This is an early foundation project: prefer clean direct designs over compatibility shims.
- Keep shared API, event, policy, and storage schemas in `packages/shared`; keep protocol types transport-neutral.
- Keep secrets and dangerous capabilities in the orchestrator/tool layer, never in frontend code.
- Use file-first storage under `~/.nerve`; SQLite is only a rebuildable index/cache.
- Validate with `pnpm check`; use `pnpm lint` and `pnpm test` when relevant.
- For UI work, follow `DESIGN.md`. Use the official shadcn-svelte components in
  `packages/web/src/lib/components/ui` (add more via `pnpm dlx shadcn-svelte@latest add
  <name>`); style only with the shadcn tokens (+ `success`/`warning`/`info`), never
  hard-coded colors; use `@lucide/svelte` for icons and keep mono for code/logs/paths only.
  The theme lives in `packages/web/src/app.css` (Jamaica, swappable from tweakcn).
- Use the `agent-browser` skill for UI debugging and browser-based testing.
- Refer `https://www.shadcn-svelte.com` and `https://bits-ui.com/docs/llms/llms.txt` for docs.
