# Shared UI package (`packages/workbench-ui`)

Inherits the root `AGENTS.md`. This package contains shared Svelte UI primitives, conversation UI, theme/styles, and generic browser/display helpers for Nerve apps.

- Keep this package app-neutral: no orchestrator, sandbox-manager state, secrets, desktop bridge, or app-specific stores.
- Components named `*Pane` are canonical app-neutral presentation surfaces. They consume normalized models/data plus explicit action callbacks and must not own host stores, API clients, polling, navigation, notifications, or clipboard effects.
- `GitUtilityPanelView` and `TaskUtilityPanelView` are the canonical shared feature hosts. They consume normalized models, explicit capability records, and required action controllers; host stores, transports, persistence, polling, navigation, notifications, and clipboard effects stay in app adapters.
- Presentational surfaces include `components/workbench/*`, `components/navigator/*`, conversation transcript/composer components, and tool-call views. They take data + snippets in and emit events/capability calls out; do not import app `$lib` modules.
- Do not import from app `$lib` aliases. Exported source must use relative imports or `@nervekit/workbench-ui/...` package subpaths.
- Components and styles follow the same shadcn-svelte/Tailwind token rules as `packages/workbench-app`: theme tokens only, no hard-coded visual constants unless documented.
- Global CSS lives in `src/styles/`; app packages import `@nervekit/workbench-ui/styles/app.css` and add their own app-specific partials.
- Icons use `@lucide/svelte`; monospace is for code, logs, and paths only.
- Validate with `pnpm --filter @nervekit/workbench-ui check` and relevant tests.
