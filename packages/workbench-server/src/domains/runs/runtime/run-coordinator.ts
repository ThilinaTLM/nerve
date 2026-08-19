/* eslint-disable max-lines -- Coordinator keeps the canonical run lifecycle in one auditable use case. */
import type {
  PeerRole,
  PromptImage,
  RunCheckpointRecord,
  RunFailureRecord,
  RunInteractionRecord,
  RunPromptRecord,
  RunRecord,
  RunTransitionRecord,
} from "@nervekit/contracts";
import type { ClockPort, DiagnosticPort, IdPort } from "../../../core/ports.js";
import { assertCheckpoint, checkpointValid } from "./run-checkpoints.js";
import {
  CANCELLATION_TARGETS,
  cancelRunTarget,
  finishCancellation,
  requestCancellation,
} from "./run-cancellation.js";
import { RunEventFactory, type RunNotifyEventPort } from "./run-events.js";
import {
  InvalidRunStateError,
  RunConflictError,
  type ResolveInteractionCommand,
} from "./run-errors.js";
import { KeyedSerialLock } from "./run-locks.js";
import { RunPromptCoordinator } from "./run-prompts.js";
import { RunInteractionCoordinator } from "./run-interaction-coordinator.js";
import { decideRunRecovery } from "./run-recovery.js";
import { completeExecution } from "./run-settlement.js";
import {
  cancellableRetryDelay,
  countAutomaticRetries,
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
  type RunTerminalizationPort,
} from "./run-execution.js";
import {
  ACTIVE_STATUSES,
  boundedFailure,
  buildTransition,
  checkpointRecord,
  type CheckpointCommand,
  errorMessage,
  executionRecord,
  failure,
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
  terminalization: RunTerminalizationPort;
  clock: ClockPort;
  ids: IdPort;
  integrity: RunIntegrityPort;
  flushEvents(transition: RunTransitionRecord): Promise<void>;
  notify?: RunNotifyEventPort;
  diagnostics?: DiagnosticPort;
  retryPolicy?: RunRetryPolicyPort;
  retryDelay?(delayMs: number, signal: AbortSignal): Promise<void>;
  transitionObserver?: RunTransitionObserverPort;
}

const CANCELLATION_TARGET_DEADLINE_MS = 2_000;

