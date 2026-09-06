import { z } from "zod";
import {
  projectRecordSchema,
  pruneProjectConversationsRequestSchema,
} from "../projects/project.js";
import {
  storageCleanupRequestSchema,
  storageCleanupResultSchema,
  storageCleanupTargetSchema,
} from "../storage/storage.js";
const count = z.number().int().nonnegative();
export const maintenanceRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("storage_cleanup"),
    parameters: storageCleanupRequestSchema,
  }),
  z.object({
    kind: z.literal("prune_conversations"),
    projectId: z.string().startsWith("proj_"),
    parameters: pruneProjectConversationsRequestSchema,
  }),
  z.object({
    kind: z.literal("delete_project"),
    projectId: z.string().startsWith("proj_"),
  }),
]);
export type MaintenanceRequest = z.infer<typeof maintenanceRequestSchema>;
export const maintenanceCurrentItemSchema = z.object({
  conversationId: z.string(),
  title: z.string().optional(),
  stage: z.string(),
  removedRows: count,
  detachedLinks: count,
});
export const maintenanceResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("storage_cleanup"),
    targets: z.array(storageCleanupResultSchema),
  }),
  z.object({
    kind: z.literal("prune_conversations"),
    removedConversationCount: count,
    removedTaskCount: count,
  }),
  z.object({
    kind: z.literal("delete_project"),
    projectId: z.string(),
    removedConversationCount: count,
  }),
]);
export const maintenanceOperationSchema = z
  .object({
    id: z.string().min(1),
    revision: count,
    kind: z.enum(["storage_cleanup", "prune_conversations", "delete_project"]),
    request: maintenanceRequestSchema,
    project: projectRecordSchema.optional(),
    status: z.enum([
      "queued",
      "running",
      "cancelling",
      "succeeded",
      "failed",
      "cancelled",
    ]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    phase: z.string(),
    message: z.string(),
    cancellable: z.boolean(),
    cancellationRequested: z.boolean(),
    completedItems: count,
    totalItems: count.optional(),
    completedTargets: count,
    totalTargets: count,
    currentTarget: storageCleanupTargetSchema.optional(),
    currentItem: maintenanceCurrentItemSchema.optional(),
    removedConversationCount: count,
    removedTaskCount: count,
    skippedActiveAgentCount: count,
    skippedActiveTaskCount: count,
    freedBytes: count,
    warnings: z.array(z.string()),
    result: maintenanceResultSchema.optional(),
    error: z.string().optional(),
  })
  .superRefine((operation, context) => {
    if (
      operation.kind !== operation.request.kind ||
      (operation.result && operation.result.kind !== operation.kind)
    )
      context.addIssue({
        code: "custom",
        message: "Maintenance kind must match its request and result.",
      });
    if (
      operation.kind !== "storage_cleanup" &&
      (!operation.project ||
        operation.project.id !==
          (operation.request.kind !== "storage_cleanup"
            ? operation.request.projectId
            : undefined))
    )
      context.addIssue({
        code: "custom",
        message: "Project maintenance requires its project snapshot.",
      });
  });
export type MaintenanceOperation = z.infer<typeof maintenanceOperationSchema>;
export type MaintenanceCurrentItem = z.infer<
  typeof maintenanceCurrentItemSchema
>;
export const maintenanceStartResponseSchema = z.object({
  operation: maintenanceOperationSchema,
});
export const maintenanceStatusResponseSchema = z.object({
  operation: maintenanceOperationSchema.nullable(),
});
export const maintenanceUpdatedEventSchema = maintenanceStartResponseSchema;
export function isMaintenanceActive(
  operation: MaintenanceOperation | null | undefined,
): boolean {
  return (
    operation !== null &&
    operation !== undefined &&
    ["queued", "running", "cancelling"].includes(operation.status)
  );
}
