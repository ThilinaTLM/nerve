import { z } from "zod";

export const taskDefinitionRunPolicySchema = z.enum(["single", "concurrent"]);
export type TaskDefinitionRunPolicy = z.infer<
  typeof taskDefinitionRunPolicySchema
>;

export const taskDefinitionScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project"),
    projectId: z.string().startsWith("proj_"),
  }),
  z.object({ kind: z.literal("sandbox"), sandboxId: z.string().min(1) }),
]);
export type TaskDefinitionScope = z.infer<typeof taskDefinitionScopeSchema>;

export const taskDefinitionSchema = z.object({
  id: z.string().startsWith("taskdef_"),
  scope: taskDefinitionScopeSchema,
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  runPolicy: taskDefinitionRunPolicySchema.default("single"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;

export const createTaskDefinitionRequestSchema = z.object({
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
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
  runPolicy: taskDefinitionRunPolicySchema,
});
export type UpdateTaskDefinitionRequest = z.infer<
  typeof updateTaskDefinitionRequestSchema
>;
