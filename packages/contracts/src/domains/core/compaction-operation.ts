import { z } from "zod";

/** Latest runtime checkpoint operation; committed summaries remain transcript events. */
export const compactionOperationSchema = z.object({
  /** Allocated up front and reused as the committed compaction event ID. */
  id: z.string(),
  /** Increases across operations in this conversation during the daemon lifetime. */
  revision: z.number().int().positive(),
  reason: z.enum(["manual", "threshold", "overflow"]),
  /** `queued` is a pending manual request that runs at the next input boundary. */
  status: z.enum([
    "queued",
    "running",
    "stopping",
    "completed",
    "failed",
    "cancelled",
  ]),
  /** Request time while queued; reset when the operation starts running. */
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  /** Existing execution for automatic compaction; manual compaction has none. */
  executionId: z.string().optional(),
  /** Selected head when the operation began, for terminal draft placement. */
  headEventId: z.string().nullable(),
  /** Repair attempts replace, rather than append to, the preceding draft. */
  attempt: z.union([z.literal(1), z.literal(2)]),
  /** Bounded tail of accumulated, uncommitted checkpoint text. */
  summaryPreview: z.string().max(65_536),
  eventId: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type CompactionOperation = z.infer<typeof compactionOperationSchema>;
