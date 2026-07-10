# Current Feature Coverage

> Implementation status: see `implementation-status.md` for the current v1 alignment checklist, including snapshot cursors, replay/backpressure hardening, and safe frontend-used JSON HTTP RPC methods.

This document maps Nerve Protocol v1 to the features that exist in the current Nerve application. It is an implementation coverage guide, not a mandate to convert every HTTP route into protocol RPC.

## Coverage principle

A current Nerve feature is compatible with Protocol v1 when it satisfies the relevant parts of this contract. The current UI prefers Protocol RPC for safe JSON APIs and intentionally keeps bootstrap, secret, OAuth, binary/upload/download, and large log flows REST/out-of-band:

1. **Command or resource path**
   - The feature is invoked through an existing REST/resource endpoint, a future protocol `request`, or a transport-specific command channel.
   - Existing REST endpoints MAY remain available for compatibility, but the frontend SHOULD prefer explicit Protocol RPC methods for safe JSON operations.

2. **Event-stream synchronization**
   - User-visible state changes that need live UI updates are represented as domain events and delivered over `event.batch`.
   - Domain events remain transport-neutral and schema-owned by their domain package.

3. **Recovery and snapshots**
   - Materialized UI state that cannot be reconstructed cheaply from replay has a resource or snapshot endpoint.
   - Protocol-compatible snapshots include stream cursor metadata so clients know which later event deltas to apply.

4. **Out-of-band boundaries**
   - Large, binary, streaming, browser-mediated, or secret-sensitive payloads stay on purpose-built resource endpoints unless a future capability defines an attachment profile.
   - Protocol messages may carry metadata, operation IDs, cursors, and resulting events for these flows, but not raw secrets or unbounded binary bodies.

5. **Safe evolution**
   - New protocol methods, events, snapshots, streams, and capabilities follow [Extension Model](./extension-model.md).

## Current route and API coverage matrix

The table below describes how existing route families fit into v1. "REST/resource" means the endpoint remains intentionally resource-oriented or out-of-band. "Protocol RPC" means the current frontend uses `/api/protocol/v1` for that safe JSON operation while the REST route may remain available.

