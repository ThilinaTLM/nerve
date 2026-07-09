# Sandbox Commands

Sandbox commands are Nerve Protocol v1 `request` messages. The request `data.method` identifies the command and `data.params` contains one of the parameter shapes below.

This document defines the baseline command surface between a controller/manager and a sandbox daemon. A sandbox manager MAY expose additional manager-only commands to frontend clients, but it MUST translate sandbox-daemon commands to this contract when controlling a sandbox.

## Common command fields

Every mutating command MUST include `commandId`.

```ts
type SandboxCommandScope = {
  conversationId?: string;
  agentId?: string;
  runId?: string;
};

type MutatingCommandBase = SandboxCommandScope & {
  commandId: string;
  metadata?: Record<string, unknown>;
};
```

Rules:

- `commandId` MUST be unique for a mutating command payload within the sandbox state directory.
- The protocol message `idempotencyKey`, when present, SHOULD equal `commandId`.
- Commands that omit `conversationId` or `agentId` use the sandbox's default active conversation/agent.
- A controller MUST NOT reuse a `commandId` with a different payload.
- The sandbox MUST journal accepted mutating commands before execution.

## Canonical parameter hash

The sandbox records `paramsHash` for idempotency. `paramsHash` MUST be computed as:

1. Normalize params to JSON-compatible data.
2. Remove no fields except transport-only wrapper fields. Do not remove `metadata`.
3. Sort object keys lexicographically at every level.
4. Preserve array order.
5. Preserve string values exactly after JSON parsing.
6. Encode as UTF-8 canonical JSON without insignificant whitespace.
7. Hash with SHA-256 and prefix with `sha256:`.

Equivalent YAML/JSON object key order MUST produce the same hash. Different omitted-vs-null fields produce different hashes unless the schema explicitly normalizes the field default before hashing.

## Common results and errors

```ts
type CommandAcceptedResult = {
  accepted: true;
  commandId: string;
  status: "accepted" | "queued" | "running" | "completed" | "failed" | "cancelled";
  conversationId?: string;
  agentId?: string;
  runId?: string;
};

type SandboxCommandErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "UNKNOWN_CONVERSATION"
  | "UNKNOWN_AGENT"
  | "UNKNOWN_RUN"
  | "INVALID_RUN_STATE"
  | "UNKNOWN_INPUT_REQUEST"
  | "UNKNOWN_APPROVAL"
  | "ALREADY_RESOLVED"
  | "POLICY_DENIED"
  | "SANDBOX_DEGRADED"
  | "SANDBOX_FAILED";
```

Protocol errors SHOULD use Nerve Protocol v1 `error` messages with one of these codes in `data.code` where possible. Domain validation errors MAY also be returned as request errors by the protocol adapter.

## `sandbox.run.start`

Starts a new run or returns existing status for a duplicate command.

```ts
type SandboxRunStartParams = MutatingCommandBase & {
  runId?: string;
  prompt?: string;
  images?: Array<{
    mimeType: string;
    dataRef: string;
  }>;
  behavior?: "start" | "follow_up" | "steer";
};

type SandboxRunStartResult = CommandAcceptedResult & {
  accepted: true;
  conversationId: string;
  agentId: string;
  runId: string;
  status: SandboxRunStatus;
};
```

Validation:

- `prompt` is required for every `sandbox.run.start` behavior, including `steer`.
- For `behavior: "steer"`, `conversationId`, `agentId`, and `runId` are also required.
- First prompts are conversation-level commands and are not read from sandbox YAML.
- `behavior: "start"` creates a new run unless `runId` names an existing compatible duplicate.
- `behavior: "follow_up"` appends to the conversation after a terminal or waiting state according to harness policy.
- `behavior: "steer"` is allowed only for an active steerable run.
- Mutating starts return after the command/run is durably accepted; provider progress is delivered by events and status/snapshot updates.
- Auth-backed providers require a configured `modelCatalog.providers[].credential` and are rejected with `UNAVAILABLE` before provider launch when the credential cannot be resolved. Local/no-auth providers such as `ollama` may omit credentials.

## `sandbox.run.continue`

Continues a waiting or recoverable run.

```ts
type SandboxRunContinueParams = MutatingCommandBase & {
  runId: string;
  reason?: "after_input" | "after_approval" | "retry_error" | "manual";
};

type SandboxRunContinueResult = CommandAcceptedResult & {
  accepted: true;
  conversationId: string;
  agentId: string;
  runId: string;
  status: SandboxRunStatus;
};
```

The sandbox MUST reject continuation for completed, cancelled, failed-non-retryable, or unknown runs.

## `sandbox.run.cancel`

Requests cooperative cancellation.

```ts
type SandboxRunCancelParams = MutatingCommandBase & {
  runId: string;
  reason?: string;
};

type SandboxRunCancelResult = CommandAcceptedResult & {
  accepted: true;
  conversationId: string;
  agentId: string;
  runId: string;
  status: "queued" | "running" | "cancelled";
  cancellationRequested: true;
};
```

