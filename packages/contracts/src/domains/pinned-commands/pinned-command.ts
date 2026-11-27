import { z } from "zod";
import { launchDefinitionRunPolicySchema } from "../launch-definitions/launch-definition.js";

export const pinnedCommandSchema = z.object({
  id: z.string().startsWith("pin_"),
  projectId: z.string().startsWith("proj_"),
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  runPolicy: launchDefinitionRunPolicySchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PinnedCommand = z.infer<typeof pinnedCommandSchema>;

export const createPinnedCommandRequestSchema = z.object({
  command: z.string().min(1),
  label: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  runPolicy: launchDefinitionRunPolicySchema.optional(),
});
export type CreatePinnedCommandRequest = z.infer<
  typeof createPinnedCommandRequestSchema
>;

export const updatePinnedCommandRequestSchema = z.object({
  command: z.string().min(1),
  label: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  runPolicy: launchDefinitionRunPolicySchema.optional(),
});
export type UpdatePinnedCommandRequest = z.infer<
  typeof updatePinnedCommandRequestSchema
>;

export const pinnedCommandsResponseSchema = z.object({
  commands: z.array(pinnedCommandSchema),
});
export type PinnedCommandsResponse = z.infer<
  typeof pinnedCommandsResponseSchema
>;
