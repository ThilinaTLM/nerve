import { z } from "zod";
import { permissionExceptionSchema } from "../permissions/index.js";

const projectPermissionExceptionsSchema = z
  .array(permissionExceptionSchema)
  .max(256)
  .superRefine((exceptions, context) => {
    const ids = new Set<string>();
    for (const [index, exception] of exceptions.entries()) {
      if (ids.has(exception.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate permission exception id '${exception.id}'`,
          path: [index, "id"],
        });
      }
      ids.add(exception.id);
    }
  });

export const projectPermissionsSchema = z.object({
  version: z.literal(2),
  exceptions: projectPermissionExceptionsSchema,
});
export type ProjectPermissions = z.infer<typeof projectPermissionsSchema>;

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

export const projectLaunchPathSchema = z.string().min(1);

export const openProjectInEditorRequestSchema = z.object({
  editor: projectEditorSchema,
  path: projectLaunchPathSchema.optional(),
});
export type OpenProjectInEditorRequest = z.infer<
  typeof openProjectInEditorRequestSchema
>;

export const openProjectInEditorResponseSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  editor: projectEditorSchema,
  path: z.string().min(1),
});
export type OpenProjectInEditorResponse = z.infer<
  typeof openProjectInEditorResponseSchema
>;

export const openProjectInTerminalRequestSchema = z.object({
  path: projectLaunchPathSchema.optional(),
});
export type OpenProjectInTerminalRequest = z.infer<
  typeof openProjectInTerminalRequestSchema
>;

export const openProjectInTerminalResponseSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  dir: z.string().min(1),
});
export type OpenProjectInTerminalResponse = z.infer<
  typeof openProjectInTerminalResponseSchema
>;

export const createProjectRequestSchema = z.object({
  dir: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const pruneStrategySchema = z.enum([
  "olderThanDays",
  "keepLatest",
  "completed",
]);
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
    z.object({
      strategy: z.literal("completed"),
    }),
  ],
);
export type PruneProjectConversationsRequest = z.infer<
  typeof pruneProjectConversationsRequestSchema
>;

export const pruneProjectConversationSkippedReasonSchema = z.enum([
  "active_agent",
  "active_task",
]);
export type PruneProjectConversationSkippedReason = z.infer<
  typeof pruneProjectConversationSkippedReasonSchema
>;

export const pruneProjectConversationsResponseSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  strategy: pruneStrategySchema,
  prunedConversationIds: z.array(z.string().startsWith("conv_")),
  prunedTaskIds: z.array(z.string().startsWith("task_")),
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
