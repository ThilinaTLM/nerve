import { z } from "zod";

// Stable identifiers for categories the UI knows how to render/clean.
export const storageCategoryKeySchema = z.enum([
  "conversations",
  "logs",
  "sqliteIndex",
  "exploreReports",
  "plans",
  "agents",
  "tasks",
  "workflowState", // suspensions, approvals, user-questions, handover(s)
  "projects",
  "workers",
  "cache",
  "tmp",
  "protected", // auth, keys, tls, config.json, daemon.json (never cleared)
  "other",
]);
export type StorageCategoryKey = z.infer<typeof storageCategoryKeySchema>;

export const storageCategoryUsageSchema = z.object({
  key: storageCategoryKeySchema,
  label: z.string(),
  description: z.string(),
  bytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  cleanable: z.boolean(), // can be targeted by cleanup at all
  protected: z.boolean(), // secrets/config; never deleted
});
export type StorageCategoryUsage = z.infer<typeof storageCategoryUsageSchema>;

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

// Cleanup is a set of independent, explicitly-opted-in targets.
export const storageCleanupRequestSchema = z
  .object({
    conversationsOlderThanDays: z
      .number()
      .int()
      .positive()
      .max(3650)
      .optional(),
    logsOlderThanDays: z.number().int().positive().max(3650).optional(),
    truncateEventLog: z.boolean().optional(), // delete rotated events.jsonl.1
    clearToolCallLog: z.boolean().optional(), // truncate logs/tool-calls.jsonl
    clearExploreReports: z.boolean().optional(),
    clearCache: z.boolean().optional(),
    clearTmp: z.boolean().optional(),
    vacuumSqlite: z.boolean().optional(), // checkpoint + VACUUM
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
  target: z.string(),
  freedBytes: z.number().int().nonnegative(),
  removedItems: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  note: z.string().optional(),
});
export type StorageCleanupResult = z.infer<typeof storageCleanupResultSchema>;

export const storageCleanupResponseSchema = z.object({
  freedBytes: z.number().int().nonnegative(),
  results: z.array(storageCleanupResultSchema),
  usage: storageUsageResponseSchema, // post-cleanup snapshot for instant refresh
});
export type StorageCleanupResponse = z.infer<
  typeof storageCleanupResponseSchema
>;
