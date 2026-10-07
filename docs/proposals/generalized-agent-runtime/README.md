# Generalized agent runtime

Status: shared runtime/configuration cutover implementation and final browser source assertions are present for issue #402; browser execution, final integration acceptance and whole-chain validation remain pending. Scoped tests do not establish that all acceptance criteria have passed. See the [T1–T10 acceptance evidence matrix](acceptance-402.md) for owning modules, specific assertions and execution limits. Unified timeline, coordinated parent/child rewind, physical per-agent conversations and interest-scoped delivery remain proposed. This document does not claim all proposal schemas or storage changes exist.

## Implemented runtime scope and remaining boundaries

Agent records now carry explicit configuration, configuration revisions, activation, immutable read-only ceilings, and orchestration policy independently of historical `executionKind`. Configured children use the common admission/harness path. Explore is a batch/wait/report wrapper over that path, with exact agent/run/attempt completion identity; it does not construct a harness. Shared controls accept agent input and configuration without a live harness. Tool construction captures ordinary turn configuration/policy and pinned physical workspace roots. Approval/execution uses the originating durable decision and persisted ToolAuthoritySnapshot after restart; ordinary scope/cwd/readonly edits apply next turn. Stop and immutable read-only ceilings are independently checked at claim. Explore consumes immutable completion usage/model/tool-step metadata and correlates original submission with terminal retry identity.

These changes reuse agent documents, narrow `agent_inputs` persisted authority, run/work records and the existing conversation journal—not projections of one canonical timeline. Actual effective configuration snapshots live in execution transitions (`execution.effectiveTurnConfigurations`), not an unwritten `agent_effective_turn` namespace or a reconstruction from current settings. User/parent and trusted notification lanes share ordered acceptance and the common turn pipeline; caller idempotency keys deduplicate acceptance. Eligibility and activation are separate: `queue_only` does not wake an idle agent, and explicit pause fences automatic activation.

Existing conversation IDs remain. Immutable `contextOwnerAgentId` selects the lead or an identity partition for children/additional roots/orphans. Initial migration preserves a valid active historical root as lead after existing bindings, with deterministic oldest fallback. Unbound secondary historical roots still using only the shared layout receive a frozen complete tree/prefix and exact leaf before self-binding; existing owned trees are preserved and fresh roots stay empty. IDs, detached branches and later-write isolation are preserved, with copied-old-SQLite partial-copy/copy-before-binding crash/restart regressions. This evidence does not replace integration acceptance.

Desktop/mobile browser assertions now cover direct child selection and normal queue/settings/pause/resume controls. A real loopback OpenAI-compatible endpoint test registers two models and asserts live next-turn model adoption, queued steering after original tool settlement, same-run completion and effective revision for developer and tool-created Explore children; Explore remains discoverable/controllable while its parent wrapper waits. Full-suite discovery found 15 tests including 8 agent-acceptance tests; browser execution is pending. The obsolete direct obligation-notice writer and remaining live kind filter have been removed; live creation now uses explicit standard/independent/no-report defaults, so stale `executionKind` cannot affect new records. Readiness notification retries freeze the original acceptance, and foreign-origin same-key receipts cannot acknowledge task delivery. Lead-reported scoped results are 13 passing turn-preparation/blocker tests, 15 passing task notification/producer tests and 47 passing lifecycle/migration tests. Whole input enqueue/submission/event shutdown drain is complete, with 49 scoped follow-up passes and final read-only barrier review approved. The acceptance matrix links the actual input-shutdown and task-event teardown assertions. No pending source defect is identified; full-chain and browser execution outcomes remain pending lead update.

Final integration acceptance must verify coherent turn-policy capture, runtime cancellation/recovery, live child controls and migration against copied homes. Graceful shutdown explicitly cancels active child runs/tasks during team settlement; do not equate durable general input/settings with every pending approval/question surviving graceful restart unchanged. Emergency revocation beyond stop/read-only fences needs an explicit service/epoch; ordinary permission edits are next-turn changes, not implicit revocation. Coordinated rewind, communication-delivery rollback, subscription redesign and OS sandboxing are outside #402; no external rollback or exactly-once tool execution is claimed. See [implemented storage authority and failure windows](../../architecture/storage.md#generalized-agent-runtime-authority-and-failure-windows).

