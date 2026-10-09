import type { ConversationEvent } from "@nervekit/contracts/core";

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
  entries: readonly ConversationEvent[],
): ConversationUsageSummary {
  const summary = emptyConversationUsage();
  for (const entry of entries) {
    if (entry.type !== "assistant_message") continue;
    const usage = entry.payload.usage;
    summary.responseCount += 1;
    summary.input += usage.input;
    summary.output += usage.output;
    summary.cacheRead += usage.cacheRead;
    summary.cacheWrite += usage.cacheWrite;
    summary.totalTokens += usage.totalTokens;
    summary.cost += usage.cost.total;
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
