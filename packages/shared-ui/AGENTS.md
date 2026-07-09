# Shared UI package (`packages/shared-ui`)

Inherits the root `AGENTS.md`. This package contains shared Svelte UI primitives, conversation UI, theme/styles, and generic browser/display helpers for Nerve apps.

- Keep this package app-neutral: no orchestrator, sandbox-manager state, secrets, desktop bridge, or app-specific stores.
- Presentational surfaces include `components/workbench/*`, `components/navigator/*`, conversation transcript/composer components, and tool-call views. They take data + snippets in and emit events/capability calls out; do not import app `$lib` modules.
- Do not import from app `$lib` aliases. Exported source must use relative imports or `@nervekit/shared-ui/...` package subpaths.
- Components and styles follow the same shadcn-svelte/Tailwind token rules as `packages/web`: theme tokens only, no hard-coded visual constants unless documented.
- Global CSS lives in `src/styles/`; app packages import `@nervekit/shared-ui/styles/app.css` and add their own app-specific partials.
- Icons use `@lucide/svelte`; monospace is for code, logs, and paths only.
- Validate with `pnpm --filter @nervekit/shared-ui check` and relevant tests.
