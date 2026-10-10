import { z } from "zod";
import { commandPreparationSchema, systemNoticeSchema } from "./input.js";
import {
  interactionResolutionSchema,
  supervisionSchema,
  toolCallOriginSchema,
} from "./tool-call.js";

// Pi's content shapes, including opaque signatures needed for provider continuity.
export const textContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  textSignature: z.string().optional(),
});
export const imageContentSchema = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
});
export const thinkingContentSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  thinkingSignature: z.string().optional(),
  redacted: z.boolean().optional(),
});
export const toolCallContentSchema = z.object({
  type: z.literal("toolCall"),
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.json()),
  thoughtSignature: z.string().optional(),
  namespace: z.string().optional(),
});
export const assistantContentSchema = z.discriminatedUnion("type", [
  textContentSchema,
  thinkingContentSchema,
  toolCallContentSchema,
]);
export const modelContentSchema = z.array(
  z.discriminatedUnion("type", [textContentSchema, imageContentSchema]),
);
export const agentProjectionSchema = z.array(
  z.discriminatedUnion("type", [
    textContentSchema,
    z.object({
      type: z.literal("image"),
      assetId: z.string(),
      mimeType: z.string(),
    }),
  ]),
);
export const toolUserProjectionSchema = z.object({
  argsPreview: z.json(),
  resultPreview: z.json(),
  previewOverflow: z
    .object({
      hidden: z.number().nonnegative(),
      noun: z.string(),
      direction: z.enum(["head", "tail", "mixed"]).optional(),
    })
    .optional(),
});
export type AgentProjection = z.infer<typeof agentProjectionSchema>;
export type ToolUserProjection = z.infer<typeof toolUserProjectionSchema>;
export const usageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  cacheWrite1h: z.number().optional(),
  reasoning: z.number().optional(),
  totalTokens: z.number(),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    total: z.number(),
  }),
});
export const userMessagePayloadSchema = z.object({
  text: z.string(),
  originalText: z.string(),
  source: z.enum(["user", "parent_conversation"]),
  senderConversationId: z.string().nullable(),
  commandPreparation: commandPreparationSchema.nullable(),
});
export const assistantMessagePayloadSchema = z.object({
  content: z.array(assistantContentSchema),
  usage: usageSchema,
  stopReason: z.enum([
    "pending",
    "stop",
    "length",
    "toolUse",
    "error",
    "aborted",
    "deferred",
  ]),
  api: z.string(),
  provider: z.string(),
  model: z.string(),
  errorMessage: z.string().optional(),
  responseModel: z.string().optional(),
  responseId: z.string().optional(),
  providerThinkingLevel: z.string().optional(),
  rawStopReason: z.string().optional(),
});
export const executionTransitionSchema = z.enum([
  "started",
  "waiting",
  "retrying",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const executionDetails = {
  retry: z
    .object({
      attempt: z.number().int().positive(),
      maxAttempts: z.number().int().positive(),
      delayMs: z.number().nonnegative(),
      exhausted: z.boolean().optional(),
      error: z.string(),
    })
    .optional(),
  waiting: z
    .object({
      toolCallId: z.string().optional(),
      childConversationId: z.string().optional(),
    })
    .optional(),
  failure: z
    .object({ message: z.string(), category: z.string().optional() })
    .optional(),
};
export const executionStatePayloadSchema = z.discriminatedUnion("transition", [
  z.object({
    subtype: z.literal("execution_state"),
    transition: z.literal("started"),
    ...executionDetails,
  }),
  z.object({
    subtype: z.literal("execution_state"),
    transition: z.enum([
      "waiting",
      "retrying",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ]),
    executionId: z.string(),
    ...executionDetails,
  }),
]);
export const systemEventPayloadSchema = z.discriminatedUnion("subtype", [
  ...systemNoticeSchema.options,
  executionStatePayloadSchema,
]);
export const toolCallOutcomeSchema = z.enum([
  "completed",
  "failed",
  "denied",
  "cancelled",
  "indeterminate",
]);
export const toolCallResponsePayloadSchema = z.object({
  toolCallId: z.string(),
  providerCallId: z.string().nullable(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.json()),
  origin: toolCallOriginSchema,
  assistantEventId: z.string().nullable(),
  contentIndex: z.number().int().nonnegative().nullable(),
  outcome: toolCallOutcomeSchema,
  agentProjection: agentProjectionSchema,
  userProjection: toolUserProjectionSchema,
  supervision: supervisionSchema.nullable(),
  interactionResolution: interactionResolutionSchema.nullable(),
  resolutionRequestId: z.string().nullable(),
  assetIds: z.array(z.string()),
});
export const compactionPayloadSchema = z.object({
  summary: z.string(),
  firstKeptEventId: z.string().nullable(),
  tokensBefore: z.number().int().nonnegative(),
  details: z.json().nullable(),
});
export const llmRepresentationSchema = z.enum([
  "none",
  "user",
  "assistant",
  "tool_result",
]);
export const conversationEventTypeSchema = z.enum([
  "user_message",
  "assistant_message",
  "system_event",
  "tool_call_response",
  "compaction",
]);
const eventFields = {
  id: z.string(),
  conversationId: z.string(),
  sequence: z.number().int().positive(),
  previousEventId: z.string().nullable(),
  turnId: z.string().nullable(),
  inputId: z.string().nullable(),
  createdAt: z.string().datetime(),
};
export const conversationEventSchema = z
  .discriminatedUnion("type", [
    z.object({
      ...eventFields,
      type: z.literal("user_message"),
      llmRepresentation: z.literal("user"),
      payload: userMessagePayloadSchema,
    }),
    z.object({
      ...eventFields,
      type: z.literal("assistant_message"),
      llmRepresentation: z.literal("assistant"),
      payload: assistantMessagePayloadSchema,
    }),
    z.object({
      ...eventFields,
      type: z.literal("system_event"),
      llmRepresentation: z.enum(["none", "user"]),
      payload: systemEventPayloadSchema,
    }),
    z.object({
      ...eventFields,
      type: z.literal("tool_call_response"),
      llmRepresentation: llmRepresentationSchema,
      payload: toolCallResponsePayloadSchema,
    }),
    z.object({
      ...eventFields,
      type: z.literal("compaction"),
      llmRepresentation: z.literal("user"),
      payload: compactionPayloadSchema,
    }),
  ])
  .superRefine((event, ctx) => {
    if (
      event.type === "tool_call_response" &&
      (event.payload.origin === "model"
        ? event.llmRepresentation !== "tool_result"
        : !["user", "none"].includes(event.llmRepresentation))
    )
      ctx.addIssue({
        code: "custom",
        message: "Tool response representation contradicts its origin",
      });
    if (event.type === "tool_call_response") {
      const p = event.payload;
      const modelReference =
        p.providerCallId !== null &&
        p.assistantEventId !== null &&
        p.contentIndex !== null;
      const userReference =
        p.providerCallId === null &&
        p.assistantEventId === null &&
        p.contentIndex === null;
      if (p.origin === "model" ? !modelReference : !userReference)
        ctx.addIssue({
          code: "custom",
          message: "Tool-response references contradict its origin",
        });
    }
    if (
      event.type === "system_event" &&
      event.payload.subtype === "execution_state" &&
      event.llmRepresentation !== "none"
    )
      ctx.addIssue({
        code: "custom",
        message: "Execution facts cannot contribute to context",
      });
  });
export const eventTreeNodeSchema = z.object({
  id: z.string(),
  previousEventId: z.string().nullable(),
  type: conversationEventTypeSchema,
  preview: z.string(),
  createdAt: z.string().datetime(),
});
export type AssistantContent = z.infer<typeof assistantContentSchema>;
export type ModelContent = z.infer<typeof modelContentSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type UserMessagePayload = z.infer<typeof userMessagePayloadSchema>;
export type AssistantMessagePayload = z.infer<
  typeof assistantMessagePayloadSchema
>;
export type ExecutionTransition = z.infer<typeof executionTransitionSchema>;
export type ExecutionStatePayload = z.infer<typeof executionStatePayloadSchema>;
export type SystemEventPayload = z.infer<typeof systemEventPayloadSchema>;
export type ToolCallOutcome = z.infer<typeof toolCallOutcomeSchema>;
export type ToolCallResponsePayload = z.infer<
  typeof toolCallResponsePayloadSchema
>;
export type CompactionPayload = z.infer<typeof compactionPayloadSchema>;
export type LlmRepresentation = z.infer<typeof llmRepresentationSchema>;
export type ConversationEventType = z.infer<typeof conversationEventTypeSchema>;
export type ConversationEvent = z.infer<typeof conversationEventSchema>;
export type EventTreeNode = z.infer<typeof eventTreeNodeSchema>;

export const transferredConversationEventSchema = z.discriminatedUnion("type", [
  conversationEventSchema.options[0],
  conversationEventSchema.options[1],
  conversationEventSchema.options[2],
  conversationEventSchema.options[4],
  conversationEventSchema.options[3].extend({
    payload: toolCallResponsePayloadSchema.omit({ agentProjection: true }),
  }),
]);
export type TransferredConversationEvent = z.infer<
  typeof transferredConversationEventSchema
>;
export function transferConversationEvent(
  event: ConversationEvent,
): TransferredConversationEvent {
  if (event.type !== "tool_call_response") return event;
  const { agentProjection, ...payload } = event.payload;
  void agentProjection;
  return { ...event, payload };
}
