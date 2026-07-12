# Milestone 5 breaking cutover — in-progress handoff

Source of truth: `/home/tlm/.nerve/plans/nerve-core-protocol-v1-milestone-5-breaking-cutover.md`
Intermediate green/atomicity relaxed by the user; final validation gate unchanged.

## Commits so far

- `c4519f3a` Phase 1 (host-runtime) — DONE, green.
- `f8eda742` wip: sandbox run execution adapters (new `packages/sandbox-agent/src/run/*`).
- `5a2d4c2a` wip: route core run ops (start/followUp/steer/continue/cancel) through RunCoordinator; boot recovery via `coordinator.recover()`. Sandbox package type-checks.

## Architecture in place (sandbox)

`packages/sandbox-agent/src/run/`:
- `run-integrity.ts` — checksum port (sha256 canonical JSON).
- `run-event-publisher.ts` — `SandboxRunEventPublisher` (durable, idempotent via EventOutbox by intent id) + `SandboxRunTransientPublisher`.
- `run-references.ts` — `SandboxRunReferences` (RunCheckpointReferencePort): entryIds/toolCalls from canonical transition log; harness leaf/save-point from conversation storage; `loadRun` passthrough.
- `run-cancellation.ts` — `SandboxRunCancellation` (model/tool/task/subagent/interaction evidence).
- `live-registry.ts`, `interaction-channel.ts`, `pending-interactions.ts` — live wake + durable-wait bridge.
- `run-execution.ts` — `SandboxRunExecutionFactory`/`SandboxRunExecution`: harness construct, prompt/continue, inline-command expansion, throw-based `AgentToolSuspension` -> `sink.wait`, assistant message -> `sink.appendEntries`, deltas -> `sink.progress`, checkpoint at completion.
- `run-composition.ts` — `createSandboxRunRuntime` builds the single `RunCoordinator` (sourceRole `sandbox_agent`).

Daemon (`daemon/sandbox-daemon.ts`): constructs `this.runRuntime = createSandboxRunRuntime(...)`; `run.*` ops call `this.requireCoordinator()`; boot flushes intents + `recover()`. Helpers `runScope`, `requireCoordinator`, module `mapSandboxStatus`.

## NOT yet migrated (remaining sandbox work)

1. **Interaction resolution path** (biggest). Currently `userQuestion.answer`, `planReview.*`, `approval.*` still use `this.inputWaiter/planReviewWaiter/approvalWaiter` + `this.runs.writeCheckpoint` + `this.agentRuntime.continueRun`. Migrate to:
   - Look up the coordinator interaction by id (use `references.interaction(id)` -> runId).
   - Append the toolResult message to the harness conversation (`harnessFactory.appendConversationMessage`) so `harness.continue()` sees the answer.
   - `coordinator.resolveInteraction(runId, { interactionId, resolutionRequestId, resolution })` then `coordinator.continue(runId)`.
   - Make `SandboxRunExecution.enterWait` set `interactionId: toolCallId` in the wait command (stable id == provider toolCallId) so client resolve ids line up.
2. **Tool-handler interaction wiring**. `tools/sandbox-interaction-handlers.ts` and `tools/tool-runtime.ts` (approval branch) must, before throwing `AgentToolSuspension`, populate `runRuntime.pending` with the interaction detail (question/approval/plan_review). The `resolve`/approval-check callbacks must read the resolved coordinator interaction (by toolCallId) instead of the disk waiters. Thread `pending` + a `resolvedInteraction(toolCallId)` lookup through `createSandboxRunRuntime` -> tool-runtime -> orchestration handler options (`sandbox-orchestration-types.ts`).
3. **Query/snapshot layer**. `daemon/run-summaries.ts` (`summarizeRuns/Conversations/Agents`) and `daemon/conversation-snapshot.ts` read `RunManager` stores. Build `SandboxRunQueryAdapter` deriving summaries/snapshots from `unitOfWork.list()` projections + harness conversation. Rewire `sandbox.status.get` and `sandbox.conversation.snapshot.get`.
4. **Delete incumbents**: `agent/run-manager.ts`, `agent/agent-runtime.ts` (lifecycle), `agent/harness-event-bridge.ts`, `tools/{input,approval,plan-review}-waiter.ts`, `agent/{run-state-store,run-execution-store,checkpoint-store,transcript-store,tool-call-store}.ts` (retire readers once query adapter covers them). Remove daemon fields `runs/agentRuntime/bridge/inputWaiter/planReviewWaiter/approvalWaiter` and their construction.
5. **Tests**: rewrite `agent-harness-runtime.test.ts`, `run-manager.test.ts`, `run-summaries.test.ts`, `harness-bridge-logging.test.ts`, tool/interaction tests, daemon protocol tests against the coordinator.

## Known gaps / decisions

- Tool-call transcript records are NOT yet appended into transitions via the sink (schema `toolNameSchema`/`risk` strictness). Reference `toolCalls()` reads transitions, so checkpoints currently carry no tool-call refs. Decide: project valid `ToolCallTranscriptRecord`s in `run-execution.project` on `tool_execution_end`, or keep tool-call store as a projection source.
- `run-execution.enterWait` builds a generic `question` wait when `pending` has no detail — fix once (2) lands.
- `HostHarnessFactory` is genuinely used by `HarnessFactory` — keep it (Phase 1 step 8 resolved).

## Next concrete edit

Start with (1)+(2): set `interactionId: toolCallId` in `enterWait`; thread `pending`/`resolvedInteraction` into interaction handlers; migrate `userQuestion.answer` to resolveInteraction+continue. Then query adapter, then deletions, then `pnpm --filter @nervekit/sandbox-agent check test`.

## Workbench (Phase 3) — not started

Mirror the same adapters under `packages/workbench-server/src/domains/runs/` using the existing `RunTransitionRepository`. Then Phase 4 cross-host scenarios, Phase 5 cleanup + full gate.
