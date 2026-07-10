# Session Lifecycle

The session lifecycle defines how peers establish a Nerve Protocol v1 session, negotiate capabilities, resume event cursors, exchange liveness information, and shut down gracefully.

The first binding is WebSocket, but the lifecycle messages are transport-neutral.

## State machine

A typical client session follows this state machine:

```text
Disconnected
  └─ connect transport ─▶ TransportOpen
TransportOpen
  └─ send hello ────────▶ Handshaking
Handshaking
  ├─ receive welcome ───▶ Established
  ├─ receive error ─────▶ Closing
  └─ timeout ───────────▶ Reconnecting
Established
  ├─ send ready ────────▶ Live
  ├─ heartbeat timeout ─▶ Reconnecting
  ├─ receive goodbye ───▶ Closing
  └─ transport closed ──▶ Reconnecting
Live
  ├─ receive batches ───▶ Live
  ├─ request replay ────▶ Replaying
  ├─ flow resync ───────▶ ResyncRequired
  ├─ heartbeat timeout ─▶ Reconnecting
  └─ graceful close ────▶ Closing
Replaying
  ├─ replay.complete ───▶ Live
  ├─ replay.unavailable ▶ ResyncRequired
  └─ heartbeat timeout ─▶ Reconnecting
ResyncRequired
  ├─ reload snapshot ───▶ Reconnecting or Live
  └─ close ─────────────▶ Disconnected
Closing
  └─ transport closed ──▶ Disconnected
```

Implementations MAY use different internal states, but wire behavior MUST be compatible with the lifecycle messages described here.

## WebSocket binding summary

For the WebSocket v1 binding:

1. Client opens WebSocket transport to the orchestrator.
2. Client sends `hello` as the first protocol message.
3. Orchestrator validates auth at the transport layer and validates `hello` at the protocol layer.
4. Orchestrator replies with `welcome` or `error`.
5. Client applies any `welcome` cursor guidance and sends `ready`.
6. Orchestrator starts or continues event delivery using `event.batch`.
7. Both peers exchange `heartbeat` messages or transport-level pings as configured.
8. Client sends `ack` messages as it processes durable events.
9. Either peer can send `goodbye` before closing intentionally.

The server MAY support a compatibility mode where legacy clients receive raw event frames. A protocol v1 client MUST send `hello`; after `hello`, all frames MUST use the protocol envelope.

During development, an implementation MAY either negotiate protocol mode on the existing `/ws` path or expose a temporary `/ws/v1` path. The final product SHOULD avoid permanent duplicate WebSocket APIs unless there is a clear deployment need. Whichever path is used, protocol and legacy frames MUST NOT be mixed on one connection.

## `hello`

Direction: client → orchestrator.

Purpose: start a protocol session, identify the client role, advertise capabilities, and request resume from known cursors.

```ts
type HelloData = {
  role: "ui" | "desktop" | "cli" | "agent";
  client: {
    id: string;
    instanceId?: string;
    name?: string;
    version?: string;
    platform?: string;
    userAgent?: string;
  };
  requestedVersion: 1;
  capabilities: string[];
  encodings: Array<"json">;
  resume?: {
    sessionId?: string;
    streams?: StreamCursor[];
    lastProcessedSeq?: number;
  };
  preferences?: {
    batch?: BatchPreferences;
    heartbeatIntervalMs?: number;
    replay?: ReplayPreferences;
  };
};

type StreamCursor = {
  stream: string;
  processedSeq: number;
};

type BatchPreferences = {
  maxEvents?: number;
  maxBytes?: number;
  maxDelayMs?: number;
};

type ReplayPreferences = {
  preferSnapshot?: boolean;
  maxReplayEvents?: number;
};
```

Requirements:

- `hello` MUST be the first protocol message sent by a client on a new session.
- `requestedVersion` MUST be `1` for v1.
- `capabilities` MUST include `encoding.json`.
- A UI client using event streaming MUST include `event.batch`, `event.replay`, and `event.ack.processed`.
- `resume.streams` SHOULD be used for v1; `resume.lastProcessedSeq` MAY be used as shorthand for the `global` stream.
- The client MUST NOT claim a processed cursor greater than the highest durable event it has applied or the cursor of a trusted snapshot it has loaded.
- The client MUST NOT use the highest received transient event sequence as a resume cursor.
- The client SHOULD generate a stable `client.id` for the installation/profile and a new `client.instanceId` for each browser tab/window process.

Recommended UI client capabilities:

```json
[
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure"
]
```

## `welcome`

Direction: orchestrator → client.

Purpose: accept the session, select capabilities, report stream state, publish limits, and instruct the client how replay/live delivery will begin.

```ts
type WelcomeData = {
  sessionId: string;
  orchestrator: {
    id: string;
    instanceId?: string;
    version?: string;
    startedAt?: string;
  };
  acceptedVersion: 1;
  capabilities: string[];
  encoding: "json";
  streams: StreamState[];
  limits: ProtocolLimits;
  heartbeat: {
    intervalMs: number;
    timeoutMs: number;
  };
  resume: {
    accepted: boolean;
    mode: "live" | "replay" | "snapshot_required" | "fresh";
    reason?: string;
  };
};

type StreamState = {
  stream: string;
  latestSeq: number;
  durableSeq?: number;
  replayFromSeq?: number;
  replayAvailableFromSeq?: number;
};

type ProtocolLimits = {
  maxMessageBytes: number;
  maxBatchEvents: number;
  maxBatchBytes: number;
  maxInflightBatches: number;
  maxUnackedDurableEvents: number;
};
```

