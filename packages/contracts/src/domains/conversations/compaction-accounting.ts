import { z } from "zod";

export const checkpointAnchorSchema = z.object({
  sourceEntryId: z.string(),
  kind: z.enum(["request", "assignment", "steering", "plan"]),
  text: z.string(),
});
export type CheckpointAnchor = z.infer<typeof checkpointAnchorSchema>;
export const anchorOverflowSchema = z.object({
  sourceEntryId: z.string(),
  kind: checkpointAnchorSchema.shape.kind,
});
export type AnchorOverflow = z.infer<typeof anchorOverflowSchema>;

/** Lossless checkpoint data, separate from the generated working-state summary. */
export interface CheckpointDetails {
  anchors?: CheckpointAnchor[];
  anchorOverflow?: AnchorOverflow[];
  /** Original stored provider proposal IDs, including proposals removed by earlier checkpoints. */
  knownToolCallIds?: string[];
}

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
  anchorTokens: z.number().int().nonnegative().optional(),
  anchorOverflow: z.array(anchorOverflowSchema).optional(),
});
export type CompactionAccounting = z.infer<typeof compactionAccountingSchema>;
