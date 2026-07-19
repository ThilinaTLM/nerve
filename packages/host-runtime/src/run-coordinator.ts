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
import type { ClockPort, DiagnosticPort, IdPort } from "./index.js";
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
import { decideRunRecovery } from "./run-recovery.js";
import {
  completeExecution,
  completeInteractionResolution as settleInteractionResolution,
} from "./run-settlement.js";
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
  interactionRecord,
  newRun,
  prefixed,
  revise,
  sameStrings,
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
  flushEvents(transition: RunTransitionRecord): Promise<void>;
  notify?: RunNotifyEventPort;
  diagnostics?: DiagnosticPort;
  retryPolicy?: RunRetryPolicyPort;
  retryDelay?(delayMs: number, signal: AbortSignal): Promise<void>;
  transitionObserver?: RunTransitionObserverPort;
}

export class RunCoordinator {
  private readonly locks = new KeyedSerialLock();
  private readonly live = new LiveExecutionRegistry();
  private readonly pendingCommits = new Set<Promise<void>>();
  private commitGeneration = 0;
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
    const [interaction] = await this.waitMany(runId, [command]);
    if (!interaction) throw new InvalidRunStateError("Wait was not created");
    return interaction;
  }

  async waitMany(
    runId: string,
    commands: readonly WaitCommand[],
  ): Promise<readonly RunInteractionRecord[]> {
    if (commands.length === 0) {
      throw new InvalidRunStateError("Wait batch must not be empty");
    }
    return this.exclusive(`run:${runId}`, async () => {
      const state = await this.require(runId);
      if (state.interactions.some((item) => item.status === "pending")) {
        throw new RunConflictError(
          `Run ${runId} already has a pending interaction`,
        );
      }
      this.assertWaitBatch(commands);
      const now = this.now();
      const checkpoint = checkpointRecord(
        state,
        { ...commands[0]!.checkpoint, boundary: "suspension" },
        now,
        this.ports.ids,
        this.ports.integrity,
      );
      const interactions = commands.map((command) =>
        interactionRecord(state.run, command, checkpoint, now, this.ports.ids),
      );
      const first = interactions[0]!;
      const next = revise(
        state.run,
        {
          status: "waiting",
          recoverability: "checkpoint",
          activeInteractionId: first.id,
          lastCheckpointId: checkpoint.checkpointId,
        },
        now,
      );
      await this.commit(state, next, "waiting", {
        interactions,
        checkpoints: [checkpoint],
        events: interactions.map((interaction) =>
          this.events.waiting(next, interaction),
        ),
      });
      return interactions;
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
        const checkpointSiblings = state.interactions.filter(
          (item) =>
            item.id !== current.id &&
            item.checkpointId === current.checkpointId,
        );
        if (
          checkpointSiblings.length > 0 &&
          (!current.batchToolCallIds ||
            checkpointSiblings.some(
              (item) =>
                !sameStrings(
                  item.batchToolCallIds ?? [],
                  current.batchToolCallIds ?? [],
                ),
            ))
        ) {
          throw new InvalidRunStateError(
            "Interaction batch metadata does not match",
          );
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
        const pendingSiblings = checkpointSiblings.filter(
          (item) => item.status === "pending",
        );
        const nextPending = current.batchToolCallIds
          ?.map((toolCallId) =>
            pendingSiblings.find((item) => item.toolCallId === toolCallId),
          )
          .find((item) => item !== undefined);
        const wake = pendingSiblings.length === 0;
        const next = revise(
          state.run,
          wake
            ? { status: "suspended", activeInteractionId: undefined }
            : { status: "waiting", activeInteractionId: nextPending?.id },
          now,
        );
        await this.commit(state, next, "interaction_resolved", {
          interactions: [record],
        });
        return { resolved: record, wake };
      },
    );
    // Wake the live execution outside the state lock so control resumption
    // never re-enters coordination. Absent a live execution (e.g. after
    // restart), the run stays resumable via checkpoint-based continue.
    if (wake) await this.live.get(runId)?.execution.control.continue();
    return resolved;
  }

  async resolveInteractionBatch(
    runId: string,
    commands: readonly ResolveInteractionCommand[],
  ): Promise<readonly RunInteractionRecord[]> {
    if (commands.length === 0) {
      throw new InvalidRunStateError("Interaction batch must not be empty");
    }
    const { resolved, wake } = await this.exclusive(
      `run:${runId}`,
      async (): Promise<{
        resolved: readonly RunInteractionRecord[];
        wake: boolean;
      }> => {
        const state = await this.require(runId);
        const selected = commands.map((command) => {
          const interaction = state.interactions.find(
            (item) => item.id === command.interactionId,
          );
          if (!interaction || interaction.runId !== runId) {
            throw new InvalidRunStateError(
              "Interaction does not belong to run",
            );
          }
          return { command, interaction };
        });
        this.assertResolutionBatch(
          state,
          selected.map(({ interaction }) => interaction),
        );

        const records = selected.map(({ command, interaction }) => {
          const resolutionHash = this.ports.integrity.checksum(
            command.resolution,
          );
          if (interaction.status === "resolved") {
            if (interaction.resolutionHash !== resolutionHash) {
              throw new RunConflictError("Conflicting interaction resolution");
            }
            return interaction;
          }
          if (interaction.status !== "pending") {
            throw invalid(state.run, "resolve interaction batch");
          }
          const now = this.now();
          return {
            ...interaction,
            status: "resolved" as const,
            resolutionRequestId: command.resolutionRequestId,
            resolutionHash,
            resolution: command.resolution,
            resolvedAt: now,
          } satisfies RunInteractionRecord;
        });
        if (
          selected.every(({ interaction }) => interaction.status === "resolved")
        ) {
          return { resolved: records, wake: false };
        }
        if (
          selected.some(({ interaction }) => interaction.status !== "pending")
        ) {
          throw new RunConflictError("Partially resolved interaction batch");
        }
        const now = this.now();
        const next = revise(
          state.run,
          { status: "suspended", activeInteractionId: undefined },
          now,
        );
        await this.commit(state, next, "interaction_batch_resolved", {
          interactions: [...records],
        });
        return { resolved: records, wake: true };
      },
    );
    if (wake) await this.live.get(runId)?.execution.control.continue();
    return resolved;
  }

  async resolveAndCompleteInteraction(
    runId: string,
    command: ResolveInteractionCommand,
    result: Readonly<Record<string, unknown>> = {},
  ): Promise<RunRecord> {
    const { run: completed, cleanupLive } = await this.exclusive(
      `run:${runId}`,
      async () => {
        const state = await this.require(runId);
        const current = state.interactions.find(
          (item) => item.id === command.interactionId,
        );
        if (!current || current.runId !== runId) {
          throw new InvalidRunStateError("Interaction does not belong to run");
        }
        if (
          state.interactions.some(
            (item) =>
              item.id !== current.id &&
              item.checkpointId === current.checkpointId &&
              item.status === "pending",
          )
        ) {
          throw new InvalidRunStateError(
            "Pending sibling interactions prevent terminal resolution",
          );
        }
        const resolutionHash = this.ports.integrity.checksum(
          command.resolution,
        );
        if (current.status === "resolved") {
          if (current.resolutionHash !== resolutionHash) {
            throw new RunConflictError("Conflicting interaction resolution");
          }
          if (state.run.status === "completed") {
            return { run: state.run, cleanupLive: false };
          }
          throw invalid(state.run, "terminally resolve interaction");
        }
        if (current.status !== "pending") {
          throw invalid(state.run, "terminally resolve interaction");
        }
        const now = this.now();
        const resolved: RunInteractionRecord = {
          ...current,
          status: "resolved",
          resolutionRequestId: command.resolutionRequestId,
          resolutionHash,
          resolution: command.resolution,
          resolvedAt: now,
        };
        const settled = settleInteractionResolution(
          state,
          resolved,
          result,
          now,
          this.events,
        );
        await this.commit(
          state,
          settled.run,
          "interaction_resolved_completed",
          settled.changes,
        );
        return { run: settled.run, cleanupLive: true };
      },
    );

    const live = cleanupLive ? this.live.get(runId) : undefined;
    if (live) {
      live.abort.abort("interaction terminally resolved");
      try {
        await live.execution.control.cancel("interaction terminally resolved");
      } catch (error) {
        this.ports.diagnostics?.warn(
          "terminal interaction live execution cleanup failed",
          { runId, error: errorMessage(error) },
        );
      }
    }
    return completed;
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
          const status = await cancelRunTarget(
            target,
            requested,
            this.ports.cancellation,
            execution,
            reason,
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

  private assertWaitBatch(commands: readonly WaitCommand[]): void {
    const first = commands[0]!;
    const firstCheckpointHash = this.ports.integrity.checksum({
      ...first.checkpoint,
      boundary: "suspension",
    });
    const batchToolCallIds = first.batchToolCallIds;
    if (commands.length > 1 && !batchToolCallIds) {
      throw new InvalidRunStateError(
        "Multi-wait commands require batch tool-call IDs",
      );
    }
    if (
      batchToolCallIds &&
      (batchToolCallIds.length < 2 || batchToolCallIds.length > 32)
    ) {
      throw new InvalidRunStateError("Invalid interaction batch size");
    }
    const commandToolCallIds = new Set<string>();
    const interactionIds = new Set<string>();
    for (const command of commands) {
      if (
        this.ports.integrity.checksum({
          ...command.checkpoint,
          boundary: "suspension",
        }) !== firstCheckpointHash
      ) {
        throw new InvalidRunStateError(
          "Wait commands must share one suspension checkpoint",
        );
      }
      if (
        !sameStrings(command.batchToolCallIds ?? [], batchToolCallIds ?? [])
      ) {
        throw new InvalidRunStateError(
          "Wait commands must share ordered batch tool-call IDs",
        );
      }
      if (commandToolCallIds.has(command.toolCallId)) {
        throw new InvalidRunStateError("Duplicate wait tool-call ID");
      }
      commandToolCallIds.add(command.toolCallId);
      if (command.interactionId) {
        if (interactionIds.has(command.interactionId)) {
          throw new InvalidRunStateError("Duplicate wait interaction ID");
        }
        interactionIds.add(command.interactionId);
      }
      if (batchToolCallIds && !batchToolCallIds.includes(command.toolCallId)) {
        throw new InvalidRunStateError(
          "Wait tool call is not a member of its batch",
        );
      }
    }
    if (
      batchToolCallIds &&
      new Set(batchToolCallIds).size !== batchToolCallIds.length
    ) {
      throw new InvalidRunStateError("Duplicate batch tool-call ID");
    }
  }

  private assertResolutionBatch(
    state: RunHydratedState,
    interactions: readonly RunInteractionRecord[],
  ): void {
    const first = interactions[0]!;
    const selectedIds = interactions.map((interaction) => interaction.id);
    if (new Set(selectedIds).size !== selectedIds.length) {
      throw new InvalidRunStateError("Duplicate interaction resolution");
    }
    if (
      interactions.some(
        (interaction) => interaction.checkpointId !== first.checkpointId,
      )
    ) {
      throw new InvalidRunStateError(
        "Interaction batch must share one checkpoint",
      );
    }
    const batchToolCallIds = first.batchToolCallIds;
    if (
      interactions.some(
        (interaction) =>
          !sameStrings(
            interaction.batchToolCallIds ?? [],
            batchToolCallIds ?? [],
          ),
      )
    ) {
      throw new InvalidRunStateError(
        "Interaction batch metadata does not match",
      );
    }
    const checkpointInteractions = state.interactions.filter(
      (interaction) => interaction.checkpointId === first.checkpointId,
    );
    const expected = batchToolCallIds
      ? batchToolCallIds.flatMap((toolCallId) => {
          const interaction = checkpointInteractions.find(
            (candidate) => candidate.toolCallId === toolCallId,
          );
          return interaction ? [interaction] : [];
        })
      : checkpointInteractions;
    if (
      !sameStrings(
        selectedIds,
        expected.map((interaction) => interaction.id),
      )
    ) {
      throw new InvalidRunStateError(
        "All checkpoint interactions must be resolved together in order",
      );
    }
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
