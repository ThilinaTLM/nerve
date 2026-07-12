# Milestone 5 workbench breaking cutover — active handoff

Source of truth: `/home/tlm/.nerve/plans/nerve-core-protocol-v1-milestone-5-breaking-cutover.md`.
Intermediate breakage is explicitly permitted by the user; no dual-authority/dual-write compatibility path should be added.

## Completed commits

- `c4519f3a` — shared host-runtime execution boundary (green).
- `2661421f` — sandbox cutover complete (includes final projection/deletion cleanup).
  - `RunCoordinator` is sole sandbox lifecycle authority.
  - All run ops and question/approval/plan-review waits/resolutions route through coordinator.
  - Canonical transitions drive status/snapshots/tool details/checkpoints/recovery.
  - Deleted `RunManager`, `SandboxAgentRuntime`, `HarnessEventBridge`, all old waiters and run/execution/checkpoint/transcript/tool stores.
  - Retained `SandboxPlanReviewStore` only as a validated plan-file record store.
  - Gate: contracts check; host-runtime check + 26 tests; sandbox check + 46 tests; `pnpm fix`; `git diff --check` — all pass.
- `374a9165` — workbench host adapter layer (type-checks):
  - `domains/runs/run-integrity.ts`
  - `run-event-publisher.ts` (idempotent `EventBus.publishWithId` + drainable transient)
  - `run-references.ts` (canonical entries/tool revisions/interactions + harness leaf)
  - `run-live-executions.ts`
  - `run-cancellation.ts`
  - `run-execution.ts` (`WorkbenchRunExecutionAdapter` boundary)
  - `run-composition.ts` (`createWorkbenchRunRuntime`)
- `64c94e2f` — `WorkbenchRunService` operation facade; coordinator-backed start/steer/follow-up/continue/retry/resume/cancel; feature mechanics injected.

## Current validation

- Working tree clean at handoff.
- `pnpm fix` passes.
- `pnpm --filter @nervekit/workbench-server check` passes.
- Workbench runtime is still on incumbent `AgentRunner`; therefore adapter/facade changes are not production-active yet and existing tests remain baseline, not cutover proof.

## Next concrete edit (start here)

### 1. Extract `AgentRunSession` mechanics behind `WorkbenchRunExecutionAdapter`

Files:
- `domains/agents/run/agent-runner.ts`
- `domains/agents/run/agent-run-session.ts`
- new `domains/runs/workbench-agent-execution.ts`

Steps:
1. Extend `runAgentPromptSession` options to accept externally assigned `RunRecord`/`runId` and `RunExecutionSink`; remove `createId("run")` when coordinator-managed.
2. Implement `WorkbenchAgentExecutionAdapter.create(run, sink)`:
   - resolve `agent` from `RuntimeState`;
   - construct harness using the existing setup in `agent-run-session.ts` (lines ~75–165);
   - expose `RunExecutionControl` via harness steer/followUp/continue/abort;
   - register control in the already-added `WorkbenchLiveExecutions` only (do not use `state.runs` as authority);
   - execute prompt/continue and return one `RunExecutionOutcome`.
3. Move durable effects to sink:
   - message end/mirroring -> `sink.appendEntries`;
   - tool lifecycle -> `sink.upsertToolCalls` (reuse the sandbox pattern; host-runtime now atomically creates `toolCall.updated` intents);
   - provider/tool boundaries -> `sink.checkpoint` with `WorkbenchRunReferences`;
   - ask-user/approval/plan-review -> `sink.wait` with complete suspension checkpoint;
   - deltas/drafts -> `sink.progress` only.
4. In coordinator-managed mode remove/guard the incumbent lifecycle writes in `agent-run-session.ts` (current anchors):
   - `events.publish("run.started")` around line 520;
   - `state.runs.set` around line 540 (replace with execution-local control registration);
   - terminal `run.completed/run.failed/run.suspended` publications and `conversationRuntime` lifecycle mutation around lines 600–780;
   - suspension service creation as run authority.
   Keep model/tool/retry/compaction/message mechanics.

### 2. Compose coordinator and replace production operation owner

File: `runtime/runtime-composition.ts`.

After `ToolService` and `HarnessManager` exist:
- create execution adapter;
- call `createWorkbenchRunRuntime({ home: storage.paths.home, state, events, tools, harnessManager, execution, logger })`;
- flush pending intents, `coordinator.recover()`, materialize/flush before registry ready;
- create `WorkbenchRunService` and replace `services.agentRunner` in lifecycle call sites.

Update `RuntimeServices` and `runtime-registry.ts` forwarding methods:
- `promptAgent`, `abortAgent`, `continueFromFailedTurn`, `resumeRun`, context usage;
- ToolService explore closure and auto-compaction helpers may remain injected feature mechanics temporarily, but not lifecycle authority.

### 3. Migrate interaction/queue/cancellation services

- `human-input-resolution.service.ts`: ownership check -> `coordinator.resolveInteraction` only; live control wakes through execution adapter, restart uses explicit `continue`.
- prompt queue repository/queued prompt service: remove persistence authority; `WorkbenchRunService` already routes prompts through coordinator canonical prompt records.
- retry continuation: remove leaf rewind/guess logic, call coordinator continue only.
- task notification: replace `state.runs` callback lookup with live-execution projection/control or a coordinator prompt/message adapter.
- cancellation: complete task/subagent/interaction evidence in `WorkbenchRunCancellation` (currently model+tools implemented; others return `not_running`).

### 4. Delete incumbents after composition switch

Required deletions/narrowing:
- `AgentRunner` lifecycle owner;
- `AgentRunSession` lifecycle ownership (retain narrowly named execution helper only);
- `run-state.ts` and authoritative `RuntimeState.runs` map;
- `interrupted-run-recovery.ts` (startup uses coordinator recovery);
- prompt queue/suspension legacy readers and retry leaf-guess paths;
- narrow/rename `HarnessManager` to conversation storage adapter once lifecycle methods are absent.

### 5. Restore workbench tests and continue phases

Run workbench phase gate from the plan, then commit `feat(workbench-server): complete shared run lifecycle cutover`.
Afterward:
- Phase 4 shared real-host scenario driver/fixtures (18 required scripts).
- Phase 5 retired-name/boundary/security/state-layout cleanup and full validation gate.

## Known adapter gaps to fix during extraction

- `WorkbenchRunCancellation.cancelTasks/cancelSubagents/cancelInteraction` are placeholders returning `not_running`.
- `WorkbenchRunReferences.toolCalls()` currently derives lifecycle revision from canonical transition occurrence count (same pattern as sandbox); ensure execution emits every relevant revision.
- `WorkbenchRunService.continueFromFailedTurn` intentionally ignores leaf IDs; checkpoint validation is the only resume gate.
- No production code instantiates `createWorkbenchRunRuntime` yet — this is the immediate milestone.
