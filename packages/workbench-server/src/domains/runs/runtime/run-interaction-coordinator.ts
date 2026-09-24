import type {
  LifecycleWork,
  RunInteractionRecord,
  RunRecord,
} from "@nervekit/contracts/runs";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import type { IdPort } from "../../../core/ports/ids.js";
import { RunEventFactory } from "./run-events.js";
import {
  InvalidRunStateError,
  RunConflictError,
  type ResolveInteractionCommand,
} from "./run-errors.js";
import { completeInteractionResolution } from "./run-settlement.js";
import {
  checkpointRecord,
  interactionRecord,
  revise,
  sameStrings,
  type TransitionChanges,
  type WaitCommand,
} from "./run-transitions.js";
import type { RunHydratedState } from "./run-unit-of-work.js";
import type { RunIntegrityPort } from "./run-execution.js";

export interface RunInteractionCoordinatorOptions {
  readonly ids: IdPort;
  readonly integrity: RunIntegrityPort;
  readonly events: RunEventFactory;
  readonly load: (runId: string) => Promise<RunHydratedState>;
  readonly exclusive: <T>(
    runId: string,
    action: () => Promise<T>,
  ) => Promise<T>;
  readonly now: () => string;
  readonly commit: (
    previous: RunHydratedState,
    run: RunRecord,
    kind: string,
    changes?: TransitionChanges,
  ) => Promise<void>;
  readonly continueLive: (runId: string) => Promise<void>;
  readonly cancelLive: (runId: string, reason: string) => Promise<void>;
  readonly durableContinuation?: boolean;
}

export interface ApprovalDecisionCommand {
  toolCallId: string;
  resolutionRequestId: string;
  resolution: { decision: "allow" | "deny"; note?: string };
  /** The decided tool revision, committed atomically with this transition. */
  toolProjection?: ToolCallRecord;
  /** Whether the final decision creates execute_tool work. */
  releaseWork: boolean;
  /** Context validation read under the run lock (for example, active branch). */
  assertContext?(state: RunHydratedState): Promise<void>;
}

export interface ApprovalDecisionOutcome {
  run: RunRecord;
  checkpointId: string;
  replayed: boolean;
}

/** A decision that conflicts with durable checkpoint state; nothing was written. */
export class ApprovalCheckpointConflictError extends Error {
  constructor(
    readonly code:
      | "RUN_INTERACTION_NOT_FOUND"
      | "APPROVAL_ALREADY_RESOLVED"
      | "RUN_CHECKPOINT_STALE"
      | "RUN_TOOL_REVISION_STALE",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalCheckpointConflictError";
  }
}

/** Checkpoint interactions in the checkpoint's declared member order. */
export function approvalCheckpointMembers(
  state: RunHydratedState,
  checkpointId: string,
): RunInteractionRecord[] {
  const members = state.interactions.filter(
    (item) => item.checkpointId === checkpointId,
  );
  const order = members[0]?.batchToolCallIds;
  if (!order) return members;
  return order.flatMap((toolCallId) => {
    const member = members.find((item) => item.toolCallId === toolCallId);
    return member ? [member] : [];
  });
}

function outcome(
  run: RunRecord,
  checkpointId: string,
  replayed: boolean,
): ApprovalDecisionOutcome {
  return { run, checkpointId, replayed };
}

