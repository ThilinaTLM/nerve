# Durability

Sandbox v1 is durable when `/state` is mounted on persistent storage. The sandbox must be able to restart, reconnect, replay unacknowledged events, restore refreshed credentials, recover secret-store status, reload context/skills metadata, and resume or report stable conversation/agent/run state without losing accepted work. It must also preserve enough controller connectivity state to explain reconnecting and disconnect self-exit decisions.

Durability has two sides:

- **local durability** in `/state`, owned by the sandbox daemon;
- **controller durability**, owned by the API/controller after it processes and acknowledges sandbox events.

## State directory layout

A conforming implementation SHOULD use a layout equivalent to:

```text
/state/
  VERSION
  lock
  config/
    sanitized.yaml
    digest.txt
    effective.json
  controller/
    session.json
    cursors.json
    connectivity.json
  credentials/
    oauth/<provider>.json
    ssh/
    gpg/
    status.json
  secrets/
    stores.json
    status.json
  setup/
    git.json
    github.json
  commands/
    inbox.jsonl
    decisions.jsonl
  events/
    outbox.jsonl
    ack.json
  conversations/
    <conversation-id>/
      state.json
      agents/
        <agent-id>/
          state.json
          runs/
            <run-id>/
              state.json
              transcript.jsonl
              tool-calls/
                <tool-call-id>.json
              checkpoints/
                <checkpoint-id>.json
              artifacts/
  skills/
    context-files.json
    loaded.json
    diagnostics.jsonl
  boot/
    attempts.jsonl
    latest.log
  cache/
    dependencies/
    secrets/
  tmp/
```

Implementations MAY use a different physical layout if they preserve the same semantics. In particular, a deployment that starts with one conversation and one main agent MAY use shorter paths internally, but persisted state MUST retain conversation/agent/run identifiers where future or concurrent work could collide.

## Files and semantics

| File/directory                                                 | Semantics                                                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `VERSION`                                                      | State format version and migration marker.                                                                      |
| `lock`                                                         | Single-writer lock for the state directory.                                                                     |
| `config/sanitized.yaml`                                        | Loaded config with secret values absent.                                                                        |
| `config/digest.txt`                                            | Stable digest of sanitized canonical config.                                                                    |
| `config/effective.json`                                        | Effective defaults, model/provider status, setup status, tool groups, and security limitations without secrets. |
| `controller/session.json`                                      | Last accepted controller session metadata.                                                                      |
| `controller/cursors.json`                                      | Latest local/remote processed cursors.                                                                          |
| `controller/connectivity.json`                                 | Current/last controller connection state, disconnect start time, reconnect attempts, and self-exit deadline.    |
| `credentials/oauth/<provider>.json`                            | Protected refreshed OAuth bundle, never included in ordinary snapshots/events.                                  |
| `credentials/status.json`                                      | Redacted credential status such as provider, expiry, and refresh outcome.                                       |
| `secrets/stores.json`                                          | Sanitized configured secret-store metadata and cache settings.                                                  |
| `secrets/status.json`                                          | Redacted key-value store health/cache status, never secret values.                                              |
| `setup/git.json`                                               | Redacted Git startup setup result: identity presence, clone/ref, remotes, signing status, errors.               |
| `setup/github.json`                                            | Redacted GitHub startup setup result: host, auth type, CLI setup, errors.                                       |
| `commands/inbox.jsonl`                                         | Append-only journal of accepted controller commands.                                                            |
| `commands/decisions.jsonl`                                     | Command validation/idempotency decisions.                                                                       |
| `events/outbox.jsonl`                                          | Append-only durable events pending or already delivered.                                                        |
| `events/ack.json`                                              | Latest controller ack cursor known to the sandbox.                                                              |
| `conversations/<conversation-id>/state.json`                   | Latest materialized conversation status.                                                                        |
| `conversations/<conversation-id>/agents/<agent-id>/state.json` | Latest materialized agent/subagent status.                                                                      |
| `runs/<run-id>/state.json` equivalent                          | Latest materialized run status inside the agent scope.                                                          |
| `transcript.jsonl`                                             | Durable run transcript entries.                                                                                 |
| `tool-calls/*.json`                                            | Tool call args/result/error records with redaction metadata.                                                    |
| `checkpoints/*.json`                                           | Point-in-time recovery snapshots.                                                                               |
| `artifacts`                                                    | Bounded artifacts or references created by tools.                                                               |
| `skills/context-files.json`                                    | Loaded `AGENTS.md` paths, digests, and bounded metadata.                                                        |
| `skills/loaded.json`                                           | Loaded skill names, source classes, paths, and model-visible flags.                                             |
| `skills/diagnostics.jsonl`                                     | Durable skill-loading warnings/errors without full unbounded contents.                                          |
| `boot/attempts.jsonl`                                          | Durable boot attempt records.                                                                                   |
| `boot/latest.log`                                              | Bounded/redacted latest boot transcript.                                                                        |
| `cache/dependencies`                                           | Rebuildable package-manager caches.                                                                             |
| `cache/secrets`                                                | Protected key-value secret cache, if enabled.                                                                   |

