import { z } from "zod";

export const pinnedCommandSchema = z.object({
  id: z.string().startsWith("pin_"),
  projectId: z.string().startsWith("proj_"),
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PinnedCommand = z.infer<typeof pinnedCommandSchema>;

export const createPinnedCommandRequestSchema = z.object({
  command: z.string().min(1),
  label: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
});
export type CreatePinnedCommandRequest = z.infer<
  typeof createPinnedCommandRequestSchema
>;

export const updatePinnedCommandRequestSchema = z.object({
  command: z.string().min(1),
  label: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
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
