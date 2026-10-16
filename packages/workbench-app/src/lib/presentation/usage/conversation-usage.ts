import type { ConversationUsageSummary } from "@nervekit/contracts/core";
import type { ConversationEntry } from "$lib/presentation/view-models/conversation";

export type { ConversationUsageSummary } from "@nervekit/contracts/core";

/**
 * Cost follows the all-time cached share of input, so cache health is judged
 * over every recorded response. New context is never cached on first send, so
 * the all-time rate starts low and climbs as the conversation grows; the
 * expected rate rises with it. Ordered strictest first: more than
 * `afterResponses` responses require at least `minPercent` cached.
 *
 * Calibrated on recorded conversations (each tier sits just below the 5th
 * percentile of healthy ones): about 3–4% of healthy Codex/Anthropic
 * conversations ever warn, while 99% of Codex conversations without a prompt
 * cache key (≈5–25% cached) do.
 */
export const CACHE_HEALTH_TIERS = [
  { afterResponses: 50, minPercent: 85 },
  { afterResponses: 30, minPercent: 80 },
  { afterResponses: 20, minPercent: 70 },
  { afterResponses: 10, minPercent: 50 },
] as const;

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

/** The all-time cached-input percentage expected at this response count. */
export function expectedCacheRate(responseCount: number): number | null {
  return (
    CACHE_HEALTH_TIERS.find((tier) => responseCount > tier.afterResponses)
      ?.minPercent ?? null
  );
}

/** True when the all-time cache rate is below the rate expected by now. */
export function isCacheRateCritical(
  metrics: ConversationUsageMetrics,
): boolean {
  const expected = expectedCacheRate(metrics.responseCount);
  return (
    expected != null &&
    metrics.cacheRate != null &&
    metrics.cacheRate < expected
  );
}