Requirements:

- The orchestrator MUST send either `welcome` or `error` after a valid `hello`.
- `sessionId` MUST be unique for the accepted protocol session.
- `capabilities` MUST be the intersection of client-advertised and server-supported capabilities, plus any REQUIRED baseline capabilities.
- `encoding` MUST be one of the encodings advertised by the client.
- `streams` MUST include the `global` stream for event-streaming sessions.
- `resume.mode` determines the next expected step:
  - `live`: server can begin at current live tail; no replay required.
  - `replay`: for the v1 WebSocket binding, server starts replay from `replayFromSeq` after receiving `ready`.
  - `snapshot_required`: client cursor is too old or incompatible; client must load a snapshot before applying live deltas.
  - `fresh`: no resume cursor was supplied; server starts from the current live tail unless the client explicitly requests history.
- For `resume.mode: "replay"`, the client MUST send `ready`; it SHOULD NOT also send a `replay.request` for the same resume range unless the server fails to start replay or a later gap is detected.
- For `resume.mode: "fresh"`, clients that need initial materialized state SHOULD load snapshots or resource state before applying live deltas. `fresh` does not imply that historical durable state was delivered.
- A browser UI workbench normally treats `fresh` as permission to start live delivery only after it has loaded initial workspace resources or a snapshot with cursor metadata. Starting from the live tail without initial state is valid only for clients that do not need historical materialized state.
- `StreamState.durableSeq` is the latest durable recovery cursor known by the orchestrator for that stream. It may be lower than `latestSeq` when transient events were most recently published.

## `ready`

Direction: client → orchestrator.

Purpose: signal that the client has completed initial setup and is ready for replay/live event delivery.

```ts
type ReadyData = {
  sessionId: string;
  streams?: StreamCursor[];
};
```

Requirements:

- The client SHOULD send `ready` after processing `welcome`.
- The orchestrator SHOULD NOT send high-volume live event batches before `ready`, except for urgent errors or flow-control messages.
- `streams` MAY repeat the client's processed cursors if they changed during handshake setup.

## `heartbeat`

Direction: either.

Purpose: prove liveness, exchange lightweight cursors, and help clients detect half-open connections.

```ts
type HeartbeatData = {
  sessionId: string;
  sentAt: string;
  latestSeq?: number;
  processed?: StreamCursor[];
  serverLoad?: {
    eventQueueDepth?: number;
    replayQueueDepth?: number;
  };
};
```

Requirements:

- A WebSocket server SHOULD send protocol `heartbeat` messages even when transport-level ping/pong is enabled, because browser JavaScript cannot observe WebSocket protocol pings directly.
- The orchestrator SHOULD include `latestSeq` for the `global` stream.
- A client MAY include processed cursors in heartbeat messages, but SHOULD still send explicit `ack` messages according to [Replay and Acknowledgements](./replay-and-ack.md).
- A peer SHOULD consider the session unhealthy when no protocol message or transport liveness signal is observed before `timeoutMs`.

Recommended defaults:

| Setting                        |   Default |
| ------------------------------ | --------: |
| Server heartbeat interval      | 30,000 ms |
| Client liveness check interval | 15,000 ms |
| Client liveness timeout        | 70,000 ms |
| Handshake timeout              | 10,000 ms |

## `goodbye`

Direction: either.

Purpose: graceful shutdown.

```ts
type GoodbyeData = {
  sessionId?: string;
  reason:
    | "client_closing"
    | "server_shutdown"
    | "restart_required"
    | "auth_expired"
    | "protocol_error"
    | "idle_timeout"
    | "other";
  message?: string;
  retryAfterMs?: number;
  finalCursors?: StreamCursor[];
};
```

Requirements:

- A peer SHOULD send `goodbye` before intentionally closing a healthy transport.
- `retryAfterMs` SHOULD be included when reconnecting immediately would be wasteful.
- `finalCursors` MAY be included by clients to provide one last processed cursor.
- Receivers MUST treat `goodbye` as advisory; transports may close without it.

## Session identity

A session is a logical protocol conversation over a transport connection.

- `sessionId` is assigned by the orchestrator in `welcome`.
- A reconnect usually creates a new `sessionId`.
- `client.id` identifies an installation/profile and can survive reconnects.
- `client.instanceId` identifies a tab/window/process and SHOULD change when that runtime starts fresh.

Client IDs and locally stored cursors SHOULD be scoped to the orchestrator identity or data directory identity when possible. If a browser profile connects to a different Nerve daemon or a reset data directory, stale cursors can be ahead of the server or refer to unrelated state; the orchestrator must reject incompatible cursors and the client should load a fresh snapshot.

