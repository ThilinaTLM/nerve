import type {
  CanonicalCheckpoint,
  RunControl,
  WaitGroup,
  WaitGroupMember,
} from "@nervekit/contracts/runs";
import type { ConversationHead } from "@nervekit/contracts/conversations";

export type CheckpointInapplicabilityReason =
  | "owner_mismatch"
  | "generation_mismatch"
  | "selection_mismatch"
  | "run_fenced"
  | "wait_group_mismatch"
  | "member_mismatch"
  | "policy_changed"
  | "snapshot_incompatible"
  | "anchor_not_ancestor"
  | "continuation_head_mismatch"
  | "incompatible_advance";

export type CheckpointApplicability =
  | { kind: "applicable" }
  | { kind: "inapplicable"; reason: CheckpointInapplicabilityReason };

export interface CheckpointApplicabilityInput {
  checkpoint: CanonicalCheckpoint;
  head: ConversationHead;
  run: RunControl;
  group: WaitGroup;
  member: WaitGroupMember;
  expectedInputFingerprint: string;
  expectedPolicyFingerprint?: string;
  policyStillValid: boolean;
  snapshotCompatible: boolean;
  advancesCompatible: boolean;
}

export interface TimelineAncestryPort {
  isAncestor(
    conversationId: string,
    ancestorEntryId: string | null,
    descendantEntryId: string | null,
  ): Promise<boolean>;
}

export async function evaluateCheckpointApplicability(
  input: CheckpointApplicabilityInput,
  ancestry: TimelineAncestryPort,
): Promise<CheckpointApplicability> {
  const { checkpoint, head, run, group, member } = input;
  if (
    checkpoint.conversationId !== head.conversationId ||
    checkpoint.conversationId !== run.conversationId ||
    checkpoint.runId !== run.runId ||
    group.runId !== run.runId ||
    member.waitGroupId !== group.waitGroupId
  ) {
    return { kind: "inapplicable", reason: "owner_mismatch" };
  }
  if (checkpoint.runGeneration !== run.generation) {
    return { kind: "inapplicable", reason: "generation_mismatch" };
  }
  if (
    checkpoint.selectionEpoch !== head.selectionEpoch ||
    run.boundSelectionEpoch !== head.selectionEpoch
  ) {
    return { kind: "inapplicable", reason: "selection_mismatch" };
  }
  if (
    !run.foregroundOwned ||
    [
      "completed",
      "failed",
      "cancelled",
      "abandoned",
      "superseded",
      "deletion_fenced",
    ].includes(run.state)
  ) {
    return { kind: "inapplicable", reason: "run_fenced" };
  }
  if (
    run.waitGroupId !== group.waitGroupId ||
    checkpoint.waitGroupId !== group.waitGroupId ||
    group.state === "closed"
  ) {
    return { kind: "inapplicable", reason: "wait_group_mismatch" };
  }
  if (
    member.inputFingerprint !== input.expectedInputFingerprint ||
    (input.expectedPolicyFingerprint !== undefined &&
      member.policyFingerprint !== input.expectedPolicyFingerprint)
  ) {
    return { kind: "inapplicable", reason: "member_mismatch" };
  }
  if (!input.policyStillValid) {
    return { kind: "inapplicable", reason: "policy_changed" };
  }
  if (!input.snapshotCompatible) {
    return { kind: "inapplicable", reason: "snapshot_incompatible" };
  }
  if (
    run.continuationEntryId !== head.activeEntryId ||
    group.continuationEntryId !== run.continuationEntryId
  ) {
    return { kind: "inapplicable", reason: "continuation_head_mismatch" };
  }
  if (
    !(await ancestry.isAncestor(
      head.conversationId,
      checkpoint.anchorEntryId,
      group.continuationEntryId,
    ))
  ) {
    return { kind: "inapplicable", reason: "anchor_not_ancestor" };
  }
  if (!input.advancesCompatible) {
    return { kind: "inapplicable", reason: "incompatible_advance" };
  }
  return { kind: "applicable" };
}
