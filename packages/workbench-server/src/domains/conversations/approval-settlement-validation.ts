import type { ApprovalSettlement } from "@nervekit/contracts/conversations";
import type { RunRecord } from "@nervekit/contracts/runs";
import type { ToolCallRecord } from "@nervekit/contracts/tools";

const allowed: Record<
  ApprovalSettlement["phase"],
  readonly ApprovalSettlement["phase"][]
> = {
  awaiting_decisions: ["awaiting_decisions", "ready", "blocked", "cancelled"],
  ready: ["executing", "blocked", "cancelled"],
  executing: [
    "executing",
    "continuation_pending",
    "completed",
    "blocked",
    "cancelled",
  ],
  continuation_pending: [
    "continuation_pending",
    "completed",
    "blocked",
    "cancelled",
  ],
  blocked: ["cancelled"],
  completed: [],
  cancelled: [],
};

/** Reject invalid state at the aggregate boundary, regardless of the writer. */
export function validateApprovalSettlement(
  value: ApprovalSettlement,
  previous: ApprovalSettlement | undefined,
  run: RunRecord | undefined,
  toolCall: (id: string) => ToolCallRecord | undefined,
): void {
  if (value.revision !== (previous?.revision ?? 0) + 1)
    throw new Error("Approval settlement revision conflict.");
  if (previous) {
    if (
      previous.runId !== value.runId ||
      previous.executionId !== value.executionId ||
      previous.checkpointId !== value.checkpointId ||
      previous.conversationId !== value.conversationId ||
      JSON.stringify(previous.toolCallIds) !== JSON.stringify(value.toolCallIds)
    )
      throw new Error("Approval settlement identity changed.");
    if (!allowed[previous.phase].includes(value.phase))
      throw new Error("Invalid approval settlement phase transition.");
  } else if (
    !["awaiting_decisions", "ready", "blocked"].includes(value.phase)
  ) {
    throw new Error("Invalid initial approval settlement phase.");
  }
  for (const id of value.toolCallIds) {
    const tool = toolCall(id);
    if (
      !tool ||
      tool.conversationId !== value.conversationId ||
      tool.runId !== value.runId
    )
      throw new Error("Approval settlement tool ownership mismatch.");
    if (
      ["continuation_pending", "completed"].includes(value.phase) &&
      !["completed", "failed", "denied", "cancelled"].includes(tool.status)
    )
      throw new Error("Approval settlement requires terminal batch members.");
  }
  if (!value.runId || value.phase === "cancelled") return;
  if (!run || run.conversationId !== value.conversationId)
    throw new Error("Approval settlement run is missing.");
  if (value.phase === "completed") {
    if (
      run.executionId === value.executionId ||
      run.approvalSettlementId ||
      !["running", "starting"].includes(run.status)
    ) {
      throw new Error(
        "Approval completion must atomically transfer continuation ownership.",
      );
    }
    return;
  }
  const expected =
    value.phase === "awaiting_decisions"
      ? "waiting"
      : value.phase === "continuation_pending"
        ? "suspended"
        : "settling";
  if (
    run.status !== expected ||
    run.executionId !== value.executionId ||
    run.lastCheckpointId !== value.checkpointId ||
    run.approvalSettlementId !== value.id
  ) {
    throw new Error("Approval settlement and run state are inconsistent.");
  }
}