The protocol does not require server-side session resurrection. Resume correctness is based on event cursors, not on preserving a previous session object.

## Capability negotiation

Capabilities are string identifiers. Both peers advertise supported capabilities; the orchestrator selects accepted capabilities in `welcome`.

Baseline WebSocket event-streaming capabilities:

| Capability            | Required for v1 WebSocket event streaming | Description                               |
| --------------------- | ----------------------------------------- | ----------------------------------------- |
| `encoding.json`       | yes                                       | UTF-8 JSON protocol messages.             |
| `event.batch`         | yes                                       | Event batch delivery.                     |
| `event.replay`        | yes                                       | Replay request and replay markers.        |
| `event.ack.processed` | yes                                       | Client processed-cursor acknowledgements. |
| `flow.backpressure`   | recommended                               | Flow update/degradation messages.         |
| `snapshot.workspace`  | optional                                  | Snapshot-assisted recovery.               |
| `http.envelope`       | optional                                  | Protocol envelope over HTTP.              |

Rules:

- A peer MUST NOT use a capability-specific extension unless the capability was accepted.
- The orchestrator MAY reject a session if required capabilities are missing.
- A client SHOULD tolerate missing optional capabilities by falling back to baseline behavior.

## Resume behavior

During `hello`, the client can provide processed cursors. The orchestrator evaluates them against available replay sources.

Outcomes:

1. **Fresh live session**
   - Client provides no cursor.
   - Orchestrator returns `resume.mode: "fresh"`.
   - Live delivery starts at the current tail unless the client requests history.

2. **Live resume without replay**
   - Client cursor equals the current durable recovery cursor for requested streams, or is otherwise proven compatible with the current durable state.
   - Orchestrator returns `resume.mode: "live"`.

3. **Replay resume**
   - Client cursor is behind and replay is available.
   - Orchestrator returns `resume.mode: "replay"` and `replayFromSeq`.
   - For the v1 WebSocket binding, the orchestrator starts `replay.started` after the client sends `ready`, then sends replay batches and `replay.complete` before resuming live delivery for that stream.

4. **Snapshot required**
   - Client cursor is too old, missing, or incompatible with available replay.
   - Orchestrator returns `resume.mode: "snapshot_required"`.
   - Client MUST obtain a snapshot before applying live deltas unless a domain-specific recovery flow says otherwise.
   - A snapshot response MUST provide cursors that become the client's processed cursors for affected streams.

## Reconnect strategy

Clients SHOULD use exponential backoff with jitter for reconnects. Recommended values:

| Attempt |         Base delay |
| ------: | -----------------: |
|       1 |             250 ms |
|       2 |             500 ms |
|       3 |           1,000 ms |
|       4 |           1,500 ms |
|       5 |           2,500 ms |
|      6+ | capped at 5,000 ms |

A client SHOULD reconnect immediately after local page reload if the orchestrator is expected to be running, but SHOULD still avoid tight loops when auth, DNS, TLS, or startup errors persist.

On reconnect, a client MUST use its latest processed durable cursor or trusted snapshot cursor, not merely its latest received batch cursor.

## Authentication and authorization handoff

Authentication is defined by the transport binding. For the WebSocket binding, auth is checked before or during upgrade using the daemon token rules. After transport auth succeeds:

- `hello.role` and `client` fields are informational and policy inputs, not sole authentication proof.
- The orchestrator MAY apply role-based session policy after parsing `hello`.
- A session that fails policy MUST receive `error` with code `AUTH_FORBIDDEN` if possible, then close.

See [Errors and Security](./errors-and-security.md).

## Session errors

During handshake, an error is normally terminal. Examples:

| Code                           | Typical cause                                           |
| ------------------------------ | ------------------------------------------------------- |
| `PROTOCOL_VERSION_UNSUPPORTED` | Unsupported `version`.                                  |
| `INVALID_MESSAGE`              | Malformed envelope or payload.                          |
| `CAPABILITY_REQUIRED`          | Client lacks required capability.                       |
| `AUTH_REQUIRED`                | Missing or invalid transport auth.                      |
| `AUTH_FORBIDDEN`               | Authenticated peer is not allowed to open this session. |
| `SESSION_REJECTED`             | Server policy rejects the session.                      |

After a session is established, errors may be terminal or recoverable depending on `data.retryable` and `data.close` in the `error` message.

## Graceful orchestrator restart

When the orchestrator knows it is shutting down or restarting, it SHOULD:

1. Stop accepting new high-volume work for the affected session.
2. Send `goodbye` with reason `server_shutdown` or `restart_required`.
3. Include `retryAfterMs` if known.
4. Close the transport with a normal close code where the transport supports it.

Clients SHOULD reconnect after the delay using their last processed cursors.

## Multiple UI clients

Multiple UI clients can connect concurrently. Each session has independent cursors and flow-control state. The orchestrator MUST NOT treat one client's acknowledgement as acknowledgement by another client.

Domain events remain shared in the global stream. Acknowledgements are session/client delivery state, not event persistence state.

## Session lifecycle examples

See [Examples](./examples.md) for concrete JSON examples of handshake, heartbeat, and graceful shutdown.
