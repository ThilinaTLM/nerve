import { z } from "zod";

export const taskDefinitionRunPolicySchema = z.enum(["single", "concurrent"]);
export type TaskDefinitionRunPolicy = z.infer<
  typeof taskDefinitionRunPolicySchema
>;

export const taskDefinitionPortSchema = z.number().int().min(1).max(65_535);

export const taskDefinitionScopeSchema = z.object({
  kind: z.literal("project"),
  projectId: z.string().startsWith("proj_"),
});
export type TaskDefinitionScope = z.infer<typeof taskDefinitionScopeSchema>;

export const taskDefinitionSchema = z.object({
  id: z.string().startsWith("taskdef_"),
  scope: taskDefinitionScopeSchema,
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  port: taskDefinitionPortSchema.optional(),
  runPolicy: taskDefinitionRunPolicySchema.default("single"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;

/**
 * Project-resident definitions derive their project identity from the enclosing
 * directory. The non-strict scope intentionally projects legacy runtime-shaped
 * files by discarding their obsolete projectId.
 */
export const persistedTaskDefinitionSchema = taskDefinitionSchema.extend({
  scope: z.object({ kind: z.literal("project") }),
});
export type PersistedTaskDefinition = z.infer<
  typeof persistedTaskDefinitionSchema
>;

export const taskDefinitionFileSchema = z
  .object({
    version: z.literal(1),
    definitions: z.array(persistedTaskDefinitionSchema),
  })
  .strict();
export type TaskDefinitionFile = z.infer<typeof taskDefinitionFileSchema>;

export const createTaskDefinitionRequestSchema = z.object({
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  port: taskDefinitionPortSchema.optional(),
  runPolicy: taskDefinitionRunPolicySchema.default("single"),
  sourceTaskId: z.string().startsWith("task_").optional(),
});
export type CreateTaskDefinitionRequest = z.infer<
  typeof createTaskDefinitionRequestSchema
>;

export const updateTaskDefinitionRequestSchema = z.object({
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  port: taskDefinitionPortSchema.optional(),
  runPolicy: taskDefinitionRunPolicySchema,
});
export type UpdateTaskDefinitionRequest = z.infer<
  typeof updateTaskDefinitionRequestSchema
>;