async function withCancellationDeadline<T>(
  operation: Promise<T>,
  target: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Cancellation target ${target} timed out after ${CANCELLATION_TARGET_DEADLINE_MS}ms`,
              ),
            ),
          CANCELLATION_TARGET_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class RunCoordinator {
  private readonly locks = new KeyedSerialLock();
  private readonly live = new LiveExecutionRegistry();
  private readonly pendingExecutions = new Set<Promise<void>>();
  private readonly pendingCommits = new Set<Promise<void>>();
  private executionGeneration = 0;
  private commitGeneration = 0;
  private readonly events: RunEventFactory;
  private readonly prompts: RunPromptCoordinator;
  private readonly interactions: RunInteractionCoordinator;

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
    this.interactions = new RunInteractionCoordinator({
      ids: ports.ids,
      integrity: ports.integrity,
      events: this.events,
      load: (runId) => this.require(runId),
      exclusive: (key, action) => this.exclusive(key, action),
      now: () => this.now(),
      commit: (previous, run, kind, changes) =>
        this.commit(previous, run, kind, changes),
      continueLive: async (runId) => {
        await this.live.get(runId)?.execution.control.continue();
      },
      cancelLive: async (runId, reason) => {
        const live = this.live.get(runId);
        if (!live) return;
        live.abort.abort(reason);
        try {
          await live.execution.control.cancel(reason);
        } catch (error) {
          this.ports.diagnostics?.warn(
            "terminal interaction live execution cleanup failed",
            { runId, error: errorMessage(error) },
          );
        }
      },
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

  async forcePush(runId: string): Promise<readonly RunPromptRecord[]> {
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (!ACTIVE_STATUSES.has(state.run.status)) {
        throw invalid(state.run, "force push");
      }
      const prompts = state.prompts
        .filter((prompt) => ["queued", "accepted"].includes(prompt.status))
        .sort((left, right) => left.ordinal - right.ordinal);
      if (prompts.length === 0) {
        throw new InvalidRunStateError("No queued prompts to force push");
      }
      const execution = this.live.get(runId)?.execution;
      if (!execution) {
        throw new InvalidRunStateError("Run has no live execution");
      }
      await execution.control.forcePush();
      return prompts;
    });
  }

  async continue(runId: string): Promise<RunRecord> {
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (state.interactions.some((item) => item.status === "pending")) {
        throw new InvalidRunStateError(
          "All interactions must be resolved before continue",
        );
      }
      if (
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
      const resumeKind =
        state.run.status === "interrupted" ? "manual" : "interaction";
      const next: RunRecord = {
        ...state.run,
        revision: state.run.revision + 1,
        status: "running",
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
      await this.commit(state, next, "resumed", {
        execution: executionRecord(next, "starting", now),
        events: [this.events.resumed(next, now, resumeKind)],
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
    return this.interactions.wait(runId, command);
  }

  async waitMany(
    runId: string,
    commands: readonly WaitCommand[],
  ): Promise<readonly RunInteractionRecord[]> {
    return this.interactions.waitMany(runId, commands);
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
    return this.interactions.resolveInteraction(runId, command);
  }

  async resolveInteractionBatch(
    runId: string,
    commands: readonly ResolveInteractionCommand[],
  ): Promise<readonly RunInteractionRecord[]> {
    return this.interactions.resolveInteractionBatch(runId, commands);
  }

  async resolveAndCompleteInteraction(
    runId: string,
    command: ResolveInteractionCommand,
    result: Readonly<Record<string, unknown>> = {},
  ): Promise<RunRecord> {
    return this.interactions.resolveAndCompleteInteraction(
      runId,
      command,
      result,
    );
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
    const execution = this.live.get(runId)?.execution;
    const evidence = await Promise.all(
      targets.map(async (target) => {
        try {
          const status = await withCancellationDeadline(
            cancelRunTarget(
              target,
              requested,
              this.ports.cancellation,
              execution,
              reason,
            ),
            target,
          );
          return { target, status, checkedAt: this.now() };
        } catch (error) {
          return {
            target,
            status: "failed" as const,
            checkedAt: this.now(),
            message: errorMessage(error).slice(0, 500),
          };
        }
      }),
    );
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
    // Terminal runs cannot require recovery, so only active runs are scanned.
    for (const state of await this.ports.unitOfWork.listActive()) {
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

  /**
   * Runs a query at a commit-settled point. If a producer commit overlaps the
   * read, retry after that complete commit pipeline (projection and event
   * publication included) settles.
   */
  async readSettled<T>(read: () => Promise<T>): Promise<T> {
    for (;;) {
      await Promise.all([...this.pendingCommits]);
      const generation = this.commitGeneration;
      const value = await read();
      if (
        this.pendingCommits.size === 0 &&
        generation === this.commitGeneration
      ) {
        return value;
      }
    }
  }

  /** Waits until detached executions and their complete commit pipelines stop. */
  async settled(): Promise<void> {
    for (;;) {
      const executionGeneration = this.executionGeneration;
      const commitGeneration = this.commitGeneration;
      await Promise.allSettled([...this.pendingExecutions]);
      await Promise.all([...this.pendingCommits]);
      if (
        this.pendingExecutions.size === 0 &&
        this.pendingCommits.size === 0 &&
        executionGeneration === this.executionGeneration &&
        commitGeneration === this.commitGeneration
      ) {
        return;
      }
    }
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
      promptDelivered: (promptId) => this.prompts.delivered(runId, promptId),
      checkpoint: (command) => this.checkpoint(runId, command),
      wait: (command) => this.wait(runId, command),
      waitMany: (commands) => this.waitMany(runId, commands),
      progress: (event) => this.ports.notify?.publish(event),
    };
  }

  private async appendDurable(
    runId: string,
    kind: string,
    changes: TransitionChanges,
  ): Promise<void> {
    await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (TERMINAL_STATUSES.has(state.run.status))
        throw invalid(state.run, kind);
      const next = revise(state.run, {}, this.now());
      await this.commit(state, next, kind, {
        ...changes,
        events: [
          ...(changes.events ?? []),
          ...(changes.entries ?? []).map((entry) =>
            this.events.entryAppended(next, entry),
          ),
          ...(changes.toolCalls ?? []).map((toolCall) =>
            this.events.toolCallUpdated(next, toolCall),
          ),
        ],
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
            // Avoid leaking rejection during teardown; recovery reconciles state.
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
    this.executionGeneration += 1;
    this.pendingExecutions.add(promise);
    void promise.then(
      () => this.pendingExecutions.delete(promise),
      () => this.pendingExecutions.delete(promise),
    );
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
    input: RunFailureRecord,
    signal: AbortSignal,
  ): Promise<void> {
    const value = boundedFailure(input);
    const retryRun = await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (
        TERMINAL_STATUSES.has(state.run.status) ||
        state.run.status === "cancellation_requested" ||
        state.run.executionId !== executionId
      ) {
        return undefined;
      }
      const checkpointEligible = value.continuable ?? value.retryable;
      const validCheckpoint =
        checkpointEligible &&
        (await checkpointValid(
          state,
          this.ports.references,
          this.ports.integrity,
        ));
      const policy = this.ports.retryPolicy ?? DEFAULT_RUN_RETRY_POLICY;
      const decision = decideRunRetry(
        state.run,
        policy,
        countAutomaticRetries(state.transitions),
      );
      const now = this.now();
      if (value.retryable && validCheckpoint && decision.retry) {
        const retrying = revise(
          state.run,
          {
            status: "retrying",
            recoverability: "checkpoint",
            attempt: decision.executionAttempt,
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
              attempt: decision.retryAttempt,
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
    const becomingTerminal =
      TERMINAL_STATUSES.has(run.status) &&
      (!previous || !TERMINAL_STATUSES.has(previous.run.status));
    if (becomingTerminal) {
      await this.ports.terminalization.terminalize(run);
    }
    const transition = buildTransition(
      run,
      kind,
      expectedRevision,
      changes,
      this.ports.ids,
      this.ports.integrity,
    );
    const finishCommit = this.beginCommit();
    try {
      const committed = await this.ports.unitOfWork.commit(
        expectedRevision,
        transition,
      );
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
        await this.ports.unitOfWork.materialize(committed);
      } catch (error) {
        this.ports.diagnostics?.error("run projection materialization failed", {
          runId: run.runId,
          revision: transition.revision,
          error: errorMessage(error),
        });
      }
      try {
        await this.ports.flushEvents(transition);
      } catch (error) {
        this.ports.diagnostics?.warn("run event delivery deferred", {
          runId: run.runId,
          revision: transition.revision,
          error: errorMessage(error),
        });
      }
    } finally {
      finishCommit();
    }
  }

  private beginCommit(): () => void {
    let resolve!: () => void;
    const pending = new Promise<void>((settled) => {
      resolve = settled;
    });
    this.commitGeneration += 1;
    this.pendingCommits.add(pending);
    return () => {
      this.pendingCommits.delete(pending);
      resolve();
    };
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