| Current area               | Existing route family                                                                      | v1 posture                                              | Notes                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | `GET /api/status`                                                                          | REST/resource                                           | Stable resource read. Can align errors with protocol codes where practical.                                                     |
| Client config              | `GET /api/client-config`                                                                   | REST/resource                                           | Bootstraps HTTP and WebSocket URLs before a protocol session exists. Keep outside protocol.                                     |
| Event replay compatibility | `GET /api/events?since=N`                                                                  | Compatibility REST; protocol replay target              | Keep during migration. Protocol equivalent is `replay.request` over WebSocket or protocol HTTP replay.                          |
| Settings                   | `GET/PUT /api/settings`                                                                    | REST/resource; RPC candidate                            | Mutations publish `settings.updated`. Secret-bearing settings must not leak through protocol metadata.                          |
| Auth provider metadata     | `GET /api/auth/providers`                                                                  | REST/resource                                           | Materialized credential/provider status, no secrets. Refreshes after `auth.*`, `secrets.*`, or `providers.*` events.            |
| Provider API keys          | `/api/provider-keys`, `/api/auth/credential-key`                                           | Secure REST/resource                                    | API key submission uses the credential encryption path. Do not carry raw keys in protocol metadata or events.                   |
| OAuth flows                | `/api/auth/oauth/flows/*`                                                                  | REST/resource; RPC candidate for metadata only          | Browser redirects and provider tokens stay transport/security specific. Events such as `auth.oauth_flow_updated` can update UI. |
| Provider catalog           | `/api/providers/catalog`, `/api/providers/custom`, `/api/providers/models`                 | REST/resource; RPC candidate                            | Publishes `providers.catalog_changed` and `auth.providers_changed`.                                                             |
| Prompt suggestions         | `/api/projects/:projectId/prompt-suggestions`, `/api/prompt-suggestions/*`                 | REST/resource; RPC candidate                            | Trust changes publish `prompt_suggestions.trust_updated`.                                                                       |
| Storage and index          | `/api/storage`, `/api/storage/rebuild-index`, `/api/storage/usage`, `/api/storage/cleanup` | REST/resource; RPC candidate for maintenance operations | Rebuild/cleanup are long-running candidates if they later need accepted-operation events.                                       |
| Models                     | `GET /api/models`                                                                          | REST/resource                                           | Stable catalog read. Provider/model catalog mutations are under provider catalog routes.                                        |
| Subscription usage         | `GET /api/usage/subscription`                                                              | REST/resource plus transient events                     | `usage.subscription.updated` is best-effort live state and may be coalesced. Polling remains an acceptable fallback.            |
| Tools catalog              | `GET /api/tools`                                                                           | REST/resource                                           | Tool definitions are materialized metadata. Dangerous tool execution remains orchestrator-controlled.                           |
| Tool calls                 | `GET /api/tool-calls`, `GET /api/tool-calls/:id`                                           | REST/resource; RPC candidate                            | State changes are visible through `toolCall.updated`, `approval.*`, and related events.                                         |
| Approvals                  | `/api/approvals/*`                                                                         | REST/resource; strong RPC candidate                     | Grant/deny are small mutation methods and publish `approval.granted` / `approval.denied`.                                       |
| User questions             | `/api/user-questions/*`                                                                    | REST/resource; strong RPC candidate                     | Answer/dismiss are small mutation methods and publish `userQuestion.*`.                                                         |
| Plan reviews               | `/api/plan-reviews/*`                                                                      | REST/resource; strong RPC candidate                     | Review decisions are small mutation methods and publish `planReview.*`.                                                         |
| Transcription              | `POST /api/transcription/audio`                                                            | Out-of-band REST                                        | Multipart audio upload stays out of protocol v1. Responses/events may carry text/result metadata only.                          |
| Workers                    | `GET /api/workers`, `GET /api/workers/:id`                                                 | REST/resource                                           | Worker lifecycle events (`worker.*`) update live state.                                                                         |
| Application logs           | `/api/logs`, `/api/logs/client`, `/api/logs/prune`                                         | REST/resource; RPC candidate                            | Logs must be bounded and redacted. Client logs are diagnostic writes, not event-stream state.                                   |
| Tasks                      | `/api/tasks`, `/api/tasks/:id/*`                                                           | REST/resource; RPC candidate                            | Task lifecycle and output use `task.*` events. Log query remains paginated REST.                                                |
| Completions                | `/api/completions/slash`, `/api/completions/files`                                         | REST/resource                                           | Request/response read APIs; no event-stream requirement.                                                                        |
| Filesystem directories     | `GET /api/filesystem/directories`                                                          | REST/resource                                           | Local filesystem metadata read. Enforce orchestrator policy.                                                                    |
| Filesystem file reads      | `GET /api/filesystem/file`                                                                 | REST/resource / out-of-band boundary                    | Text and small image reads may return bounded content. Large/binary content stays out-of-band.                                  |
| Clipboard images           | `POST /api/filesystem/clipboard-image`                                                     | Out-of-band REST                                        | Base64 upload is already resource-specific; protocol can reference saved paths/results, not embed arbitrary images.             |
| Git and GitHub             | `/api/projects/:projectId/git/*`, `/api/projects/:projectId/github/*`                      | REST/resource; RPC candidate for mutations              | Mutations may be long-running and policy-sensitive. Protocol events can correlate state changes later.                          |
| Projects                   | `/api/projects/*`                                                                          | REST/resource; RPC candidate                            | `project.created`, `project.deleted`, and `project.conversations.pruned` synchronize live UI.                                   |
| Pinned commands            | `/api/projects/:projectId/pinned-commands/*`                                               | REST/resource; RPC candidate                            | Current state can be loaded with project resources. Add events if live cross-client updates become required.                    |
| Conversations              | `/api/conversations/*`                                                                     | REST/resource; RPC candidate for mutations              | Conversation lifecycle and runtime use `conversation.*`; exports stay out-of-band downloads.                                    |
| Conversation snapshots     | `GET /api/conversations/:id/snapshot`                                                      | Snapshot resource                                       | Should include cursor metadata when made protocol-compatible.                                                                   |
| Conversation exports       | `/api/conversations/:id/export*`                                                           | Out-of-band REST/download                               | JSON/Markdown/HTML downloads are resource bodies, not protocol messages.                                                        |
| Agents                     | `/api/agents/*`                                                                            | REST/resource; RPC candidate                            | Agent creation/configuration and run control publish `agent.*` and `conversation.run.*` events.                                 |
| Agent system prompt export | `GET /api/agents/:id/system-prompt`                                                        | Out-of-band REST/download                               | Markdown download should remain resource-oriented.                                                                              |
| Agent tool request         | `POST /api/agents/:id/tools`                                                               | REST/resource; RPC candidate with policy                | Tool execution and approvals stay orchestrator/tool-layer controlled.                                                           |

