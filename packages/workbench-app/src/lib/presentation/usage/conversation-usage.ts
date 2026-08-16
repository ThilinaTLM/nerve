import type { ConversationEntry } from "@nervekit/contracts";

export interface ConversationUsageSummary {
  responseCount: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

export interface ConversationUsageMetrics extends ConversationUsageSummary {
  hasUsage: boolean;
  promptTokens: number;
  cachedTokens: number;
  uncachedTokens: number;
  cacheRate: number | null;
}

export function emptyConversationUsage(): ConversationUsageSummary {
  return {
    responseCount: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
  };
}

export function summarizeConversationUsage(
  entries: readonly Pick<ConversationEntry, "usage">[],
): ConversationUsageSummary {
  const summary = emptyConversationUsage();
  for (const entry of entries) {
    if (!entry.usage) continue;
    summary.responseCount += 1;
    summary.input += entry.usage.input;
    summary.output += entry.usage.output;
    summary.cacheRead += entry.usage.cacheRead;
    summary.cacheWrite += entry.usage.cacheWrite;
    summary.totalTokens += entry.usage.totalTokens;
    summary.cost += entry.usage.cost;
  }
  return summary;
}

export function conversationUsageMetrics(
  usage: ConversationUsageSummary,
): ConversationUsageMetrics {
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  return {
    ...usage,
    hasUsage: usage.responseCount > 0,
    promptTokens,
    cachedTokens: usage.cacheRead,
    uncachedTokens: usage.input + usage.cacheWrite,
    cacheRate: promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : null,
  };
}
