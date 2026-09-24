# Asynchronous subagent teams

Status: implemented initial version. Async developer children use autonomous permissions in the lead's shared working directory and worktree; Explore remains the read-only option.

## Goal

Give a lead agent persistent teammates that it can prompt asynchronously, inspect after they finish, stop, and prompt again. Each teammate retains its own conversation across assignments. The lead remains responsible for user interaction and deciding whether a teammate's response completes the work or needs a follow-up.

This is an optional capability, separate from the existing one-shot Explore tool. Disabling the entire async-subagent tool group leaves the current agent experience intact.

## Agreed interaction model

- Each child has a stable identity, a human-readable name, an owning lead, and an isolated, durable conversation.
- Creating a child leaves it idle. Prompting an idle child starts an asynchronous run and returns immediately after admission, not after completion.
- A running or stopping child rejects new prompts. Do not expose steering, queued follow-ups, or force-push through these tools, even though the harness supports them.
- The lead cannot inspect an unfinished child response. It can still inspect lifecycle state through list/status.
- To change an assignment early, the lead stops the child, waits for cancellation to settle, then sends a new prompt into the same conversation.
- When execution settles back to idle, notify the lead and wake it if necessary, following background-task behavior.
- The lead retrieves the last assistant response from the child's conversation. There is no separate message inbox or peer-to-peer messaging system.
- Children have no Ask User tool and no plan mode, including its tools and mode-specific instructions. A child needing clarification ends its turn with a question or blocker in its normal response. The lead decides how to resolve it.

## Existing foundations

Reuse these mechanisms rather than introducing another agent loop:

- [`AgentHarness`](../../packages/harness/src/harness/agent-harness.ts): conversation execution, cancellation, idle observation, and tool configuration.
- [`HarnessTurnController`](../../packages/harness/src/harness/run/turn-controller.ts): foreground prompt admission already rejects a busy harness.
- [Harness queue operations](../../packages/harness/src/harness/queue/operations.ts): existing delivery boundaries for messages to an active lead. These queues are an implementation mechanism, not a new subagent inbox.
- [`SubagentRunner`](../../packages/workbench-server/src/domains/agents/execution/subagent-runner.ts): child identities, isolated transcript storage, harness construction, and Explore execution. Current children are one-shot; the runner does not retain a reusable harness registry.
- [Agent tool adapter](../../packages/workbench-server/src/domains/tools/orchestration/agent-tool-adapter.ts): Explore already uses an explicit child tool allowlist excluding human interaction and plan mode.
- [`resolveToolAvailability`](../../packages/tools/src/runtime/availability.ts): tool-name and tool-group enable/disable filtering.
- [`TaskNotificationService`](../../packages/workbench-server/src/domains/tasks/application/task-notification.service.ts): durable notification identity, injection into active runs, direct persistence fallback, idle-agent continuation, and recovery.

Existing child-interaction restrictions and read-only child policy are intentional boundaries. A new async-child execution path must be explicit; do not globally relax restrictions on every agent with a parent.

## Proposed tool surface

The table summarizes the tool API; authoritative schemas live in the owning contracts and tool catalog.

| Tool                          | Behavior                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `subagent_new(name)`          | Create an owned, idle teammate and return its stable ID. Names are labels; IDs address children.                          |
| `subagent_prompt(id, prompt)` | Atomically admit a run only when idle; return its identity immediately. Reject busy children without queueing the prompt. |
| `subagent_list()`             | List children owned by this lead, with names, states, and latest run outcomes. Do not return transcript bodies.           |
| `subagent_status(id)`         | Return lifecycle metadata. Only when idle, include the last assistant response and its originating run identity.          |
| `subagent_stop(id)`           | Request cancellation of the current run without deleting conversation history. Idempotent when already idle or stopping.  |

All operations enforce ownership server-side. A supplied child ID must not grant access to another lead's conversation.

### State and outcome

Separate the reusable child's execution state from the outcome of its latest assignment:

