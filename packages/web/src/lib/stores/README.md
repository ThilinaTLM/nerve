# Frontend state ownership

- Components may own disposable UI state only: popovers, search text, expanded sections, focus tokens.
- Shared server/entity state enters through API loader helpers or event reducers, then lives in `workbenchState` or a scoped store.
- Reusable UI signals such as conversation activity dots must come from shared selectors/helpers, not duplicate component logic.
- Scoped resource data is keyed by stable IDs (`conversationId`, `projectId`, `projectId + repo`) and keeps last successful data visible while refreshes run.
- Events update local state immediately. REST snapshots reconcile that state in the background.
- Mutations should either update locally when safe or set scoped busy/error flags and refresh in place; they should not clear unrelated active caches.
