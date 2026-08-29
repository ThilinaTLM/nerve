import type { PlanReviewRecord } from "@nervekit/contracts/plans";
import type {
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "@nervekit/contracts/tools";
import type { ApprovalWithToolCall } from "$lib/presentation/state/tool-types";

function approvalScopes(
  scopes: readonly string[],
): Array<
  "single_call" | "always_conversation" | "always_project" | "always_user"
> {
  return [
    ...new Set(
      scopes.map((scope) => (scope === "always" ? "always_user" : scope)),
    ),
  ].filter(
    (
      scope,
    ): scope is
      | "single_call"
      | "always_conversation"
      | "always_project"
      | "always_user" =>
      scope === "single_call" ||
      scope === "always_conversation" ||
      scope === "always_project" ||
      scope === "always_user",
  );
}

export function pendingApprovals(
  toolCalls: readonly ToolCallTranscriptRecord[],
): ApprovalWithToolCall[] {
  return toolCalls.flatMap((toolCall) =>
    toolCall.interactions.flatMap((interaction) =>
      interaction.kind === "approval" && interaction.status === "pending"
        ? [
            {
              id: `approval_${toolCall.id}_${interaction.ordinal}`,
              toolCallId: toolCall.id,
              agentId: toolCall.agentId,
              conversationId: toolCall.conversationId,
              projectId: toolCall.projectId,
              risk: interaction.request.risk,
              reason: interaction.request.reason,
              status: "pending" as const,
              requestedAt: interaction.requestedAt,
              offeredScopes: approvalScopes(interaction.request.offeredScopes),
              suggestedExceptions: interaction.request.suggestedExceptions,
              suggestedRules: interaction.request.suggestedRules,
              toolCall,
            },
          ]
        : [],
    ),
  );
}

export function pendingUserQuestions(
  toolCalls: readonly ToolCallTranscriptRecord[],
): UserQuestionRecord[] {
  return toolCalls.flatMap((toolCall) =>
    toolCall.interactions.flatMap((interaction) =>
      interaction.kind === "user_input" && interaction.status === "pending"
        ? [
            {
              id: `question_${toolCall.id}_${interaction.ordinal}`,
              toolCallId: toolCall.id,
              agentId: toolCall.agentId,
              conversationId: toolCall.conversationId,
              projectId: toolCall.projectId,
              question: interaction.request.question,
              context: interaction.request.context,
              recommendation: interaction.request.recommendation,
              status: "pending" as const,
              requestedAt: interaction.requestedAt,
              updatedAt: interaction.updatedAt,
            },
          ]
        : [],
    ),
  );
}

export function pendingPlanReviews(
  toolCalls: readonly ToolCallTranscriptRecord[],
): PlanReviewRecord[] {
  return toolCalls.flatMap((toolCall) =>
    toolCall.interactions.flatMap((interaction) =>
      interaction.kind === "plan_review" && interaction.status === "pending"
        ? [
            {
              id: `plan_review_${toolCall.id}_${interaction.ordinal}`,
              toolCallId: toolCall.id,
              agentId: toolCall.agentId,
              conversationId: toolCall.conversationId,
              projectId: toolCall.projectId,
              slug: interaction.request.slug,
              title: interaction.request.title,
              summary: interaction.request.summary,
              planPath: interaction.request.planPath,
              status: "pending" as const,
              requestedAt: interaction.requestedAt,
              updatedAt: interaction.updatedAt,
            },
          ]
        : [],
    ),
  );
}

export function interactionAddress(id: string): {
  toolCallId: string;
  ordinal: number;
} {
  const marker = id.indexOf("tool_");
  const separator = id.lastIndexOf("_");
  if (marker < 0 || separator <= marker)
    throw new Error("Invalid tool interaction address.");
  const ordinal = Number(id.slice(separator + 1));
  if (!Number.isInteger(ordinal) || ordinal < 0)
    throw new Error("Invalid tool interaction ordinal.");
  return { toolCallId: id.slice(marker, separator), ordinal };
}
