import { z } from "zod";

export const inputSourceSchema = z.enum([
  "user",
  "parent_conversation",
  "system",
]);
export const deliveryTargetSchema = z.enum([
  "next_turn",
  "specific_execution",
  "next_execution",
]);
/** Terminal outcome shared by every background task kind. */
export const taskOutcomeSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
]);
export type TaskOutcome = z.infer<typeof taskOutcomeSchema>;
export const systemNoticeSchema = z.discriminatedUnion("subtype", [
  z.object({
    subtype: z.literal("task_result"),
    producer: z.string(),
    task: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("bash"),
        /** The bashId. */
        id: z.string(),
        exitCode: z.number().int().nullable(),
      }),
      z.object({
        kind: z.literal("subagent"),
        /** The child conversationId. */
        id: z.string(),
        assignmentId: z.string(),
      }),
    ]),
    outcome: taskOutcomeSchema,
    text: z.string(),
    assetIds: z.array(z.string()),
  }),
  z.object({
    subtype: z.literal("user_intervention"),
    producer: z.string(),
    text: z.string(),
  }),
  z.object({
    subtype: z.literal("notification"),
    producer: z.string(),
    text: z.string(),
  }),
]);
export const queuedInputSchema = z
  .object({
    inputId: z.string(),
    conversationId: z.string(),
    acceptanceSequence: z.number().int().positive(),
    source: inputSourceSchema,
    senderConversationId: z.string().nullable(),
    content: z.union([z.string(), systemNoticeSchema]),
    deliveryTarget: deliveryTargetSchema,
    targetExecutionId: z.string().nullable(),
    wakeWhenIdle: z.boolean(),
    acceptedAt: z.string().datetime(),
  })
  .superRefine((input, ctx) => {
    if ((input.source === "system") !== (typeof input.content !== "string"))
      ctx.addIssue({
        code: "custom",
        message: "System inputs require a notice; other sources require text",
      });
    if (
      input.source !== "parent_conversation" &&
      input.senderConversationId !== null
    )
      ctx.addIssue({
        code: "custom",
        message: "Only parent inputs may have a sender conversation",
      });
    if (
      input.source === "parent_conversation" &&
      input.senderConversationId === null
    )
      ctx.addIssue({
        code: "custom",
        message: "Parent inputs require a sender",
      });
    if (
      input.deliveryTarget === "specific_execution" &&
      input.targetExecutionId === null
    )
      ctx.addIssue({
        code: "custom",
        message: "Specific execution requires a target",
      });
  });
export const submitInputRequestSchema = z
  .object({
    conversationId: z.string(),
    inputId: z.string(),
    text: z.string(),
    deliveryTarget: deliveryTargetSchema.optional(),
    targetExecutionId: z.string().nullable().optional(),
    source: z.enum(["user", "parent_conversation"]),
    senderConversationId: z.string().optional(),
    wakeWhenIdle: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.source === "parent_conversation" && !input.senderConversationId)
      ctx.addIssue({
        code: "custom",
        message: "Parent inputs require a sender",
      });
    if (input.source === "user" && input.senderConversationId !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "User inputs cannot have a sender conversation",
      });
    if (
      input.deliveryTarget === "specific_execution" &&
      !input.targetExecutionId
    )
      ctx.addIssue({
        code: "custom",
        message: "Specific execution requires a target",
      });
  });
export type InputSource = z.infer<typeof inputSourceSchema>;
export type DeliveryTarget = z.infer<typeof deliveryTargetSchema>;
export type SystemNotice = z.infer<typeof systemNoticeSchema>;
export type QueuedInput = z.infer<typeof queuedInputSchema>;
export type SubmitInputRequest = z.infer<typeof submitInputRequestSchema>;
