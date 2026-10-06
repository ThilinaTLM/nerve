# Generalized agent runtime

Status: proposed. This describes a target architecture, not current contracts or storage schemas.

## Philosophy

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

| Today                                                                                                                                                                                | Target                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [`executionKind`](../../../packages/contracts/src/domains/agents/agent.ts) combines root, explore, and async developer                                                               | Parentage, configuration, and orchestration are separate dimensions                                    |
| [`SubagentRunner`](../../../packages/workbench-server/src/domains/agents/execution/subagent-runner.ts) executes one-shot Explore children                                            | Explorer configuration on the shared runtime                                                           |
| [`AsyncSubagentService`](../../../packages/workbench-server/src/domains/agents/async-subagent.service.ts) rejects busy child prompts                                                 | Every agent accepts explicit steering/follow-up input                                                  |
| [Harness steering](../../../packages/harness/src/agent/agent.ts) and [durable run prompts](../../../packages/workbench-server/src/domains/runs/runtime/run-prompts.ts) already exist | Acceptance is agent-owned, journaled, and independent of a live harness                                |
| Journal, run/work records, and event streams have distinct responsibilities                                                                                                          | Journal owns conversation-affecting facts; lifecycle/inbox projections accelerate reads and scheduling |
| Workspace/conversation subscriptions and transient filtering already exist                                                                                                           | Explicit overview, detail, and live interests; fan-out routed by interest                              |

The [async-subagent proposal](../async-subagent-teams.md) deliberately specifies idle-only prompting and limited child tools. This proposal evolves that model; it does not claim those restrictions already changed. [Storage architecture](../../architecture/storage.md) remains the description of implemented persistence.

## Architectural decisions

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
- Unify runtime controls while preserving current behavior, then expose busy-child steering and shared hot reload.
- Introduce communication bindings prospectively. Do not invent exact historical child checkpoints where old data lacks them; mark those boundaries unavailable and require an explicit reconciliation choice.
- Integrate journal-based human interaction, efficient branch loading, interest-scoped delivery, and coherent snapshot/cursor handling.
- Retire execution-kind lifecycle branches only after behavior parity. Keep useful configured profiles and batch tools.

Future schema/storage migrations must use the migration framework, fresh/copied `NERVE_HOME` under `/tmp`, and explicit ports. Isolated desktop validation also needs separate Electron `userData`. This proposal makes no runtime or storage changes.

## Behavioral acceptance criteria

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
