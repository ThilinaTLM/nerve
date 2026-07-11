import { agentRecordSchema } from "../agents/index.js";
import { conversationRecordSchema } from "../conversations/index.js";
import {
  planReviewRecordSchema,
  planReviewStatusSchema,
  resolvePlanReviewRequestSchema,
} from "../plans/index.js";
import {
  answerUserQuestionRequestSchema,
  approvalRecordSchema,
  approvalStatusSchema,
  dismissUserQuestionRequestSchema,
  resolveApprovalRequestSchema,
  toolCallRecordSchema,
  toolCallStatusSchema,
  toolCallTranscriptRecordSchema,
  toolDescriptorSchema,
  userQuestionRecordSchema,
  userQuestionStatusSchema,
} from "./index.js";
import { boundedPublicJsonSchema } from "../events/bounded-public-data.schema.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();
const approvalParamsSchema = z
  .object({ approvalId: z.string().startsWith("approval_") })
  .merge(resolveApprovalRequestSchema);
const userQuestionAnswerParamsSchema = z
  .object({ questionId: z.string().min(1).max(256) })
  .merge(answerUserQuestionRequestSchema);
const userQuestionDismissParamsSchema = z
  .object({ questionId: z.string().min(1).max(256) })
  .merge(dismissUserQuestionRequestSchema);
const planReviewParamsSchema = z
  .object({ reviewId: z.string().startsWith("plan_review_") })
  .merge(resolvePlanReviewRequestSchema);
const toolCallListParamsSchema = z
  .object({
    status: toolCallStatusSchema.optional(),
    limit: z.number().int().positive().max(1_000).optional(),
  })
  .optional();
const approvalListParamsSchema = z
  .object({ status: approvalStatusSchema.optional() })
  .optional();
const userQuestionListParamsSchema = z
  .object({ status: userQuestionStatusSchema.optional() })
  .optional();
const planReviewListParamsSchema = z
  .object({ status: planReviewStatusSchema.optional() })
  .optional();
const toolCallIdSchema = z.string().min(1).max(256);
const toolCallGetParamsSchema = z.object({
  toolCallId: toolCallIdSchema,
  conversationId: z.string().startsWith("conv_").optional(),
  agentId: z.string().startsWith("agent_").optional(),
  runId: z.string().startsWith("run_").optional(),
});
const sandboxToolCallDetailsSchema = z.object({
  toolCall: z.object({
    toolCallId: z.string().min(1).max(256),
    conversationId: z.string().startsWith("conv_"),
    agentId: z.string().startsWith("agent_"),
    runId: z.string().startsWith("run_"),
    toolName: z.string().min(1).max(128),
    status: z.string().min(1).max(64),
    args: boundedPublicJsonSchema.optional(),
    result: boundedPublicJsonSchema.optional(),
    error: boundedPublicJsonSchema.optional(),
    requestedAt: z.string().datetime(),
  }),
  argsPreview: boundedPublicJsonSchema.optional(),
  resultPreview: boundedPublicJsonSchema.optional(),
  displayTitle: z.string().max(512).optional(),
  displaySummary: z.string().max(2_048).optional(),
});
const interactionAcceptedResultSchema = z.object({
  accepted: z.literal(true),
  interactionId: z.string().min(1).max(256),
  status: z.enum([
    "queued",
    "answered",
    "dismissed",
    "granted",
    "denied",
    "accepted",
    "changes_requested",
    "discarded",
  ]),
});

export const toolsOperationDefinitions = [
  defineOperation(
    "tool.list",
    emptyParamsSchema,
    z.object({ tools: z.array(toolDescriptorSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.tool.list",
  ),
  defineOperation(
    "toolCall.list",
    toolCallListParamsSchema,
    z.object({ toolCalls: z.array(toolCallTranscriptRecordSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.toolCall.list",
  ),
  defineOperation(
    "toolCall.get",
    toolCallGetParamsSchema,
    z.union([
      z.object({ toolCall: toolCallRecordSchema }),
      sandboxToolCallDetailsSchema,
    ]),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.toolCall.get",
  ),
  defineOperation(
    "approval.list",
    approvalListParamsSchema,
    z.object({ approvals: z.array(approvalRecordSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.approval.list",
  ),
  defineOperation(
    "approval.grant",
    approvalParamsSchema,
    z.union([
      z.object({ toolCall: toolCallRecordSchema }),
      interactionAcceptedResultSchema,
    ]),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.approval.grant",
  ),
  defineOperation(
    "approval.deny",
    approvalParamsSchema,
    z.union([
      z.object({ toolCall: toolCallRecordSchema }),
      interactionAcceptedResultSchema,
    ]),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.approval.deny",
  ),
  defineOperation(
    "userQuestion.list",
    userQuestionListParamsSchema,
    z.object({ questions: z.array(userQuestionRecordSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.userQuestion.list",
  ),
  defineOperation(
    "userQuestion.answer",
    userQuestionAnswerParamsSchema,
    z.union([
      z.object({ question: userQuestionRecordSchema }),
      interactionAcceptedResultSchema,
    ]),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.userQuestion.answer",
  ),
  defineOperation(
    "userQuestion.dismiss",
    userQuestionDismissParamsSchema,
    z.union([
      z.object({ question: userQuestionRecordSchema }),
      interactionAcceptedResultSchema,
    ]),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.userQuestion.dismiss",
  ),
  defineOperation(
    "planReview.list",
    planReviewListParamsSchema,
    z.object({ planReviews: z.array(planReviewRecordSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.planReview.list",
  ),
  defineOperation(
    "planReview.accept",
    planReviewParamsSchema,
    z.union([
      z.object({ planReview: planReviewRecordSchema }),
      interactionAcceptedResultSchema,
    ]),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.planReview.accept",
  ),
  defineOperation(
    "planReview.acceptInNewChat",
    planReviewParamsSchema,
    z.object({
      planReview: planReviewRecordSchema,
      conversation: conversationRecordSchema,
      agent: agentRecordSchema,
    }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.planReview.acceptInNewChat",
  ),
  defineOperation(
    "planReview.requestChanges",
    planReviewParamsSchema,
    z.union([
      z.object({ planReview: planReviewRecordSchema }),
      interactionAcceptedResultSchema,
    ]),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.planReview.requestChanges",
  ),
  defineOperation(
    "planReview.reject",
    planReviewParamsSchema,
    z.object({ planReview: planReviewRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.planReview.reject",
  ),
  defineOperation(
    "planReview.discard",
    planReviewParamsSchema,
    z.union([
      z.object({ planReview: planReviewRecordSchema }),
      interactionAcceptedResultSchema,
    ]),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.planReview.discard",
  ),
] as const;
