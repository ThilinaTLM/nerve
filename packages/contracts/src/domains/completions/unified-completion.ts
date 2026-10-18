import { z } from "zod";
import {
  completionItemSchema,
  completionKindSchema,
  FILE_COMPLETION_RESULT_LIMIT,
  FILE_COMPLETION_QUERY_MAX_LENGTH,
} from "./completion.js";

export const completionScopeSchema = z
  .object({
    projectId: z.string().min(1),
    conversationId: z.string().min(1).optional(),
  })
  .strict();
export type CompletionScope = z.infer<typeof completionScopeSchema>;
export const completionSearchRequestSchema = completionScopeSchema.extend({
  q: z.string().max(FILE_COMPLETION_QUERY_MAX_LENGTH).default(""),
  limit: z
    .number()
    .int()
    .min(1)
    .max(FILE_COMPLETION_RESULT_LIMIT)
    .default(FILE_COMPLETION_RESULT_LIMIT),
});
export type CompletionSearchRequest = z.infer<
  typeof completionSearchRequestSchema
>;
export const completionSourceStateSchema = z.object({
  source: z.string().min(1),
  status: z.enum(["loading", "fresh", "stale", "unavailable"]),
  refreshing: z.boolean().optional(),
  updatedAt: z.number().nonnegative().optional(),
});
export type CompletionSourceState = z.infer<typeof completionSourceStateSchema>;
export const completionSearchResponseSchema = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(completionItemSchema),
  sources: z.array(completionSourceStateSchema),
});
export type CompletionSearchResponse = z.infer<
  typeof completionSearchResponseSchema
>;
export const completionSelectionRequestSchema = completionScopeSchema.extend({
  documentId: z.string().min(1).max(4096),
  expectedVersion: z.string().min(1).max(256),
  action: z.enum(["select", "disable"]),
});
export type CompletionSelectionRequest = z.infer<
  typeof completionSelectionRequestSchema
>;
export const completionSelectionResponseSchema = z.object({
  item: completionItemSchema,
});
export type CompletionSelectionResponse = z.infer<
  typeof completionSelectionResponseSchema
>;
export const completionChangedSchema = completionScopeSchema.extend({
  revision: z.number().int().nonnegative(),
});
export type CompletionChanged = z.infer<typeof completionChangedSchema>;

const prefixes: Readonly<
  Record<string, readonly z.infer<typeof completionKindSchema>[]>
> = {
  file: ["file", "directory"],
  pr: ["pull_request"],
  issue: ["issue"],
  skill: ["skill"],
  tool: ["tool"],
  profile: ["subagent_profile"],
  agent: ["subagent_profile", "subagent"],
  launch: ["launch", "launch_definition"],
};
/** Shared syntax only, never lexical matching or authorization. */
export function parseCompletionIntent(raw: string): {
  text: string;
  kinds?: readonly z.infer<typeof completionKindSchema>[];
} {
  const token = raw.trim().replace(/^@+/, "");
  const colon = token.indexOf(":");
  const kinds =
    colon >= 0 ? prefixes[token.slice(0, colon).toLowerCase()] : undefined;
  return kinds ? { text: token.slice(colon + 1), kinds } : { text: token };
}
