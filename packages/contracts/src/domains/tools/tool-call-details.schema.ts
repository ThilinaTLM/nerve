import { z } from "zod";
import { boundedPublicJsonSchema } from "../events/bounded-public-data.schema.js";

export const sandboxToolCallDetailsSchema = z.object({
  toolCall: z.object({
    toolCallId: z.string().min(1).max(256),
    conversationId: z.string().startsWith("conv_"),
    agentId: z.string().startsWith("agent_"),
    runId: z.string().startsWith("run_"),
    toolName: z.string().min(1).max(128),
    status: z.enum([
      "requested",
      "waiting_for_input",
      "waiting_for_approval",
      "started",
      "completed",
      "failed",
      "cancelled",
    ]),
    args: boundedPublicJsonSchema.optional(),
    displayArgs: boundedPublicJsonSchema.optional(),
    result: boundedPublicJsonSchema.optional(),
    lifecycleSeq: z.number().int().nonnegative().safe().optional(),
    redactionVersion: z.number().int().nonnegative().safe().optional(),
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(2_048),
        retryable: z.boolean().optional(),
      })
      .optional(),
    requestedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    cancelledAt: z.string().datetime().optional(),
  }),
  argsPreview: boundedPublicJsonSchema.optional(),
  resultPreview: boundedPublicJsonSchema.optional(),
  displayTitle: z.string().max(512).optional(),
  displaySummary: z.string().max(2_048).optional(),
});
export type SandboxToolCallDetails = z.infer<
  typeof sandboxToolCallDetailsSchema
>;
