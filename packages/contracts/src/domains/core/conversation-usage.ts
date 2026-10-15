import { z } from "zod";

/** Cumulative recorded response usage; cached input is included in totalTokens. */
export const conversationUsageSummarySchema = z.object({
  responseCount: z.number().int().nonnegative(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
  cost: z.number(),
});
export type ConversationUsageSummary = z.infer<
  typeof conversationUsageSummarySchema
>;

export const conversationAgentUsageSchema = z.object({
  own: conversationUsageSummarySchema,
  subagents: conversationUsageSummarySchema,
  total: conversationUsageSummarySchema,
  subagentCount: z.number().int().nonnegative(),
});
export type ConversationAgentUsage = z.infer<
  typeof conversationAgentUsageSchema
>;
