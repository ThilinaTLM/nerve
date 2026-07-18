# Session lifecycle

## Handshake

1. Transport authentication completes before protocol acceptance.
2. The client sends `hello` with version, capabilities, required capabilities, JSON encoding, and optional bounded preferences.
3. The server replies with `welcome` or a protocol error.
4. `welcome` contains the accepting peer, negotiated capabilities, limits, heartbeat settings, and session ID. It contains no event cursors.
5. The client sends `ready` with the session ID and optional host status.
6. After ready, the client installs its exact stream set with `stream.subscription.set`.

`stream.subscription.v1` is required by the shared client and server sessions. There is no separate handshake resume path.

## Exact-set subscriptions

`stream.subscription.set` contains the session ID, a subscription ID, and `StreamCursor[]`. The server authorizes and resolves the complete requested set before replacing the old set. `stream.subscription.updated` reports one mode per stream:

- `live`: cursor equals the stream head;
- `replay`: missing retained events will follow;
- `snapshot_required`: the cursor is ahead or older than retained history.

Accepted non-snapshot streams become the exact active set. Replay is emitted before live events that arrived during replay. A rejected update leaves the previous set active.

## Heartbeat and close

Heartbeat data is only `{ sessionId, sentAt }`. A graceful goodbye carries the session ID and bounded reason. Heartbeat timeout, invalid state, target failure, or unsafe outgoing overflow closes deterministically. Overflow requiring a fresh snapshot uses reason `resync_required`.

## Browser identity and cursor epochs

The browser client ID is stored at `nerve.protocol.clientId`; the tab instance ID is stored at `nerve.protocol.instanceId`.

The manager UI persists per-stream cursors under `nerve.protocol.v1.sandbox-manager-ui` with epoch `protocol-v1`. Workbench cursors are installed from snapshots and kept in application state. Cursor values advance only after successful reducer application.
