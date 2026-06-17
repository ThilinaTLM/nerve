import { z } from "zod";

export const projectRecordSchema = z.object({
  id: z.string().startsWith("proj_"),
  name: z.string().min(1),
  dir: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const projectEditorSchema = z.enum(["vscode", "zed"]);
export type ProjectEditor = z.infer<typeof projectEditorSchema>;

export const openProjectInEditorRequestSchema = z.object({
  editor: projectEditorSchema,
});
export type OpenProjectInEditorRequest = z.infer<
  typeof openProjectInEditorRequestSchema
>;

export const openProjectInEditorResponseSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  editor: projectEditorSchema,
  dir: z.string().min(1),
});
export type OpenProjectInEditorResponse = z.infer<
  typeof openProjectInEditorResponseSchema
>;

export const createProjectRequestSchema = z.object({
  dir: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const pruneStrategySchema = z.enum(["olderThanDays", "keepLatest"]);
export type PruneStrategy = z.infer<typeof pruneStrategySchema>;

export const pruneProjectConversationsRequestSchema = z.discriminatedUnion(
  "strategy",
  [
    z.object({
      strategy: z.literal("olderThanDays"),
      olderThanDays: z.number().int().positive().max(3650),
    }),
    z.object({
      strategy: z.literal("keepLatest"),
      keepLatest: z.number().int().nonnegative().max(10000),
    }),
  ],
);
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
  strategy: pruneStrategySchema,
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
