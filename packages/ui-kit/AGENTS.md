# UI kit (`packages/ui-kit`)

Inherits the root `AGENTS.md`. This package is the source of official shadcn-svelte primitives, shared theme styles, generic Markdown/code/terminal renderers, and generic browser/display utilities.

- Never depend on Nerve contracts, protocol, host state, or app packages.
- Use theme-token Tailwind utilities and official shadcn-svelte components; use `@lucide/svelte` for icons.
- Keep mono typography for code, logs, and paths only.
- Global shared CSS belongs in `src/styles/` with `app.css` as its entry.
- Validate with `pnpm --filter @nervekit/ui-kit check` and relevant tests.
