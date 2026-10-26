import type { ToolCall, ToolCallOutcome } from "@nervekit/contracts/core";
import type { ToolExecutionResultPayload } from "@nervekit/contracts/tools";

/** Preserve the reviewed snapshot for transcript display, not agent context. */
export function planReviewDisplayResult(
  call: ToolCall,
  outcome: ToolCallOutcome,
  result: ToolExecutionResultPayload,
) {
  const interaction = call.interaction;
  if (
    call.toolName !== "plan_present" ||
    outcome !== "completed" ||
    interaction?.kind !== "plan_review" ||
    !interaction.resolution
  ) {
    return result;
  }
  const { request, resolution } = interaction;
  const review = {
    id: call.id,
    title: request.title,
    summary: request.summary,
    content: request.content,
    planPath: request.path,
    status:
      resolution.decision === "approve" ? "accepted" : "changes_requested",
    feedback: resolution.feedback,
  };
  return {
    ...result,
    details: {
      ...(result.details && typeof result.details === "object"
        ? result.details
        : {}),
      review,
    },
  };
}

/** Stable input identity referencing the captured, reviewed plan file. */
export function planImplementationInput(call: ToolCall) {
  const interaction = call.interaction;
  if (
    call.toolName !== "plan_present" ||
    interaction?.kind !== "plan_review" ||
    interaction.resolution?.decision !== "approve"
  )
    return undefined;
  const { request, resolution } = interaction;
  if (request.content === undefined)
    throw new Error(
      "Captured plan content is unavailable; present the plan again.",
    );
  return {
    conversationId: call.conversationId,
    inputId: `plan-implementation:${JSON.stringify([call.conversationId, call.id])}`,
    source: "user" as const,
    text: `The user has accepted the plan. Please implement it.\n\nPlan file: ${request.path}${resolution.feedback ? `\n\nApproval feedback:\n${resolution.feedback}` : ""}`,
  };
}
