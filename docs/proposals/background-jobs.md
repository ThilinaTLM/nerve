# Background tasks: one lifecycle for async bash and sub-agents

> **Status:** Proposal, decided. One effort in two phases: **A** unifies the code (`BackgroundTaskService` + runners), **B** unifies the notice contract and rewrites stored notices in the single pending migration step. Covers `packages/conversation-core` (`async-bash/`, `delegation/`), the system-notice contract in `packages/contracts/src/domains/core/input.ts`, the harness message projection and the transcript consumers.
>
> **Decisions already taken:** code unification and the unified notice contract are both approved (A + B). No `async_bash` table, column or CHECK change (the old "Option C" is **not** approved). No persisted `background_task` table for sub-agents (the old "Option D" stays rejected). Replay compatibility with older clients is not a concern: Nerve ships as a desktop app that bundles client and daemon, so they always upgrade together.

## Problem

Nerve has two kinds of work that outlive the tool call that started them and report back to a parent conversation later:

1. **Async bash** – `AsyncBashService` (`packages/conversation-core/src/async-bash/async-bash.service.ts`, 358 lines).
2. **Sub-agent delegation** – `subagent_prompt` & co. in `packages/conversation-core/src/delegation/delegation-tools.ts` (480 lines).

Both implement the same lifecycle by hand, with different code and slightly different vocabularies.

