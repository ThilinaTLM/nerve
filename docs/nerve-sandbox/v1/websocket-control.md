# WebSocket Control

Sandbox v1 uses WebSocket as the first control and event transport between the sandbox daemon and controller/manager. After connection, every application frame MUST be a [Nerve Protocol v1](../../nerve-protocol/v1/README.md) JSON message. Concrete command schemas are defined in [Commands](./commands.md); concrete event payload schemas are defined in [Event Schemas](./event-schemas.md).

The WebSocket carries two logical flows:

- controller → sandbox commands, steering, approvals, and input;
- sandbox → controller status, transcript, tool, checkpoint, setup, and lifecycle events.

## Peer roles

| Peer               | Protocol role  | Responsibility                                                                                                     |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Sandbox daemon     | `agent`        | Runs the agent, tools, startup setup, local journals, checkpoints, and event outbox.                               |
| Sandbox controller | `orchestrator` | Authenticates sandbox sessions, sends commands, receives events, persists product-side state, and serves UIs/APIs. |

The controller role name does not require the current Nerve local orchestrator. It means the peer owns command authority and durable event intake for this sandbox session.

## Transport authentication

V1 authentication uses an API key during WebSocket connection setup.

Requirements:

- The sandbox MUST authenticate before or during the WebSocket upgrade.
- The API key SHOULD be sent in the configured header, normally `Authorization: Bearer <redacted>`.
- API keys MUST NOT appear inside protocol `data`, `meta`, tracing fields, events, or logs.
- Authentication failures SHOULD reject the upgrade or send a protocol `error` with `AUTH_INVALID` and `close: true` if a protocol session was already established.
- OAuth for the controller WebSocket transport is reserved for a future profile and MUST NOT be used by baseline v1 implementations.
- This transport-auth restriction does not prohibit model/tool/secret-store provider OAuth credential refresh. Provider credentials are configured in YAML and are not sent in protocol payloads.

## Session lifecycle

The sandbox follows the Nerve Protocol v1 lifecycle:

1. Open WebSocket transport.
2. Send `hello` as the first protocol message.
3. Receive `welcome` or `error`.
4. Send `ready` after local recovery, startup setup, context/skill loading, and required boot phases complete.
5. Exchange `heartbeat`, `request`, `response`, `event.batch`, `ack`, `replay.*`, `flow.update`, and `error` messages.
6. Send `goodbye` before intentional shutdown when possible.

The sandbox SHOULD reconnect with exponential backoff and resume from its latest processed command/event cursors. If it cannot establish a valid controller session before `controller.disconnectPolicy.exitAfterMs`, 5 minutes by default, it MUST exit itself so the manager can garbage-collect the container.

## Required capabilities

The sandbox `hello` MUST advertise at least:

```json
[
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "sandbox.runtime.v1",
  "sandbox.commands.v1",
  "sandbox.events.v1",
  "sandbox.snapshots.v1"
]
```

The controller `welcome` MUST include the accepted intersection. A peer MUST NOT use a sandbox feature unless the corresponding capability was accepted.

Optional capabilities MAY include:

| Capability                              | Purpose                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `sandbox.models.pi_ai.v1`               | Sandbox accepts pi-ai-compatible model catalog and selectors.               |
| `sandbox.credentials.oauth_refresh.v1`  | Sandbox can refresh manager-provided OAuth credential bundles.              |
| `sandbox.secret_stores.v1`              | Sandbox can resolve key-value secret references.                            |
| `sandbox.git_config.v1`                 | Sandbox applies top-level Git startup setup.                                |
| `sandbox.github_config.v1`              | Sandbox applies top-level GitHub startup setup.                             |
| `sandbox.tool_groups.v1`                | Sandbox reports and enforces group-based model-callable tool configuration. |
| `sandbox.tools.web_search.v1`           | Web search/fetch group is configured and available.                         |
| `sandbox.tools.jira.v1`                 | Jira group is configured and available.                                     |
| `sandbox.tools.confluence.v1`           | Confluence group is configured and available.                               |
| `sandbox.skills.v1`                     | Sandbox loads and reports `AGENTS.md` and `SKILL.md` resources.             |
| `sandbox.disconnect_exit.v1`            | Sandbox self-exits after configured controller disconnect grace period.     |
| `sandbox.multi_agent_state.v1`          | Sandbox snapshots/events include conversation and agent identifiers.        |
| `sandbox.network.egress_policy.v1`      | Sandbox can report/enforce structured network policy.                       |
| `sandbox.security.firewall.v1`          | Sandbox can apply host/runtime-backed egress firewall rules.                |
| `sandbox.controller_oauth.experimental` | Experimental controller WebSocket OAuth; not part of baseline v1.           |

## Streams

For one sandbox per WebSocket connection, the `global` stream is scoped to that sandbox session.

