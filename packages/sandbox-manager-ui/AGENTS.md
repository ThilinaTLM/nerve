# Sandbox manager UI (`packages/sandbox-manager-ui`)

Inherits the root `AGENTS.md`. This package is the dedicated Svelte app for the sandbox manager web UI.

- Keep sandbox manager UI state, API clients, routes, and components here.
- Import shared primitives/styles from `@nervekit/ui`; do not add shadcn components under this package unless they are app-specific wrappers.
- Do not import workbench/desktop/orchestrator code from `packages/web`.
- Do not register a service worker in this app.
- Keep secrets and privileged actions on the manager API side; browser code talks to same-origin `/api` only.
- Validate with `pnpm --filter @nervekit/sandbox-manager-ui check` and relevant tests/builds.
