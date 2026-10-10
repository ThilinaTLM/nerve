import type { PlanReviewRecord } from "@nervekit/contracts/plans";

import type {
  ToolCallTranscriptRecord,
  UserQuestionRecord,
} from "$lib/presentation/view-models/conversation";
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
  return toolCalls.flatMap((toolCall) => {
    const interaction = toolCall.interaction;
    if (interaction?.kind !== "approval" || interaction.status !== "pending")
      return [];
    return [
      {
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
        permissionRuleSetId: interaction.request.permissionRuleSetId,
        toolCall,
      },
    ];
  });
}

export function pendingUserQuestions(
  toolCalls: readonly ToolCallTranscriptRecord[],
): UserQuestionRecord[] {
  return toolCalls.flatMap((toolCall) => {
    const interaction = toolCall.interaction;
    if (interaction?.kind !== "user_input" || interaction.status !== "pending")
      return [];
    return [
      {
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
    ];
  });
}

export function pendingPlanReviews(
  toolCalls: readonly ToolCallTranscriptRecord[],
): PlanReviewRecord[] {
  return toolCalls.flatMap((toolCall) => {
    const interaction = toolCall.interaction;
    if (interaction?.kind !== "plan_review" || interaction.status !== "pending")
      return [];
    return [
      {
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
    ];
  });
}
