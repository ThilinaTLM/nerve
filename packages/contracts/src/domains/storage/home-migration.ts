import { z } from "zod";
import { nerveHomeClassSchema } from "../settings/home-configuration.js";

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

export const homeMigrationPlannerOutcomeSchema = z.enum([
  "ahead",
  "invalid",
  "corrupt",
  "drift",
  "pending",
  "sweep",
  "current",
]);
export type HomeMigrationPlannerOutcome = z.infer<
  typeof homeMigrationPlannerOutcomeSchema
>;

// Keep the shorter name available to callers that model the outcome separately.
export const homeMigrationPlanOutcomeSchema = homeMigrationPlannerOutcomeSchema;
export type HomeMigrationPlanOutcome = HomeMigrationPlannerOutcome;

export const homeMigrationStepKindSchema = z.enum([
  "schema",
  "data",
  "files",
  "config",
]);
export type HomeMigrationStepKind = z.infer<typeof homeMigrationStepKindSchema>;

export const homeMigrationStepStageSchema = z.enum([
  "draft",
  "final",
  "released",
]);
export type HomeMigrationStepStage = z.infer<
  typeof homeMigrationStepStageSchema
>;

export const homeMigrationStepSummarySchema = z
  .object({
    id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    description: z.string().min(1),
    kind: homeMigrationStepKindSchema,
    stage: homeMigrationStepStageSchema,
    status: z.enum(["pending", "applied", "adopted", "drifted"]),
    durationMs: z.number().int().nonnegative().optional(),
    quarantined: z.number().int().nonnegative(),
  })
  .strict();
export type HomeMigrationStepSummary = z.infer<
  typeof homeMigrationStepSummarySchema
>;

export const homeMigrationQuarantineUnitSchema = z.enum([
  "record",
  "conversation",
  "config",
  "file",
]);
export type HomeMigrationQuarantineUnit = z.infer<
  typeof homeMigrationQuarantineUnitSchema
>;

export const homeMigrationRecordClassSchema = z.enum([
  "derived",
  "user-content",
]);
export type HomeMigrationRecordClass = z.infer<
  typeof homeMigrationRecordClassSchema
>;

export const homeMigrationQuarantineEntrySummarySchema = z
  .object({
    id: z.string().min(1),
    sourceStep: z.string().min(1),
    unit: homeMigrationQuarantineUnitSchema,
    recordClass: homeMigrationRecordClassSchema,
    source: z.string().min(1),
    sourceKey: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    reason: z.string().min(1),
    affectedRecords: z.number().int().nonnegative(),
    affectedBytes: z.number().int().nonnegative(),
    requiresApproval: z.boolean(),
  })
  .strict();
export type HomeMigrationQuarantineEntrySummary = z.infer<
  typeof homeMigrationQuarantineEntrySummarySchema
>;

export const homeMigrationQuarantineSummarySchema = z
  .object({
    entries: z.array(homeMigrationQuarantineEntrySummarySchema),
    total: z.number().int().nonnegative(),
    derived: z.number().int().nonnegative(),
    userContent: z.number().int().nonnegative(),
    affectedRecords: z.number().int().nonnegative(),
    affectedBytes: z.number().int().nonnegative(),
    requiresApproval: z.boolean(),
  })
  .strict();
export type HomeMigrationQuarantineSummary = z.infer<
  typeof homeMigrationQuarantineSummarySchema
>;

export const homeMigrationFailureSchema = z
  .object({
    code: z.string().min(1),
    phase: z.enum([
      "lock",
      "inspect",
      "plan",
      "preflight",
      "stage",
      "apply",
      "validate",
      "sweep",
      "approval",
      "promote",
      "cleanup",
    ]),
    message: z.string().min(1),
    retryable: z.boolean(),
    stepId: z.string().min(1).optional(),
    recordKey: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    appVersion: z.string().min(1).optional(),
    gitSha: z.string().min(1).optional(),
    cause: z.string().min(1).optional(),
  })
  .strict();
export type HomeMigrationFailure = z.infer<typeof homeMigrationFailureSchema>;

export const homeMigrationFailureReportSchema = z
  .object({
    format: z.literal("nerve-home-migration-failure"),
    version: z.literal(1),
    runId: z.string().min(1),
    planFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    failedAt: z.string().datetime(),
    failure: homeMigrationFailureSchema,
    steps: z.array(homeMigrationStepSummarySchema),
    quarantine: homeMigrationQuarantineSummarySchema.optional(),
  })
  .strict();
export type HomeMigrationFailureReport = z.infer<
  typeof homeMigrationFailureReportSchema
>;

export const homeMigrationProgressSchema = z
  .object({
    phase: z.enum([
      "lock",
      "inspect",
      "plan",
      "preflight",
      "stage",
      "configuration",
      "conversations",
      "files",
      "apply",
      "validate",
      "verify",
      "sweep",
      "approval",
      "promote",
      "cleanup",
      "complete",
    ]),
    message: z.string().min(1),
    completed: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    step: homeMigrationStepSummarySchema.optional(),
    quarantine: homeMigrationQuarantineSummarySchema.optional(),
    failure: homeMigrationFailureSchema.optional(),
  })
  .strict()
  .refine(
    ({ completed, total }) =>
      completed === undefined || total === undefined || completed <= total,
    { message: "completed must not exceed total", path: ["completed"] },
  );
export type HomeMigrationProgress = z.infer<typeof homeMigrationProgressSchema>;

export const unifiedHomeMigrationPlanSchema = z
  .object({
    format: z.literal("nerve-home-migration-plan"),
    version: z.literal(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    outcome: homeMigrationPlannerOutcomeSchema,
    homeClass: nerveHomeClassSchema,
    buildId: z.string().min(1),
    steps: z.array(homeMigrationStepSummarySchema),
    quarantine: homeMigrationQuarantineSummarySchema.optional(),
    requiredBytes: z.number().int().nonnegative().optional(),
    availableBytes: z.number().int().nonnegative().optional(),
    message: z.string().min(1).optional(),
    failure: homeMigrationFailureSchema.optional(),
  })
  .strict();
export type UnifiedHomeMigrationPlan = z.infer<
  typeof unifiedHomeMigrationPlanSchema
>;

/** Current framework plan; named distinctly from the legacy current-home plan. */
export const homeMigrationPlanSchema = unifiedHomeMigrationPlanSchema;
export type HomeMigrationPlan = UnifiedHomeMigrationPlan;

export const homeMigrationApprovalSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    approvedQuarantineIds: z.array(z.string().min(1)),
  })
  .strict();
export type HomeMigrationApproval = z.infer<typeof homeMigrationApprovalSchema>;

export const homeMigrationResultSchema = z
  .object({
    format: z.literal("nerve-home-migration-result"),
    version: z.literal(1),
    runId: z.string().min(1),
    planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    outcome: z.enum(["current", "migrated", "swept"]),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    steps: z.array(homeMigrationStepSummarySchema),
    quarantine: homeMigrationQuarantineSummarySchema,
    snapshotPath: z.string().min(1).optional(),
  })
  .strict();
export type HomeMigrationResult = z.infer<typeof homeMigrationResultSchema>;

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
