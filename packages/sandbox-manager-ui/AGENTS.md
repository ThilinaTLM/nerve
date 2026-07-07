# Sandbox manager UI (`packages/sandbox-manager-ui`)

Inherits the root `AGENTS.md`. This package is the dedicated Svelte app for the sandbox manager web UI.

- Keep sandbox manager UI state, API clients, and components here.
- Import shared primitives/styles from `@nervekit/ui`; do not add shadcn components under this package unless they are app-specific wrappers.
- Do not import workbench/desktop/orchestrator code from `packages/web`.
- Do not register a service worker in this app.
- Reuse shared chat/composer/navigator components from `@nervekit/conversation-ui` (`TranscriptList`, `ConversationPaneLayout`, `ComposerShell`/`ComposerToolbar`/`ComposerEditor`) and `@nervekit/ui` (`NavigatorPanel`/`NavigatorItem`, `WorkbenchTabStrip`); feed chat by projecting `ConversationRenderState` through `state/sandbox-chat-render.ts`. Do not fork transcript/tool-call/composer/navigator rendering.
- Single-page model: no client-side routes. `app/SandboxCenter.svelte` renders the workbench frame; global center-view state lives in `state/sandbox-center.svelte.ts` (`dashboard | sandbox | settings`, selection persisted to localStorage). Settings and the sandbox workspace are center tabs (`components/workspace/SandboxCenterTabs.svelte`); the empty center shows `components/dashboard/SandboxDashboard.svelte`.
- Theme is local-only (`state/appearance.svelte.ts` + `mode-watcher`, persisted to localStorage); there is no server UI-settings API here.
- Keep secrets and privileged actions on the manager API side; browser code talks to same-origin `/api` only.
- Validate with `pnpm --filter @nervekit/sandbox-manager-ui check` and relevant tests/builds.
