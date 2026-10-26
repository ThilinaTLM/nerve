import { z } from "zod";
import {
  planReviewResolutionSchema,
  profileTargetSchema,
} from "../agent-configuration/agent-configuration-operations.js";
import { agentMutationSchema } from "../agent-configuration/resolver.js";
import { toolRiskSchema } from "../permissions/permissions.js";
import {
  configurationDiagnosticSchema,
  sha256HexSchema,
} from "../agent-configuration/schemas.js";

/** Content-bound approval, not a reusable authorization to execute. No secrets or
 * executor captures are persisted here. The host owns canonicalization/hashing. */
export const toolApprovalBindingSchema = z.strictObject({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  argumentsDigest: sha256HexSchema,
  executionTargetDigest: sha256HexSchema,
  policyAuthorityDigest: sha256HexSchema,
});
export type ToolApprovalBinding = z.infer<typeof toolApprovalBindingSchema>;

/** Live dependency versions. Keys identify host-owned configuration, account,
 * trust, discovery or policy dependencies; versions are process-local. */
export const configurationGenerationVectorSchema = z.record(
  z.string().min(1),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
);
/** Transient core/host admission seam; never persist an executor capture. */
export const toolAdmissionEvidenceSchema = z.strictObject({
  binding: toolApprovalBindingSchema,
  requestGenerations: configurationGenerationVectorSchema,
  policyGenerations: configurationGenerationVectorSchema,
});
export type ConfigurationGenerationVector = z.infer<
  typeof configurationGenerationVectorSchema
>;
export type ToolAdmissionEvidence = z.infer<typeof toolAdmissionEvidenceSchema>;

/** Evidence equality only: the final gate must still evaluate current policy,
 * respect denial and synchronously verify current dependency generations. */
export function toolApprovalBindingMatches(
  approved: ToolApprovalBinding | undefined,
  current: ToolApprovalBinding,
): boolean {
  return (
    approved !== undefined &&
    approved.toolCallId === current.toolCallId &&
    approved.toolName === current.toolName &&
    approved.argumentsDigest === current.argumentsDigest &&
    approved.executionTargetDigest === current.executionTargetDigest &&
    approved.policyAuthorityDigest === current.policyAuthorityDigest
  );
}

export const toolCallStateSchema = z.enum([
  "supervising",
  "awaiting_approval",
  "ready",
  "running",
  "awaiting_input",
]);
export const toolCallOriginSchema = z.enum(["model", "user"]);
export const supervisionSchema = z.strictObject({
  decision: z.enum(["allow", "approval", "deny"]),
  /** Written only when approval is granted, never merely when requested. */
  approval: toolApprovalBindingSchema.optional(),
  reason: z.string().optional(),
  effectiveRisk: toolRiskSchema.optional(),
  matchedRule: z.json().optional(),
  suggestedRules: z.array(z.json()),
  authority: z.json(),
});
export const userInputAnswerSchema = z.object({
  option: z.string().optional(),
  text: z.string().optional(),
});
export const configurationBlockedResolutionSchema = z.strictObject({
  kind: z.literal("configuration_blocked"),
  decision: z.enum(["retry", "cancel"]),
});
export const configurationBlockedRequestSchema = z.strictObject({
  diagnostics: z.array(configurationDiagnosticSchema).min(1),
});
export const configurationBlockedInteractionSchema = z.strictObject({
  kind: z.literal("configuration_blocked"),
  request: configurationBlockedRequestSchema,
  resolution: configurationBlockedResolutionSchema.optional(),
  resolutionRequestId: z.string().min(1).optional(),
});
export type ConfigurationBlockedResolution = z.infer<
  typeof configurationBlockedResolutionSchema
>;
export type ConfigurationBlockedRequest = z.infer<
  typeof configurationBlockedRequestSchema
>;
export type ConfigurationBlockedInteraction = z.infer<
  typeof configurationBlockedInteractionSchema
>;

