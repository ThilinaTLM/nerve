import { z } from "zod";

export const legacyV2HomeMarkerSchema = z
  .object({
    format: z.literal("nerve-workbench-state"),
    version: z.literal(2),
  })
  .strict();
export type LegacyV2HomeMarker = z.infer<typeof legacyV2HomeMarkerSchema>;

export const homeMigrationCountsSchema = z
  .object({
    conversations: z.number().int().nonnegative(),
    conversationRecords: z.number().int().nonnegative(),
    durableEvents: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    agents: z.number().int().nonnegative(),
    payloads: z.number().int().nonnegative(),
    plans: z.number().int().nonnegative(),
    credentials: z.number().int().nonnegative(),
  })
  .strict();
export type HomeMigrationCounts = z.infer<typeof homeMigrationCountsSchema>;

export const homeMigrationReportSchema = z
  .object({
    format: z.literal("nerve-home-migration"),
    version: z.literal(1),
    sourceFormat: z.literal("nerve-workbench-state"),
    sourceVersion: z.literal(2),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    backupPath: z.string().min(1),
    counts: homeMigrationCountsSchema,
    warnings: z.array(z.string()),
  })
  .strict();
export type HomeMigrationReport = z.infer<typeof homeMigrationReportSchema>;

export type HomeMigrationProgress = {
  phase:
    | "inspect"
    | "stage"
    | "configuration"
    | "conversations"
    | "files"
    | "validate"
    | "promote";
  message: string;
};
