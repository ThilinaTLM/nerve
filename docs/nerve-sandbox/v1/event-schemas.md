# Sandbox Event Schemas

Sandbox events are domain events carried inside Nerve Protocol v1 `event.batch` messages. This document defines baseline payloads for Sandbox v1.

## Event envelope mapping

Each event in an `event.batch` SHOULD have an event envelope equivalent to:

```ts
type SandboxEvent<
  TType extends keyof SandboxEventPayloadMap = keyof SandboxEventPayloadMap,
> = {
  id: string;
  seq: number;
  type: TType;
  ts: string;
  durability: "durable" | "transient";
  data: SandboxEventPayloadMap[TType];
};
```

Run-scoped events SHOULD duplicate `conversationId`, `agentId`, and `runId` at the protocol event metadata level when the underlying event stream supports it, but the payload remains authoritative for domain reducers.

All payloads MUST be safe to persist and log after redaction. Raw secrets MUST NOT appear.

## Common types

```ts
type SandboxEventCommon = {
  sandboxId?: string;
  instanceId: string;
  configDigest?: string;
};

type RunScope = {
  conversationId: string;
  agentId: string;
  runId: string;
};

type RedactedError = {
  code: string;
  message: string;
  retryable?: boolean;
};

type BoundedText = {
  text: string;
  truncated?: boolean;
  bytes?: number;
};

type ArtifactRef = {
  path?: string;
  contentId?: string;
  url?: string;
  mimeType?: string;
  bytes?: number;
  expiresAt?: string;
};
```

## Payload map

```ts
type SandboxEventPayloadMap = {
  "sandbox.config.loaded": SandboxConfigLoadedEvent;
  "sandbox.secret_store.checked": SandboxSecretStoreCheckedEvent;
  "sandbox.credentials.refreshed": SandboxCredentialsRefreshedEvent;
  "sandbox.setup.git.started": SandboxSetupStartedEvent;
  "sandbox.setup.git.completed": SandboxSetupCompletedEvent;
  "sandbox.setup.github.started": SandboxSetupStartedEvent;
  "sandbox.setup.github.completed": SandboxSetupCompletedEvent;
  "sandbox.boot.started": SandboxBootStartedEvent;
  "sandbox.boot.completed": SandboxBootCompletedEvent;
  "sandbox.skills.loaded": SandboxSkillsLoadedEvent;
  "sandbox.ready": SandboxReadyEvent;
  "sandbox.controller.disconnected": SandboxControllerDisconnectedEvent;
  "sandbox.controller.reconnected": SandboxControllerReconnectedEvent;
  "sandbox.shutdown.scheduled": SandboxShutdownScheduledEvent;
  "sandbox.shutdown.started": SandboxShutdownStartedEvent;
  "sandbox.security.denied": SandboxSecurityDeniedEvent;
  "run.started": RunStartedEvent;
  "run.delta": RunDeltaEvent;
  "run.transcript.appended": RunTranscriptAppendedEvent;
  "run.waiting_for_input": RunWaitingForInputEvent;
  "run.waiting_for_approval": RunWaitingForApprovalEvent;
  "run.checkpointed": RunCheckpointedEvent;
  "run.completed": RunTerminalEvent;
  "run.failed": RunFailedEvent;
  "run.cancelled": RunTerminalEvent;
  "toolCall.updated": ToolCallRequestedEvent;
  "toolCall.updated": ToolCallStartedEvent;
  "toolCall.updated": ToolCallCompletedEvent;
  "toolCall.updated": ToolCallFailedEvent;
  "toolCall.updated": ToolCallCancelledEvent;
};
```

## Sandbox lifecycle events

