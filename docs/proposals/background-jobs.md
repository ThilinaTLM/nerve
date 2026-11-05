# Background jobs: one lifecycle for async bash and sub-conversations

> **Status:** Proposal. Covers `packages/conversation-core` (`async-bash/`, `delegation/`), the system-notice contract in `packages/contracts/src/domains/core/input.ts`, and the transcript consumers of those notices.

## Problem

Nerve has two kinds of work that outlive the tool call that started them and report back to a parent conversation later:

1. **Async bash** – `AsyncBashService` (`packages/conversation-core/src/async-bash/async-bash.service.ts`, 358 lines).
2. **Sub-conversation delegation** – `subagent_prompt` & co. in `packages/conversation-core/src/delegation/delegation-tools.ts` (480 lines).

Both implement the same lifecycle by hand, with different code and slightly different vocabularies.

| Lifecycle step         | Async bash                                                                                                      | Sub-conversation                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persist                | `async_bash` table (`conversation-core/src/storage/schema.ts:78`), `storage.asyncBash.*`                        | None of its own. State is derived from the child conversation and its executions.                                                                            |
| Recover after restart  | `AsyncBashService.recover()` reattaches via `ProcessPort.reattach(processRef)`, otherwise marks `lost`          | Child conversations are recovered by the normal conversation runner. A running execution that dies becomes `interrupted`.                                    |
| Cancel                 | `cancel(bashId)`, `cancelForConversations(ids)`                                                                 | `subagent_stop` (`stoppedByTool` set) and cascading stop from the lead pausing.                                                                              |
| Discard on delete      | `discard(ids)` with a `discarded` set so `finish()` stays silent                                                | Child conversation deletion through `ConversationService`.                                                                                                   |
| Terminal notice        | `finish()` updates the row and calls `inputs.enqueueNotice({ subtype: "async_bash_event" })` in one transaction | `core.onExecutionFinished` handler builds text and calls `enqueueNotice({ subtype: "sub_conversation_event" })` (not atomic with the child's terminal state) |
| Change events          | `AsyncBashChange` `async_bash_changed`, then `publishSummary`                                                   | Ordinary conversation events plus summaries                                                                                                                  |
| Suppress noisy notices | `discarded` set                                                                                                 | `stoppedByTool` and `parent.paused` checks inside the handler                                                                                                |

### Vocabulary drift

The two notice subtypes in `packages/contracts/src/domains/core/input.ts` (lines 14-32) describe the same idea, "a background job reached a terminal state", with different enums and field names:

```ts
async_bash_event: status: completed | failed | timed_out | cancelled | lost; // + bashId, exitCode
sub_conversation_event: status: completed | failed | cancelled | interrupted; // + childConversationId, assignmentId
```

- `timed_out` and `lost` exist only for bash; `interrupted` exists only for sub-conversations. "Lost" (we cannot verify the process) and "interrupted" (the host went away mid-run) are the same fact.
- `producer` is a bash id in one case and a conversation id in the other, while each subtype also repeats the id in its own field.
- `exitCode` is meaningful only for bash.

The drift is also visible in consumers, which branch per subtype and cannot share code:

- `packages/workbench-app/src/lib/features/conversations/adapters/core-transcript.adapter.ts:140-160` maps `async_bash_event` to `task_event` and `sub_conversation_event` to `subagent_run_event`.
- `packages/conversation-core/src/context/context-projection.ts:132` and `conversations/references/reference-extraction.ts:33,41,80` special-case `async_bash_event`.
- `delegation/subagent-status.ts` (`backgroundLines`, `ChildState`) has its own third status vocabulary: `running | waiting | idle | stopped | failed | interrupted`.

## Goals / non-goals

**Goals**

- One named lifecycle (`BackgroundJob`) that owns persist / recover / cancel / discard / terminal-notice / change events, with per-kind runners supplying only what differs.
- One terminal status vocabulary and one notice shape, so the transcript, context projection and reference extraction handle jobs generically.
- Terminal state and parent notice always commit atomically, for both kinds.

**Non-goals**

- No change to how a sub-conversation executes. It is a full conversation and stays one.
- No change to tool names or model-visible tool schemas (`async_bash_*`, `subagent_*`).
- No new job kinds in this proposal (but the runner interface should make a third kind cheap).

## Proposed design

### Concept: `BackgroundJob` and `JobRunner`

```ts
// packages/conversation-core/src/background-jobs/background-job.ts
export type JobKind = "bash" | "sub_conversation";

/** Closed, shared terminal vocabulary. */
export type JobOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out" // runner-specific cause, still a distinct, user-visible outcome
  | "interrupted"; // host lost or could not verify the work (today: bash `lost`)

export interface JobRef {
  kind: JobKind;
  id: string; // bashId or child conversationId
  parentConversationId: string;
}

export interface JobTerminal {
  outcome: JobOutcome;
  text: string; // already projected for the model
  assetIds: string[];
  detail: Record<string, unknown>; // kind-specific: exitCode, assignmentId
}

export interface JobRunner {
  readonly kind: JobKind;
  /** Re-attach to live work after restart; return undefined when it cannot be verified. */
  recover(ref: JobRef): Promise<JobHandle | undefined>;
}

export interface JobHandle {
  wait(): Promise<JobTerminal>;
  cancel(): Promise<void>;
}

export class BackgroundJobService {
  register(runner: JobRunner): void;
  adopt(ref: JobRef, handle: JobHandle): void; // start watching
  recover(parentConversationId?: string): Promise<void>;
  cancel(ref: JobRef): Promise<void>;
  cancelForConversations(ids: string[]): Promise<void>;
  discard(refs: readonly JobRef[]): Promise<void>;
}
```

`BackgroundJobService` owns the watcher map, the `discarded` set, the "settle exactly once inside a transaction together with `enqueueNotice`" rule, and the change-event emission that `AsyncBashService` has today. Runners own only process or conversation specifics:

- `BashRunner` wraps `ProcessPort.reattach`, `BackgroundProcess.wait/cancel` and `projectProcessOutput`.
- `SubConversationRunner` wraps execution-finished observation, `finalAssistantText`/`inlineReport`, and the `stoppedByTool`/paused suppression, which becomes a `suppressNotice?(terminal): boolean` hook on the runner instead of ad-hoc sets in the delegation handler.

### Unified notice

Replace the two subtypes with one:

```ts
// contracts/src/domains/core/input.ts
z.object({
  subtype: z.literal("background_job_event"),
  producer: z.string(),
  jobKind: z.enum(["bash", "sub_conversation"]),
  jobId: z.string(),
  outcome: jobOutcomeSchema,
  text: z.string(),
  assetIds: z.array(z.string()),
  // kind-specific, validated by a nested discriminated union on jobKind
  detail: z.discriminatedUnion("jobKind", [
    z.object({
      jobKind: z.literal("bash"),
      exitCode: z.number().int().nullable(),
    }),
    z.object({
      jobKind: z.literal("sub_conversation"),
      assignmentId: z.string(),
    }),
  ]),
});
```

Consumers (`core-transcript.adapter.ts`, `context-projection.ts`, `reference-extraction.ts`) switch on `jobKind` only where they truly differ (the UI row kind), and share everything else.

## Storage, notice-format and replay impact

This is the sensitive part. Three layers are affected differently.

1. **`async_bash` table.** Its `status` CHECK lists `running, completed, failed, timed_out, cancelled, lost` (`schema.ts:82`). Renaming `lost` to `interrupted` in the row is a schema change. **Not required for this proposal**: the service can keep persisting `lost` and map to `interrupted` at the notice boundary (see Alternatives).
2. **Persisted notices.** `system_notice` input content is stored as JSON in the input queue and in conversation events, then replayed to clients and rebuilt into model context. Existing rows contain `async_bash_event` / `sub_conversation_event` payloads. Replacing the subtypes means either (a) rewriting stored payloads in a migration, or (b) keeping the old subtypes readable forever (a compat shim, which AGENTS.md discourages).
3. **Replay and transfer.** The same payloads are part of replay streams and of `TransferredConversationEvent` handling in the app adapter. Clients on an older build reading a newer daemon's replay would see an unknown discriminator, so the contract change must ship in lockstep with the app (they ship together today, but confirm for any persisted exports and the transcript fixtures under `packages/workbench-app/src/lib/presentation/tools/views/subagent-result-parser.test.ts`).

> **Needs explicit user approval before implementation (AGENTS.md: DB schema and storage format are sensitive).** Anything below under "Option B" or "Option C" rewrites stored data or the table CHECK. Per the repo rule, any such change must be added to the **single pending migration step** for unreleased data (extend it, do not add another), tested with `pnpm storage:copy --slot N`, and must not touch frozen steps under `packages/workbench-server/src/infrastructure/migrations/steps/**`. Check the released version in the root `package.json` first: if `async_bash_event` / `sub_conversation_event` already shipped, rewriting is a released-data migration, not an unreleased one.

### Alternatives, from least to most invasive

- **Option A (recommended first step, no storage change).** Do the _code_ unification only: introduce `BackgroundJobService` + runners and keep both stored subtypes and the `async_bash` table unchanged. Add a shared in-code `JobOutcome` and map at the boundary (`lost`→`interrupted`, `timed_out` stays). The notice contract keeps two subtypes but both are built by one `buildJobNotice()` helper, so the drift stops growing. This removes the duplicated lifecycle without touching persisted data.
- **Option B (contract unification, data rewrite).** Introduce `background_job_event` and migrate stored `system_notice` payloads in the pending migration step. Highest payoff for consumers; needs approval and a replay test over a copied slot.
- **Option C (also rename `lost`).** Option B plus a table rebuild to change the `async_bash.status` CHECK. Not worth it alone; `lost` can stay a bash-internal persistence value.
- **Option D (persist sub-conversation jobs).** Adding a `background_job` table so sub-conversations get a row like bash does. Rejected: the child conversation is already the persisted truth, and a second record can drift from it.

## Migration / rollout

1. Extract `BackgroundJobService` from `AsyncBashService` with `BashRunner`, keeping the public `core.asyncBash` surface (`list`, `logs`, `readLogPage`, `cancel`) as thin delegations. Existing `async-bash.service.test.ts` (385 lines) is the behavior suite and must stay green.
2. Move the terminal-notice construction of `onExecutionFinished` in `delegation-tools.ts` into `SubConversationRunner`, using the same atomic settle path. Today the notice is enqueued outside any transaction with the child's final state.
3. Introduce shared `JobOutcome` and `buildJobNotice()` (Option A). Stop here unless Option B is approved.
4. If approved: add `background_job_event` to the contract, extend the pending migration step to rewrite stored notices, update the three consumers, delete the old subtypes.

## What gets deleted / simplified

- `discarded` set, `watchers`/`processes` maps and the `recover`/`cancel`/`discard` bodies in `AsyncBashService` move into one generic service (about 150 lines, shared).
- The `stoppedByTool` set and paused-parent check in `delegation-tools.ts` become a runner hook.
- Option B: one notice subtype instead of two, and per-subtype branches in `core-transcript.adapter.ts`, `context-projection.ts`, `reference-extraction.ts`.
- `subagent-status.ts` `ChildState` can derive `interrupted/stopped` from `JobOutcome` rather than reinventing it.

## Risks & open questions

- **Atomicity change for sub-conversations.** Moving notice emission into a transaction with terminal state could alter ordering relative to `execution_state` events. Needs a targeted test in `delegation-tools.test.ts`.
- **Do we need `timed_out` for sub-conversations?** Probably not today; the closed `JobOutcome` allows it but runners need not emit it.
- **Are the two subtypes released?** Decides whether Option B is an "unreleased change" folded into the pending migration step, or needs a new-version migration path.
- **Naming.** "Job" vs "task" (the UI already calls bash notices `task_event`). Pick once.
- **Approval required** for Options B-C (see above). Option A needs none.

## Effort

- Option A: M (about 2-3 days; mostly moving code, tests exist).
- Option B on top: M (1-2 days code + migration + replay test on a copied slot).
