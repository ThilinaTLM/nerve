import { z } from "zod";

export const storageCategoryKeySchema = z.enum([
  "conversations",
  "logs",
  "sqliteIndex",
  "exploreReports",
  "plans",
  "agents",
  "tasks",
  "workflowState",
  "projects",
  "workers",
  "cache",
  "tmp",
  "protected",
  "other",
]);
export type StorageCategoryKey = z.infer<typeof storageCategoryKeySchema>;

export const storageCategoryUsageSchema = z.object({
  key: storageCategoryKeySchema,
  label: z.string(),
  description: z.string(),
  bytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  cleanable: z.boolean(),
  protected: z.boolean(),
});
export type StorageCategoryUsage = z.infer<typeof storageCategoryUsageSchema>;

export const storageCleanupTargetSchema = z.enum([
  "conversations",
  "datedLogs",
  "rotatedEventLog",
  "toolCallLog",
  "exploreReports",
  "cache",
  "tmp",
  "searchIndex",
]);
export type StorageCleanupTarget = z.infer<typeof storageCleanupTargetSchema>;

export const storageCleanupTargetUsageSchema = z.object({
  target: storageCleanupTargetSchema,
  bytes: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  estimate: z.enum(["exact", "upTo", "unknown"]),
});
export type StorageCleanupTargetUsage = z.infer<
  typeof storageCleanupTargetUsageSchema
>;

export const largestConversationUsageSchema = z.object({
  conversationId: z.string(),
  title: z.string().nullable(),
  bytes: z.number().int().nonnegative(),
});
export type LargestConversationUsage = z.infer<
  typeof largestConversationUsageSchema
>;

export const storageUsageResponseSchema = z.object({
  dataDir: z.string(),
  generatedAt: z.string().datetime(),
  totalBytes: z.number().int().nonnegative(),
  categories: z.array(storageCategoryUsageSchema),
  cleanupTargets: z.array(storageCleanupTargetUsageSchema),
  sqlite: z.object({
    dbBytes: z.number().int().nonnegative(),
    walBytes: z.number().int().nonnegative(),
    shmBytes: z.number().int().nonnegative(),
  }),
  conversations: z.object({
    total: z.number().int().nonnegative(),
    largest: z.array(largestConversationUsageSchema),
  }),
});
export type StorageUsageResponse = z.infer<typeof storageUsageResponseSchema>;

export const storageCleanupRequestSchema = z
  .object({
    conversationsOlderThanDays: z
      .number()
      .int()
      .positive()
      .max(3650)
      .optional(),
    logsOlderThanDays: z.number().int().positive().max(3650).optional(),
    truncateEventLog: z.boolean().optional(),
    clearToolCallLog: z.boolean().optional(),
    clearExploreReports: z.boolean().optional(),
    clearCache: z.boolean().optional(),
    clearTmp: z.boolean().optional(),
    rebuildSearchIndex: z.boolean().optional(),
  })
  .refine(
    (value) =>
      Object.values(value).some(
        (entry) => entry !== undefined && entry !== false,
      ),
    { message: "Select at least one cleanup target." },
  );
export type StorageCleanupRequest = z.infer<typeof storageCleanupRequestSchema>;

export const storageCleanupResultSchema = z.object({
  target: storageCleanupTargetSchema,
  outcome: z.enum(["succeeded", "failed", "cancelled"]),
  freedBytes: z.number().int().nonnegative(),
  removedItems: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  note: z.string().optional(),
  error: z.string().optional(),
});
export type StorageCleanupResult = z.infer<typeof storageCleanupResultSchema>;

export const storageCleanupOperationStatusSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
]);
export type StorageCleanupOperationStatus = z.infer<
  typeof storageCleanupOperationStatusSchema
>;

export const storageCleanupOperationSchema = z.object({
  id: z.string().startsWith("storageop_"),
  request: storageCleanupRequestSchema,
  status: storageCleanupOperationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  currentTarget: storageCleanupTargetSchema.optional(),
  message: z.string(),
  completedTargets: z.number().int().nonnegative(),
  totalTargets: z.number().int().nonnegative(),
  cancellable: z.boolean(),
  cancellationRequested: z.boolean().default(false),
  freedBytes: z.number().int().nonnegative(),
  results: z.array(storageCleanupResultSchema),
  usage: storageUsageResponseSchema.optional(),
  error: z.string().optional(),
});
export type StorageCleanupOperation = z.infer<
  typeof storageCleanupOperationSchema
>;

export const storageCleanupStartResponseSchema = z.object({
  operation: storageCleanupOperationSchema,
});
export type StorageCleanupStartResponse = z.infer<
  typeof storageCleanupStartResponseSchema
>;

export const storageCleanupGetParamsSchema = z
  .object({ operationId: z.string().startsWith("storageop_").optional() })
  .optional();
export type StorageCleanupGetParams = z.infer<
  typeof storageCleanupGetParamsSchema
>;

export const storageCleanupStatusResponseSchema = z.object({
  operation: storageCleanupOperationSchema.nullable(),
});
export type StorageCleanupStatusResponse = z.infer<
  typeof storageCleanupStatusResponseSchema
>;

export const storageCleanupCancelParamsSchema = z.object({
  operationId: z.string().startsWith("storageop_"),
});
export type StorageCleanupCancelParams = z.infer<
  typeof storageCleanupCancelParamsSchema
>;

export const storageCleanupCancelResponseSchema = z.object({
  operation: storageCleanupOperationSchema,
});
export type StorageCleanupCancelResponse = z.infer<
  typeof storageCleanupCancelResponseSchema
>;

export const storageCleanupUpdatedEventSchema = z.object({
  operation: storageCleanupOperationSchema,
});
export type StorageCleanupUpdatedEvent = z.infer<
  typeof storageCleanupUpdatedEventSchema
>;
