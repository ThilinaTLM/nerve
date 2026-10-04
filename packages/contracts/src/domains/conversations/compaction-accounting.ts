import { z } from "zod";

/** Conversation-only estimates, never measured full-provider-request usage. */
export const compactionAccountingSchema = z.object({
  estimatorVersion: z.literal(1),
  scope: z.literal("conversation"),
  summaryTokens: z.number().int().nonnegative(),
  retainedTokens: z.number().int().nonnegative(),
  retainedMessages: z.number().int().nonnegative(),
  retentionTarget: z.number().int().nonnegative(),
  retentionBudgetExceeded: z.boolean(),
  summaryTarget: z.number().int().positive(),
  summaryCeiling: z.number().int().positive(),
  summaryRepaired: z.boolean(),
});
export type CompactionAccounting = z.infer<typeof compactionAccountingSchema>;
