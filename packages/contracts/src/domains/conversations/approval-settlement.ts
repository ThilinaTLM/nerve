import { z } from "zod";

/** Durable work owed after an approval decision, not a second decision store. */
export const approvalSettlementSchema = z.object({
  id: z.string().min(1).max(256),
  conversationId: z.string().startsWith("conv_"),
  runId: z.string().startsWith("run_").optional(),
  executionId: z.string().startsWith("exec_").optional(),
  checkpointId: z.string().startsWith("checkpoint_").optional(),
  toolCallIds: z.array(z.string().startsWith("tool_")).min(1).max(32),
  phase: z.enum([
    "awaiting_decisions",
    "ready",
    "executing",
    "continuation_pending",
    "completed",
    "blocked",
    "cancelled",
  ]),
  revision: z.number().int().positive(),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string().datetime().optional(),
  failure: z
    .object({
      code: z.string().min(1).max(128),
      message: z.string().min(1).max(2000),
      retryable: z.boolean(),
    })
    .optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ApprovalSettlement = z.infer<typeof approvalSettlementSchema>;
export const isOutstandingApprovalSettlement = (
  value: ApprovalSettlement,
): boolean => !["completed", "cancelled"].includes(value.phase);