The sandbox MUST persist the cancellation request and SHOULD abort provider requests and tool processes where possible. Duplicate cancellation commands are idempotent.

## `sandbox.input.submit`

Submits human/controller input for a pending question.

```ts
type SandboxInputSubmitParams = MutatingCommandBase & {
  runId: string;
  requestId: string;
  text: string;
};

type SandboxInputSubmitResult = CommandAcceptedResult & {
  accepted: true;
  conversationId: string;
  agentId: string;
  runId: string;
  requestId: string;
  status: SandboxRunStatus;
};
```

The `requestId` MUST match an unresolved `run.waiting_for_input` state. Answers for unknown, dismissed, expired, or already answered requests MUST be rejected.

## `sandbox.approval.resolve`

Resolves a pending tool approval.

```ts
type SandboxApprovalResolveParams = MutatingCommandBase & {
  runId: string;
  approvalId: string;
  decision: "grant" | "deny";
  note?: string;
  selectedScope?: "single_call" | "same_tool_same_args" | "run";
};

type SandboxApprovalResolveResult = CommandAcceptedResult & {
  accepted: true;
  conversationId: string;
  agentId: string;
  runId: string;
  approvalId: string;
  decision: "grant" | "deny";
  status: SandboxRunStatus;
};
```

A granted approval applies only to the referenced tool call unless the waiting event offered broader scopes and the controller selected one. The sandbox MAY ignore or reject unsupported broader scopes.

## `sandbox.status.get`

Returns current daemon status. This command is read-only and does not require `commandId`.

```ts
type SandboxStatusGetParams = {
  includeConversations?: boolean;
  includeRuns?: boolean;
  includeConfig?: "none" | "digest" | "sanitized";
  includeConnectivity?: boolean;
};

type SandboxStatusGetResult = {
  sandboxId?: string;
  instanceId: string;
  status: SandboxDaemonStatus;
  configDigest?: string;
  startedAt?: string;
  updatedAt: string;
  degraded?: DegradedStatus;
  connectivity?: ControllerConnectivityStatus;
  conversations?: SandboxConversationSummary[];
  runs?: SandboxRunSummary[];
  config?: unknown;
};
```

If `includeConfig: "sanitized"`, raw secrets MUST be absent.

## `sandbox.snapshot.get`

Returns a durable snapshot for reconciliation.

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
  includeConnectivity?: boolean;
};

type SandboxSnapshotResult = {
  sandboxId?: string;
  instanceId: string;
  status: SandboxDaemonStatus;
  conversations: SandboxConversationSnapshot[];
  runs: SandboxRunSnapshot[];
  configDigest?: string;
  config?: unknown;
  toolGroups?: ToolGroupStatus[];
  setup?: {
    git?: StartupSetupStatus;
    github?: StartupSetupStatus;
  };
  secretStores?: SecretStoreStatus[];
  skills?: SkillStatus[];
  contextFiles?: ContextFileStatus[];
  credentialStatus?: CredentialStatus[];
  connectivity?: ControllerConnectivityStatus;
  cursor: {
    streams: Array<{ stream: string; processedSeq: number }>;
  };
};
```

Snapshots MUST NOT include raw secrets, unbounded transcripts, provider payloads, or protected credential/cache files.

## Shared status types

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
  | "reconnecting"
  | "stopping"
  | "failed";

type DegradedStatus = {
  degraded: true;
  reason: string;
  since: string;
  limitations: string[];
};

type ControllerConnectivityStatus = {
  state: "connected" | "reconnecting" | "disconnected" | "shutting_down";
  connectedAt?: string;
  disconnectedAt?: string;
  lastErrorCode?: string;
  reconnectAttempts?: number;
  exitAfterMs?: number;
  exitAt?: string;
};

type StartupSetupStatus = {
  configured: boolean;
  status: "skipped" | "started" | "completed" | "failed" | "degraded";
  startedAt?: string;
  completedAt?: string;
  limitations?: string[];
  error?: RedactedError;
};

type RedactedError = {
  code: string;
  message: string;
  retryable?: boolean;
};
```

Implementations may add fields, but baseline fields MUST retain these meanings.

## In-flight command recovery

After restart, the sandbox MUST rebuild command idempotency state from `commands/inbox.jsonl` and `commands/decisions.jsonl`.

- Commands with terminal status MUST NOT execute again.
- Accepted but not-started commands MAY be requeued if their method is retry-safe and the run state allows it.
- Running commands without a stable checkpoint MUST become failed-retryable, cancelled, or queued according to method-specific recovery policy.
- Tool calls in progress at crash time MUST not be assumed successful unless their result record was durably written.
- Recovery decisions MUST be recorded and surfaced in status/events.
