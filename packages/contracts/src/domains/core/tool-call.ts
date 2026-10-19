import { z } from "zod";
import { toolRiskSchema } from "../permissions/permissions.js";

export const toolCallStateSchema = z.enum([
  "supervising",
  "awaiting_approval",
  "ready",
  "running",
  "awaiting_input",
]);
export const toolCallOriginSchema = z.enum(["model", "user"]);
export const supervisionSchema = z.object({
  decision: z.enum(["allow", "approval", "deny"]),
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
  z.object({
    kind: z.literal("plan_review"),
    decision: z.enum(["approve", "reject"]),
    feedback: z.string().optional(),
  }),
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
export const planReviewRequestSchema = z.object({
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