```ts
type SandboxConfigLoadedEvent = SandboxEventCommon & {
  status: "loaded" | "degraded";
  configDigest: string;
  effectiveDefaults?: Record<string, unknown>;
  models: Array<{
    provider: string;
    model: string;
    active: boolean;
    limitations?: string[];
  }>;
  toolGroups: ToolGroupStatus[];
  secretStores?: SecretStoreStatus[];
  setup?: { git?: StartupSetupStatus; github?: StartupSetupStatus };
  network?: NetworkPolicyStatus;
  limitations?: string[];
};

type SandboxSecretStoreCheckedEvent = SandboxEventCommon & {
  storeId: string;
  status: "available" | "unavailable" | "degraded" | "skipped";
  cacheEnabled?: boolean;
  checkedAt: string;
  error?: RedactedError;
};

type SandboxCredentialsRefreshedEvent = SandboxEventCommon & {
  provider: string;
  group?: string;
  credentialType: "oauth" | "api_key" | "bearer" | "basic" | "ssh" | "gpg";
  status: "refreshed" | "unchanged" | "failed" | "skipped";
  expiresAt?: string;
  persisted: "state" | "file" | "none" | "not_applicable";
  error?: RedactedError;
};

type SandboxSetupStartedEvent = SandboxEventCommon & {
  setup: "git" | "github";
  startedAt: string;
};

type SandboxSetupCompletedEvent = SandboxEventCommon & {
  setup: "git" | "github";
  status: "completed" | "failed" | "degraded" | "skipped";
  startedAt?: string;
  completedAt: string;
  summary?: Record<string, unknown>;
  limitations?: string[];
  error?: RedactedError;
};

type SandboxBootStartedEvent = SandboxEventCommon & {
  phase: string;
  index: number;
  startedAt: string;
  timeoutMs: number;
  runAs: "sandbox" | "root";
  network: "inherit" | "deny" | "package_registries_only";
};

type SandboxBootCompletedEvent = SandboxEventCommon & {
  phase: string;
  index: number;
  status: "completed" | "failed" | "timeout" | "skipped";
  startedAt?: string;
  completedAt: string;
  exitCode?: number;
  stdout?: BoundedText;
  stderr?: BoundedText;
  artifacts?: ArtifactRef[];
  lockfileDigests?: Array<{ path: string; before?: string; after?: string }>;
  error?: RedactedError;
};

type SandboxSkillsLoadedEvent = SandboxEventCommon & {
  status: "loaded" | "degraded" | "failed";
  contextFiles: ContextFileStatus[];
  skills: SkillStatus[];
  diagnostics?: Array<{
    level: "info" | "warn" | "error";
    message: string;
    path?: string;
  }>;
};

type SandboxReadyEvent = SandboxEventCommon & {
  status: "ready" | "degraded";
  readyAt: string;
  recovered: boolean;
  daemonStatus: SandboxDaemonStatus;
  degraded?: DegradedStatus;
  cursor: { streams: Array<{ stream: string; processedSeq: number }> };
};
```

## Connectivity and shutdown events

```ts
type SandboxControllerDisconnectedEvent = SandboxEventCommon & {
  disconnectedAt: string;
  reason:
    | "transport_closed"
    | "heartbeat_timeout"
    | "auth_failed"
    | "protocol_error"
    | "network_error"
    | "unknown";
  retryable: boolean;
  exitAfterMs: number;
  exitAt: string;
};

type SandboxControllerReconnectedEvent = SandboxEventCommon & {
  disconnectedAt?: string;
  reconnectedAt: string;
  downtimeMs?: number;
  sessionId: string;
  replayRequired?: boolean;
};

type SandboxShutdownScheduledEvent = SandboxEventCommon & {
  reason:
    | "controller_disconnect_timeout"
    | "manager_request"
    | "resource_limit"
    | "fatal_error";
  scheduledAt: string;
  exitAt?: string;
  graceMs?: number;
};

type SandboxShutdownStartedEvent = SandboxEventCommon & {
  reason:
    | "controller_disconnect_timeout"
    | "manager_request"
    | "resource_limit"
    | "fatal_error";
  startedAt: string;
  exitCode?: number;
};
```

`sandbox.controller.disconnected`, `sandbox.shutdown.scheduled`, and `sandbox.shutdown.started` SHOULD be durable when they can be written before exit. A disconnect event may remain local until connectivity returns; if the sandbox exits before reconnecting, the manager may infer the condition from container exit status and state files.

## Run events

```ts
type RunStartedEvent = SandboxEventCommon &
  RunScope & {
    commandId: string;
    status: "queued" | "running";
    promptSummary?: string;
    model: { provider: string; model: string; thinkingLevel?: string };
    startedAt: string;
  };

type RunDeltaEvent = SandboxEventCommon &
  RunScope & {
    deltaId: string;
    role: "assistant" | "tool" | "system";
    text?: string;
    artifactRefs?: ArtifactRef[];
    finishReason?: string;
  };

type RunTranscriptAppendedEvent = SandboxEventCommon &
  RunScope & {
    entryId: string;
    index: number;
    role: "user" | "assistant" | "tool" | "system";
    content: BoundedText | ArtifactRef;
    createdAt: string;
  };

type RunWaitingForInputEvent = SandboxEventCommon &
  RunScope & {
    requestId: string;
    question: BoundedText;
    placeholder?: string;
    required: boolean;
    createdAt: string;
  };

type RunWaitingForApprovalEvent = SandboxEventCommon &
  RunScope & {
    approvalId: string;
    toolCallId: string;
    risk: string[];
    reason: string;
    normalizedArgs: unknown;
    offeredScopes?: Array<"single_call" | "same_tool_same_args" | "run">;
    createdAt: string;
  };

type RunCheckpointedEvent = SandboxEventCommon &
  RunScope & {
    checkpointId: string;
    status: SandboxRunStatus;
    transcriptCursor: number;
    toolCallIds?: string[];
    createdAt: string;
  };

type RunTerminalEvent = SandboxEventCommon &
  RunScope & {
    status: "completed" | "cancelled";
    completedAt: string;
    summary?: BoundedText;
  };

type RunFailedEvent = SandboxEventCommon &
  RunScope & {
    status: "failed";
    failedAt: string;
    retryable: boolean;
    error: RedactedError;
  };
```

