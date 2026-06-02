import { z } from "zod";
import { modelSelectionSchema } from "./models.js";
import { modeSchema, permissionLevelSchema } from "./settings.js";

export const workspaceScopeSchema = z.object({
  roots: z.array(z.string()).min(1),
  readonly: z.boolean().optional(),
});
export type WorkspaceScope = z.infer<typeof workspaceScopeSchema>;

export const updateAgentRequestSchema = z.object({
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
  model: modelSelectionSchema.nullable().optional(),
});
export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;

export const agentStatusSchema = z.enum([
  "idle",
  "running",
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
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  projectDir: z.string().min(1),
  workerId: z.string().startsWith("worker_").optional(),
  parentAgentId: z.string().startsWith("agent_").optional(),
  rootAgentId: z.string().startsWith("agent_"),
  mode: modeSchema,
  permissionLevel: permissionLevelSchema,
  workspaceScope: workspaceScopeSchema,
  budget: agentBudgetSchema.default({
    depth: 0,
    maxDepth: 3,
    maxRuns: 8,
    usedRuns: 0,
  }),
  model: modelSelectionSchema.optional(),
  status: agentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentRecord = z.infer<typeof agentRecordSchema>;

export const createAgentRequestSchema = z.object({
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  projectDir: z.string().min(1).optional(),
  workerId: z.string().startsWith("worker_").optional(),
  parentAgentId: z.string().startsWith("agent_").optional(),
  task: z.string().optional(),
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
  workspaceScope: workspaceScopeSchema.optional(),
  budget: createAgentBudgetRequestSchema.optional(),
  model: modelSelectionSchema.optional(),
});
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

export const promptRequestSchema = z.object({
  text: z.string().min(1),
  images: z
    .array(
      z.object({
        type: z.literal("image"),
        data: z.string(),
        mimeType: z.string(),
      }),
    )
    .optional(),
  behavior: z.enum(["reject-if-busy", "steer", "follow-up"]).optional(),
});
export type PromptRequest = z.infer<typeof promptRequestSchema>;
