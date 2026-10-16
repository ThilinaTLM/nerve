import { z } from "zod";

export const upgradeStepIdSchema = z.string().regex(/^\d{4}-[a-z0-9-]+$/);

export const upgradeReportSetAsideSchema = z.object({
  kind: z.enum(["conversation", "configuration"]),
  id: z.string(),
  title: z.string().optional(),
  reason: z.string(),
  quarantinePath: z.string(),
});

export const upgradeReportLossSchema = z.object({
  reason: z.string(),
  count: z.number().int().nonnegative(),
});

/** Persisted by the migration framework after a step commits successfully. */
export const upgradeReportSchema = z.object({
  step: upgradeStepIdSchema,
  description: z.string(),
  completedAt: z.string(),
  setAside: z.array(upgradeReportSetAsideSchema),
  losses: z.array(upgradeReportLossSchema),
});

export const upgradeReportListSchema = z.object({
  reports: z.array(upgradeReportSchema),
});

export type UpgradeReportSetAside = z.infer<typeof upgradeReportSetAsideSchema>;
export type UpgradeReportLoss = z.infer<typeof upgradeReportLossSchema>;
export type UpgradeReport = z.infer<typeof upgradeReportSchema>;
export type UpgradeReportList = z.infer<typeof upgradeReportListSchema>;
