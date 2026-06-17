# Legacy frontend state ownership

`stores/` is now the compatibility layer for the pre-feature-sliced workbench state. New feature work should prefer `features/*/state`, `features/*/api`, and `features/*/components`.

- `stores/workbench/state.svelte.ts` remains the temporary mutable state source while feature facades migrate callers incrementally.
- `stores/workbench/selectors.svelte.ts` remains the legacy selector source; feature selector modules wrap the parts they own.
- Events update local state immediately through `events/event-router.ts`; new cross-feature reactions should register through `core/events/event-bus.ts`.
- Do not add new domain-owned state to this directory unless it is part of an active migration shim.
