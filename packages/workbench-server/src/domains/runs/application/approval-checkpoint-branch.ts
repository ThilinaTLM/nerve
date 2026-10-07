import { ApplicationError } from "../../../core/application-error.js";
import type { RunHydratedState } from "../runtime/index.js";
import type { ConversationEntry } from "@nervekit/contracts/conversations";

// Checkpoints contain entries committed through the run transition journal.
// Other durable paths can append entries to the same model transcript between
// those transitions (for example, a completed tool result). The checkpoint
// must therefore be an ordered subsequence of the active branch and still own
// its tip; requiring a contiguous suffix incorrectly marks those runs stale.
export function activeBranchEndsWithCheckpointResults(
  activeIds: readonly string[],
  checkpointIds: readonly string[],
  entries: readonly ConversationEntry[],
  runId: string,
  memberIds: readonly string[],
): boolean {
  const ids = [...activeIds];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const members = new Set(memberIds);
  while (ids.length) {
    const tail = byId.get(ids.at(-1)!);
    const toolRecordId = (
      tail?.details as { toolRecordId?: string } | undefined
    )?.toolRecordId;
    if (tail?.runId !== runId || !toolRecordId || !members.has(toolRecordId)) {
      break;
    }
    ids.pop();
  }
  return activeBranchEndsWithCheckpoint(ids, checkpointIds);
}

export function activeBranchEndsWithCheckpoint(
  activeBranchEntryIds: readonly string[],
  checkpointEntryIds: readonly string[],
): boolean {
  if (checkpointEntryIds.length === 0 || activeBranchEntryIds.length === 0)
    return false;
  if (checkpointEntryIds.at(-1) !== activeBranchEntryIds.at(-1)) return false;

  let checkpointIndex = 0;
  for (const entryId of activeBranchEntryIds) {
    if (entryId === checkpointEntryIds[checkpointIndex]) checkpointIndex += 1;
  }
  return checkpointIndex === checkpointEntryIds.length;
}

export function activeBranchEntryIds(
  entries: readonly ConversationEntry[],
  activeEntryId: string | undefined,
): string[] {
  if (!activeEntryId) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ids: string[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined = activeEntryId;
  while (cursor) {
    if (visited.has(cursor)) return [];
    visited.add(cursor);
    const entry = byId.get(cursor);
    if (!entry) return [];
    ids.push(entry.id);
    cursor = entry.parentEntryId;
  }
  return ids.reverse();
}

export function assertApprovalCheckpointBranch(
  state: RunHydratedState,
  checkpointId: string | undefined,
  entries: ConversationEntry[],
  activeEntryId: string | null | undefined,
): void {
  const checkpoint = state.checkpoints.find(
    (candidate) => candidate.checkpointId === checkpointId,
  );
  if (!checkpoint) {
    throw new ApplicationError(
      409,
      "RUN_CHECKPOINT_STALE",
      "The approval checkpoint is no longer active.",
    );
  }
  const currentEntryIds = activeBranchEntryIds(
    entries,
    activeEntryId ?? undefined,
  );
  // Result entries may have been appended before a crash between recording
  // member results and the checkpoint settlement transition. Only results
  // for this run's checkpoint members may extend its original branch tip.
  const memberIds = state.interactions
    .filter((item) => item.checkpointId === checkpointId)
    .map((item) => item.toolCallId);
  if (
    !activeBranchEndsWithCheckpointResults(
      currentEntryIds,
      checkpoint.entryIds,
      entries,
      state.run.runId,
      memberIds,
    )
  ) {
    throw new ApplicationError(
      409,
      "RUN_CHECKPOINT_STALE",
      "The conversation changed after this approval was requested. No tool was executed.",
    );
  }
}