/** Owns durable wait/resolution state while RunCoordinator owns execution lifecycle. */
export class RunInteractionCoordinator {
  constructor(private readonly options: RunInteractionCoordinatorOptions) {}

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
    return this.options.exclusive(`run:${runId}`, async () => {
      const state = await this.options.load(runId);
      if (state.interactions.some((item) => item.status === "pending")) {
        throw new RunConflictError(
          `Run ${runId} already has a pending interaction`,
        );
      }
      this.assertWaitBatch(commands);
      const now = this.options.now();
      const checkpoint = checkpointRecord(
        state,
        { ...commands[0].checkpoint, boundary: "suspension" },
        now,
        this.options.ids,
        this.options.integrity,
      );
      const interactions = commands.map((item) =>
        interactionRecord(state.run, item, checkpoint, now, this.options.ids),
      );
      const first = interactions[0];
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
      await this.options.commit(state, next, "waiting", {
        interactions,
        checkpoints: [checkpoint],
        events: interactions.map((interaction) =>
          this.options.events.waiting(next, interaction),
        ),
      });
      return interactions;
    });
  }

  async resolveInteraction(
    runId: string,
    command: ResolveInteractionCommand,
    accompanying: Pick<
      TransitionChanges,
      "entries" | "toolCalls" | "lifecycleWork"
    > = {},
  ): Promise<RunInteractionRecord> {
    const { resolved, wake } = await this.options.exclusive(
      `run:${runId}`,
      async (): Promise<{
        resolved: RunInteractionRecord;
        wake: boolean;
      }> => {
        const state = await this.options.load(runId);
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
        const resolutionHash = this.options.integrity.checksum(
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
        const now = this.options.now();
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
        await this.options.commit(state, next, "interaction_resolved", {
          ...accompanying,
          interactions: [record],
          lifecycleWork:
            wake && this.options.durableContinuation
              ? [this.continuationWork(next, now)]
              : accompanying.lifecycleWork,
        });
        return { resolved: record, wake };
      },
    );
    if (wake && !this.options.durableContinuation) {
      await this.options.continueLive(runId);
    }
    return resolved;
  }

  /**
   * Records one approval decision as the authoritative checkpoint transition.
   * A non-final decision creates no work. The final decision moves the run to
   * `executing_tools` and commits one deterministic `execute_tool` item per
   * allowed member in the same transaction. The decision's tool projection is
   * committed atomically with it. Callers never wait for execution.
   */
  async recordApprovalDecision(
    runId: string,
    command: ApprovalDecisionCommand,
  ): Promise<ApprovalDecisionOutcome> {
    return this.options.exclusive(`run:${runId}`, async () => {
      const state = await this.options.load(runId);
      const interaction = state.interactions.find(
        (item) =>
          item.toolCallId === command.toolCallId && item.kind === "approval",
      );
      if (!interaction) {
        throw new ApprovalCheckpointConflictError(
          "RUN_INTERACTION_NOT_FOUND",
          "The approval is not part of this run.",
        );
      }
      const members = approvalCheckpointMembers(
        state,
        interaction.checkpointId,
      );
      const resolutionHash = this.options.integrity.checksum(
        command.resolution,
      );
      if (interaction.status === "resolved") {
        if (interaction.resolutionHash !== resolutionHash) {
          throw new ApprovalCheckpointConflictError(
            "APPROVAL_ALREADY_RESOLVED",
            "Approval was already resolved by another request.",
          );
        }
        return outcome(state.run, interaction.checkpointId, true);
      }
      if (
        interaction.status !== "pending" ||
        state.run.status !== "waiting" ||
        state.run.lastCheckpointId !== interaction.checkpointId
      ) {
        throw new ApprovalCheckpointConflictError(
          "RUN_CHECKPOINT_STALE",
          "The approval checkpoint is no longer active.",
        );
      }
      if (members.some((member) => member.kind !== "approval")) {
        throw new InvalidRunStateError(
          "Approval checkpoints must contain only approval interactions",
        );
      }
      if (
        command.toolProjection &&
        command.toolProjection.revision !== interaction.toolCallRevision + 1
      ) {
        throw new ApprovalCheckpointConflictError(
          "RUN_TOOL_REVISION_STALE",
          "A tool changed after this approval was requested. No tool was executed.",
        );
      }
      await command.assertContext?.(state);
      const now = this.options.now();
      const record: RunInteractionRecord = {
        ...interaction,
        status: "resolved",
        resolutionRequestId: command.resolutionRequestId,
        resolutionHash,
        resolution: command.resolution,
        resolvedAt: now,
      };
      const decided = members.map((member) =>
        member.id === record.id ? record : member,
      );
      const nextPending = decided.find((member) => member.status === "pending");
      const toolProjections = command.toolProjection
        ? [command.toolProjection]
        : [];
      if (nextPending) {
        const next = revise(
          state.run,
          { status: "waiting", activeInteractionId: nextPending.id },
          now,
        );
        await this.options.commit(state, next, "approval_decided", {
          interactions: [record],
          toolProjections,
        });
        return outcome(next, interaction.checkpointId, false);
      }
      const next = revise(
        state.run,
        { status: "executing_tools", activeInteractionId: undefined },
        now,
      );
      await this.options.commit(state, next, "approval_checkpoint_released", {
        interactions: [record],
        toolProjections,
        lifecycleWork: command.releaseWork
          ? decided
              .filter((member) => member.resolution?.decision === "allow")
              .map((member) =>
                this.executeToolWork(next, member.checkpointId, member, now),
              )
          : [],
      });
      return outcome(next, interaction.checkpointId, false);
    });
  }

  /**
   * Resolves a released checkpoint once every member has a terminal tool
   * result: the run becomes `suspended` with continuation work in the same
   * transaction. Returns false (and writes nothing) when another caller
   * already settled it or the run moved on.
   */
  async settleApprovalCheckpoint(
    runId: string,
    checkpointId: string,
    accompanying: Pick<TransitionChanges, "entries" | "toolCalls"> = {},
    assertContext?: (state: RunHydratedState) => Promise<void>,
  ): Promise<boolean> {
    const settled = await this.options.exclusive(`run:${runId}`, async () => {
      const state = await this.options.load(runId);
      if (
        state.run.status !== "executing_tools" ||
        state.run.lastCheckpointId !== checkpointId
      ) {
        return false;
      }
      await assertContext?.(state);
      const now = this.options.now();
      const next = revise(state.run, { status: "suspended" }, now);
      await this.options.commit(state, next, "approval_checkpoint_settled", {
        ...accompanying,
        lifecycleWork: this.options.durableContinuation
          ? [this.continuationWork(next, now)]
          : undefined,
      });
      return true;
    });
    if (settled && !this.options.durableContinuation) {
      await this.options.continueLive(runId);
    }
    return settled;
  }

  private executeToolWork(
    run: RunRecord,
    checkpointId: string,
    interaction: RunInteractionRecord,
    now: string,
  ): LifecycleWork {
    const identity = {
      kind: "execute_tool",
      runId: run.runId,
      checkpointId,
      toolCallId: interaction.toolCallId,
    };
    const inputHash = this.options.integrity.checksum(identity);
    return {
      id: `work_${inputHash.slice("sha256:".length, "sha256:".length + 24)}`,
      deduplicationKey: `approval-exec:${interaction.toolCallId}`,
      conversationId: run.conversationId,
      runId: run.runId,
      proposalId: interaction.toolCallId,
      kind: "execute_tool",
      state: "ready",
      inputHash,
      generation: 0,
      attemptCount: 0,
      notBefore: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  async resolveAndCompleteInteraction(
    runId: string,
    command: ResolveInteractionCommand,
    result: Readonly<Record<string, unknown>> = {},
    accompanying: Pick<
      TransitionChanges,
      "entries" | "toolCalls" | "lifecycleWork"
    > = {},
  ): Promise<RunRecord> {
    const { run: completed, cleanupLive } = await this.options.exclusive(
      `run:${runId}`,
      async () => {
        const state = await this.options.load(runId);
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
        const resolutionHash = this.options.integrity.checksum(
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
        const now = this.options.now();
        const resolved: RunInteractionRecord = {
          ...current,
          status: "resolved",
          resolutionRequestId: command.resolutionRequestId,
          resolutionHash,
          resolution: command.resolution,
          resolvedAt: now,
        };
        const settled = completeInteractionResolution(
          state,
          resolved,
          result,
          now,
          this.options.events,
        );
        await this.options.commit(
          state,
          settled.run,
          "interaction_resolved_completed",
          {
            ...settled.changes,
            entries: [
              ...(accompanying.entries ?? []),
              ...(settled.changes.entries ?? []),
            ],
            toolCalls: [
              ...(accompanying.toolCalls ?? []),
              ...(settled.changes.toolCalls ?? []),
            ],
          },
        );
        return { run: settled.run, cleanupLive: true };
      },
    );

    if (cleanupLive) {
      await this.options.cancelLive(runId, "interaction terminally resolved");
    }
    return completed;
  }

  private assertWaitBatch(commands: readonly WaitCommand[]): void {
    const first = commands[0];
    const firstCheckpointHash = this.options.integrity.checksum({
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
        this.options.integrity.checksum({
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

  private continuationWork(run: RunRecord, now: string): LifecycleWork {
    const identity = {
      runId: run.runId,
      executionId: run.executionId,
      revision: run.revision,
      checkpointId: run.lastCheckpointId,
    };
    return {
      id: `work_${this.options.ids.next()}`,
      deduplicationKey: `${run.runId}:continue_model:${identity.revision}`,
      conversationId: run.conversationId,
      runId: run.runId,
      kind: "continue_model",
      state: "ready",
      modelRequest: {
        command: "continue",
        replayCapability: "non_replayable",
      },
      inputHash: this.options.integrity.checksum(identity),
      generation: 0,
      attemptCount: 0,
      notBefore: now,
      createdAt: now,
      updatedAt: now,
    };
  }
}

function invalid(run: RunRecord, command: string): InvalidRunStateError {
  return new InvalidRunStateError(
    `Cannot ${command} run ${run.runId} while ${run.status}`,
  );
}
