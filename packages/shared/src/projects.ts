import { z } from "zod";

export const projectRecordSchema = z.object({
  id: z.string().startsWith("proj_"),
  name: z.string().min(1),
  dir: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const createProjectRequestSchema = z.object({
  dir: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const pruneProjectConversationsRequestSchema = z.object({
  olderThanDays: z.number().int().positive().max(3650).default(7),
});
export type PruneProjectConversationsRequest = z.infer<
  typeof pruneProjectConversationsRequestSchema
>;

export const pruneProjectConversationSkippedReasonSchema = z.enum([
  "active_agent",
  "active_process",
]);
export type PruneProjectConversationSkippedReason = z.infer<
  typeof pruneProjectConversationSkippedReasonSchema
>;

export const pruneProjectConversationsResponseSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  olderThanDays: z.number().int().positive(),
  cutoff: z.string().datetime(),
  prunedConversationIds: z.array(z.string().startsWith("conv_")),
  prunedProcessIds: z.array(z.string().startsWith("proc_")),
  skipped: z.array(
    z.object({
      conversationId: z.string().startsWith("conv_"),
      reason: pruneProjectConversationSkippedReasonSchema,
    }),
  ),
});
export type PruneProjectConversationsResponse = z.infer<
  typeof pruneProjectConversationsResponseSchema
>;
