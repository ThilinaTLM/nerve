import type { RunInteractionRecord, RunRecord } from "@nervekit/contracts/runs";
import type { IdPort } from "../../../core/ports.js";
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
        { ...commands[0]!.checkpoint, boundary: "suspension" },
        now,
        this.options.ids,
        this.options.integrity,
      );
      const interactions = commands.map((item) =>
        interactionRecord(state.run, item, checkpoint, now, this.options.ids),
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
          interactions: [record],
        });
        return { resolved: record, wake };
      },
    );
    if (wake) await this.options.continueLive(runId);
    return resolved;
  }

  async resolveInteractionBatch(
    runId: string,
    commands: readonly ResolveInteractionCommand[],
  ): Promise<readonly RunInteractionRecord[]> {
    if (commands.length === 0) {
      throw new InvalidRunStateError("Interaction batch must not be empty");
    }
    const { resolved, wake } = await this.options.exclusive(
      `run:${runId}`,
      async (): Promise<{
        resolved: readonly RunInteractionRecord[];
        wake: boolean;
      }> => {
        const state = await this.options.load(runId);
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
          const resolutionHash = this.options.integrity.checksum(
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
          const now = this.options.now();
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
        const now = this.options.now();
        const next = revise(
          state.run,
          { status: "suspended", activeInteractionId: undefined },
          now,
        );
        await this.options.commit(state, next, "interaction_batch_resolved", {
          interactions: [...records],
        });
        return { resolved: records, wake: true };
      },
    );
    if (wake) await this.options.continueLive(runId);
    return resolved;
  }

  async resolveAndCompleteInteraction(
    runId: string,
    command: ResolveInteractionCommand,
    result: Readonly<Record<string, unknown>> = {},
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
          settled.changes,
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
    const first = commands[0]!;
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
}

function invalid(run: RunRecord, command: string): InvalidRunStateError {
  return new InvalidRunStateError(
    `Cannot ${command} run ${run.runId} while ${run.status}`,
  );
}