`run.delta` is transient by default and is not required for replay recovery. `run.transcript.appended`, wait events, checkpoints, and terminal run events are durable and are written only after the referenced state/transcript/checkpoint data is durable. Retryable provider failures use `run.failed` with `error.retryable = true`; the run snapshot/status may be `recoverable_failed` to show continue eligibility.

## Tool events

```ts
type ToolCallRequestedEvent = SandboxEventCommon &
  RunScope & {
    toolCallId: string;
    toolName: string;
    status:
      | "requested"
      | "waiting_for_approval"
      | "started"
      | "completed"
      | "failed"
      | "cancelled";
    group?: string;
    risk?: string[];
    decision?: "allow" | "approval" | "deny";
    approvalId?: string;
    displayArgs?: unknown;
    normalizedArgs?: unknown;
    artifactRefs?: ArtifactRef[];
    lifecycleSeq?: number;
    requestedAt?: string;
  };

type ToolCallStartedEvent = ToolCallRequestedEvent & {
  status: "started";
  startedAt: string;
  timeoutMs?: number;
};

type ToolCallCompletedEvent = ToolCallRequestedEvent & {
  status: "completed";
  completedAt: string;
  durationMs?: number;
  result?: unknown;
  stdout?: BoundedText;
  stderr?: BoundedText;
  artifacts?: ArtifactRef[];
};

type ToolCallFailedEvent = ToolCallRequestedEvent & {
  status: "failed";
  failedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error: RedactedError;
};

type ToolCallCancelledEvent = ToolCallRequestedEvent & {
  status: "cancelled";
  cancelledAt: string;
  error?: RedactedError;
};

type SandboxSecurityDeniedEvent = SandboxEventCommon &
  Partial<RunScope> & {
    denialId: string;
    action: string;
    group?: string;
    toolName?: string;
    risk?: string[];
    reason: string;
    normalizedArgs?: unknown;
    deniedAt: string;
  };
```

Tool lifecycle events are durable. Tool results MUST be bounded and redacted. Large outputs SHOULD be represented as artifact references. Approval waits update the tool-call status to `waiting_for_approval` before emitting `run.waiting_for_approval`.

## Status support types

```ts
type ToolGroupStatus = {
  group: string;
  configured: boolean;
  active: boolean;
  tools: string[];
  unavailableTools?: string[];
  credentialType?:
    "none" | "api_key" | "bearer" | "oauth" | "ssh" | "gpg" | "basic";
  limitations?: string[];
};

type SecretStoreStatus = {
  id: string;
  status: "available" | "unavailable" | "degraded" | "skipped";
  cacheEnabled?: boolean;
  limitations?: string[];
};

type StartupSetupStatus = {
  configured: boolean;
  status: "skipped" | "started" | "completed" | "failed" | "degraded";
  startedAt?: string;
  completedAt?: string;
  limitations?: string[];
  error?: RedactedError;
};

type ContextFileStatus = {
  path: string;
  digest?: string;
  bytes?: number;
  included: boolean;
};

type SkillStatus = {
  name: string;
  source: "builtin" | "workspace" | "manager" | "mounted" | "unknown";
  path: string;
  digest?: string;
  modelVisible: boolean;
  bytes?: number;
};

type CredentialStatus = {
  provider: string;
  group?: string;
  credentialType: string;
  expiresAt?: string;
  status:
    | "available"
    | "expired"
    | "refreshing"
    | "refreshed"
    | "failed"
    | "unavailable";
  error?: RedactedError;
};

type NetworkPolicyStatus = {
  requestedDefault: "allow" | "deny";
  enforcedDefault: "allow" | "deny" | "unknown";
  allowedHosts: string[];
  deniedHosts: string[];
  packageRegistryHosts?: string[];
  backend: "container" | "iptables" | "nftables" | "proxy" | "cni" | "none";
  limitations?: string[];
};

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
  | "reconnecting"
  | "stopping"
  | "failed";

type DegradedStatus = {
  degraded: true;
  reason: string;
  since: string;
  limitations: string[];
};
```

## Redaction and bounds

Event producers MUST:

- recursively redact configured secret values;
- redact authorization headers, cookies, tokens, private keys, passphrases, and credential helper contents;
- bound text fields by bytes and mark truncation;
- emit paths only when they are safe and do not expose protected credential locations;
- avoid full provider request/response payloads;
- avoid unbounded skill/context file contents.
