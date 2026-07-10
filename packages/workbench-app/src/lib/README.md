# Web module ownership

The web package is organized as a feature-sliced workbench frontend.

- `api.ts` is the public API barrel; `README.md` documents ownership. These are the only files at the `lib/` root.
- `app/` owns the shell, layout state, and the workbench lifecycle provider. It composes features only through their public barrels (`$lib/features/<feature>`) and must not reach into a feature's internal `state/` modules. This is enforced by `scripts/check-workbench-app-import-boundaries.mjs` (run as part of `pnpm check`).
- `core/` owns workbench-local primitives: event bus/websocket transport, aggregated state types (`core/types/state-types.ts`), state keys, hooks, shortcuts, audio, highlighting, clipboard bridge, and workbench utilities. Shared UI primitives, generic API helpers, Markdown, and PlainText live in `@nervekit/workbench-ui`.
- `features/*/api`, `features/*/state`, and `features/*/components` own domain-specific calls, selectors, actions, and panes. Each feature exposes everything other features and `app/` need through its `index.ts` barrel.
- Cross-component UI signals are owned by the feature they belong to (e.g. composer focus/escape/mic tokens live in `features/conversations/state/composer-signals.svelte.ts`, project-search focus in `features/projects/state/project-navigator-signals.svelte.ts`, desktop quit state in `features/desktop/state/desktop-shutdown.svelte.ts`).
- Feature event hooks register through `core/events/event-bus.ts` via `features/register-feature-events.ts`.
- Prefer files under ~400 lines: split oversized modules into focused helpers/sub-modules and oversized components into presenter sub-components.
- Shared schemas and protocol types stay in `@nervekit/contracts`; frontend code must not own secrets or daemon-side policy decisions.