| Lifecycle step         | Async bash                                                                                                      | Sub-agent (child conversation)                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persist                | `async_bash` table (`conversation-core/src/storage/schema.ts:78`), `storage.asyncBash.*`                        | None of its own. State is derived from the child conversation and its executions.                                                                            |
| Recover after restart  | `AsyncBashService.recover()` reattaches via `ProcessPort.reattach(processRef)`, otherwise marks `lost`          | Child conversations are recovered by the normal conversation runner. A running execution that dies becomes `interrupted`.                                    |
| Cancel                 | `cancel(bashId)`, `cancelForConversations(ids)`                                                                 | `subagent_stop` (`stoppedByTool` set) and cascading stop from the lead pausing.                                                                              |
| Discard on delete      | `discard(ids)` with a `discarded` set so `finish()` stays silent                                                | Child conversation deletion through `ConversationService`.                                                                                                   |
| Terminal notice        | `finish()` updates the row and calls `inputs.enqueueNotice({ subtype: "async_bash_event" })` in one transaction | `core.onExecutionFinished` handler builds text and calls `enqueueNotice({ subtype: "sub_conversation_event" })` (not atomic with the child's terminal state) |
| Change events          | `AsyncBashChange` `async_bash_changed`, then `publishSummary`                                                   | Ordinary conversation events plus summaries                                                                                                                  |
| Suppress noisy notices | `discarded` set                                                                                                 | `stoppedByTool` and `parent.paused` checks inside the handler                                                                                                |

### Vocabulary drift

The two notice subtypes in `packages/contracts/src/domains/core/input.ts` (lines 14-32) describe the same idea, "a background task reached a terminal state", with different enums and field names:

```ts
async_bash_event: status: completed | failed | timed_out | cancelled | lost; // + bashId, exitCode
sub_conversation_event: status: completed | failed | cancelled | interrupted; // + childConversationId, assignmentId
```

- `timed_out` and `lost` exist only for bash; `interrupted` exists only for sub-agents. "Lost" (we cannot verify the process) and "interrupted" (the host went away mid-run) are the same fact.
- `producer` is a bash id in one case and a conversation id in the other, while each subtype also repeats the id in its own field.
- `exitCode` is meaningful only for bash.

The drift is also visible in consumers, which branch per subtype and cannot share code:

- `packages/workbench-app/src/lib/features/conversations/adapters/core-transcript.adapter.ts:140-160` maps `async_bash_event` to the `task_event` row and `sub_conversation_event` to `subagent_run_event`; line 335 special-cases `async_bash_event` again to attach the live `asyncBash` snapshot.
- `packages/conversation-core/src/context/context-projection.ts:131-133` maps only `async_bash_event` to the harness event type `task_event`; everything else uses the subtype name. `packages/harness/src/messages/messages.ts:199` then wraps only `task_event` in `<background_task_update>`, so the model sees sub-agent completions in a different envelope (`<harness_event>`) than bash completions.
- `conversations/references/reference-extraction.ts:33,41,80` special-cases `async_bash_event`.
- `delegation/subagent-status.ts` (`backgroundLines`, `ChildState`) has its own third status vocabulary: `running | waiting | idle | stopped | failed | interrupted`.

## Goals / non-goals

**Goals**

- One named lifecycle (`BackgroundTask`) that owns persist / recover / cancel / discard / terminal-notice / change events, with per-kind runners supplying only what differs.
- One terminal outcome vocabulary and one notice shape (`task_result`), so the transcript, context projection and reference extraction handle tasks generically.
- Terminal state and parent notice always commit atomically, for both kinds.

**Non-goals**

- No change to how a sub-agent executes. It is a full conversation and stays one.
- No change to model-visible tool names or schemas (`async_bash_*`, `subagent_*`).
- **No DB schema change**: no table, column or CHECK change (see "Storage impact").
- No new task kinds in this proposal (but the runner interface should make a third kind cheap).

## Naming

The concept is a **background task**: `BackgroundTask`, `BackgroundTaskService`, `TaskRunner`, kinds `bash` | `subagent`. The notice subtype is **`task_result`**: it parallels `tool_result` (a tool call's settlement) and is emitted **only on a terminal outcome**, never for progress. The transcript row kind currently called `task_event` is renamed to `task_result` to match.

Why "task" is safe: the strings `task_start`, `task_control` and `task_logs` exist only in migration step 0001 legacy code (`workbench-server/src/infrastructure/migrations/steps/0001-conversation-core/{events.mapper,conversation.importer,process-history}.ts`, its README and test), so live code does not overload it. The UI and harness already say "task" (`TaskEventNotice`, `TaskNoticeCard.svelte`, `<background_task_update>`).

Alternatives considered:

- **`job` (`BackgroundJob`)**: the earlier draft of this document. Rejected: the user-visible and harness vocabulary is already "task", so "job" would add a second word for one concept.
- **`background_work`**: too vague; reads as a mass noun and does not suggest a unit with an id and an outcome.
- **`task_finished`**: names the moment rather than the payload, and does not parallel `tool_result`. Also reads wrong for `cancelled` and `interrupted`, which are results but not "finished" in the happy-path sense.

## Design

### Phase A: `BackgroundTask` and `TaskRunner` (code only)

```ts
// packages/conversation-core/src/background-tasks/background-task.ts
export type TaskKind = "bash" | "subagent";

/** Closed, shared terminal vocabulary. */
export type TaskOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out" // runner-specific cause, still a distinct, user-visible outcome
  | "interrupted"; // host lost or could not verify the work (bash storage value: `lost`)

export interface TaskRef {
  kind: TaskKind;
  id: string; // bashId or child conversationId
  parentConversationId: string;
}

export interface TaskTerminal {
  outcome: TaskOutcome;
  text: string; // already projected for the model
  assetIds: string[];
  detail:
    | { kind: "bash"; exitCode: number | null }
    | { kind: "subagent"; assignmentId: string };
}

export interface TaskRunner {
  readonly kind: TaskKind;
  /** Re-attach to live work after restart; return undefined when it cannot be verified. */
  recover(ref: TaskRef): Promise<TaskHandle | undefined>;
  /** Optional: keep the terminal state but skip the parent notice (stopped by tool, paused parent). */
  suppressNotice?(terminal: TaskTerminal): boolean;
}

export interface TaskHandle {
  wait(): Promise<TaskTerminal>;
  cancel(): Promise<void>;
}

export class BackgroundTaskService {
  register(runner: TaskRunner): void;
  adopt(ref: TaskRef, handle: TaskHandle): void; // start watching
  recover(parentConversationId?: string): Promise<void>;
  cancel(ref: TaskRef): Promise<void>;
  cancelForConversations(ids: string[]): Promise<void>;
  discard(refs: readonly TaskRef[]): Promise<void>;
}
```

`BackgroundTaskService` owns the watcher map, the `discarded` set, the "settle exactly once inside a transaction together with `enqueueNotice`" rule, and the change-event emission that `AsyncBashService` has today. Runners own only process or conversation specifics:

- `BashRunner` wraps `ProcessPort.reattach`, `BackgroundProcess.wait/cancel` and `projectProcessOutput`. It keeps persisting the row status `lost` in `async_bash` and reports `interrupted` as the outcome (mapping at the runner boundary, see "Storage impact").
- `SubagentRunner` wraps execution-finished observation, `finalAssistantText`/`inlineReport`, and the `stoppedByTool`/paused suppression, which becomes `suppressNotice` instead of ad-hoc sets in the delegation handler.

In Phase A the stored notice subtypes are unchanged: both runners build their notice through one `buildTaskNotice()` helper that still returns `async_bash_event` / `sub_conversation_event`. Phase B swaps what that helper returns.

### Phase B: unified `task_result` notice

Replace both subtypes:

```ts
// contracts/src/domains/core/input.ts
export const taskOutcomeSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
]);

z.object({
  subtype: z.literal("task_result"),
  producer: z.string(),
  task: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("bash"),
      id: z.string(), // bashId
      exitCode: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal("subagent"),
      id: z.string(), // child conversationId
      assignmentId: z.string(),
    }),
  ]),
  outcome: taskOutcomeSchema,
  text: z.string(),
  assetIds: z.array(z.string()),
});
```

Changes in consumers:

- **Rename the transcript row kind `task_event` → `task_result`** consistently: `workbench-app/src/lib/presentation/state/timeline.ts` (lines 55, 272, 442, 465), `presentation/state/transcript.ts:210-212`, `presentation/conversations/conversation-view-contracts.ts:314`, `presentation/transcript/transcript-row-model.ts:56,143`, `presentation/transcript/TranscriptRow.svelte:147,320`, `presentation/view-models/records.ts:106,144`, `features/conversations/views/conversation-menu-model.ts:109`, the adapter (`core-transcript.adapter.ts:143-146`), and the `TaskEventNotice`/`TaskNoticeCard`/`task-event-notice.ts` names (`TaskResultNotice`, …). `subagent_run_event` stays a distinct presentation row (it renders the sub-agent card); the adapter switches on `task.kind` to choose it.
- **Context projection and harness**: `context-projection.ts:131-133` emits `task_result` for the unified subtype; `harness/src/messages/messages.ts:199` matches `task_result`. Sub-agent completions therefore get the same `<background_task_update>` envelope as bash. This is a model-visible framing change for sub-agent results (see Risks).
- **`reference-extraction.ts`** matches `task_result` with `task.kind === "bash"` and `outcome === "completed"` (it only cares about bash commands).
- `subagent-status.ts` derives `interrupted`/`stopped` from `TaskOutcome` instead of its own list.
- Update the prose reference in `packages/website/src/content/docs/developers/tool-output-lifecycle.md:38` and the fixtures/tests that name the old subtypes (`async-bash.service.test.ts:293`, `delegation-tools.test.ts:215`, `conversation-reference.repository.test.ts:234,333`, `compaction-lifecycle.test.ts`, `plan-review-lifecycle.test.ts`, `conversation-activity.test.ts`, `subagent-result-parser.test.ts:129`).

## Storage impact

**No DB schema change.** `async_bash.status` keeps its CHECK (`running, completed, failed, timed_out, cancelled, lost`, `schema.ts:82`) and the service keeps writing `lost`. Mapping `lost` → `interrupted` happens only at the contract boundary: when `BashRunner` reports a terminal outcome, and when the migration rewrites stored notices. No table, column, index or CHECK changes; `conversation_event.payload` and `input_queue.content` are already free-form JSON (`json_valid` checks only).

**Phase B rewrites released user data.** Both `async_bash_event` and `sub_conversation_event` are already present in the released `v0.39.1` (`git show v0.39.1:packages/contracts/src/domains/core/input.ts` lines 15 and 24), and the root `package.json` version is `0.39.1`. So this is not an unreleased-only change; installed homes contain these payloads. Stored locations:

1. `conversation_event.payload` where `event_type = 'system_event'` and `payload.subtype` is one of the two old values.
2. `input_queue.content` for queued, undelivered system notices with the same shapes.

Rewrite rules (frozen local shapes in the step, not imports of the live contract):

| Old                                                                  | New                                                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `async_bash_event {bashId, status, exitCode}`                        | `task_result {task: {kind:"bash", id: bashId, exitCode}, outcome}`                      |
| `sub_conversation_event {childConversationId, assignmentId, status}` | `task_result {task: {kind:"subagent", id: childConversationId, assignmentId}, outcome}` |
| status `lost`                                                        | outcome `interrupted`                                                                   |
| all other status values                                              | same string                                                                             |

`producer`, `text` and `assetIds` are copied. `llm_representation` and event ordering do not change. The model context for an existing conversation is rebuilt from events at projection time, so old sub-agent results will be re-framed in `<background_task_update>` (one-time prefix-cache miss for resumed conversations).

**Replay compatibility is not a constraint.** The daemon and client ship in one desktop bundle, so no older client reads a newer daemon's replay stream; the contract change needs no compat shim and the old subtypes are deleted outright.

### Which migration step

`docs/architecture/migrations.md` ("Choosing the migration boundary", "Adding or extending a step") says all changes since the released root version go in the single draft step. Concretely, `MIGRATION_METADATA` in `packages/workbench-server/src/infrastructure/migrations/framework/registry-metadata.ts` has three entries, all `stage: "draft"`: `0001-conversation-core`, `0002-agent-profiles` (`rerunOnChange: true`) and `0003-process-output-files`. The newest, and the one to extend, is **`0003-process-output-files`** (`steps/0003-process-output-files/step.ts`), which already rewrites background-run data for homes written by released versions.

Consequences to handle in the same change:

- Homes already on v0.39.1 have 0003 recorded in their ledger. A draft step is only re-run for such homes when its registry entry has `rerunOnChange: true` and the checksum changed (`framework/ledger.ts:132-140`). Set `rerunOnChange: true` on 0003, and update the entry's checksum (`hashStepFolder`) plus `migrations.lock.json`; run `pnpm exec tsx scripts/storage-migrations/check.ts`.
- Re-running 0003 must stay idempotent. The existing output-file work already is (`candidates()` skips runs that already have `output.txt`); the notice rewrite must also skip rows that are already `task_result`.
- Do **not** add a 0004 step, and do not touch released/frozen step code beyond this one draft step.
- Per-conversation units via `runUnit` (rewrite events and queue rows of one conversation in one transaction), so a conversation with an unparseable payload is set aside and quarantined rather than blocking the upgrade. Validate old rows with the shapes the v0.39.1 writer produced.
- Add fixture tests (old payloads of both kinds including `lost`, queued notices, already-converted rows, a corrupt payload, rollback/resume) in `0003-process-output-files/step.test.ts`.

**Testing is required on a copied slot, never slot 1** (AGENTS.md): `pnpm storage:copy --from <stopped-home> --slot N`, then `pnpm storage:migrate --home data/storage-N`, then `pnpm exec tsx scripts/storage-migrations/validate-history.ts --home data/storage-N` and read every report's set-aside list. The history validator parses stored events against current contracts, which is exactly the check for the new `task_result` shape. Point project paths at disposable locations before starting a daemon on the copied slot.

## Rollout

1. **A1.** Extract `BackgroundTaskService` from `AsyncBashService` with `BashRunner`, keeping the public `core.asyncBash` surface (`list`, `logs`, `readLogPage`, `cancel`) as thin delegations. The existing `async-bash.service.test.ts` (385 lines) is the behavior suite and must stay green.
2. **A2.** Move the terminal-notice construction of `onExecutionFinished` in `delegation-tools.ts` into `SubagentRunner`, using the same atomic settle path. Today the notice is enqueued outside any transaction with the child's final state.
3. **A3.** Introduce shared `TaskOutcome` and `buildTaskNotice()` (still returning the two old subtypes). This is a shippable stopping point with no stored-data change.
4. **B1.** Add `task_result` to the contract, switch `buildTaskNotice()` and all consumers, rename the `task_event` row kind to `task_result`, delete the old subtypes.
5. **B2.** Extend step `0003-process-output-files` (with `rerunOnChange: true`, checksum, lock) to rewrite stored notices; fixture tests.
6. **B3.** Rehearse on a copied slot as above; update `tool-output-lifecycle.md`.

B1 and B2 must land together (the contract no longer parses old payloads).

## What gets deleted / simplified

- `discarded` set, `watchers`/`processes` maps and the `recover`/`cancel`/`discard` bodies in `AsyncBashService` move into one generic service (about 150 lines, shared).
- The `stoppedByTool` set and paused-parent check in `delegation-tools.ts` become a runner hook.
- One notice subtype instead of two, and per-subtype branches in `core-transcript.adapter.ts`, `context-projection.ts`, `reference-extraction.ts`; one harness envelope instead of two.
- `subagent-status.ts` `ChildState` derives `interrupted/stopped` from `TaskOutcome` rather than reinventing it.
- The `task_event` / `async_bash_event` / `sub_conversation_event` names.

## Risks & open questions

- **Released-data rewrite.** Mitigations: per-conversation units with quarantine, idempotent rewrite, mandatory rehearsal on a copied slot, `validate-history.ts`.
- **`rerunOnChange` on 0003.** Needed so v0.39.1 homes re-run the step; confirm during implementation that a re-run with the output-file logic as a no-op behaves correctly in `runMigrations` (rollback journal and `inserted-assets.json` scratch handling) via the fixture tests.
- **Atomicity change for sub-agents.** Moving notice emission into a transaction with terminal state could alter ordering relative to `execution_state` events. Needs a targeted test in `delegation-tools.test.ts`.
- **Model-visible framing change.** Sub-agent results move from `<harness_event>` to `<background_task_update>`. Check prompt text and any eval/golden fixtures that quote the old envelope; the one-time prefix-cache miss for existing conversations is accepted.
- **`timed_out` for sub-agents.** Probably never emitted today; the closed `TaskOutcome` allows it but runners need not emit it.

No remaining question needs a product decision.

## Effort

- Phase A: M (about 2-3 days; mostly moving code, tests exist).
- Phase B: M (1-2 days for contract, consumers and the row rename, plus about 1 day for the migration, fixtures and copied-slot rehearsal).
  Total: about one week as one effort.
