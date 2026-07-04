# Shared UI package (`packages/ui`)

Inherits the root `AGENTS.md`. This package contains shared Svelte UI primitives, theme/styles, and generic browser/display helpers for Nerve apps.

- Keep this package domain-neutral: no orchestrator, sandbox-manager state, secrets, desktop bridge, or transport protocol ownership.
- Do not import from app `$lib` aliases. Exported source must use relative imports or `@nervekit/ui/...` package subpaths.
- Components and styles follow the same shadcn-svelte/Tailwind token rules as `packages/web`: theme tokens only, no hard-coded visual constants unless documented.
- Global CSS lives in `src/styles/`; app packages import `@nervekit/ui/styles/app.css` and add their own app-specific partials.
- Icons use `@lucide/svelte`; monospace is for code, logs, and paths only.
- Validate with `pnpm --filter @nervekit/ui check` and relevant tests.
