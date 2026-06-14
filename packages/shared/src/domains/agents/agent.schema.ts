import { z } from "zod";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/index.js";
import { modeSchema, permissionLevelSchema } from "../settings/index.js";

export const workspaceScopeSchema = z.object({
  roots: z.array(z.string()).min(1),
  readonly: z.boolean().optional(),
});
export type WorkspaceScope = z.infer<typeof workspaceScopeSchema>;

export const updateAgentRequestSchema = z.object({
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
  model: modelSelectionSchema.nullable().optional(),
  thinkingLevel: thinkingLevelSchema.optional(),
});
export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;

export const agentStatusSchema = z.enum([
  "idle",
  "running",
  "awaiting_user",
  "aborted",
  "error",
]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentBudgetSchema = z.object({
  depth: z.number().int().nonnegative().default(0),
  maxDepth: z.number().int().positive().max(8).default(3),
  maxRuns: z.number().int().positive().max(64).default(8),
  usedRuns: z.number().int().nonnegative().default(0),
});
export type AgentBudget = z.infer<typeof agentBudgetSchema>;

export const createAgentBudgetRequestSchema = agentBudgetSchema.partial();
export type CreateAgentBudgetRequest = z.infer<
  typeof createAgentBudgetRequestSchema
>;

export const agentRecordSchema = z.object({
  id: z.string().startsWith("agent_"),
  conversationId: z.string().startsWith("conv_"),
  projectId: z.string().startsWith("proj_"),
  projectDir: z.string().min(1),
  workerId: z.string().startsWith("worker_").optional(),
  parentAgentId: z.string().startsWith("agent_").optional(),
  rootAgentId: z.string().startsWith("agent_"),
  mode: modeSchema,
  permissionLevel: permissionLevelSchema,
  workspaceScope: workspaceScopeSchema,
  systemPrompt: z.string().min(1).optional(),
  budget: agentBudgetSchema.default({
    depth: 0,
    maxDepth: 3,
    maxRuns: 8,
    usedRuns: 0,
  }),
  model: modelSelectionSchema.optional(),
  thinkingLevel: thinkingLevelSchema.default("off"),
  status: agentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentRecord = z.infer<typeof agentRecordSchema>;

export const createAgentRequestSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  projectId: z.string().startsWith("proj_"),
  projectDir: z.string().min(1).optional(),
  workerId: z.string().startsWith("worker_").optional(),
  parentAgentId: z.string().startsWith("agent_").optional(),
  task: z.string().optional(),
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
  workspaceScope: workspaceScopeSchema.optional(),
  systemPrompt: z.string().min(1).optional(),
  budget: createAgentBudgetRequestSchema.optional(),
  model: modelSelectionSchema.optional(),
  thinkingLevel: thinkingLevelSchema.optional(),
});
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

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
  images: z.array(promptImageSchema).optional(),
  behavior: promptBehaviorSchema.optional(),
});
export type PromptRequest = z.infer<typeof promptRequestSchema>;

export const continueFromFailureRequestSchema = z.object({
  statusEntryId: z.string().startsWith("entry_"),
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
  images: z.array(promptImageSchema).optional(),
  status: queuedPromptStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deliveredEntryId: z.string().startsWith("entry_").optional(),
  error: z.string().optional(),
});
export type QueuedPromptRecord = z.infer<typeof queuedPromptRecordSchema>;
