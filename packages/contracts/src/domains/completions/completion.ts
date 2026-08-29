import { z } from "zod";

export const FILE_COMPLETION_RESULT_LIMIT = 8;
export const FILE_COMPLETION_QUERY_MAX_LENGTH = 512;

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
  q: z.string().max(FILE_COMPLETION_QUERY_MAX_LENGTH).optional().default(""),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(FILE_COMPLETION_RESULT_LIMIT)
    .optional()
    .default(FILE_COMPLETION_RESULT_LIMIT),
});
export type FileCompletionQuery = z.infer<typeof fileCompletionQuerySchema>;