## Proposed philosophy

The sections below describe the broader target, not current persistence or issue #402 acceptance requirements. In particular, separate physical conversations, one fact journal and coordinated rewind are future work.

> One agent blueprint. One canonical branching history per agent. Configuration determines capabilities. Views and provider messages are projections. Live delivery follows user interest.

Creating a conversation in the UI creates an agent and its owned conversation. The main agent talks directly to the user. Its children use the same blueprint, asynchronous runtime, steering controls, and hot-reload behavior. Parentage establishes delegation and reporting, not a reduced class of agent.

An agent has an identity, model, conversation, optional parent, tools, enabled skills, system prompt, permission rule set/overlay, project/cwd, and user/system input queues. A run is an execution of that persistent agent. A turn is one model invocation and its associated tool execution within a run.

History is a tree with a selected linear path. All conversation-affecting durable facts belong to its canonical journal: input acceptance and delivery, assistant output, tools, approvals, questions, configuration changes, execution transitions, and parent/child communication. Separate read tables may make this efficient, but must not create independent histories that need stitching together.

## Documents

- [Agent model](agent-model.md): identity, configuration, authority, and hot reload.
- [Execution and messaging](execution-and-messaging.md): asynchronous runs, steering, human interaction, and recovery.
- [Conversations and events](conversations-and-events.md): canonical records, efficient storage, provider projections, and replay.
- [Branching and delegation](branching-and-delegation.md): lightweight parent/child history bindings and coordinated branch selection.
- [Visibility and delivery](visibility-and-delivery.md): discoverable agents, watched live activity, subscriptions, and backpressure.

Diagrams are conceptual models, not SQLite DDL or promised wire contracts.

## Goals and boundaries

- One runtime and control surface for all agents, including direct user steering of children.
- Capabilities determined by enabled tools/skills, instructions, workspace, and resolved permissions—not hardcoded agent kinds.
- Hot reload at the next turn boundary, with effective configuration provenance.
- One reconstructable history, including durable human-in-the-loop suspension and continuation.
- Branches share prefixes; parent/child communication binds exact historical points without copying conversations.
- All authorized agents are discoverable. Detailed transient activity is delivered only when requested.
- Small indexed projections and bounded delivery keep storage, network traffic, and UI work efficient.

Non-goals: multiple simultaneous executions of one agent, unrestricted authority, automatic replay of uncertain tool effects, automatic rollback of external filesystem/process effects, or a second global event-sourcing system. This design does not require an arbitrary profile framework or peer-to-peer messaging platform.

## Current foundations and target

| Today                                                                                                                                 | Target                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Historical kind values are decoded into explicit agent configuration/policies                                                         | Kind is migration data, not a live lifecycle authority                            |
| [`SubagentRunner`](../../../packages/workbench-server/src/domains/agents/execution/subagent-runner.ts) waits on common submitted runs | Preserve wait-and-return orchestration without another engine                     |
| Shared agent controls; desktop/mobile and real-endpoint live configuration source assertions                                          | Execute final acceptance/recovery and browser coverage across configured profiles |
| Agent-input documents and run/work records remain separate canonical authorities                                                      | A future unified fact timeline may provide derived inbox/lifecycle projections    |
| Existing conversation journal retains lead and agent-owned model partitions                                                           | Future separate physical conversations and communication-boundary bindings        |
| Existing workspace/conversation subscriptions remain                                                                                  | Future interest-scoped indexed delivery                                           |

The [async-subagent proposal](../async-subagent-teams.md) describes the earlier idle-only/limited-child design. Those kind-wide restrictions are removed from the cutover's shared tool/control paths; reusable-team capacity and reporting remain orchestration responsibilities. [Storage architecture](../../architecture/storage.md) describes implemented persistence.

## Proposed architectural decisions