## Write-ahead rules

The sandbox MUST follow write-ahead behavior for recovery-critical operations:

1. **Commands**
   - Validate command envelope and method.
   - Check idempotency.
   - Append accepted command to `commands/inbox.jsonl`.
   - Flush it durably.
   - Only then execute or enqueue the command.

2. **Command decisions**
   - Record accept/reject/idempotency decisions in `commands/decisions.jsonl`.
   - A duplicate command MUST be answered from prior journaled state when possible.
   - `paramsHash` MUST use the canonical SHA-256 JSON normalization defined in [Commands](./commands.md).

3. **Events**
   - Materialize event payload.
   - Append durable event to `events/outbox.jsonl`.
   - Flush it durably.
   - Only then send it over WebSocket.

4. **Conversation, agent, and run state**
   - Update conversation/agent/run `state.json` before or atomically with durable status events.
   - Append transcript/tool-call records before emitting durable events that claim they exist.
   - Persist parent-child relationships for subagents and explore work.

5. **Checkpoints**
   - Write checkpoint content to a temporary file.
   - Flush and atomically rename into `checkpoints/`.
   - Update state to reference the checkpoint.

6. **Credential refresh**
   - Resolve existing credential state.
   - Refresh using provider/tool client without logging secret values.
   - Write refreshed bundle to a temporary file under protected state or configured credential file.
   - Flush and atomically rename.
   - Preserve the previous valid bundle if refresh fails.
   - Emit only redacted durable credential status events.

7. **Secret-store resolution/cache**
   - Resolve key-value secrets only when needed.
   - If caching is enabled, write values only under protected cache state using restrictive permissions and atomic writes.
   - Record cache/status metadata without raw values.
   - Preserve prior valid cache entries when refresh/fetch fails, subject to TTL and fail-closed policy.

8. **Git/GitHub startup setup**
   - Record setup start before invoking external commands or APIs.
   - Record redacted completion/failure status before boot phases depend on setup.
   - Do not record raw keys, tokens, credential helper contents, or unredacted remote URLs.

9. **Context and skill loading**
   - Load context files and skills after workspace checkout when checkout is configured.
   - Write `skills/context-files.json`, `skills/loaded.json`, and diagnostics before emitting `sandbox.skills.loaded`.
   - Store bounded metadata and digests, not unbounded file contents.

## Event outbox

`events/outbox.jsonl` is the authoritative local source for sandbox durable event replay.

```ts
type OutboxRecord = {
  seq: number;
  id: string;
  ts: string;
  type: string;
  durability: "durable" | "transient";
  data: unknown;
  conversationId?: string;
  agentId?: string;
  runId?: string;
  sentAt?: string;
  ackedAt?: string;
};
```

Requirements:

- Durable event `seq` values MUST be strictly increasing in the sandbox stream.
- A durable event MUST remain replayable until the controller acknowledges it and retention allows compaction.
- Transient events MAY be omitted from the outbox or retained only briefly, but transient events MUST NOT be required for recovery.
- Event IDs MUST remain stable across resend/replay.
- Credential and secret-store events MUST carry redacted status only.

## Command inbox

`commands/inbox.jsonl` is the authoritative local record of accepted controller commands.

```ts
type CommandRecord = {
  commandId: string;
  messageId: string;
  method: string;
  paramsHash: string;
  params: unknown;
  acceptedAt: string;
  status:
    "accepted" | "queued" | "running" | "completed" | "failed" | "cancelled";
  recoveryStatus?:
    "not_needed" | "requeued" | "marked_failed" | "marked_cancelled";
  conversationId?: string;
  agentId?: string;
  runId?: string;
};
```

Requirements:

- `commandId` MUST be unique for a mutating command payload.
- Repeated `commandId` with the same `paramsHash` MUST be idempotent.
- Repeated `commandId` with a different `paramsHash` MUST be rejected.
- Commands that reached a terminal decision MUST NOT be executed again after restart.
- Accepted but not-started commands MAY be requeued only when method-specific recovery policy allows it.
- Commands running during a crash MUST be reconciled from durable run/tool state; tool calls MUST NOT be assumed successful without a durable result record.
- Recovery decisions MUST be appended to `commands/decisions.jsonl` or equivalent.

## Checkpoints

A checkpoint SHOULD be written:

