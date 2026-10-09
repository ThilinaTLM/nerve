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
export const commandPreparationStateSchema = z.enum([
  "not_started",
  "running",
  "completed",
  "cancelled",
  "indeterminate",
  "not_run",
]);
export const commandResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
});
export const commandPreparationSchema = z.object({
  blocks: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      command: z.string(),
      state: commandPreparationStateSchema,
      result: commandResultSchema.nullable(),
    }),
  ),
});
export const systemNoticeSchema = z.discriminatedUnion("subtype", [
  z.object({
    subtype: z.literal("async_bash_event"),
    producer: z.string(),
    bashId: z.string(),
    status: z.enum(["completed", "failed", "timed_out", "cancelled", "lost"]),
    exitCode: z.number().int().nullable(),
    text: z.string(),
    assetIds: z.array(z.string()),
  }),
  z.object({
    subtype: z.literal("sub_conversation_event"),
    producer: z.string(),
    childConversationId: z.string(),
    assignmentId: z.string(),
    status: z.enum(["completed", "failed", "cancelled", "interrupted"]),
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
    commandPreparation: commandPreparationSchema.nullable(),
    preparedText: z.string().nullable(),
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
export type CommandPreparationState = z.infer<
  typeof commandPreparationStateSchema
>;
export type CommandResult = z.infer<typeof commandResultSchema>;
export type CommandPreparation = z.infer<typeof commandPreparationSchema>;
export type SystemNotice = z.infer<typeof systemNoticeSchema>;
export type QueuedInput = z.infer<typeof queuedInputSchema>;
export type SubmitInputRequest = z.infer<typeof submitInputRequestSchema>;
