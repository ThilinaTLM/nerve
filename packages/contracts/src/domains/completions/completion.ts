import { z } from "zod";

export const FILE_COMPLETION_QUERY_MAX_LENGTH = 512;

export const completionKindSchema = z.enum([
  "slash",
  "file",
  "directory",
  "launch",
  "pull_request",
  "issue",
  "skill",
  "tool",
  "subagent_profile",
  "launch_definition",
  "subagent",
]);
export type CompletionKind = z.infer<typeof completionKindSchema>;

export const completionMatchRangeSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);
export type CompletionMatchRange = z.infer<typeof completionMatchRangeSchema>;

export const completionItemSchema = z.object({
  documentId: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  /** Effective configured flag only; true does not imply trust, usability or approval. */
  enabled: z.boolean().optional(),
  /** Current select/enable eligibility; blocked/untrusted entries can still be configured enabled. */
  available: z.boolean().optional(),
  /** Whether the owning API permits explicit disable, independently of configured state. */
  canDisable: z.boolean().optional(),
  unavailableReason: z.string().optional(),
  /** Lowercased referenced-entity state, separate from context detail. */
  status: z.string().optional(),
  scoreFactors: z
    .object({
      lexical: z.number(),
      context: z.number(),
      usage: z.number(),
      state: z.number(),
      prior: z.number().optional(),
    })
    .optional(),
  label: z.string().min(1),
  detail: z.string().optional(),
  info: z.string().optional(),
  kind: completionKindSchema,
  apply: z.string().optional(),
  displayLabel: z.string().optional(),
  sortScore: z.number().optional(),
  matchRanges: z.array(completionMatchRangeSchema).optional(),
  detailMatchRanges: z.array(completionMatchRangeSchema).optional(),
});
export type CompletionItem = z.infer<typeof completionItemSchema>;