export const interactionResolutionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("approval"),
    decision: z.enum(["approve", "deny"]),
    persistScope: z.enum(["conversation", "project", "user"]).optional(),
  }),
  z.object({
    kind: z.literal("user_input"),
    answers: z.record(
      z.string(),
      z.union([z.string(), z.array(z.string()), userInputAnswerSchema]),
    ),
    dismissed: z.literal(true).optional(),
  }),
  planReviewResolutionSchema,
  configurationBlockedResolutionSchema,
]);
export const approvalRequestSchema = z.object({
  reason: z.string(),
  suggestedRules: z.array(z.json()),
});
export const userInputOptionSchema = z.object({
  label: z.string().min(1).max(200),
  description: z.string().optional(),
  recommended: z.boolean().optional(),
});
export const userInputQuestionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/),
  question: z.string(),
  context: z.string().optional(),
  recommendation: z.string().optional(),
  options: z
    .array(userInputOptionSchema)
    .max(6)
    .superRefine((options, ctx) => {
      if (
        new Set(options.map((option) => option.label)).size !== options.length
      )
        ctx.addIssue({
          code: "custom",
          message: "Option labels must be unique",
        });
      if (options.filter((option) => option.recommended).length > 1)
        ctx.addIssue({
          code: "custom",
          message: "Only one option may be recommended",
        });
    })
    .optional(),
});
export const userInputRequestSchema = z.object({
  questions: z
    .array(userInputQuestionSchema)
    .min(1)
    .max(5)
    .superRefine((questions, ctx) => {
      if (
        new Set(questions.map((question) => question.id)).size !==
        questions.length
      )
        ctx.addIssue({
          code: "custom",
          message: "Question ids must be unique",
        });
    }),
});

function normalizeUserInputShape(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const request = value as Record<string, unknown>;
  if (Array.isArray(request.questions)) {
    return {
      ...request,
      questions: request.questions.map((question, index) =>
        question && typeof question === "object" && !Array.isArray(question)
          ? {
              ...question,
              id:
                (question as Record<string, unknown>).id === undefined
                  ? `q${index + 1}`
                  : (question as Record<string, unknown>).id,
            }
          : question,
      ),
    };
  }
  if (!("questions" in request) && typeof request.question === "string")
    return { questions: [{ ...request, id: "answer" }] };
  return value;
}

export function normalizeUserInputRequest(value: unknown): UserInputRequest {
  return userInputRequestSchema.parse(normalizeUserInputShape(value));
}
export const planReviewRequestSchema = z.strictObject({
  targetProfile: profileTargetSchema,
  expectedRevision: agentMutationSchema.shape.expectedRevision,
  expectedDigest: agentMutationSchema.shape.expectedDigest,
  assetId: z.string(),
  path: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
});
export const interactionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("approval"),
    request: approvalRequestSchema,
    resolution: interactionResolutionSchema.options[0].optional(),
    resolutionRequestId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("user_input"),
    request: z.preprocess(normalizeUserInputShape, userInputRequestSchema),
    resolution: interactionResolutionSchema.options[1].optional(),
    resolutionRequestId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("plan_review"),
    request: planReviewRequestSchema,
    resolution: interactionResolutionSchema.options[2].optional(),
    resolutionRequestId: z.string().optional(),
  }),
  configurationBlockedInteractionSchema,
]);
export const toolCallSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    turnId: z.string(),
    providerCallId: z.string().nullable(),
    assistantEventId: z.string().nullable(),
    contentIndex: z.number().int().nonnegative().nullable(),
    origin: toolCallOriginSchema,
    toolName: z.string(),
    arguments: z.record(z.string(), z.json()),
    state: toolCallStateSchema,
    supervision: supervisionSchema.nullable(),
    interaction: interactionSchema.nullable(),
    executionClaim: z.string().nullable(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((call, ctx) => {
    const approval = call.supervision?.approval;
    if (
      approval &&
      (approval.toolCallId !== call.id || approval.toolName !== call.toolName)
    )
      ctx.addIssue({
        code: "custom",
        path: ["supervision", "approval"],
        message: "Approval binding belongs to a different tool call",
      });
    if (
      call.interaction?.kind === "configuration_blocked" &&
      !call.interaction.resolution &&
      call.state !== "awaiting_input"
    )
      ctx.addIssue({
        code: "custom",
        path: ["state"],
        message: "Unresolved configuration-blocked calls must await input",
      });
    const modelReference =
      call.providerCallId !== null &&
      call.assistantEventId !== null &&
      call.contentIndex !== null;
    const userReference =
      call.providerCallId === null &&
      call.assistantEventId === null &&
      call.contentIndex === null;
    if (call.origin === "model" ? !modelReference : !userReference)
      ctx.addIssue({
        code: "custom",
        message: "Tool-call references contradict its origin",
      });
  });
export type ToolCallState = z.infer<typeof toolCallStateSchema>;
export type ToolCallOrigin = z.infer<typeof toolCallOriginSchema>;
export type Supervision = z.infer<typeof supervisionSchema>;
export type InteractionResolution = z.infer<typeof interactionResolutionSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type UserInputOption = z.infer<typeof userInputOptionSchema>;
export type UserInputQuestion = z.infer<typeof userInputQuestionSchema>;
export type UserInputAnswer = z.infer<typeof userInputAnswerSchema>;
export type UserInputRequest = z.infer<typeof userInputRequestSchema>;
export type PlanReviewRequest = z.infer<typeof planReviewRequestSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
