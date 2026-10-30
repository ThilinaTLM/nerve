import { z } from "zod";

export const activityStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);
export const unreadableConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  error: z.string(),
});
export type UnreadableConversation = z.infer<
  typeof unreadableConversationSchema
>;
export const activitySchema = z.object({
  id: z.string().min(1),
  parentId: z.string().optional(),
  revision: z.number().int().nonnegative(),
  kind: z.string().min(1),
  title: z.string(),
  scope: z
    .object({
      projectId: z.string().optional(),
      projectName: z.string().optional(),
      repositoryPath: z.string().optional(),
    })
    .optional(),
  status: activityStatusSchema,
  phase: z.string().optional(),
  message: z.string().optional(),
  unreadableConversations: z.array(unreadableConversationSchema).optional(),
  progress: z
    .object({
      completed: z.number().nonnegative(),
      total: z.number().positive(),
    })
    .optional(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  error: z
    .object({ message: z.string(), category: z.string().optional() })
    .optional(),
  actions: z.object({ cancel: z.boolean(), retry: z.boolean() }),
});
export type Activity = z.infer<typeof activitySchema>;
export type ActivityStatus = Activity["status"];
export const activityUpdatedEventSchema = z.object({
  activity: activitySchema,
  removed: z.boolean().optional(),
});
export const activityActionResultSchema = z.object({
  accepted: z.boolean(),
  activityId: z.string().optional(),
  reason: z.string().optional(),
});
export type ActivityActionResult = z.infer<typeof activityActionResultSchema>;
export function isActivityRunning(activity: Pick<Activity, "status">): boolean {
  return activity.status === "queued" || activity.status === "running";
}