A multiplexed controller MAY introduce scoped streams such as `sandbox:<sandboxId>` only through an explicitly negotiated future capability. Until then, v1 implementations SHOULD use `global` and include `sandboxId`, `instanceId`, `conversationId`, `agentId`, or `runId` in event payloads when useful.

## Command delivery

Controller commands use Nerve Protocol v1 `request` messages. The request `data.method` identifies the command, and `data.params` contains method-specific parameters. [Commands](./commands.md) is authoritative for baseline parameter, result, idempotency, and error schemas.

Requirements:

- Every mutating command MUST include `commandId` in params.
- The controller SHOULD also set `idempotencyKey` to the same value or a stable operation key.
- The sandbox MUST journal an accepted command before executing it.
- Duplicate commands with the same `commandId` and same payload MUST be idempotent.
- Reuse of a `commandId` with different payload MUST return `IDEMPOTENCY_CONFLICT`.
- Commands MAY include `conversationId` and `agentId`; if omitted, the sandbox uses the configured/default active conversation and agent.
- The sandbox SHOULD respond quickly with accepted/current status and publish progress through events.

### `sandbox.run.start`

Starts a new run or returns the existing run status for a duplicate command.

```ts
type SandboxRunStartParams = {
  commandId: string;
  conversationId?: string;
  agentId?: string;
  runId?: string;
  prompt?: string;
  images?: Array<{
    mimeType: string;
    dataRef: string;
  }>;
  behavior?: "start" | "follow_up" | "steer";
  metadata?: Record<string, unknown>;
};

type SandboxRunStartResult = {
  accepted: true;
  conversationId: string;
  agentId: string;
  runId: string;
  status: SandboxRunStatus;
};
```

`prompt` is required for `sandbox.run.start`. First prompts are conversation-level input sent after the sandbox reaches `ready`/`degraded`; they are not mounted in sandbox YAML.

### `sandbox.run.continue`

Continues a run from a waiting or recoverable error state.

```ts
type SandboxRunContinueParams = {
  commandId: string;
  conversationId?: string;
  agentId?: string;
  runId: string;
  reason?: "after_input" | "after_approval" | "retry_error" | "manual";
};
```

The sandbox MUST reject continuation for completed, cancelled, or non-retryable failed runs.

### `sandbox.run.cancel`

Requests cancellation of an active or queued run.

```ts
type SandboxRunCancelParams = {
  commandId: string;
  conversationId?: string;
  agentId?: string;
  runId: string;
  reason?: string;
};
```

Cancellation is cooperative. The sandbox MUST persist the cancellation request and SHOULD abort provider requests and tool processes where possible.

### `sandbox.input.submit`

Submits human/controller input for a pending question.

```ts
type SandboxInputSubmitParams = {
  commandId: string;
  conversationId?: string;
  agentId?: string;
  runId: string;
  requestId: string;
  text: string;
};
```

The `requestId` MUST match a pending `run.waiting_for_input` event or snapshot state.

### `sandbox.approval.resolve`

Resolves a pending tool approval.

```ts
type SandboxApprovalResolveParams = {
  commandId: string;
  conversationId?: string;
  agentId?: string;
  runId: string;
  approvalId: string;
  decision: "grant" | "deny";
  note?: string;
};
```

A granted approval applies only to the referenced tool call unless the event payload explicitly offered a broader approval scope and the controller selected it.

### `sandbox.status.get`

Returns current daemon status without changing state.

```ts
type SandboxStatusGetParams = {
  includeConversations?: boolean;
  includeRuns?: boolean;
  includeConfig?: "none" | "digest" | "sanitized";
};
```

### `sandbox.snapshot.get`

Returns a durable snapshot for recovery or controller reconciliation.

```ts
type SandboxSnapshotGetParams = {
  conversationId?: string;
  agentId?: string;
  runId?: string;
  includeTranscript?: boolean;
  includeToolCalls?: boolean;
  includeConfig?: "none" | "digest" | "sanitized";
  includeToolGroups?: boolean;
  includeSkills?: boolean;
  includeSetup?: boolean;
};

type SandboxSnapshotResult = {
  sandboxId?: string;
  instanceId: string;
  status: SandboxDaemonStatus;
  conversations: SandboxConversationSnapshot[];
  runs: SandboxRunSnapshot[];
  configDigest?: string;
  toolGroups?: ToolGroupStatus[];
  setup?: {
    git?: StartupSetupStatus;
    github?: StartupSetupStatus;
  };
  secretStores?: Array<{
    id: string;
    status: string;
    cacheEnabled?: boolean;
    limitations?: string[];
  }>;
  skills?: Array<{
    name: string;
    source: string;
    path: string;
    modelVisible: boolean;
  }>;
  contextFiles?: Array<{ path: string; digest?: string }>;
  credentialStatus?: Array<{
    provider: string;
    group?: string;
    credentialType: string;
    expiresAt?: string;
    status: string;
  }>;
  cursor: {
    streams: Array<{ stream: string; processedSeq: number }>;
  };
};
```

