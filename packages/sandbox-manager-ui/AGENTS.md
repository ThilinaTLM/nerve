# Sandbox manager UI (`packages/sandbox-manager-ui`)

Inherits the root `AGENTS.md`. This package is the dedicated Svelte app for the sandbox manager web UI.

- Keep sandbox manager UI state, API clients, routes, and components here.
- Import shared primitives/styles from `@nervekit/ui`; do not add shadcn components under this package unless they are app-specific wrappers.
- Do not import workbench/desktop/orchestrator code from `packages/web`.
- Do not register a service worker in this app.
- Reuse the shared chat components from `@nervekit/conversation-ui` (`TranscriptList`, `PromptComposer`) for the sandbox chat; feed them by projecting `ConversationRenderState` through `state/sandbox-chat-render.ts`. Do not fork transcript/tool-call rendering.
- Pages render inside `components/layout/AppShell.svelte` (sticky header + max-width container); routing is path-based via `routes/route-state.svelte.ts`.
- Theme is local-only (`state/appearance.svelte.ts` + `mode-watcher`, persisted to localStorage); there is no server UI-settings API here.
- Keep secrets and privileged actions on the manager API side; browser code talks to same-origin `/api` only.
- Validate with `pnpm --filter @nervekit/sandbox-manager-ui check` and relevant tests/builds.
