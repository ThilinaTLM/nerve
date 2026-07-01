import { z } from "zod";
import { resolvePlanReviewRequestSchema } from "../plans/index.js";
import {
  answerUserQuestionRequestSchema,
  dismissUserQuestionRequestSchema,
  resolveApprovalRequestSchema,
} from "../tools/index.js";
import { workspaceSnapshotResponseSchema } from "./snapshot.schema.js";

export const protocolMethodNameSchema = z.enum([
  "snapshot.workspace.get",
  "snapshot.conversation.get",
  "approval.grant",
  "approval.deny",
  "userQuestion.answer",
  "userQuestion.dismiss",
  "planReview.accept",
  "planReview.acceptInNewChat",
  "planReview.requestChanges",
  "planReview.reject",
  "planReview.discard",
]);
export type ProtocolMethodName = z.infer<typeof protocolMethodNameSchema>;

export const protocolMethodKindSchema = z.enum([
  "read",
  "mutation",
  "accepted_async",
]);
export type ProtocolMethodKind = z.infer<typeof protocolMethodKindSchema>;

export const protocolMethodIdempotencySchema = z.enum([
  "none",
  "recommended",
  "required",
]);
export type ProtocolMethodIdempotency = z.infer<
  typeof protocolMethodIdempotencySchema
>;

export interface ProtocolMethodDefinition {
  method: ProtocolMethodName;
  paramsSchema: z.ZodType;
  resultSchema: z.ZodType;
  kind: ProtocolMethodKind;
  idempotency: ProtocolMethodIdempotency;
}

const emptyParamsSchema = z.object({}).optional();
const conversationSnapshotParamsSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
});
const approvalParamsSchema = z
  .object({ approvalId: z.string().startsWith("approval_") })
  .merge(resolveApprovalRequestSchema);
const userQuestionAnswerParamsSchema = z
  .object({ questionId: z.string().startsWith("question_") })
  .merge(answerUserQuestionRequestSchema);
const userQuestionDismissParamsSchema = z
  .object({ questionId: z.string().startsWith("question_") })
  .merge(dismissUserQuestionRequestSchema);
const planReviewParamsSchema = z
  .object({ reviewId: z.string().startsWith("plan_review_") })
  .merge(resolvePlanReviewRequestSchema);

const methodDefinitions = {
  "snapshot.workspace.get": {
    method: "snapshot.workspace.get",
    paramsSchema: emptyParamsSchema,
    resultSchema: workspaceSnapshotResponseSchema,
    kind: "read",
    idempotency: "none",
  },
  "snapshot.conversation.get": {
    method: "snapshot.conversation.get",
    paramsSchema: conversationSnapshotParamsSchema,
    resultSchema: z.object({ snapshot: z.unknown(), cursor: z.unknown() }),
    kind: "read",
    idempotency: "none",
  },
  "approval.grant": {
    method: "approval.grant",
    paramsSchema: approvalParamsSchema,
    resultSchema: z.object({ toolCall: z.unknown() }),
    kind: "mutation",
    idempotency: "recommended",
  },
  "approval.deny": {
    method: "approval.deny",
    paramsSchema: approvalParamsSchema,
    resultSchema: z.object({ toolCall: z.unknown() }),
    kind: "mutation",
    idempotency: "recommended",
  },
  "userQuestion.answer": {
    method: "userQuestion.answer",
    paramsSchema: userQuestionAnswerParamsSchema,
    resultSchema: z.object({ question: z.unknown() }),
    kind: "mutation",
    idempotency: "recommended",
  },
  "userQuestion.dismiss": {
    method: "userQuestion.dismiss",
    paramsSchema: userQuestionDismissParamsSchema,
    resultSchema: z.object({ question: z.unknown() }),
    kind: "mutation",
    idempotency: "recommended",
  },
  "planReview.accept": {
    method: "planReview.accept",
    paramsSchema: planReviewParamsSchema,
    resultSchema: z.object({ planReview: z.unknown() }),
    kind: "mutation",
    idempotency: "recommended",
  },
  "planReview.acceptInNewChat": {
    method: "planReview.acceptInNewChat",
    paramsSchema: planReviewParamsSchema,
    resultSchema: z.object({ planReview: z.unknown() }).passthrough(),
    kind: "mutation",
    idempotency: "recommended",
  },
  "planReview.requestChanges": {
    method: "planReview.requestChanges",
    paramsSchema: planReviewParamsSchema,
    resultSchema: z.object({ planReview: z.unknown() }),
    kind: "mutation",
    idempotency: "recommended",
  },
  "planReview.reject": {
    method: "planReview.reject",
    paramsSchema: planReviewParamsSchema,
    resultSchema: z.object({ planReview: z.unknown() }),
    kind: "mutation",
    idempotency: "recommended",
  },
  "planReview.discard": {
    method: "planReview.discard",
    paramsSchema: planReviewParamsSchema,
    resultSchema: z.object({ planReview: z.unknown() }),
    kind: "mutation",
    idempotency: "recommended",
  },
} as const satisfies Record<ProtocolMethodName, ProtocolMethodDefinition>;

export function protocolMethodDefinition(
  method: ProtocolMethodName,
): ProtocolMethodDefinition {
  return methodDefinitions[method];
}

export function protocolMethodParamsSchema(
  method: ProtocolMethodName,
): z.ZodType {
  return protocolMethodDefinition(method).paramsSchema;
}

export function protocolMethodResultSchema(
  method: ProtocolMethodName,
): z.ZodType {
  return protocolMethodDefinition(method).resultSchema;
}

export function allProtocolMethodDefinitions(): ProtocolMethodDefinition[] {
  return Object.values(methodDefinitions);
}
