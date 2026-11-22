import { z } from "zod";

export const backgroundJobStatusSchema = z.enum(["idle", "running", "failing"]);
export type BackgroundJobStatus = z.infer<typeof backgroundJobStatusSchema>;

export const backgroundJobRunSchema = z.object({
  startedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  outcome: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), summary: z.string() }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
});
export type BackgroundJobRun = z.infer<typeof backgroundJobRunSchema>;

/** In-memory state of one registered job; rebuilt on every daemon start. */
export const backgroundJobSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  description: z.string(),
  intervalMs: z.number().int().positive(),
  status: backgroundJobStatusSchema,
  /** Start of the current run while `status` is `running`. */
  runningSince: z.string().datetime().optional(),
  lastRun: backgroundJobRunSchema.optional(),
  /** Absent while running. */
  nextRun: z.string().datetime().optional(),
});
export type BackgroundJob = z.infer<typeof backgroundJobSchema>;

/** One job's new state; the event is scoped by job id so the latest per job wins. */
export const backgroundJobsChangedEventSchema = z.object({
  job: backgroundJobSchema,
});
