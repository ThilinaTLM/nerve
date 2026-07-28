import type { RunHydratedState } from "./run-unit-of-work.js";
import type { RunCheckpointReferencePort } from "./run-unit-of-work.js";
import {
  checkpointWithoutChecksum,
  type IntegrityPort,
  sameStrings,
} from "./run-transitions.js";

export class InvalidCheckpointError extends Error {
  readonly code = "INVALID_CHECKPOINT";
}

/**
 * Validate that the run's latest checkpoint is complete and its declared
 * references match durable transcript, tool-call, and interaction state.
 * This is the only gate that authorizes a checkpoint-based continue/resume.
 */
export async function checkpointValid(
  state: RunHydratedState,
  references: RunCheckpointReferencePort,
  integrity: IntegrityPort,
): Promise<boolean> {
  const checkpoint = state.checkpoints.find(
    (item) => item.checkpointId === state.run.lastCheckpointId,
  );
  if (!checkpoint || checkpoint.stateEpoch !== references.stateEpoch()) {
    return false;
  }
  if (
    checkpoint.runId !== state.run.runId ||
    checkpoint.executionId !== state.run.executionId ||
    checkpoint.attempt !== state.run.attempt ||
    checkpoint.checksum !==
      integrity.checksum(checkpointWithoutChecksum(checkpoint))
  ) {
    return false;
  }
  const latest = state.checkpoints.at(-1);
  if (latest?.checkpointId !== checkpoint.checkpointId) return false;
  const interaction = checkpoint.interactionId
    ? await references.interaction(checkpoint.interactionId)
    : undefined;
  if (
    checkpoint.interactionId &&
    (!interaction || interaction.runId !== state.run.runId)
  ) {
    return false;
  }
  const resolvingInteraction = interaction?.status === "resolved";
  const transcript = await references.transcript(state.run.runId);
  const transcriptMatches = resolvingInteraction
    ? transcript.cursor >= checkpoint.transcriptCursor &&
      sameStrings(
        transcript.entryIds.slice(0, checkpoint.entryIds.length),
        checkpoint.entryIds,
      )
    : transcript.cursor === checkpoint.transcriptCursor &&
      transcript.harnessLeafId === checkpoint.harnessLeafId &&
      transcript.harnessSavePointId === checkpoint.harnessSavePointId &&
      sameStrings(transcript.entryIds, checkpoint.entryIds);
  if (!transcriptMatches) return false;
  const tools = await references.toolCalls(state.run.runId);
  for (const reference of checkpoint.toolCalls) {
    const tool = tools.find((item) => item.toolCallId === reference.toolCallId);
    if (
      !tool ||
      (resolvingInteraction
        ? tool.lifecycleRevision < reference.lifecycleRevision
        : tool.lifecycleRevision !== reference.lifecycleRevision)
    ) {
      return false;
    }
    if (["requested", "running"].includes(tool.status)) return false;
  }
  return true;
}

export async function assertCheckpoint(
  state: RunHydratedState,
  references: RunCheckpointReferencePort,
  integrity: IntegrityPort,
): Promise<void> {
  if (!(await checkpointValid(state, references, integrity))) {
    throw new InvalidCheckpointError(
      `Run ${state.run.runId} has no valid latest checkpoint`,
    );
  }
}
