# Session lifecycle

## Handshake

1. Transport authentication completes before protocol acceptance.
2. The client sends `hello` with `requestedVersion: 1`, capabilities, JSON encoding, optional per-stream processed cursors, and bounded preferences.
3. The server validates required capabilities and replies with `welcome` or a protocol `error`.
4. `welcome` contains `acceptingPeer`, accepted capabilities, stream states, hard limits, heartbeat settings, and resume mode (`fresh`, `live`, `replay`, or `snapshot_required`).
5. The client completes required replay or snapshot recovery, then sends `ready` with installed cursors.
6. Normal RPC and event delivery begins.

`ProtocolClientSession` and `ProtocolServerSession` implement this state machine. `ProtocolClientConnection` owns reconnect transport behavior; host composition supplies auth, message factories, replay/snapshot ports, and durable cursor persistence.

## Heartbeat and close

`heartbeat.data` contains `sessionId`, `sentAt`, optional processed cursors, and optional `load.eventQueueDepth`/`load.replayQueueDepth`. A graceful `goodbye` includes a bounded reason and may include final cursors. Timeout, invalid state transitions, invalid targets, or queue safety failures close the session deterministically.

## Browser identity and cursor epochs

`@nervekit/protocol` stores the browser client ID at local-storage key `nerve.protocol.clientId` and the tab instance ID at session-storage key `nerve.protocol.instanceId`.

The manager UI persists cursors under `nerve.protocol.v1.sandbox-manager-ui` with epoch `protocol-v1`; an epoch mismatch removes that record. Workbench durable progress is installed from the current workspace snapshot and kept in app state. To reset a browser session, clear site local storage and session storage; no reader for earlier browser cursor shapes exists.
