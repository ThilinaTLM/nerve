import type { SubscriptionUsageEntry } from "../usage-types";

/** Active provider wins even without data; only inactive selection may fall back. */
export function selectUsageTriggerEntry(
  entries: readonly SubscriptionUsageEntry[],
): SubscriptionUsageEntry | undefined {
  return (
    entries.find((entry) => entry.active) ??
    entries.find((entry) => entry.usage?.session || entry.usage?.weekly)
  );
}