- Execution state: idle, running, or stopping. Running includes admission/startup so two prompts cannot both start.
- Latest run outcome: completed, cancelled, failed, or interrupted by recovery.

Normal flow is `idle → running → idle`; cancellation is `running → stopping → idle`. A teammate is not permanently completed when one assignment finishes.

`stop` may return stopping while cancellation settles. The lead must not be allowed to prompt again until settlement. A cancellation request alone is not evidence that tools and the provider have stopped.

The latest assistant response is not necessarily a result of the latest run. For example, cancellation may occur before a new response exists. Status must identify the response's originating run and distinguish a completed response from interrupted output. Never silently present an older answer as the latest assignment's result. Before the first response, return no response.

## Completion notification and wakeup

Treat every admitted child run settling to idle as a notification event, including failure and cancellation. Initial creation in idle is not a completion event.

1. Persist the run outcome and conversation output, then establish that execution has settled.
2. Persist a pending completion notification correlated with the child, child run, owning lead, and lead conversation.
3. If the lead is active, deliver a small harness message at its existing safe delivery boundary. Do not start a second lead run.
4. Otherwise, persist the notification in the lead conversation and request continuation using the existing background-task wake pattern.
5. The lead calls status to retrieve the response, then accepts it, ignores it, or sends follow-up work.

The notification contains identity and outcome, not a second copy of the child's response. It should instruct the lead that the child is available for inspection, without treating every completion as requiring more work.

Reuse the existing delivery mechanics where they genuinely overlap. If extraction is necessary, extract a narrowly scoped notification-delivery helper; do not model child conversations as shell-process task records or build a general messaging platform.

### Delivery correctness

- Use a durable identity per child run completion so retries do not duplicate conversation entries.
- Persist delivery progress and recover pending notifications across restart and lead-run teardown races.
- Preserve the existing distinction between enqueueing a notification and actually delivering it to the harness.
- Admission of idle-lead continuation must be serialized with other run starts. Simultaneous child completions must not start concurrent lead runs or lose notifications.
- Correlate notifications with runs: a late completion from an older assignment must not mark a newer run idle or imply its response is ready.
- Stop settlement must produce one completion event, not separate duplicate events for cancellation and idle.
- An explicit user stop must suppress automatic resurrection of the stopped work. Persist outcomes, but gate wakeup according to cancellation ownership. Stopping a single child through the lead's tool should still notify the lead normally.

These are durable lifecycle notifications, not an inbox abstraction for exchanging arbitrary messages.

## Optional capability and child tools

Introduce a dedicated async-subagent catalog group containing all five tools. Use existing availability/configuration plumbing so the group can be disabled as a unit. Recommended initial default: disabled until explicitly enabled.

When disabled:

- Do not advertise these tools or their prompt guidelines.
- Reject attempted dispatch as unavailable; hiding definitions alone is insufficient.
- Do not change existing Explore or background-task capabilities.
- Existing transcripts remain readable through normal application surfaces.

Live-disable semantics: prevent new async-child operations, cancel and settle active children through the owning service, persist their outcomes, and suppress new automatic team wakeups. Disabling must not orphan execution merely because its management tools disappear.

Children receive an explicit tool capability profile. Exclude Ask User, every plan-mode tool, async-subagent spawning/management, and nested Explore for the first version. Exclude plan-mode configuration and instructions as well. Enforce restrictions at tool availability and execution boundaries rather than relying only on the system prompt.

Async developer children use the built-in autonomous permission rule set, including editing, commands, and background tasks. They share the lead's exact working directory and worktree; the lead assigns non-overlapping components/files. There are no worktrees, merges, or file locks. Creating an autonomous child remains subject to the lead's delegation authorization; child capability exclusions are enforced separately from the autonomous policy. Explore retains its existing read-only profile.

## Architecture and ownership

