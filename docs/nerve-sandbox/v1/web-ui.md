# Sandbox manager web UI

`@nervekit/sandbox-manager-app` is a same-origin Svelte app served from the manager's built `dist/web`. It keeps one `ProtocolClientSession`, always subscribes to `manager`, and adds at most one selected `sandbox:<id>` stream.

Selection loads and installs the manager/sandbox recovery snapshot before replacing the exact subscription set. Retained sequenced events replay per stream before live delivery. A cursor outside retained bounds triggers another snapshot. Ephemeral `event.notify` signals update live activity/output without changing stream cursors.

Dashboard and settings use the `manager` stream only. Shared workbench UI components render conversations, Git, and tasks from manager state adapters.
