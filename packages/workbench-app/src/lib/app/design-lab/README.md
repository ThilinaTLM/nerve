# Design Lab

Development-only UI workspace, available through the existing Vite server:

- `/dev/components` — shared components, foundations, and workbench compositions.
- `/dev/components#/tool-cards` — link directly to a catalog section.
- `/dev/wireframes` — prototype index.
- `/dev/wireframes/<name>` — a local prototype, when present.

The lab replaces the workbench, uses mock data, and does not need a daemon connection. Theme controls use the shared themes; selecting a theme does not write application settings. Navigation between lab areas reloads the page, resetting prototype state.

## Create a wireframe

When asked to create a wireframe, use this area instead of a standalone HTML file:

1. Create the gitignored `wireframes/` directory if needed and add a kebab-case Svelte file, for example `review-queue.svelte`.
2. The runner discovers it automatically; no registry edit or commit is needed.
3. Open `/dev/wireframes/review-queue` and iterate with Vite hot reload.

A fresh checkout shows an empty index until you create a prototype. The runner and component catalog are tracked; individual wireframes are disposable local planning artifacts.

Reuse official `@nervekit/ui-kit` controls, `$lib/presentation` components, and feature-owned stateless views where appropriate. Follow the workbench styling rules: theme-token utilities, shared control sizes, and existing panel/card anatomy. Keep fixtures and interaction state local. Do not mount application hosts, start polling, or call mutation APIs. Promote reusable improvements into their owning production component, not a lab-only copy.

The component catalog remains curated documentation of actual application UI; speculative compositions belong in wireframes.

## Production boundary

`src/App.svelte` loads the lab only inside a compile-time `import.meta.env.DEV` branch. Lab modules and fixtures must never be statically imported by production code. The build checks emitted module ids for lab leakage, and Tailwind excludes lab sources from production utility generation. Shared components and shared styles remain available to the real application.

Keep prototypes here, not in `public/`: public assets are copied into production unconditionally. No separate lab build or backend/database storage is required.
