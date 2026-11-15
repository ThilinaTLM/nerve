import type { SubscriptionUsage } from "@nervekit/contracts/usage";
import type { SubscriptionUsageEntry } from "$lib/features/usage/usage-types";

const SUBSCRIPTION_PROVIDER_ORDER = [
  "anthropic",
  "openai-codex",
  "github-copilot",
] as const;

/** Providers with a snapshot, plus the selected one so its chip stays visible. */
export function subscriptionUsageEntries(
  usages: Readonly<Record<string, SubscriptionUsage>>,
  selectedProvider: string | undefined,
): SubscriptionUsageEntry[] {
  return SUBSCRIPTION_PROVIDER_ORDER.map((provider) => ({
    provider,
    usage: usages[provider],
    active: provider === selectedProvider,
  })).filter((entry) => entry.usage || entry.active);
}
