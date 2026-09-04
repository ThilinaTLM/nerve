# Nerve GPUI Workbench

An experimental native GPUI client for an existing Nerve Workbench server.

The client does **not** start, supervise, restart, or stop the server. It discovers and authenticates to a server that is already running, opens a Nerve protocol-v1 WebSocket session, and keeps its workspace snapshot current from the workspace event stream.

This first connected increment includes:

- a server-backed project switcher in the header;
- project-scoped conversation lists in the Conversations side-panel tab;
- live snapshot refresh after workspace events;
- connection, retry, error, and empty states;
- resizable left, right, and bottom panels;
- panel visibility controls and narrow-window side drawers; and
- the embedded Nerve dark theme.

Conversation selection is local for now. Transcript loading and the remaining files, tasks, Git, pull request, context, scratch-note, and center-editor integrations are still placeholders.

## Existing-server discovery

The GPUI client uses the same local metadata conventions as the rest of Nerve:

1. `NERVE_HOME`, or `~/.nerve` when unset;
2. `NERVE_API_TARGET` when explicitly set;
3. otherwise the non-stale URL in `<NERVE_HOME>/daemon.json`;
4. otherwise `http://127.0.0.1:3747`.

Authentication is read from `<NERVE_HOME>/secrets/daemon-token`. Missing or invalid metadata is shown as a connection error; the client never creates or repairs server state.

## Run

GPUI currently supports macOS and Linux. Start the Workbench server separately, then run from the repository root:

```sh
pnpm gpui
```

To connect to an isolated development server:

```sh
NERVE_HOME=/tmp/nerve-gpui-home \
NERVE_API_TARGET=http://127.0.0.1:4757 \
pnpm gpui
```

Never use the live Nerve home when starting a test server.

## Validate

```sh
pnpm --filter @nervekit/gpui-workbench check
pnpm --filter @nervekit/gpui-workbench test
```

The supported release client remains the Svelte Workbench hosted by the browser and Electron desktop shell. This package is private, developer-only, and excluded from release artifacts.