Snapshot cursors follow the Nerve Protocol v1 snapshot contract.

## Run status

```ts
type SandboxRunStatus =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

type SandboxDaemonStatus =
  | "booting"
  | "ready"
  | "running"
  | "degraded"
  | "recovering"
  | "stopping"
  | "failed";
```

## Event families

Sandbox events are carried in Nerve Protocol v1 `event.batch` messages. [Event Schemas](./event-schemas.md) is authoritative for baseline payload schemas. Event payloads MUST be safe to persist and log after redaction.

| Event type                        | Durability | Purpose                                                                                                                       |
| --------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `sandbox.config.loaded`           | durable    | Sanitized config digest, effective defaults, model/provider status, setup status, secret-store status, and tool-group status. |
| `sandbox.secret_store.checked`    | durable    | Redacted secret-store reachability/cache status.                                                                              |
| `sandbox.credentials.refreshed`   | durable    | Redacted credential refresh status.                                                                                           |
| `sandbox.setup.git.started`       | durable    | Top-level Git startup setup began.                                                                                            |
| `sandbox.setup.git.completed`     | durable    | Top-level Git startup setup completed or failed with redacted details.                                                        |
| `sandbox.setup.github.started`    | durable    | Top-level GitHub startup setup began.                                                                                         |
| `sandbox.setup.github.completed`  | durable    | Top-level GitHub startup setup completed or failed with redacted details.                                                     |
| `sandbox.boot.started`            | durable    | Boot phase began.                                                                                                             |
| `sandbox.boot.completed`          | durable    | Boot phase completed successfully or failed.                                                                                  |
| `sandbox.skills.loaded`           | durable    | `AGENTS.md` context and `SKILL.md` resources loaded with bounded metadata.                                                    |
| `sandbox.ready`                   | durable    | Sandbox can accept commands.                                                                                                  |
| `sandbox.controller.disconnected` | durable    | Controller session was lost and reconnect/self-exit timer started.                                                            |
| `sandbox.controller.reconnected`  | durable    | Controller session was re-established.                                                                                        |
| `sandbox.shutdown.scheduled`      | durable    | Shutdown was scheduled, including disconnect self-exit.                                                                       |
| `sandbox.shutdown.started`        | durable    | Shutdown began.                                                                                                               |
| `run.started`                     | durable    | Run started for a conversation/agent.                                                                                         |
| `run.delta`                       | transient  | Bounded streaming assistant/tool/system progress; not required for replay recovery.                                           |
| `run.transcript.appended`         | durable    | Durable transcript entry appended.                                                                                            |
| `run.waiting_for_input`           | durable    | Agent waits for user/controller input.                                                                                        |
| `run.waiting_for_approval`        | durable    | Tool call waits for approval.                                                                                                 |
| `run.checkpointed`                | durable    | Recovery checkpoint written.                                                                                                  |
| `run.completed`                   | durable    | Run completed.                                                                                                                |
| `run.failed`                      | durable    | Run failed.                                                                                                                   |
| `run.cancelled`                   | durable    | Run cancelled.                                                                                                                |
| `tool.call.requested`             | durable    | Tool call requested or approval needed.                                                                                       |
| `tool.call.started`               | durable    | Tool call execution began.                                                                                                    |
| `tool.call.completed`             | durable    | Tool call completed with bounded result.                                                                                      |
| `tool.call.failed`                | durable    | Tool call failed with redacted error.                                                                                         |
| `tool.call.cancelled`             | durable    | Tool call was cancelled after state was updated.                                                                              |
| `sandbox.security.denied`         | durable    | Policy denied an action.                                                                                                      |

Events associated with a run SHOULD include `conversationId`, `agentId`, and `runId`. Event producers MUST use the payload shapes in [Event Schemas](./event-schemas.md) for baseline event types.

## Redaction and bounded payloads

- Raw secrets MUST NOT appear in protocol payloads.
- Secret-store values MUST never be emitted; key names SHOULD be redacted or hashed when configured.
- Tool output, boot output, transcripts, and errors MUST be bounded.
- Large artifacts SHOULD be referenced by path, content ID, or controller-specific resource ID.
- Startup setup events MUST not include raw private keys, tokens, credential helper files, or unredacted remote URLs.

## Replay and ack

Durable sandbox events are at-least-once delivered.

Requirements:

- The sandbox MUST persist durable events before sending.
- The controller MUST acknowledge processed event sequence numbers.
- The sandbox MUST replay unacknowledged durable events after reconnect; transient deltas are best-effort and may be dropped.
- Receivers MUST deduplicate by event ID/sequence.
- Transient events MAY be dropped during reconnect and MUST NOT be required for recovery.

## Flow control

The controller MAY use Nerve Protocol flow-control messages to pause or reduce event throughput. The sandbox SHOULD keep writing durable local state even when outbound delivery is backpressured, until resource limits require cancellation or failure.
