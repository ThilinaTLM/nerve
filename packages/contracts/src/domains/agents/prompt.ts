import { z } from "zod";

export const promptImageSchema = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
});
export type PromptImage = z.infer<typeof promptImageSchema>;

export const promptBehaviorSchema = z.enum([
  "reject-if-busy",
  "steer",
  "follow-up",
]);
export type PromptBehavior = z.infer<typeof promptBehaviorSchema>;
export type QueuedPromptBehavior = Exclude<PromptBehavior, "reject-if-busy">;

export const promptRequestSchema = z.object({
  text: z.string().min(1),
  images: z.array(promptImageSchema).max(16).optional(),
  behavior: promptBehaviorSchema.optional(),
});
export type PromptRequest = z.infer<typeof promptRequestSchema>;

export const continueFromFailureRequestSchema = z.object({
  runId: z.string().startsWith("run_"),
});
export type ContinueFromFailureRequest = z.infer<
  typeof continueFromFailureRequestSchema
>;

export const queuedPromptStatusSchema = z.enum([
  "queued",
  "accepted",
  "delivered",
  "cancelled",
  "failed",
]);
export type QueuedPromptStatus = z.infer<typeof queuedPromptStatusSchema>;

export const queuedPromptRecordSchema = z.object({
  id: z.string().startsWith("promptq_"),
  agentId: z.string().startsWith("agent_"),
  conversationId: z.string().startsWith("conv_"),
  projectId: z.string().startsWith("proj_"),
  runId: z.string().startsWith("run_").optional(),
  behavior: z.enum(["steer", "follow-up"]),
  text: z.string().min(1),
  images: z.array(promptImageSchema).max(16).optional(),
  status: queuedPromptStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deliveredEntryId: z.string().startsWith("entry_").optional(),
  error: z.string().optional(),
});
export type QueuedPromptRecord = z.infer<typeof queuedPromptRecordSchema>;
