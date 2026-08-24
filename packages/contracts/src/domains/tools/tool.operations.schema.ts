import { z } from "zod";
import { agentRecordSchema } from "../agents/index.js";
import { conversationRecordSchema } from "../conversations/index.js";
import { defineOperation } from "../protocol/operation-definition.schema.js";
import {
  toolCallRecordSchema,
  toolCallStatusSchema,
  toolCallTranscriptRecordSchema,
  toolDescriptorSchema,
} from "./records.schema.js";

const emptyParamsSchema = z.object({}).optional();
const toolCallIdSchema = z.string().startsWith("tool_").max(256);
const toolCallListParamsSchema = z
  .object({
    status: toolCallStatusSchema.optional(),
    pendingInteractionKind: z
      .enum(["approval", "user_input", "plan_review"])
      .optional(),
    conversationId: z.string().startsWith("conv_").optional(),
    projectId: z.string().startsWith("proj_").optional(),
    runId: z.string().startsWith("run_").optional(),
    limit: z.number().int().positive().max(1_000).optional(),
    cursor: z
      .object({
        updatedAt: z.string().datetime(),
        id: toolCallIdSchema,
      })
      .optional(),
  })
  .optional();
const toolCallGetParamsSchema = z.object({
  toolCallId: toolCallIdSchema,
  conversationId: z.string().startsWith("conv_").optional(),
  agentId: z.string().startsWith("agent_").optional(),
  runId: z.string().startsWith("run_").optional(),
});

export const toolInteractionResolutionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("approval"),
    action: z.enum(["allow", "deny"]),
    note: z.string().max(4_096).optional(),
    scope: z
      .enum([
        "single_call",
        "same_tool_same_args",
        "run",
        "always",
        "always_project",
        "always_user",
      ])
      .optional(),
  }),
  z.object({
    kind: z.literal("user_input"),
    action: z.enum(["answer", "dismiss"]),
    answer: z.string().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal("plan_review"),
    action: z.enum([
      "accept",
      "accept_in_new_chat",
      "request_changes",
      "reject",
      "discard",
    ]),
    feedback: z.string().optional(),
    implementationModel: z.unknown().optional(),
    implementationThinkingLevel: z.string().optional(),
    compactBeforeImplementation: z.boolean().optional(),
  }),
]);
export type ToolInteractionResolution = z.infer<
  typeof toolInteractionResolutionSchema
>;

export const resolveToolInteractionRequestSchema = z.object({
  toolCallId: toolCallIdSchema,
  interactionOrdinal: z.number().int().nonnegative().max(15),
  expectedRevision: z.number().int().positive().safe(),
  resolutionRequestId: z.string().min(1).max(256),
  resolution: toolInteractionResolutionSchema,
});
export type ResolveToolInteractionRequest = z.infer<
  typeof resolveToolInteractionRequestSchema
>;

const resolutionEffectSchema = z.object({
  kind: z.literal("new_conversation"),
  conversation: conversationRecordSchema,
  agent: agentRecordSchema,
});

export const toolsOperationDefinitions = [
  defineOperation(
    "tool.list",
    emptyParamsSchema,
    z.object({ tools: z.array(toolDescriptorSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.tool.list",
  ),
  defineOperation(
    "toolCall.list",
    toolCallListParamsSchema,
    z.object({
      toolCalls: z.array(toolCallTranscriptRecordSchema),
      nextCursor: z
        .object({
          updatedAt: z.string().datetime(),
          id: toolCallIdSchema,
        })
        .optional(),
    }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.toolCall.list",
  ),
  defineOperation(
    "toolCall.get",
    toolCallGetParamsSchema,
    z.object({ toolCall: toolCallRecordSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.toolCall.get",
  ),
  defineOperation(
    "toolCall.interaction.resolve",
    resolveToolInteractionRequestSchema,
    z.object({
      toolCall: toolCallRecordSchema,
      effect: resolutionEffectSchema.optional(),
    }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.toolCall.interaction.resolve",
  ),
] as const;
