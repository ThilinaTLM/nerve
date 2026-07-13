import type {
  PeerRole,
  PromptImage,
  RunCheckpointRecord,
  RunFailureRecord,
  RunInteractionRecord,
  RunPromptRecord,
  RunRecord,
} from "@nervekit/contracts";
import type { ClockPort, DiagnosticPort, IdPort } from "./index.js";
import { assertCheckpoint, checkpointValid } from "./run-checkpoints.js";
import {
  CANCELLATION_TARGETS,
  cancelRunTarget,
  finishCancellation,
  requestCancellation,
} from "./run-cancellation.js";
import { RunEventFactory, type RunTransientEventPort } from "./run-events.js";
import {
  InvalidRunStateError,
  RunConflictError,
  type ResolveInteractionCommand,
} from "./run-errors.js";
import { KeyedSerialLock } from "./run-locks.js";
import { RunPromptCoordinator } from "./run-prompts.js";
import { decideRunRecovery } from "./run-recovery.js";
import {
  completeExecution,
  completeResolvedInteraction as settleResolvedInteraction,
} from "./run-settlement.js";
import {
  cancellableRetryDelay,
  decideRunRetry,
  DEFAULT_RUN_RETRY_POLICY,
  isRetryAbort,
  type RunRetryPolicyPort,
} from "./run-retries.js";
import {
  LiveExecutionRegistry,
  type RunCancellationPort,
  type RunExecution,
  type RunExecutionFactoryPort,
  type RunExecutionSink,
  type RunIntegrityPort,
} from "./run-execution.js";
import {
  ACTIVE_STATUSES,
  buildTransition,
  checkpointRecord,
  type CheckpointCommand,
  errorMessage,
  executionRecord,
  failure,
  interactionRecord,
  newRun,
  prefixed,
  revise,
  type StartRunCommand,
  TERMINAL_STATUSES,
  type TransitionChanges,
  type WaitCommand,
} from "./run-transitions.js";
import type {
  RunCheckpointReferencePort,
  RunHydratedState,
  RunTransitionObserverPort,
  RunUnitOfWorkPort,
} from "./run-unit-of-work.js";

export interface RunCoordinatorPorts {
  sourceRole: PeerRole;
  unitOfWork: RunUnitOfWorkPort;
  execution: RunExecutionFactoryPort;
  references: RunCheckpointReferencePort;
  cancellation: RunCancellationPort;
  clock: ClockPort;
  ids: IdPort;
  integrity: RunIntegrityPort;
  flushEvents(): Promise<void>;
  transient?: RunTransientEventPort;
  diagnostics?: DiagnosticPort;
  retryPolicy?: RunRetryPolicyPort;
  retryDelay?(delayMs: number, signal: AbortSignal): Promise<void>;
  transitionObserver?: RunTransitionObserverPort;
}

export class RunCoordinator {
  private readonly locks = new KeyedSerialLock();
  private readonly live = new LiveExecutionRegistry();
  private readonly events: RunEventFactory;
  private readonly prompts: RunPromptCoordinator;

  constructor(private readonly ports: RunCoordinatorPorts) {
    this.events = new RunEventFactory(ports.sourceRole);
    this.prompts = new RunPromptCoordinator({
      ids: ports.ids,
      events: this.events,
      now: () => this.now(),
      load: (runId) => this.require(runId),
      live: (runId) => this.live.get(runId)?.execution,
      exclusive: (key, action) => this.exclusive(key, action),
      commit: (previous, run, kind, changes) =>
        this.commit(previous, run, kind, changes),
    });
  }

  async start(command: StartRunCommand): Promise<RunRecord> {
    const scopeId =
      command.scopeId ?? `${command.conversationId}:${command.agentId}`;
    return this.exclusive(`scope:${scopeId}`, async () => {
      const active = await this.ports.unitOfWork.findActive(scopeId);
      if (active && ACTIVE_STATUSES.has(active.run.status)) {
        throw new RunConflictError(
          `Scope already has active run ${active.run.runId}`,
        );
      }
      const now = this.now();
      const run = newRun(command, scopeId, now, this.ports.ids);
      let execution: RunExecution;
      try {
        execution = await this.ports.execution.create(
          run,
          this.sink(run.runId),
        );
      } catch (error) {
        const failed = {
          ...run,
          status: "failed" as const,
          recoverability: "retryable" as const,
          failure: failure("RUN_CONSTRUCTION_FAILED", error, true),
          terminalAt: now,
        };
        await this.commit(undefined, failed, "construction_failed", {
          execution: executionRecord(failed, "failed", now),
          events: [this.events.failed(failed, now, false)],
        });
        return failed;
      }
      const running = {
        ...run,
        status: "running" as const,
        startedAt: now,
      };
      await this.commit(undefined, running, "started", {
        execution: executionRecord(running, "streaming", now),
        events: [this.events.started(running, now)],
      });
      this.launch(running, execution, "start", command.prompt, command.images);
      return running;
    });
  }

