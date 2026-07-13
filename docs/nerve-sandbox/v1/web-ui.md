# Sandbox manager web UI

`@nervekit/sandbox-manager-app` is a same-origin single-page Svelte app served from the manager's built `dist/web`. It uses `ProtocolClientSession` to consume `manager` and the selected `sandbox:<id>` stream, persists epoch-versioned cursors, and recovers cursor-bearing snapshots before replay.

The app covers lifecycle/dashboard, create/start/stop/delete, setup/boot diagnostics, logs, configuration, credentials, conversations/interactions, runs/tools, files, Git/GitHub/PRs, tasks/logs, pinned commands, and settings.

Conversation, navigator, transcript, composer, tabs, and layout presentation come from `@nervekit/workbench-ui`. Git and task tabs use the canonical `GitUtilityPanelView` and `TaskUtilityPanelView`; sandbox adapters own target selection, protocol/API calls, polling, notifications, clipboard, and workspace-tab navigation. Git setup diagnostics remain an adjacent sandbox-only section.

The browser calls same-origin `/api` and never receives privileged secret values. There is no service worker and no client-side route requirement.
