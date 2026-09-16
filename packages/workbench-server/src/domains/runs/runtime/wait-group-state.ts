import type { WaitGroup, WaitGroupMember } from "@nervekit/contracts/runs";

const legalExecutionTransitions: Readonly<
  Record<
    WaitGroupMember["executionState"],
    readonly WaitGroupMember["executionState"][]
  >
> = {
  drafted: ["awaiting_approval", "authorized", "denied", "cancelled"],
  awaiting_approval: ["authorized", "denied", "cancelled"],
  authorized: ["executing", "awaiting_approval", "cancelled"],
  executing: [
    "succeeded",
    "known_failed",
    "outcome_unknown",
    "result_unavailable",
    "cancelled",
  ],
  outcome_unknown: [
    "authorized",
    "executing",
    "succeeded",
    "known_failed",
    "result_unavailable",
    "cancelled",
    "closed",
  ],
  result_unavailable: ["executing", "succeeded", "known_failed", "closed"],
  succeeded: ["closed"],
  known_failed: ["closed"],
  denied: ["closed"],
  cancelled: ["closed"],
  closed: [],
};

export function assertWaitGroupMemberTransition(
  current: WaitGroupMember,
  next: WaitGroupMember,
): void {
  if (
    current.memberId !== next.memberId ||
    current.waitGroupId !== next.waitGroupId ||
    current.memberKind !== next.memberKind ||
    current.ownerId !== next.ownerId ||
    current.inputFingerprint !== next.inputFingerprint
  ) {
    throw new Error(
      "Wait-group member identity and immutable inputs cannot change.",
    );
  }
  if (next.revision === current.revision) {
    if (!sameMemberState(current, next)) {
      throw new Error("Wait-group member changes require a new revision.");
    }
    return;
  }
  if (next.revision !== current.revision + 1) {
    throw new Error("Wait-group member revision must advance exactly once.");
  }
  if (
    current.executionState !== next.executionState &&
    !legalExecutionTransitions[current.executionState].includes(
      next.executionState,
    )
  ) {
    throw new Error(
      `Illegal wait-group member transition: ${current.executionState} -> ${next.executionState}.`,
    );
  }
  if (current.contributesToBarrier && !next.contributesToBarrier) {
    throw new Error("A settled wait-group member cannot be reopened.");
  }
  if (
    current.resultEntryId !== undefined &&
    current.resultEntryId !== next.resultEntryId
  ) {
    throw new Error("A canonical result attachment cannot be replaced.");
  }
}

function sameMemberState(
  left: WaitGroupMember,
  right: WaitGroupMember,
): boolean {
  return (
    left.policyFingerprint === right.policyFingerprint &&
    left.executionState === right.executionState &&
    left.attachmentDisposition === right.attachmentDisposition &&
    left.resultEntryId === right.resultEntryId &&
    left.nonDispatchEvidenceId === right.nonDispatchEvidenceId &&
    left.contributesToBarrier === right.contributesToBarrier
  );
}

export function effectiveWaitGroupState(group: WaitGroup): WaitGroup["state"] {
  if (group.state === "closed") return "closed";
  if (
    group.members.some(
      (member) =>
        member.executionState === "outcome_unknown" ||
        member.executionState === "result_unavailable" ||
        member.attachmentDisposition === "outcome_unknown" ||
        member.attachmentDisposition === "result_unavailable",
    )
  ) {
    return "recovery_required";
  }
  if (group.members.every((member) => member.contributesToBarrier)) {
    return group.continuationConsumed ? "closed" : "ready";
  }
  return "open";
}

export function consumeContinuation(group: WaitGroup): WaitGroup {
  if (effectiveWaitGroupState(group) !== "ready") {
    throw new Error("Wait group has no continuation entitlement.");
  }
  return {
    ...group,
    continuationConsumed: true,
    state: "closed",
    revision: group.revision + 1,
  };
}