1. Agent identity outlives runs. One active execution slot per agent; agents execute concurrently with each other.
2. Creating a child creates a separate owned conversation. Root/lead/explorer/developer are configurations and relationships, not lifecycle implementations.
3. Authorized users can open and control any child as an ordinary agent. Parent-issued operations and user operations share services but have distinct authorization.
4. One canonical journal records durable conversation facts. Indexed inbox, interaction, status, and transcript views are projections. Leases/fences and publication bookkeeping remain operational metadata.
5. User/system input are logical lanes with shared acceptance ordering and explicit eligibility. Application record types are not provider role enums.
6. Configuration edits take effect at the next turn boundary and are recorded separately from the revision actually used by a turn. Branching keeps current settings.
7. Parent/child communication records exact branch/head and journal boundaries. Selecting an earlier parent branch selects the corresponding child history prefixes, without deleting old branches or replaying effects.
8. Overview updates are small and durable; opened views receive durable detail; watched views additionally receive transient activity. Persistence never depends on watching.
9. Commit facts, projections, and publication intents atomically. Publish after commit with stable identities. Do not promise exactly-once external effects.

## Package ownership

| Package                     | Responsibility                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/contracts`        | Agent, history, branch binding, input, configuration, permission, and event contracts                  |
| `packages/protocol`         | Transport-neutral sessions, interest subscriptions, replay/cursors, and resynchronization              |
| `packages/harness`          | Provider/tool loop, context application, turn boundaries                                               |
| `packages/workbench-server` | Authorization, history commits, projection maintenance, execution coordination, branching, publication |
| `packages/tools`            | Model-facing operations over shared services                                                           |
| `packages/workbench-app`    | Agent navigation, history rendering, pending controls, visibility-driven subscriptions                 |

Protocol must not acquire domain scheduling rules. Harness queues and UI caches are not durable authority. Specialized tools such as Explore call common services rather than invoking other model-facing tools.

## Adoption considerations

This is a design proposal, not an implementation work order. A future cutover should:

- Inventory legacy conversation graphs, prompts, approvals, obligations, settings, and completion notifications; preserve IDs and history wherever possible.
- Define journal facts and projection ownership before changing physical storage. Avoid duplicate authoritative writers.
- Build on the shared runtime controls and busy-child steering from #402; do not introduce another execution or queue authority.
- Introduce communication bindings prospectively. Do not invent exact historical child checkpoints where old data lacks them; mark those boundaries unavailable and require an explicit reconciliation choice.
- Integrate journal-based human interaction, efficient branch loading, interest-scoped delivery, and coherent snapshot/cursor handling.
- Preserve the configuration/policy-based cutover from #402. Keep useful configured profiles and batch tools, not kind-driven lifecycle branches.

Future schema/storage migrations must use the migration framework, fresh/copied `NERVE_HOME` under `/tmp`, and explicit ports. Isolated desktop validation also needs separate Electron `userData`. The remaining timeline/rewind/delivery proposal does not itself authorize runtime or storage migrations.

## Future proposal acceptance criteria

These include timeline/rewind/delivery guarantees beyond #402. Restart reconstruction is not a promise to preserve interactions deliberately cancelled during graceful shutdown.

- User and parent steering use the same agent runtime without concurrent execution or lost accepted input.
- Configuration edits affect the next turn and record the effective revision, even within a long-running assignment.
- Pending approvals/questions and their answers reconstruct from history after restart, without duplicate interaction or tool execution.
- Parent rewind before an assignment selects the child's pre-assignment prefix; original parent/child branches remain inspectable.
- Branch switching fences stale work, suppresses old completion wakeups, and never implies external effects were undone.
- Every authorized agent is discoverable; watching multiple agents is possible without subscribing to all transient activity.
- Dropped transient updates repair from a live baseline/durable state; durable gaps trigger replay or resynchronization.
- Projections rebuild without executing providers/tools; shared prefixes and payloads are not duplicated per branch.

## Open implementation details

Exact APIs/DDL, indexing strategy, batching limits, retention budgets, provider-specific role adaptation, sensitive instruction provenance, and operational recovery UX remain to be designed. Historical configuration restoration is an explicit future action, not an implicit consequence of branching. Simultaneous writable sessions for different branches of one agent would require a separate design; the initial target has one selected execution branch per agent.
