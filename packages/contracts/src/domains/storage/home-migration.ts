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

export const homeMigrationIssueSchema = z
  .object({
    id: z.string().min(1),
    migrationId: z.string().min(1),
    scope: z.enum(["conversation", "global"]),
    disposition: z.enum(["skippable", "required"]),
    code: z.string().min(1),
    reason: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    conversationTitle: z.string().min(1).optional(),
  })
  .strict();
export type HomeMigrationIssue = z.infer<typeof homeMigrationIssueSchema>;

export const currentHomeMigrationPlanSchema = z
  .object({
    format: z.literal("nerve-current-home-migration-plan"),
    version: z.literal(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    migrationIds: z.array(z.string().min(1)),
    issues: z.array(homeMigrationIssueSchema),
  })
  .strict();
export type CurrentHomeMigrationPlan = z.infer<
  typeof currentHomeMigrationPlanSchema
>;

export const currentHomeMigrationApprovalSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    approvedIssueIds: z.array(z.string().min(1)),
  })
  .strict();
export type CurrentHomeMigrationApproval = z.infer<
  typeof currentHomeMigrationApprovalSchema
>;

export const currentHomeMigrationReportSchema = z
  .object({
    format: z.literal("nerve-current-home-migration"),
    version: z.literal(1),
    migrationIds: z.array(z.string().min(1)),
    skippedConversations: z.array(
      z
        .object({
          conversationId: z.string().min(1),
          issueId: z.string().min(1),
          code: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
    backupPath: z.string().min(1).optional(),
  })
  .strict();
export type CurrentHomeMigrationReport = z.infer<
  typeof currentHomeMigrationReportSchema
>;