- **`packages/contracts`:** shared child identity/state/outcome, tool API and event payloads, and durable relationship/delivery schemas.
- **`packages/harness`:** retain the existing general-purpose execution loop, busy rejection, abort, queues, and storage interfaces. Do not put team coordination into the model loop.
- **`packages/tools`:** catalog group, definitions, availability, runtime ports/adapters, result projections, and tool-specific guidelines.
- **`packages/workbench-server`:** own child creation, lead-child authorization, serialized run admission, live execution controls, transcript persistence, settlement, and notification/wakeup orchestration. Share construction primitives with Explore without changing Explore's one-shot contract.
- **`packages/protocol`:** keep session, RPC, replay, and transport lifecycle mechanics transport-neutral. Team orchestration belongs in the server domain, not a transport implementation.
- **Workbench UI:** expose group configuration through the existing tool settings model. A richer team panel is a later enhancement, not required for tool-driven operation.

Persist conversations and relationships, not live harness objects. Maintain execution controls only for active child runs; reconstruct subsequent execution from the child's durable history. Parent ownership must outlive any one lead run so a child can finish after the lead has yielded.

On restart, reconcile persisted active children with actual execution. An execution that cannot resume must become idle with an interrupted outcome and a recoverable completion notification; never leave a child permanently running or silently restart potentially side-effecting work.

## Scope boundaries

The first version does not include child-to-child chat, multiple queued assignments per child, streaming response inspection by the lead, recursive teams, automatic copying of the full lead history, or a separate inbox UI. The lead supplies a focused assignment; the child's own history persists for follow-ups.

Keep concurrency bounded using server-side admission limits. Exact limits, child model selection, retention/deletion, and context compaction policy should be specified with implementation contracts rather than invented as constants here.

## Implementation sequence

1. Define shared lifecycle contracts, durable ownership, admission rules, and permission profile.
2. Add reusable child conversation execution and cancellation settlement, preserving existing Explore behavior.
3. Add the dedicated optional tool group and idle-only interaction surface.
4. Connect durable completion delivery and lead wakeup using the existing task-notification pattern.
5. Wire settings and recovery, then validate lifecycle races and disabled-capability behavior.

## Validation expectations

Add behavior tests at the owning layers:

- Multiple assignments preserve one child's history without leaking another child's or lead's transcript.
- Concurrent prompts admit exactly one run; running/stopping prompts are rejected without queue entries.
- Running status never exposes unfinished response content.
- Stop blocks re-prompting until actual settlement; repeated stop is safe.
- Cancelled/failed runs do not misattribute an earlier assistant response.
- Completion reaches an active lead or wakes an idle lead, without duplicate entries or concurrent lead runs.
- Several children finishing together, teardown races, retries, and restart recovery retain notifications.
- Old-run notifications cannot overwrite current child state.
- Explicit user cancellation does not resurrect work.
- Tool-group disabling removes advertising and dispatch, settles active children under the chosen policy, and preserves Explore behavior.
- Children cannot invoke Ask User, plan mode, nested delegation, or tools outside their permission profile.
- Cross-lead child access is rejected.

## Initial implementation decisions

- Autonomous developer children, with creation authorized through the lead's tool policy, share the lead's working directory and worktree.
- The tool group defaults off, including upgrades from older harness configuration. Partial group disables normalize to a full disable.
- Explicit lead stop and live group disable cancel the owned team and fence automatic wakeups. A new user prompt can reopen a stopped team.
- Names are unique within a lead's team; tools address stable child IDs. Four child executions may run concurrently per lead. Idle children retain their histories; there is no rename/delete tool in this version.
- Idle means the harness run has settled, not that its background processes have exited. List/status expose active owned task counts. Stopping a child also cancels its owned background work.
- File ownership is coordinated by the lead, not enforced. Stopping never rolls back workspace edits.

The owning implementation lives in `packages/workbench-server/src/domains/agents/async-subagent.service.ts` and `async-subagent-notification.service.ts`, with shared schemas in `packages/contracts/src/domains/agents/async-subagents.ts`. Rich team panels, model-selection controls, and configurable concurrency remain outside this initial version.

These do not change the core agreement: persistent conversations, no prompting or response inspection while running, no child human-interaction/plan tools, completion wakeups, and a fully optional async-subagent tool group.
