# Web module ownership

The web package is organized as a feature-sliced workbench frontend.

- `app/` owns the shell, layout state, workbench lifecycle provider, and cross-feature UI tokens.
- `core/` owns transport-neutral primitives such as the HTTP API client and event bus/websocket transport.
- `features/*/api`, `features/*/state`, and `features/*/components` own domain-specific calls, selectors, compatibility state facades, and panes.
- `stores/workbench.svelte.ts` remains a temporary legacy barrel while feature stores/actions finish migrating.
- `events/event-router.ts` still performs legacy event-to-state reconciliation; feature event hooks register through `core/events/event-bus.ts`.
- Shared schemas and protocol types stay in `@nerve/shared`; frontend code must not own secrets or daemon-side policy decisions.