  async steer(
    runId: string,
    text: string,
    images?: readonly PromptImage[],
  ): Promise<RunPromptRecord> {
    return this.prompts.queue(runId, "steer", text, images);
  }

  async followUp(
    runId: string,
    text: string,
    images?: readonly PromptImage[],
  ): Promise<RunPromptRecord> {
    return this.prompts.queue(runId, "follow-up", text, images);
  }

  async cancelPrompt(
    runId: string,
    promptId: string,
  ): Promise<RunPromptRecord> {
    return this.prompts.cancel(runId, promptId);
  }

  async continue(runId: string): Promise<RunRecord> {
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (state.run.status === "waiting") {
        const pending = state.interactions.find(
          (item) => item.id === state.run.activeInteractionId,
        );
        if (pending?.status === "pending") {
          throw new InvalidRunStateError(
            "Interaction must be resolved before continue",
          );
        }
      } else if (
        state.run.status !== "suspended" &&
        state.run.status !== "interrupted"
      ) {
        throw invalid(state.run, "continue");
      }
      await assertCheckpoint(
        state,
        this.ports.references,
        this.ports.integrity,
      );
      const now = this.now();
      const next: RunRecord = {
        ...state.run,
        revision: state.run.revision + 1,
        status: "retrying",
        recoverability: "checkpoint",
        attempt: state.run.attempt + 1,
        executionId: prefixed("exec", this.ports.ids.next()),
        activeInteractionId: undefined,
        updatedAt: now,
        failure: undefined,
      };
      const execution = await this.ports.execution.create(
        next,
        this.sink(next.runId),
      );
      await this.commit(state, next, "retrying", {
        execution: executionRecord(next, "starting", now),
        events: [
          this.events.retrying(next, now, {
            maxRetries: Math.max(1, next.attempt - 1),
            delayMs: 0,
          }),
        ],
      });
      this.launch(next, execution, "continue");
      return next;
    });
  }

  async checkpoint(
    runId: string,
    command: CheckpointCommand,
  ): Promise<RunCheckpointRecord> {
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (TERMINAL_STATUSES.has(state.run.status)) {
        throw invalid(state.run, "checkpoint");
      }
      const checkpoint = checkpointRecord(
        state,
        command,
        this.now(),
        this.ports.ids,
        this.ports.integrity,
      );
      const next = revise(
        state.run,
        {
          lastCheckpointId: checkpoint.checkpointId,
          recoverability: "checkpoint",
        },
        this.now(),
      );
      await this.commit(state, next, "checkpointed", {
        checkpoints: [checkpoint],
        events: [this.events.checkpointed(next, checkpoint)],
      });
      return checkpoint;
    });
  }

  async wait(
    runId: string,
    command: WaitCommand,
  ): Promise<RunInteractionRecord> {
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (state.interactions.some((item) => item.status === "pending")) {
        throw new RunConflictError(
          `Run ${runId} already has a pending interaction`,
        );
      }
      const checkpoint = checkpointRecord(
        state,
        { ...command.checkpoint, boundary: "suspension" },
        this.now(),
        this.ports.ids,
        this.ports.integrity,
      );
      const interaction = interactionRecord(
        state.run,
        command,
        checkpoint,
        this.now(),
        this.ports.ids,
      );
      const now = this.now();
      const next = revise(
        state.run,
        {
          status: "waiting",
          recoverability: "checkpoint",
          activeInteractionId: interaction.id,
          lastCheckpointId: checkpoint.checkpointId,
        },
        now,
      );
      await this.commit(state, next, "waiting", {
        interactions: [interaction],
        checkpoints: [checkpoint],
        events: [this.events.waiting(next, interaction)],
      });
      return interaction;
    });
  }

  async appendEntries(
    runId: string,
    entries: readonly import("@nervekit/contracts").ConversationEntry[],
  ): Promise<void> {
    await this.appendDurable(runId, "entries_appended", {
      entries: [...entries],
    });
  }

  async upsertToolCalls(
    runId: string,
    toolCalls: readonly import("@nervekit/contracts").ToolCallTranscriptRecord[],
  ): Promise<void> {
    await this.appendDurable(runId, "tool_calls_upserted", {
      toolCalls: [...toolCalls],
    });
  }

  async resolveInteraction(
    runId: string,
    command: ResolveInteractionCommand,
  ): Promise<RunInteractionRecord> {
    const { resolved, wake } = await this.exclusive(
      `run:${runId}`,
      async (): Promise<{
        resolved: RunInteractionRecord;
        wake: boolean;
      }> => {
        const state = await this.require(runId);
        const current = state.interactions.find(
          (item) => item.id === command.interactionId,
        );
        if (!current || current.runId !== runId) {
          throw new InvalidRunStateError("Interaction does not belong to run");
        }
        const resolutionHash = this.ports.integrity.checksum(
          command.resolution,
        );
        if (current.status === "resolved") {
          if (current.resolutionHash !== resolutionHash) {
            throw new RunConflictError("Conflicting interaction resolution");
          }
          return { resolved: current, wake: false };
        }
        if (current.status !== "pending") {
          throw invalid(state.run, "resolve interaction");
        }
        const now = this.now();
        const record: RunInteractionRecord = {
          ...current,
          status: "resolved",
          resolutionRequestId: command.resolutionRequestId,
          resolutionHash,
          resolution: command.resolution,
          resolvedAt: now,
        };
        const next = revise(state.run, { status: "suspended" }, now);
        await this.commit(state, next, "interaction_resolved", {
          interactions: [record],
        });
        return { resolved: record, wake: true };
      },
    );
    // Wake the live execution outside the state lock so control resumption
    // never re-enters coordination. Absent a live execution (e.g. after
    // restart), the run stays resumable via checkpoint-based continue.
    if (wake) await this.live.get(runId)?.execution.control.continue();
    return resolved;
  }

  async completeResolvedInteraction(
    runId: string,
    interactionId: string,
    result: Readonly<Record<string, unknown>> = {},
  ): Promise<RunRecord> {
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      const settled = settleResolvedInteraction(
        state,
        interactionId,
        result,
        this.now(),
        this.events,
      );
      await this.commit(
        state,
        settled.run,
        "resolved_interaction_completed",
        settled.changes,
      );
      return settled.run;
    });
  }

  async cancel(runId: string, reason?: string): Promise<RunRecord> {
    const targets = CANCELLATION_TARGETS;
    const requested = await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (TERMINAL_STATUSES.has(state.run.status)) return state.run;
      const request = requestCancellation(state, this.now());
      await this.commit(state, request.run, "cancellation_requested", {
        ...request.changes,
        events: request.changes.prompts?.map((prompt) =>
          this.events.cancelledPrompt(request.run, prompt),
        ),
      });
      return request.run;
    });
    if (TERMINAL_STATUSES.has(requested.status)) return requested;
    this.live.get(runId)?.abort.abort(reason);
    const evidence: RunRecord["cancellationEvidence"] = [];
    for (const target of targets) {
      try {
        const status = await cancelRunTarget(
          target,
          requested,
          this.ports.cancellation,
          this.live.get(runId)?.execution,
          reason,
        );
        evidence.push({ target, status, checkedAt: this.now() });
      } catch (error) {
        evidence.push({
          target,
          status: "failed" as const,
          checkedAt: this.now(),
          message: errorMessage(error).slice(0, 500),
        });
      }
    }
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (TERMINAL_STATUSES.has(state.run.status)) return state.run;
      const terminalAt = this.now();
      const { run: next, failed } = finishCancellation(
        state.run,
        evidence,
        terminalAt,
      );
      await this.commit(
        state,
        next,
        failed ? "cancellation_failed" : "cancelled",
        {
          execution: executionRecord(
            next,
            failed ? "failed" : "cancelled",
            terminalAt,
          ),
          events: failed
            ? [this.events.failed(next, terminalAt, true)]
            : [this.events.cancelled(next, terminalAt)],
        },
      );
      return next;
    });
  }

  async recover(): Promise<readonly RunRecord[]> {
    const recovered: RunRecord[] = [];
    for (const state of await this.ports.unitOfWork.list()) {
      const decision = await decideRunRecovery(
        state,
        this.ports.references,
        this.ports.integrity,
        () => this.now(),
      );
      if (decision.transitionKind) {
        await this.commit(state, decision.run, decision.transitionKind, {
          events: [
            this.events.failed(
              decision.run,
              decision.run.updatedAt,
              decision.interrupted,
            ),
          ],
        });
      }
      recovered.push(decision.run);
    }
    return recovered;
  }

  async get(runId: string): Promise<RunHydratedState | undefined> {
    return this.ports.unitOfWork.load(runId);
  }

  private sink(runId: string): RunExecutionSink {
    return {
      appendEntries: (entries) =>
        this.appendDurable(runId, "entries_appended", {
          entries: [...entries],
        }),
      upsertToolCalls: (toolCalls) =>
        this.appendDurable(runId, "tool_calls_upserted", {
          toolCalls: [...toolCalls],
        }),
      checkpoint: (command) => this.checkpoint(runId, command),
      wait: (command) => this.wait(runId, command),
      progress: (event) => this.ports.transient?.publish(event),
    };
  }

  private async appendDurable(
    runId: string,
    kind: string,
    changes: TransitionChanges,
  ): Promise<void> {
    await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (TERMINAL_STATUSES.has(state.run.status)) {
        throw invalid(state.run, kind);
      }
      const next = revise(state.run, {}, this.now());
      const events = changes.toolCalls?.map((toolCall) =>
        this.events.toolCallUpdated(next, toolCall),
      );
      await this.commit(state, next, kind, {
        ...changes,
        events: [...(changes.events ?? []), ...(events ?? [])],
      });
    });
  }

  private launch(
    run: RunRecord,
    execution: RunExecution,
    command: "start" | "continue",
    prompt?: string,
    images?: PromptImage[],
  ): void {
    const abort = new AbortController();
    const promise = (async () => {
      try {
        await this.prompts.drain(run.runId, execution);
        const outcome = await execution.execute({
          run,
          command,
          prompt,
          images,
          signal: abort.signal,
        });
        if (outcome.status === "completed") {
          await this.complete(run.runId, run.executionId, outcome.result);
        } else if (outcome.status === "failed") {
          await this.fail(
            run.runId,
            run.executionId,
            outcome.failure,
            abort.signal,
          );
        } else if (outcome.status === "interrupted") {
          await this.fail(
            run.runId,
            run.executionId,
            {
              code: "RUN_INTERRUPTED",
              message: outcome.message,
              retryable: true,
            },
            abort.signal,
          );
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          try {
            await this.fail(
              run.runId,
              run.executionId,
              failure("RUN_EXECUTION_FAILED", error, true),
              abort.signal,
            );
          } catch (settlementError) {
            // A host can be torn down while an async execution is settling.
            // Never leak a fire-and-forget rejection; canonical state remains
            // authoritative and recovery will reconcile if it still exists.
            this.ports.diagnostics?.error("run failure settlement failed", {
              runId: run.runId,
              error: errorMessage(settlementError),
            });
          }
        }
      } finally {
        this.live.delete(run.runId, execution);
      }
    })();
    this.live.set(run.runId, { execution, abort, promise });
  }

  private async complete(
    runId: string,
    executionId: string,
    result: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      const settled = completeExecution(
        state,
        executionId,
        result,
        this.now(),
        this.events,
      );
      if (settled) {
        await this.commit(state, settled.run, "completed", settled.changes);
      }
    });
  }

  private async fail(
    runId: string,
    executionId: string,
    value: RunFailureRecord,
    signal: AbortSignal,
  ): Promise<void> {
    const retryRun = await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (
        TERMINAL_STATUSES.has(state.run.status) ||
        state.run.status === "cancellation_requested" ||
        state.run.executionId !== executionId
      ) {
        return undefined;
      }
      const validCheckpoint =
        value.retryable &&
        (await checkpointValid(
          state,
          this.ports.references,
          this.ports.integrity,
        ));
      const policy = this.ports.retryPolicy ?? DEFAULT_RUN_RETRY_POLICY;
      const decision = decideRunRetry(state.run, policy);
      const now = this.now();
      if (validCheckpoint && decision.retry) {
        const retrying = revise(
          state.run,
          {
            status: "retrying",
            recoverability: "checkpoint",
            attempt: decision.retryAttempt,
            executionId: prefixed("exec", this.ports.ids.next()),
            failure: value,
            terminalAt: undefined,
          },
          now,
        );
        await this.commit(state, retrying, "retrying", {
          execution: executionRecord(retrying, "starting", now),
          events: [
            this.events.retrying(retrying, now, {
              maxRetries: decision.maxRetries,
              delayMs: decision.delayMs,
            }),
          ],
        });
        return { run: retrying, delayMs: decision.delayMs };
      }
      const next = revise(
        state.run,
        {
          status: validCheckpoint ? "interrupted" : "failed",
          recoverability: validCheckpoint
            ? "checkpoint"
            : value.retryable
              ? "retryable"
              : "none",
          failure: value,
          terminalAt: validCheckpoint ? undefined : now,
        },
        now,
      );
      await this.commit(
        state,
        next,
        validCheckpoint ? "retry_exhausted" : "failed",
        {
          execution: executionRecord(next, "failed", now),
          events: [this.events.failed(next, now, validCheckpoint)],
        },
      );
      return undefined;
    });
    if (!retryRun) return;
    try {
      await (this.ports.retryDelay ?? cancellableRetryDelay)(
        retryRun.delayMs,
        signal,
      );
    } catch (error) {
      if (signal.aborted || isRetryAbort(error)) return;
      throw error;
    }
    const current = await this.require(runId);
    if (
      current.run.status !== "retrying" ||
      current.run.executionId !== retryRun.run.executionId
    ) {
      return;
    }
    let execution: RunExecution;
    try {
      execution = await this.ports.execution.create(
        retryRun.run,
        this.sink(runId),
      );
    } catch (error) {
      await this.fail(
        runId,
        retryRun.run.executionId,
        failure("RUN_CONSTRUCTION_FAILED", error, true),
        signal,
      );
      return;
    }
    const launchable = await this.require(runId);
    if (
      launchable.run.status !== "retrying" ||
      launchable.run.executionId !== retryRun.run.executionId
    ) {
      await execution.control
        .cancel("retry was superseded")
        .catch(() => undefined);
      return;
    }
    this.launch(retryRun.run, execution, "continue");
  }

  private async commit(
    previous: RunHydratedState | undefined,
    run: RunRecord,
    kind: string,
    changes: TransitionChanges = {},
  ): Promise<void> {
    const expectedRevision = previous?.run.revision ?? 0;
    const transition = buildTransition(
      run,
      kind,
      expectedRevision,
      changes,
      this.ports.ids,
      this.ports.integrity,
    );
    await this.ports.unitOfWork.commit(expectedRevision, transition);
    try {
      await this.ports.transitionObserver?.committed(transition);
    } catch (error) {
      this.ports.diagnostics?.error("run transition observer failed", {
        runId: run.runId,
        revision: transition.revision,
        error: errorMessage(error),
      });
    }
    try {
      await this.ports.unitOfWork.materialize(run.runId);
    } catch (error) {
      this.ports.diagnostics?.error("run projection materialization failed", {
        runId: run.runId,
        revision: transition.revision,
        error: errorMessage(error),
      });
    }
    try {
      await this.ports.flushEvents();
    } catch (error) {
      this.ports.diagnostics?.warn("run event delivery deferred", {
        runId: run.runId,
        revision: transition.revision,
        error: errorMessage(error),
      });
    }
  }

  private async require(runId: string): Promise<RunHydratedState> {
    const state = await this.ports.unitOfWork.load(runId);
    if (!state) throw new InvalidRunStateError(`Unknown run: ${runId}`);
    return state;
  }

  private now(): string {
    return this.ports.clock.now().toISOString();
  }

  private exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    return this.locks.exclusive(key, action);
  }
}

function invalid(run: RunRecord, command: string): InvalidRunStateError {
  return new InvalidRunStateError(
    `Cannot ${command} run ${run.runId} while ${run.status}`,
  );
}
