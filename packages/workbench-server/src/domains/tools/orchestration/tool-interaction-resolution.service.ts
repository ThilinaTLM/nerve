import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type {
  ResolveToolInteractionRequest,
  ToolCallRecord,
} from "@nervekit/contracts/tools";
import { ApplicationError } from "../../../core/application-error.js";
import type { HumanInputResolutionService } from "../../human-input/index.js";
import type { PlanService } from "../../plans/plan-service.js";
import type { PermissionExceptionService } from "../../permissions/permission-exceptions.service.js";
import type { PermissionPolicyService } from "../../permissions/permission-policy.service.js";
import type { ToolService } from "../execution/tool-service.js";

export class ToolInteractionResolutionService {
  constructor(
    private readonly tools: ToolService,
    private readonly plans: PlanService,
    private readonly humanInput: HumanInputResolutionService,
    private readonly permissionPolicy: PermissionPolicyService,
    private readonly permissionExceptions: PermissionExceptionService,
  ) {}

  async resolve(request: ResolveToolInteractionRequest): Promise<{
    toolCall: ToolCallRecord;
    effect?: {
      kind: "new_conversation";
      conversation: ConversationRecord;
      agent: AgentRecord;
    };
  }> {
    const current = this.tools.getToolCall(request.toolCallId);
    const existing = current.interactions[request.interactionOrdinal];
    if (
      existing?.status === "resolved" &&
      existing.resolutionRequestId === request.resolutionRequestId
    )
      return { toolCall: current };
    if (current.revision !== request.expectedRevision)
      throw new ApplicationError(
        409,
        "TOOL_CALL_REVISION_CONFLICT",
        "The tool call changed before this interaction was resolved.",
      );
    const interaction = current.interactions[request.interactionOrdinal];
    if (
      !interaction ||
      interaction.status !== "pending" ||
      interaction.kind !== request.resolution.kind
    )
      throw new ApplicationError(
        409,
        "TOOL_INTERACTION_CONFLICT",
        "The pending tool interaction no longer matches this request.",
      );

    if (request.resolution.kind === "approval") {
      const durableScope =
        request.resolution.scope === "always_conversation"
          ? "conversation"
          : request.resolution.scope === "always_project"
            ? "project"
            : request.resolution.scope === "always_user" ||
                request.resolution.scope === "always"
              ? "user"
              : undefined;
      if (request.resolution.action === "allow" && durableScope) {
        if (
          interaction.kind !== "approval" ||
          !(
            interaction.request.offeredScopes.includes(
              request.resolution.scope ?? "single_call",
            ) ||
            (request.resolution.scope === "always_user" &&
              interaction.request.offeredScopes.includes("always"))
          ) ||
          (interaction.request.suggestedExceptions.length === 0 &&
            interaction.request.suggestedRules.length === 0)
        )
          throw new ApplicationError(
            400,
            "APPROVAL_SCOPE_NOT_OFFERED",
            "This approval does not offer the requested durable grant scope.",
          );
        if (interaction.request.suggestedRules[0]) {
          if (!interaction.request.permissionRuleSetId)
            throw new ApplicationError(
              400,
              "APPROVAL_RULE_SET_MISSING",
              "This historical approval cannot create a durable rule without its evaluated permission rule set.",
            );
          await this.permissionPolicy.saveRule(
            durableScope,
            interaction.request.permissionRuleSetId,
            interaction.request.suggestedRules[0],
            durableScope === "project"
              ? current.projectId
              : durableScope === "conversation"
                ? current.conversationId
                : undefined,
          );
        } else if (durableScope !== "conversation") {
          await this.permissionExceptions.add(
            current.projectId,
            durableScope,
            interaction.request.suggestedExceptions,
          );
        }
      }
      return {
        toolCall: await this.humanInput.resolveApproval(
          `approval_${current.id}_${interaction.ordinal}`,
          request.resolution.action,
          request.resolution.note,
          request.resolutionRequestId,
          request.resolution.scope,
        ),
      };
    }

    if (request.resolution.kind === "user_input") {
      const id = `question_${current.id}_${interaction.ordinal}`;
      if (request.resolution.action === "answer")
        await this.humanInput.answerUserQuestion(
          id,
          request.resolution.answer ?? "",
          request.resolutionRequestId,
        );
      else
        await this.humanInput.dismissUserQuestion(
          id,
          request.resolution.reason,
          request.resolutionRequestId,
        );
      return { toolCall: this.tools.getToolCall(current.id) };
    }

    await this.tools.resolveInteraction(request);
    const review = this.plans
      .listPlanReviews()
      .find((candidate) => candidate.toolCallId === current.id);
    if (!review)
      throw new ApplicationError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        "Plan review not found.",
      );
    const selection = {
      implementationModel: request.resolution.implementationModel as never,
      implementationThinkingLevel: request.resolution
        .implementationThinkingLevel as never,
      compactBeforeImplementation:
        request.resolution.compactBeforeImplementation,
    };
    if (request.resolution.action === "accept_in_new_chat") {
      const result = await this.humanInput.acceptPlanReviewInNewChat(
        review.id,
        request.resolution.feedback,
        selection,
      );
      return {
        toolCall: this.tools.getToolCall(current.id),
        effect: {
          kind: "new_conversation",
          conversation: result.conversation,
          agent: result.agent,
        },
      };
    }
    if (request.resolution.action === "accept")
      await this.humanInput.acceptPlanReview(
        review.id,
        request.resolution.feedback,
        selection,
      );
    else if (request.resolution.action === "request_changes")
      await this.humanInput.requestPlanChanges(
        review.id,
        request.resolution.feedback,
      );
    else if (request.resolution.action === "reject")
      await this.humanInput.rejectPlanReview(
        review.id,
        request.resolution.feedback,
      );
    else
      await this.humanInput.discardPlanReview(
        review.id,
        request.resolution.feedback,
      );
    return { toolCall: this.tools.getToolCall(current.id) };
  }
}
