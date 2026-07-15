# Sandbox manager UI (`packages/sandbox-manager-app`)

Inherits the root `AGENTS.md`. This package is the dedicated Svelte app for the sandbox manager web UI.

- Keep sandbox manager UI state, API clients, and components here.
- Application `*Shell` components bind sandbox state, lifecycle, polling, and side effects to canonical app-neutral `*Pane` components from `@nervekit/workbench-ui`. Do not fork shared pane rendering here.
- Import shared primitives/styles from `@nervekit/workbench-ui`; do not add shadcn components under this package unless they are app-specific wrappers. Git and task tabs must project manager state through the app adapters into the shared `GitUtilityPanelView` and `TaskUtilityPanelView`; keep sandbox setup diagnostics adjacent to, not embedded in, the shared host.
- Do not import workbench/desktop/orchestrator code from `packages/workbench-app`.
- Do not register a service worker in this app.
- Reuse shared chat/composer/navigator/workbench components from `@nervekit/workbench-ui` (`TranscriptList`, `ConversationPaneLayout`, `ComposerShell`/`ComposerToolbar`/`ComposerEditor`, `NavigatorPanel`/`NavigatorItem`, `WorkbenchTabStrip`); feed chat by projecting `ConversationRenderState` through `state/sandbox-chat-render.ts`. Do not fork transcript/tool-call/composer/navigator rendering.
- Single-page model: no client-side routes. `app/SandboxCenter.svelte` renders the workbench frame; global center-view state lives in `state/sandbox-center.svelte.ts` (`dashboard | sandbox | settings`, selection persisted to localStorage). Settings and the sandbox workspace are center tabs (`components/workspace/SandboxCenterTabs.svelte`); the empty center shows `components/dashboard/SandboxDashboard.svelte`.
- Theme is local-only (`state/appearance.svelte.ts` + `mode-watcher`, persisted to localStorage); there is no server UI-settings API here.
- Keep secrets and privileged actions on the manager API side; browser code talks to same-origin `/api` only.
- Validate with `pnpm --filter @nervekit/sandbox-manager-app check` and relevant tests/builds.
