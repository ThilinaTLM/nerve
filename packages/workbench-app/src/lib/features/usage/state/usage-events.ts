import type { SubscriptionUsage } from "$lib/api";
import { onEvent, type WorkbenchEvent } from "$lib/core/events/event-bus";
import { usageState } from "./usage-state.svelte";

export function registerUsageEventHandlers(): () => void {
  return onEvent("usage.subscription.updated", handleSubscriptionUsageUpdated);
}

function handleSubscriptionUsageUpdated(event: WorkbenchEvent): void {
  const usage = event.data as SubscriptionUsage | undefined;
  if (usage?.provider) {
    usageState.subscriptionUsage = {
      ...usageState.subscriptionUsage,
      [usage.provider]: usage,
    };
  }
}
