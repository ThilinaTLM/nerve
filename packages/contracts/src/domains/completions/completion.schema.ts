import { z } from "zod";

export const completionKindSchema = z.enum(["slash", "file", "directory"]);
export type CompletionKind = z.infer<typeof completionKindSchema>;

export const completionMatchRangeSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);
export type CompletionMatchRange = z.infer<typeof completionMatchRangeSchema>;

export const completionItemSchema = z.object({
  label: z.string().min(1),
  detail: z.string().optional(),
  info: z.string().optional(),
  kind: completionKindSchema,
  apply: z.string().optional(),
  displayLabel: z.string().optional(),
  sortScore: z.number().optional(),
  matchRanges: z.array(completionMatchRangeSchema).optional(),
});
export type CompletionItem = z.infer<typeof completionItemSchema>;

export const completionResponseSchema = z.object({
  items: z.array(completionItemSchema),
});
export type CompletionResponse = z.infer<typeof completionResponseSchema>;

export const fileCompletionQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  q: z.string().optional().default(""),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export type FileCompletionQuery = z.infer<typeof fileCompletionQuerySchema>;
