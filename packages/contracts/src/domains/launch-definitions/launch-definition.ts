import { z } from "zod";

export const launchDefinitionRunPolicySchema = z.enum(["single", "concurrent"]);
export type LaunchDefinitionRunPolicy = z.infer<
  typeof launchDefinitionRunPolicySchema
>;

export const launchDefinitionPortSchema = z.number().int().min(1).max(65_535);

export const launchDefinitionScopeSchema = z.object({
  kind: z.literal("project"),
  projectId: z.string().startsWith("proj_"),
});
export type LaunchDefinitionScope = z.infer<typeof launchDefinitionScopeSchema>;

export const launchDefinitionSchema = z.object({
  id: z.string().startsWith("launchdef_"),
  scope: launchDefinitionScopeSchema,
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  port: launchDefinitionPortSchema.optional(),
  runPolicy: launchDefinitionRunPolicySchema.default("single"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LaunchDefinition = z.infer<typeof launchDefinitionSchema>;

/**
 * Project-resident definitions derive their project identity from the enclosing
 * directory. The non-strict scope intentionally projects legacy runtime-shaped
 * files by discarding their obsolete projectId.
 */
export const persistedLaunchDefinitionSchema = launchDefinitionSchema.extend({
  scope: z.object({ kind: z.literal("project") }),
});
export type PersistedLaunchDefinition = z.infer<
  typeof persistedLaunchDefinitionSchema
>;

export const launchDefinitionFileSchema = z
  .object({
    version: z.literal(1),
    definitions: z.array(persistedLaunchDefinitionSchema),
  })
  .strict();
export type LaunchDefinitionFile = z.infer<typeof launchDefinitionFileSchema>;

export const createLaunchDefinitionRequestSchema = z.object({
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  port: launchDefinitionPortSchema.optional(),
  runPolicy: launchDefinitionRunPolicySchema.default("single"),
  sourceLaunchId: z.string().startsWith("launch_").optional(),
});
export type CreateLaunchDefinitionRequest = z.infer<
  typeof createLaunchDefinitionRequestSchema
>;

export const updateLaunchDefinitionRequestSchema = z.object({
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  port: launchDefinitionPortSchema.optional(),
  runPolicy: launchDefinitionRunPolicySchema,
});
export type UpdateLaunchDefinitionRequest = z.infer<
  typeof updateLaunchDefinitionRequestSchema
>;
