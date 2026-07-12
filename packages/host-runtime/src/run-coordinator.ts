/* eslint-disable max-lines -- Canonical run coordination keeps transition ordering visible in one state machine. */ import type {
  ConversationEntry,
  PlanReviewRecord,
  QueuedPromptRecord,
  RunCheckpointRecord,
  RunExecutionRecord,
  RunFailureRecord,
  RunInteractionRecord,
  RunPromptRecord,
  RunPublicEventIntent,
  RunRecord,
  RunTransitionRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import { RUN_STATE_EPOCH, validatePublicEvent } from "@nervekit/contracts";
import type { ClockPort, DiagnosticPort, IdPort } from "./index.js";
import type {
  RunCheckpointReferencePort,
  RunHydratedState,
  RunUnitOfWorkPort,
} from "./run-unit-of-work.js";

const ACTIVE_STATUSES = new Set<RunRecord["status"]>([
  "starting",
  "running",
  "retrying",
  "waiting",
  "suspended",
  "cancellation_requested",
  "cancellation_failed",
  "interrupted",
]);
const TERMINAL_STATUSES = new Set<RunRecord["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

export interface RunExecutionControl {
  steer(prompt: RunPromptRecord): Promise<void>;
  followUp(prompt: RunPromptRecord): Promise<void>;
  continue(): Promise<void>;
  cancel(reason?: string): Promise<void>;
}

export type RunExecutionOutcome =
  | { status: "completed"; result?: Readonly<Record<string, unknown>> }
  | { status: "suspended" }
  | { status: "failed"; failure: RunFailureRecord }
  | { status: "interrupted"; message: string };

export interface RunExecution {
  readonly control: RunExecutionControl;
  execute(input: {
    run: RunRecord;
    command: "start" | "continue";
    prompt?: string;
    signal: AbortSignal;
  }): Promise<RunExecutionOutcome>;
}

export interface RunExecutionFactoryPort {
  create(run: RunRecord): Promise<RunExecution>;
}

export interface RunCancellationPort {
  cancelModel(run: RunRecord): Promise<"confirmed" | "not_running">;
  cancelTools(run: RunRecord): Promise<"confirmed" | "not_running">;
  cancelTasks(run: RunRecord): Promise<"confirmed" | "not_running">;
  cancelSubagents(run: RunRecord): Promise<"confirmed" | "not_running">;
  cancelInteraction(run: RunRecord): Promise<"confirmed" | "not_running">;
}

export interface RunIntegrityPort {
  checksum(value: unknown): string;
}

export interface RunCoordinatorPorts {
  unitOfWork: RunUnitOfWorkPort;
  execution: RunExecutionFactoryPort;
  references: RunCheckpointReferencePort;
  cancellation: RunCancellationPort;
  clock: ClockPort;
  ids: IdPort;
  integrity: RunIntegrityPort;
  flushEvents(): Promise<void>;
  diagnostics?: DiagnosticPort;
}

export interface StartRunCommand {
  conversationId: string;
  agentId: string;
  projectId: string;
  prompt: string;
  runId?: string;
  scopeId?: string;
}

export interface WaitForQuestionCommand {
  kind: "question";
  interactionId?: string;
  toolCallId: string;
  prompt: string;
  context?: string;
  placeholder?: string;
  required?: boolean;
  checkpoint: CheckpointCommand;
}

export interface WaitForApprovalCommand {
  kind: "approval";
  interactionId?: string;
  toolCallId: string;
  prompt: string;
  context?: string;
  risk: string[];
  normalizedArgs: Record<string, unknown>;
  offeredScopes: Array<"single_call" | "same_tool_same_args" | "run">;
  checkpoint: CheckpointCommand;
}

export interface WaitForPlanReviewCommand {
  kind: "plan_review";
  interactionId?: string;
  toolCallId: string;
  prompt: string;
  context?: string;
  planReview: PlanReviewRecord;
  checkpoint: CheckpointCommand;
}

export type WaitCommand =
  | WaitForQuestionCommand
  | WaitForApprovalCommand
  | WaitForPlanReviewCommand;

export interface ResolveInteractionCommand {
  interactionId: string;
  resolutionRequestId: string;
  resolution: Record<string, unknown>;
}

export interface CheckpointCommand {
  boundary: RunCheckpointRecord["boundary"];
  transcriptCursor: number;
  entryIds: string[];
  harnessLeafId: string | null;
  harnessSavePointId: string;
  toolCalls: RunCheckpointRecord["toolCalls"];
  interactionId?: string;
}

export class RunConflictError extends Error {
  readonly code = "RUN_CONFLICT";
}
export class InvalidRunStateError extends Error {
  readonly code = "INVALID_RUN_STATE";
}
export class InvalidCheckpointError extends Error {
  readonly code = "INVALID_CHECKPOINT";
}

export class RunCoordinator {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly executions = new Map<
    string,
    { execution: RunExecution; abort: AbortController; promise: Promise<void> }
  >();

  constructor(private readonly ports: RunCoordinatorPorts) {}

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
      const run = this.newRun(command, scopeId, now);
      let execution: RunExecution;
      try {
        execution = await this.ports.execution.create(run);
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
          events: [failedEvent(failed, now, false)],
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
        events: [startedEvent(running, now)],
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
      await this.assertCheckpoint(state);
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
      const execution = await this.ports.execution.create(next);
      await this.commit(state, next, "retrying", {
        execution: executionRecord(next, "starting", now),
        events: [retryingEvent(next, now)],
      });
      this.launch(next, execution, "continue");
      return next;
    });
  }

  async checkpoint(runId: string, command: CheckpointCommand) {
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (TERMINAL_STATUSES.has(state.run.status))
        throw invalid(state.run, "checkpoint");
      const checkpoint = this.checkpointRecord(state, command);
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
        events: [checkpointEvent(next, checkpoint)],
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
      const checkpoint = this.checkpointRecord(state, {
        ...command.checkpoint,
        boundary: "suspension",
      });
      const interaction = this.interactionRecord(
        state.run,
        command,
        checkpoint,
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
        events: [waitingEvent(next, interaction)],
      });
      return interaction;
    });
  }

  async resolveInteraction(
    runId: string,
    command: ResolveInteractionCommand,
  ): Promise<RunInteractionRecord> {
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      const current = state.interactions.find(
        (item) => item.id === command.interactionId,
      );
      if (!current || current.runId !== runId) {
        throw new InvalidRunStateError("Interaction does not belong to run");
      }
      const resolutionHash = this.ports.integrity.checksum(command.resolution);
      if (current.status === "resolved") {
        if (current.resolutionHash !== resolutionHash) {
          throw new RunConflictError("Conflicting interaction resolution");
        }
        return current;
      }
      if (current.status !== "pending")
        throw invalid(state.run, "resolve interaction");
      const now = this.now();
      const resolved: RunInteractionRecord = {
        ...current,
        status: "resolved",
        resolutionRequestId: command.resolutionRequestId,
        resolutionHash,
        resolution: command.resolution,
        resolvedAt: now,
      };
      const next = revise(state.run, { status: "suspended" }, now);
      await this.commit(state, next, "interaction_resolved", {
        interactions: [resolved],
      });
      return resolved;
    });
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
      await this.commit(state, requested, "cancellation_requested", {
        prompts: cancelledPrompts,
      });
      this.executions.get(runId)?.abort.abort(reason);
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
            ? [failedEvent(next, terminalAt, true)]
            : [cancelledEvent(next, terminalAt)],
        },
      );
      return next;
    });
  }

  async recover(): Promise<readonly RunRecord[]> {
    const recovered: RunRecord[] = [];
    for (const state of await this.ports.unitOfWork.list()) {
      if (
        state.run.status === "waiting" ||
        state.run.status === "suspended" ||
        TERMINAL_STATUSES.has(state.run.status)
      ) {
        recovered.push(state.run);
        continue;
      }
      try {
        await this.assertCheckpoint(state);
        const next = revise(
          state.run,
          {
            status: "interrupted",
            recoverability: "checkpoint",
            failure: {
              code: "RUN_INTERRUPTED",
              message: "Host restarted during active execution",
              retryable: true,
            },
          },
          this.now(),
        );
        await this.commit(state, next, "interrupted", {
          events: [failedEvent(next, next.updatedAt, true)],
        });
        recovered.push(next);
      } catch {
        const next = revise(
          state.run,
          {
            status: "failed",
            recoverability: "none",
            terminalAt: this.now(),
            failure: {
              code: "INVALID_CHECKPOINT",
              message: "Run was interrupted without a valid durable checkpoint",
              retryable: true,
            },
          },
          this.now(),
        );
        await this.commit(state, next, "interrupted_without_checkpoint", {
          events: [failedEvent(next, next.updatedAt, true)],
        });
        recovered.push(next);
      }
    }
    return recovered;
  }

  async get(runId: string): Promise<RunHydratedState | undefined> {
    return this.ports.unitOfWork.load(runId);
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
          await this.fail(
            run.runId,
            failure("RUN_EXECUTION_FAILED", error, true),
          );
        }
      } finally {
        this.executions.delete(run.runId);
      }
    })();
    this.executions.set(run.runId, { execution, abort, promise });
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
        events: [completedEvent(next, now)],
      });
    });
  }

  private async fail(runId: string, value: RunFailureRecord): Promise<void> {
    await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (TERMINAL_STATUSES.has(state.run.status)) return;
      const checkpointValid =
        value.retryable && (await this.checkpointValid(state));
      const now = this.now();
      const next = revise(
        state.run,
        {
          status: checkpointValid ? "interrupted" : "failed",
          recoverability: checkpointValid
            ? "checkpoint"
            : value.retryable
              ? "retryable"
              : "none",
          failure: value,
          terminalAt: checkpointValid ? undefined : now,
        },
        now,
      );
      await this.commit(
        state,
        next,
        checkpointValid ? "interrupted" : "failed",
        {
          execution: executionRecord(next, "failed", now),
          events: [failedEvent(next, now, checkpointValid)],
        },
      );
    });
  }

  private async queuePrompt(
    runId: string,
    behavior: "steer" | "follow-up",
    text: string,
  ): Promise<RunPromptRecord> {
    const prompt = await this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (!ACTIVE_STATUSES.has(state.run.status))
        throw invalid(state.run, behavior);
      const now = this.now();
      const prompt: RunPromptRecord = {
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
        prompts: [prompt],
        events: [queuedPromptEvent(next, prompt)],
      });
      return prompt;
    });
    const execution = this.executions.get(runId)?.execution;
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
          {
            prompts: [delivered],
          },
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
    changes: {
      execution?: RunExecutionRecord;
      prompts?: RunPromptRecord[];
      interactions?: RunInteractionRecord[];
      checkpoints?: RunCheckpointRecord[];
      entries?: ConversationEntry[];
      toolCalls?: ToolCallTranscriptRecord[];
      events?: RunPublicEventIntent[];
    } = {},
  ): Promise<void> {
    const expectedRevision = previous?.run.revision ?? 0;
    const transitionBase = {
      stateEpoch: RUN_STATE_EPOCH,
      transitionId: prefixed("transition", this.ports.ids.next()),
      runId: run.runId,
      scopeId: run.scopeId,
      revision: expectedRevision + 1,
      previousRevision: expectedRevision,
      kind,
      committedAt: run.updatedAt,
      run: { ...run, revision: expectedRevision + 1 },
      execution: changes.execution,
      prompts: changes.prompts ?? [],
      interactions: changes.interactions ?? [],
      checkpoints: changes.checkpoints ?? [],
      entries: changes.entries ?? [],
      toolCalls: changes.toolCalls ?? [],
      events: changes.events ?? [],
    };
    const transition: RunTransitionRecord = {
      ...transitionBase,
      checksum: this.ports.integrity.checksum(transitionBase),
    };
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

  private newRun(
    command: StartRunCommand,
    scopeId: string,
    now: string,
  ): RunRecord {
    return {
      stateEpoch: RUN_STATE_EPOCH,
      conversationId: command.conversationId,
      agentId: command.agentId,
      projectId: command.projectId,
      runId: command.runId ?? prefixed("run", this.ports.ids.next()),
      scopeId,
      revision: 1,
      status: "starting",
      recoverability: "retryable",
      executionId: prefixed("exec", this.ports.ids.next()),
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      cancellationEvidence: [],
    };
  }

  private checkpointRecord(
    state: RunHydratedState,
    command: CheckpointCommand,
  ): RunCheckpointRecord {
    const base = {
      stateEpoch: RUN_STATE_EPOCH,
      checkpointId: prefixed("checkpoint", this.ports.ids.next()),
      parentCheckpointId: state.run.lastCheckpointId,
      conversationId: state.run.conversationId,
      agentId: state.run.agentId,
      projectId: state.run.projectId,
      runId: state.run.runId,
      executionId: state.run.executionId,
      attempt: state.run.attempt,
      boundary: command.boundary,
      transcriptCursor: command.transcriptCursor,
      entryIds: command.entryIds,
      harnessLeafId: command.harnessLeafId,
      harnessSavePointId: command.harnessSavePointId,
      toolCalls: command.toolCalls,
      interactionId: command.interactionId,
      createdAt: this.now(),
      committed: true as const,
    };
    return { ...base, checksum: this.ports.integrity.checksum(base) };
  }

  private interactionRecord(
    run: RunRecord,
    command: WaitCommand,
    checkpoint: RunCheckpointRecord,
  ): RunInteractionRecord {
    const common = {
      stateEpoch: RUN_STATE_EPOCH,
      id:
        command.interactionId ?? prefixed(command.kind, this.ports.ids.next()),
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      executionId: run.executionId,
      toolCallId: command.toolCallId,
      prompt: command.prompt,
      context: command.context,
      status: "pending" as const,
      checkpointId: checkpoint.checkpointId,
      createdAt: this.now(),
    };
    if (command.kind === "question") {
      return {
        ...common,
        kind: "question",
        placeholder: command.placeholder,
        required: command.required !== false,
      };
    }
    if (command.kind === "approval") {
      return {
        ...common,
        kind: "approval",
        risk: command.risk,
        normalizedArgs: command.normalizedArgs,
        offeredScopes: command.offeredScopes,
      };
    }
    return {
      ...common,
      kind: "plan_review",
      planReview: command.planReview,
    };
  }

  private async assertCheckpoint(state: RunHydratedState): Promise<void> {
    if (!(await this.checkpointValid(state))) {
      throw new InvalidCheckpointError(
        `Run ${state.run.runId} has no valid latest checkpoint`,
      );
    }
  }

  private async checkpointValid(state: RunHydratedState): Promise<boolean> {
    const checkpoint = state.checkpoints.find(
      (item) => item.checkpointId === state.run.lastCheckpointId,
    );
    if (
      !checkpoint ||
      checkpoint.stateEpoch !== this.ports.references.stateEpoch()
    )
      return false;
    if (
      checkpoint.runId !== state.run.runId ||
      checkpoint.executionId !== state.run.executionId ||
      checkpoint.attempt !== state.run.attempt ||
      checkpoint.checksum !==
        this.ports.integrity.checksum(checkpointWithoutChecksum(checkpoint))
    )
      return false;
    const latest = state.checkpoints.at(-1);
    if (latest?.checkpointId !== checkpoint.checkpointId) return false;
    const transcript = await this.ports.references.transcript(state.run.runId);
    if (
      transcript.cursor !== checkpoint.transcriptCursor ||
      transcript.harnessLeafId !== checkpoint.harnessLeafId ||
      transcript.harnessSavePointId !== checkpoint.harnessSavePointId ||
      !sameStrings(transcript.entryIds, checkpoint.entryIds)
    )
      return false;
    const tools = await this.ports.references.toolCalls(state.run.runId);
    for (const reference of checkpoint.toolCalls) {
      const tool = tools.find(
        (item) => item.toolCallId === reference.toolCallId,
      );
      if (!tool || tool.lifecycleRevision !== reference.lifecycleRevision)
        return false;
      if (["requested", "running"].includes(tool.status)) return false;
    }
    if (checkpoint.interactionId) {
      const interaction = await this.ports.references.interaction(
        checkpoint.interactionId,
      );
      if (!interaction || interaction.runId !== state.run.runId) return false;
    }
    return true;
  }

  private async cancelTarget(
    target: RunRecord["cancellationEvidence"][number]["target"],
    run: RunRecord,
    reason?: string,
  ) {
    if (target === "model") {
      const live = this.executions.get(run.runId);
      if (live) await live.execution.control.cancel(reason);
      return this.ports.cancellation.cancelModel(run);
    }
    if (target === "tool") return this.ports.cancellation.cancelTools(run);
    if (target === "task") return this.ports.cancellation.cancelTasks(run);
    if (target === "subagent")
      return this.ports.cancellation.cancelSubagents(run);
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

function revise(
  run: RunRecord,
  patch: Partial<RunRecord>,
  updatedAt: string,
): RunRecord {
  return { ...run, ...patch, revision: run.revision + 1, updatedAt };
}

function executionRecord(
  run: RunRecord,
  status: RunExecutionRecord["status"],
  now: string,
): RunExecutionRecord {
  return {
    stateEpoch: RUN_STATE_EPOCH,
    conversationId: run.conversationId,
    agentId: run.agentId,
    projectId: run.projectId,
    runId: run.runId,
    executionId: run.executionId,
    attempt: run.attempt,
    status,
    recoverability: run.recoverability,
    startedAt: run.startedAt ?? run.createdAt,
    completedAt: ["completed", "failed", "cancelled", "superseded"].includes(
      status,
    )
      ? now
      : undefined,
    lastCheckpointId: run.lastCheckpointId,
    failure: run.failure,
  };
}

function intent(
  run: RunRecord,
  type: string,
  occurredAt: string,
  data: Record<string, unknown>,
): RunPublicEventIntent {
  validatePublicEvent(type, data, "workbench_server");
  return {
    id: `${run.runId}/${run.revision}/${type}`,
    type,
    durability: "durable",
    occurredAt,
    data,
  };
}

function startedEvent(run: RunRecord, now: string) {
  return intent(run, "run.started", now, {
    conversationId: run.conversationId,
    agentId: run.agentId,
    projectId: run.projectId,
    runId: run.runId,
    startedAt: now,
  });
}
function completedEvent(run: RunRecord, now: string) {
  return intent(run, "run.completed", now, {
    conversationId: run.conversationId,
    agentId: run.agentId,
    projectId: run.projectId,
    runId: run.runId,
    completedAt: now,
  });
}
function failedEvent(run: RunRecord, now: string, interrupted: boolean) {
  return intent(run, "run.failed", now, {
    conversationId: run.conversationId,
    agentId: run.agentId,
    projectId: run.projectId,
    runId: run.runId,
    message: run.failure?.message ?? "run failed",
    aborted: false,
    interrupted: interrupted || undefined,
    failedAt: now,
  });
}
function retryingEvent(run: RunRecord, now: string) {
  return intent(run, "run.retrying", now, {
    conversationId: run.conversationId,
    agentId: run.agentId,
    projectId: run.projectId,
    runId: run.runId,
    attempt: run.attempt,
    maxRetries: Math.max(run.attempt, 3),
    delayMs: 0,
    retryAt: now,
    errorMessage: run.failure?.message,
  });
}
function queuedPromptEvent(run: RunRecord, prompt: RunPromptRecord) {
  return intent(run, "conversation.prompt.queued", run.updatedAt, {
    conversationId: run.conversationId,
    agentId: run.agentId,
    projectId: run.projectId,
    runId: run.runId,
    queuedPrompt: prompt satisfies QueuedPromptRecord,
  });
}
function checkpointEvent(run: RunRecord, checkpoint: RunCheckpointRecord) {
  return intent(run, "run.checkpointed", checkpoint.createdAt, {
    conversationId: run.conversationId,
    agentId: run.agentId,
    runId: run.runId,
    checkpointId: checkpoint.checkpointId,
    status: sandboxStatus(run),
    checkpointedAt: checkpoint.createdAt,
  });
}
function waitingEvent(run: RunRecord, interaction: RunInteractionRecord) {
  const common = {
    conversationId: run.conversationId,
    agentId: run.agentId,
    runId: run.runId,
    createdAt: interaction.createdAt,
  };
  if (interaction.kind === "question") {
    return intent(run, "run.waiting", interaction.createdAt, {
      ...common,
      waitKind: "input",
      requestId: interaction.id,
      question: { text: interaction.prompt },
      placeholder: interaction.placeholder,
      required: interaction.required,
    });
  }
  if (interaction.kind === "approval") {
    return intent(run, "run.waiting", interaction.createdAt, {
      ...common,
      waitKind: "approval",
      approvalId: interaction.id,
      toolCallId: interaction.toolCallId,
      risk: interaction.risk,
      reason: interaction.prompt,
      normalizedArgs: interaction.normalizedArgs,
      offeredScopes: interaction.offeredScopes,
    });
  }
  return intent(run, "run.waiting", interaction.createdAt, {
    ...common,
    waitKind: "plan_review",
    reviewId: interaction.planReview.id,
    toolCallId: interaction.toolCallId,
    planReview: interaction.planReview,
  });
}
function cancelledEvent(run: RunRecord, now: string) {
  return intent(run, "run.cancelled", now, {
    conversationId: run.conversationId,
    agentId: run.agentId,
    runId: run.runId,
    status: "cancelled",
    cancelledAt: now,
  });
}

function sandboxStatus(run: RunRecord): string {
  if (run.status === "waiting") return "waiting_for_input";
  if (["retrying", "interrupted", "cancellation_failed"].includes(run.status)) {
    return "recoverable_failed";
  }
  if (run.status === "starting") return "queued";
  if (run.status === "cancellation_requested") return "running";
  return run.status;
}

function failure(
  code: string,
  error: unknown,
  retryable: boolean,
): RunFailureRecord {
  return { code, message: errorMessage(error).slice(0, 2_000), retryable };
}
function invalid(run: RunRecord, command: string): InvalidRunStateError {
  return new InvalidRunStateError(
    `Cannot ${command} run ${run.runId} while ${run.status}`,
  );
}
function prefixed(prefix: string, value: string): string {
  return value.startsWith(`${prefix}_`) ? value : `${prefix}_${value}`;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}
function checkpointWithoutChecksum(checkpoint: RunCheckpointRecord) {
  const { checksum, ...rest } = checkpoint;
  void checksum;
  return rest;
}
