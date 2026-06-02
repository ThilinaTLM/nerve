# Web module ownership

The web package owns presentation, browser routing, UI state, API adapters, and websocket event routing for the workbench.

- `stores/workbench/state.svelte.ts` owns the mutable workbench state object and transcript item type.
- `stores/workbench/selectors.svelte.ts` owns reusable `$derived` selectors; `App.svelte` should consume selectors rather than recreate store logic.
- Slice modules (`workspace.svelte.ts`, `session-flow.svelte.ts`, `settings.svelte.ts`, `composer-config.svelte.ts`, and `workbench/processes.svelte.ts`) own domain actions.
- `stores/workbench.svelte.ts` is a compatibility barrel for existing imports.
- `events/event-router.ts` owns event-to-state reconciliation; `events/websocket-client.svelte.ts` owns websocket lifecycle.
- Large app components should extract focused children under feature directories and move shared cross-child styles into imported CSS files.

Do not place secrets, dangerous capability decisions, or daemon-side policy in frontend code. Those remain in orchestrator/tool layers; shared schemas remain in `@nerve/shared`.
