import type {
  PeerRole,
  RunCheckpointRecord,
  RunFailureRecord,
  RunInteractionRecord,
  RunPromptRecord,
  RunRecord,
} from "@nervekit/contracts";
import type { ClockPort, DiagnosticPort, IdPort } from "./index.js";
import { assertCheckpoint, checkpointValid } from "./run-checkpoints.js";
import { RunEventFactory, type RunTransientEventPort } from "./run-events.js";
import {
  InvalidRunStateError,
  RunConflictError,
  type ResolveInteractionCommand,
} from "./run-errors.js";
import { decideRunRecovery } from "./run-recovery.js";
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
}

export class RunCoordinator {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly live = new LiveExecutionRegistry();
  private readonly events: RunEventFactory;

  constructor(private readonly ports: RunCoordinatorPorts) {
    this.events = new RunEventFactory(ports.sourceRole);
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
      this.launch(running, execution, "start", command.prompt);
      return running;
    });
  }

  async steer(runId: string, text: string): Promise<RunPromptRecord> {
    return this.queuePrompt(runId, "steer", text);
  }

  async followUp(runId: string, text: string): Promise<RunPromptRecord> {
    return this.queuePrompt(runId, "follow-up", text);
  }

  async cancelPrompt(
    runId: string,
    promptId: string,
  ): Promise<RunPromptRecord> {
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      const prompt = state.prompts.find((item) => item.id === promptId);
      if (!prompt || !["queued", "accepted"].includes(prompt.status)) {
        throw new InvalidRunStateError("Queued prompt was not found");
      }
      const now = this.now();
      const cancelled: RunPromptRecord = {
        ...prompt,
        status: "cancelled",
        updatedAt: now,
      };
      await this.commit(state, revise(state.run, {}, now), "prompt_cancelled", {
        prompts: [cancelled],
      });
      return cancelled;
    });
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
        events: [this.events.retrying(next, now)],
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

  async cancel(runId: string, reason?: string): Promise<RunRecord> {
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (TERMINAL_STATUSES.has(state.run.status)) return state.run;
      const now = this.now();
      const targets = [
        "model",
        "tool",
        "task",
        "subagent",
        "interaction",
      ] as const;
      const requested = revise(
        state.run,
        {
          status: "cancellation_requested",
          cancellationEvidence: targets.map((target) => ({
            target,
            status: "pending" as const,
            checkedAt: now,
          })),
        },
        now,
      );
      const cancelledPrompts = state.prompts
        .filter(
          (item) => item.status === "queued" || item.status === "accepted",
        )
        .map((item) => ({
          ...item,
          status: "cancelled" as const,
          updatedAt: now,
        }));
      const cancelledInteractions = state.interactions
        .filter((interaction) => interaction.status === "pending")
        .map((interaction) => ({
          ...interaction,
          status: "cancelled" as const,
          resolvedAt: now,
        }));
      await this.commit(state, requested, "cancellation_requested", {
        prompts: cancelledPrompts,
        interactions: cancelledInteractions,
      });
      this.live.get(runId)?.abort.abort(reason);
      const evidence = [];
      for (const target of targets) {
        try {
          const status = await this.cancelTarget(target, requested, reason);
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
      const afterRequest = await this.require(runId);
      const failed = evidence.some((item) => item.status === "failed");
      const terminalAt = this.now();
      const next = revise(
        afterRequest.run,
        {
          status: failed ? "cancellation_failed" : "cancelled",
          recoverability: failed ? "manual" : "none",
          cancellationEvidence: evidence,
          terminalAt: failed ? undefined : terminalAt,
          failure: failed
            ? {
                code: "CANCELLATION_UNCONFIRMED",
                message: "One or more cancellation targets remain unconfirmed",
                retryable: true,
              }
            : undefined,
        },
        terminalAt,
      );
      await this.commit(
        afterRequest,
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
  ): void {
    const abort = new AbortController();
    const promise = (async () => {
      try {
        await this.drainPrompts(run.runId, execution);
        const outcome = await execution.execute({
          run,
          command,
          prompt,
          signal: abort.signal,
        });
        if (outcome.status === "completed") {
          await this.complete(run.runId, outcome.result);
        } else if (outcome.status === "failed") {
          await this.fail(run.runId, outcome.failure);
        } else if (outcome.status === "interrupted") {
          await this.fail(run.runId, {
            code: "RUN_INTERRUPTED",
            message: outcome.message,
            retryable: true,
          });
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          try {
            await this.fail(
              run.runId,
              failure("RUN_EXECUTION_FAILED", error, true),
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
        this.live.delete(run.runId);
      }
    })();
    this.live.set(run.runId, { execution, abort, promise });
  }

  private async complete(
    runId: string,
    result: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (TERMINAL_STATUSES.has(state.run.status)) return;
      const now = this.now();
      const next = revise(
        state.run,
        {
          status: "completed",
          recoverability: "not_needed",
          result: { ...result },
          terminalAt: now,
        },
        now,
      );
      await this.commit(state, next, "completed", {
        execution: executionRecord(next, "completed", now),
        events: [this.events.completed(next, now)],
      });
    });
  }

  private async fail(runId: string, value: RunFailureRecord): Promise<void> {
    await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (TERMINAL_STATUSES.has(state.run.status)) return;
      const isValid =
        value.retryable &&
        (await checkpointValid(
          state,
          this.ports.references,
          this.ports.integrity,
        ));
      const now = this.now();
      const next = revise(
        state.run,
        {
          status: isValid ? "interrupted" : "failed",
          recoverability: isValid
            ? "checkpoint"
            : value.retryable
              ? "retryable"
              : "none",
          failure: value,
          terminalAt: isValid ? undefined : now,
        },
        now,
      );
      await this.commit(state, next, isValid ? "interrupted" : "failed", {
        execution: executionRecord(next, "failed", now),
        events: [this.events.failed(next, now, isValid)],
      });
    });
  }

  private async queuePrompt(
    runId: string,
    behavior: "steer" | "follow-up",
    text: string,
  ): Promise<RunPromptRecord> {
    const prompt = await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (!ACTIVE_STATUSES.has(state.run.status)) {
        throw invalid(state.run, behavior);
      }
      const now = this.now();
      const record: RunPromptRecord = {
        id: prefixed("promptq", this.ports.ids.next()),
        agentId: state.run.agentId,
        conversationId: state.run.conversationId,
        projectId: state.run.projectId,
        runId,
        behavior,
        text,
        status: "queued",
        ordinal: state.prompts.length,
        deliveryAttempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      const next = revise(state.run, {}, now);
      await this.commit(state, next, "prompt_queued", {
        prompts: [record],
        events: [this.events.queuedPrompt(next, record)],
      });
      return record;
    });
    const execution = this.live.get(runId)?.execution;
    if (execution) await this.drainPrompts(runId, execution);
    return prompt;
  }

  private async drainPrompts(
    runId: string,
    execution: RunExecution,
  ): Promise<void> {
    let state = await this.require(runId);
    for (const prompt of state.prompts.filter(
      (item) => item.status === "queued",
    )) {
      try {
        if (prompt.behavior === "steer") await execution.control.steer(prompt);
        else await execution.control.followUp(prompt);
        const current = await this.require(runId);
        const now = this.now();
        const delivered: RunPromptRecord = {
          ...prompt,
          status: "delivered",
          deliveryAttempts: prompt.deliveryAttempts + 1,
          updatedAt: now,
        };
        await this.commit(
          current,
          revise(current.run, {}, now),
          "prompt_delivered",
          { prompts: [delivered] },
        );
        state = await this.require(runId);
      } catch (error) {
        const current = await this.require(runId);
        const now = this.now();
        await this.commit(
          current,
          revise(current.run, {}, now),
          "prompt_failed",
          {
            prompts: [
              {
                ...prompt,
                status: "failed",
                error: errorMessage(error).slice(0, 1_000),
                deliveryAttempts: prompt.deliveryAttempts + 1,
                updatedAt: now,
              },
            ],
          },
        );
        throw error;
      }
    }
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

  private async cancelTarget(
    target: RunRecord["cancellationEvidence"][number]["target"],
    run: RunRecord,
    reason?: string,
  ): Promise<"confirmed" | "not_running"> {
    if (target === "model") {
      const live = this.live.get(run.runId);
      if (live) await live.execution.control.cancel(reason);
      return this.ports.cancellation.cancelModel(run);
    }
    if (target === "tool") return this.ports.cancellation.cancelTools(run);
    if (target === "task") return this.ports.cancellation.cancelTasks(run);
    if (target === "subagent") {
      return this.ports.cancellation.cancelSubagents(run);
    }
    return this.ports.cancellation.cancelInteraction(run);
  }

  private async require(runId: string): Promise<RunHydratedState> {
    const state = await this.ports.unitOfWork.load(runId);
    if (!state) throw new InvalidRunStateError(`Unknown run: ${runId}`);
    return state;
  }

  private now(): string {
    return this.ports.clock.now().toISOString();
  }

  private async exclusive<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(key, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}

function invalid(run: RunRecord, command: string): InvalidRunStateError {
  return new InvalidRunStateError(
    `Cannot ${command} run ${run.runId} while ${run.status}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