- after config/setup/bootstrap reaches ready or degraded state;
- after skill/context loading completes when resources affect the system prompt;
- after a required credential refresh succeeds or fails before a run;
- after a secret-store fetch/cached credential changes availability for a required provider/tool;
- when a run starts;
- before waiting for user input;
- before waiting for approval;
- after each completed agent turn if configured;
- after each tool call result if configured;
- when a run completes, fails, or is cancelled;
- before graceful shutdown if a run is active.

A run checkpoint SHOULD include:

```ts
type RunCheckpoint = {
  checkpointId: string;
  conversationId: string;
  agentId: string;
  runId: string;
  parentAgentId?: string;
  status: string;
  configDigest: string;
  modelSelection: { provider: string; model: string; thinkingLevel?: string };
  transcriptCursor: number;
  toolCallIds: string[];
  pendingInput?: unknown;
  pendingApproval?: unknown;
  childAgentIds?: string[];
  createdAt: string;
};
```

The checkpoint MUST NOT contain raw secrets.

## Recovery sequence

On restart, the sandbox SHOULD:

1. Acquire `/state/lock`.
2. Read `VERSION` and migrate or fail closed.
3. Load previous sanitized config digest and compare with current config.
4. Load credential and secret-store status.
5. Recover or reapply idempotent Git/GitHub setup as required by config.
6. Load controller session/cursors and connectivity state.
7. Load command decisions and event ack cursor.
8. Load latest conversation, agent, run states, and checkpoints.
9. Rebuild in-memory idempotency indexes.
10. Reconcile active commands/runs:
    - terminal runs remain terminal;
    - waiting runs remain waiting;
    - accepted but not-started commands may be requeued if safe;
    - active runs become recoverable, failed, cancelled, or queued according to implementation policy;
    - cancelled runs remain cancelled;
    - in-progress tool calls without durable completion become failed or unknown, not successful.
11. Reload context/skills if config/image/workspace inputs changed.
12. Reconcile outbox replay using the lower/safe cursor of local `events/ack.json` and any trusted controller-provided processed cursor; never discard events that might not have been processed.
13. Replay unacknowledged durable events after controller reconnect.
14. Announce recovered daemon status.

## Controller connectivity state

The sandbox SHOULD persist controller connectivity status so restart and manager diagnostics can explain disconnect behavior.

```ts
type ControllerConnectivityRecord = {
  state: "connected" | "reconnecting" | "disconnected" | "shutting_down";
  sessionId?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  lastErrorCode?: string;
  reconnectAttempts: number;
  exitAfterMs: number;
  exitAt?: string;
};
```

Requirements:

- The record MUST NOT contain controller API keys or authorization headers.
- `disconnectedAt` and `exitAt` MUST be persisted when the disconnect self-exit timer starts.
- Successful protocol `welcome` SHOULD update `sessionId`, clear `exitAt`, and reset reconnect attempts.
- If the sandbox exits due to disconnect timeout, it SHOULD persist `state: "shutting_down"` and the intended exit code before exiting when possible.

## Snapshots

Snapshots are controller-requested summaries used for reconciliation. They MUST be safe to persist and log.

A snapshot SHOULD include:

- sandbox ID, instance ID, daemon status, controller connectivity status, and config digest;
- sanitized effective config summary;
- model/provider status;
- Git/GitHub setup status without secrets;
- secret-store status without values;
- tool-group status;
- loaded context/skill metadata;
- conversation, agent, and run summaries;
- selected run details when requested;
- cursor information for replay.

Snapshots MUST NOT include raw secrets, provider request payloads, unbounded transcripts, unbounded skill contents, or protected credential files.

## Retention and pruning

Retention policy MAY remove old events, commands, transcripts, artifacts, cache entries, and checkpoints only when doing so cannot break recovery of retained conversations/runs.

Requirements:

- Durable events MUST remain until acknowledged and retention permits pruning.
- The latest state and at least one valid checkpoint SHOULD be kept for each retained run.
- Parent/child agent relationships SHOULD remain explainable while any child or parent run is retained.
- Protected credential state required for current config MUST NOT be deleted while the sandbox may need to refresh or continue runs.
- Secret-store cache entries MAY be pruned according to TTL, max size, or manager revocation policy.
- Dependency caches under `/state/cache/dependencies` are rebuildable and MAY be pruned according to size/age policy.
- Artifacts MAY be pruned only when snapshots/events no longer reference them or references are marked expired.

## Corruption handling

If state corruption is detected, the sandbox MUST fail closed unless it can recover a safe earlier state.

- Corrupt protected credential files MUST NOT be partially used.
- Corrupt secret cache values MUST be discarded or treated unavailable.
- Corrupt command journals MUST not cause duplicate execution of mutating commands.
- Corrupt checkpoints may be skipped only if an older valid checkpoint can explain the run state.
- Recovery limitations MUST be reported to the controller with redacted errors.
