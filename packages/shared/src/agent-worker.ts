import { z } from "zod";
import { modelSelectionSchema } from "./models.js";

export const agentRequestAuthSchema = z.object({
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type AgentRequestAuth = z.infer<typeof agentRequestAuthSchema>;

export const agentWorkerPromptMessageSchema = z.object({
  type: z.literal("prompt"),
  id: z.string().startsWith("run_"),
  systemPrompt: z.string().optional(),
  messages: z.array(z.unknown()),
  model: modelSelectionSchema.optional(),
  auth: agentRequestAuthSchema.optional(),
});

export const agentWorkerAbortMessageSchema = z.object({
  type: z.literal("abort"),
  id: z.string().startsWith("run_"),
});

export const agentWorkerClientMessageSchema = z.discriminatedUnion("type", [
  agentWorkerPromptMessageSchema,
  agentWorkerAbortMessageSchema,
]);
export type AgentWorkerClientMessage = z.infer<
  typeof agentWorkerClientMessageSchema
>;
export type AgentWorkerPromptMessage = z.infer<
  typeof agentWorkerPromptMessageSchema
>;

export const agentWorkerServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("started"), id: z.string().startsWith("run_") }),
  z.object({
    type: z.literal("text_delta"),
    id: z.string().startsWith("run_"),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("done"),
    id: z.string().startsWith("run_"),
    text: z.string(),
    message: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("error"),
    id: z.string().startsWith("run_").optional(),
    message: z.string(),
    aborted: z.boolean().optional(),
    fatal: z.boolean().optional(),
  }),
]);
export type AgentWorkerServerMessage = z.infer<
  typeof agentWorkerServerMessageSchema
>;