## Method namespace coverage

If a current REST feature is later migrated or mirrored as protocol RPC, it SHOULD use the method families listed in [HTTP Mapping](./http-mapping.md#method-registry). The coverage target is family-level completeness, not a one-to-one rewrite of routes.

Recommended method families for current features:

```text
status.*
clientConfig.*
workspace.*
snapshot.*
project.*
pinnedCommand.*
conversation.*
agent.*
task.*
taskLog.*
tool.*
toolCall.*
approval.*
userQuestion.*
planReview.*
settings.*
auth.*
auth.oauth.*
providerCatalog.*
providerCatalog.model.*
promptSuggestion.*
model.*
usage.*
worker.*
filesystem.*
git.*
github.*
completion.*
applicationLog.*
storage.*
transcription.*
```

Adding one of these method names does not imply the matching REST endpoint must be removed.

Implemented Protocol RPC coverage currently includes the safe frontend-used methods in these families: `settings.*`, `auth.providers.*`, `providerCatalog.*`, `storage.*`, `model.*`, `usage.*`, `tool.*`, `toolCall.*`, `approval.*`, `userQuestion.*`, `planReview.*`, `conversation.*`, `agent.*`, `project.*`, `pinnedCommand.*`, `task.*`, `git.*`, `github.*`, `promptSuggestion.*`, `completion.*`, `filesystem.directories.*`, `worker.*`, and `applicationLog.prune`.

## Current event family coverage matrix

The global stream carries current Nerve domain events. The protocol does not require renaming existing event types. New event types SHOULD prefer lowercase dot-separated names, but current underscore names are valid domain event names.

| Event family                                                                                                                                      | Typical durability                                              | UI role                                                   | Notes                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `daemon.*`                                                                                                                                        | durable                                                         | Daemon lifecycle/status diagnostics                       | `daemon.started` and `daemon.stopped` may be useful for status/log views.                                            |
| `project.*`                                                                                                                                       | durable                                                         | Project list and workspace refresh                        | Includes create/delete/prune events.                                                                                 |
| `conversation.created`, `conversation.updated`, `conversation.deleted`, `conversation.imported`                                                   | durable                                                         | Workspace conversation list                               | Reducers should upsert/remove by conversation ID.                                                                    |
| `conversation.entry.appended`                                                                                                                     | durable                                                         | Conversation transcript and workspace list                | Must be idempotent by entry ID.                                                                                      |
| `conversation.run.*`                                                                                                                              | durable except explicitly transient implementation details      | Agent run lifecycle                                       | Start/completed/failed/suspended are durable state; retrying/status-like events may be transient when configured so. |
| `conversation.prompt.*`                                                                                                                           | durable                                                         | Queued prompt state                                       | Upsert/remove by queued prompt ID.                                                                                   |
| `toolCall.updated`                                                                                                                                | durable                                                         | Tool call transcript and approval state                   | Upsert by tool call ID.                                                                                              |
| `conversation.compaction.*`, `conversation.compacted`, `conversation.context.updated`, `conversation.navigated`, `conversation.branch_summarized` | durable or transient by domain semantics                        | Conversation view refresh/context/compaction              | `conversation.compaction.started` can be transient progress; final changes must be durable.                          |
| `conversation.live.*`                                                                                                                             | transient                                                       | Streaming assistant text/thinking/tool drafts/tool output | May be coalesced/dropped if durable final entries reconstruct state.                                                 |
| `agent.*`                                                                                                                                         | durable                                                         | Agent list/config/status and subagent/explore progress    | Some progress-style events may be transient if they are not needed for recovery.                                     |
| `agent.suspension.*`                                                                                                                              | durable                                                         | Human intervention/suspended run state                    | Must be recoverable from snapshot or replay.                                                                         |
| `worker.*`                                                                                                                                        | durable                                                         | Worker process inventory/status                           | Upsert by worker ID.                                                                                                 |
| `task.*`                                                                                                                                          | durable for lifecycle, transient only for non-required progress | Task list, foreground task, notifications                 | `task.output` is durable enough for log query/replay when needed; high-volume output may use paginated log storage.  |
| `approval.*`                                                                                                                                      | durable                                                         | Pending approval UX and notifications                     | Pending approvals must also be available through resource/snapshot state.                                            |
| `userQuestion.*`                                                                                                                                  | durable                                                         | Human input UX and notifications                          | Pending questions must be recoverable.                                                                               |
| `planReview.*`                                                                                                                                    | durable                                                         | Plan review UX and notifications                          | Pending plan reviews must be recoverable.                                                                            |
| `settings.*`                                                                                                                                      | durable                                                         | Settings refresh                                          | Payload must avoid secrets.                                                                                          |
| `auth.*`                                                                                                                                          | durable                                                         | Auth/provider metadata refresh                            | OAuth/provider status only; no tokens.                                                                               |
| `secrets.*`                                                                                                                                       | durable metadata only                                           | Settings/auth refresh                                     | Must never include secret values.                                                                                    |
| `providers.*`                                                                                                                                     | durable                                                         | Provider/model catalog refresh                            | Current events use provider IDs only.                                                                                |
| `prompt_suggestions.*`                                                                                                                            | durable                                                         | Prompt suggestion refresh                                 | Current underscore name remains valid.                                                                               |
| `usage.subscription.updated`                                                                                                                      | transient                                                       | Subscription usage display                                | Polling can repair missed updates.                                                                                   |
| `policy.*`                                                                                                                                        | durable or diagnostic by domain                                 | Policy/approval diagnostics                               | Must not leak sensitive arguments or secrets.                                                                        |

## Snapshot and materialized state coverage

Snapshots are materialized views plus stream cursors. They are the recovery boundary when a client starts fresh, replay is unavailable, or replay would be too large.

### Workspace snapshot

A protocol-compatible workspace snapshot SHOULD include the state required to render the main workbench:

- status/client-visible daemon metadata where appropriate;
- projects;
- conversations and active runtime summaries;
- agents;
- tasks and visible task summaries;
- pending approvals;
- pending user questions;
- pending plan reviews;
- workers if displayed;
- provider/auth/settings summaries as needed by the current UI;
- tool interaction summaries needed for badges or notifications.

It MUST include:

```ts
type SnapshotCursor = {
  streams: Array<{ stream: "global"; processedSeq: number }>;
};
```

After applying the snapshot, the client sets its processed cursor to the snapshot cursor and applies only event deltas with `seq > processedSeq`.

### Conversation snapshot

A protocol-compatible conversation snapshot SHOULD include:

- conversation metadata;
- entries or tree state needed by the open conversation view;
- active run/runtime state if recoverable;
- queued prompts;
- visible tool calls/transcript summaries;
- context usage or enough metadata to refresh it;
- cursor metadata for the stream position at which the snapshot is valid.

If transient `conversation.live.*` events were missed, the snapshot or subsequent durable events must be enough to render a correct conversation state.

### Narrow snapshots

Future snapshots MAY target narrower domains such as tasks, approvals, settings, or provider catalog. Every snapshot that participates in event recovery MUST include cursor metadata for the streams whose state it covers.

## Out-of-band feature boundaries

Protocol v1 intentionally does not define a general binary, multipart, or secret-submission frame.

Keep these feature categories out-of-band unless a future capability defines otherwise:

- audio upload for transcription;
- clipboard image upload;
- conversation exports and system prompt downloads;
- large file/image reads and binary downloads;
- OAuth browser redirects and provider token exchange details;
- provider API key submission and decrypted credentials;
- huge logs/artifacts, which should use paginated or file/resource endpoints.

Out-of-band operations SHOULD still integrate with protocol state by:

- returning operation IDs or resource IDs;
- publishing durable events for state changes;
- publishing transient progress events when useful;
- using protocol-compatible error codes where practical;
- including snapshot cursors when returning materialized state.

## Acceptance definition for current feature coverage

Nerve Protocol v1 covers current Nerve features when all of the following are true:

- Current REST/resource endpoints continue to work or have explicit protocol replacements.
- The UI can establish a protocol WebSocket session and receive all current domain events through `event.batch`.
- Current reducers receive equivalent `EventEnvelope` domain events after unwrapping batches.
- Durable events are replayable or recoverable through snapshots.
- Transient events can be missed without corrupting durable UI state.
- Workspace and conversation materialized loads include cursor metadata before they are used as recovery snapshots.
- Secret-sensitive and binary flows remain outside protocol metadata and event payloads.
- Current event families are documented in the event registry/checklist and are covered by tests as protocol implementation proceeds.
