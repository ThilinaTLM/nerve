import { refreshSubscriptionUsage } from "$lib/application/settings";
import type { SubscriptionUsage } from "$lib/api";
import {
  onEvent,
  onWorkbenchReconnect,
  type WorkbenchEvent,
} from "$lib/application/events/workbench-event-bus";
import { usageState } from "./usage-state.svelte";

export function registerUsageEventHandlers(): () => void {
  const unregisterEvents = onEvent(
    "usage.subscription.updated",
    handleSubscriptionUsageUpdated,
  );
  const unregisterReconnect = onWorkbenchReconnect(async () => {
    await refreshSubscriptionUsage();
  });
  return () => {
    unregisterEvents();
    unregisterReconnect();
  };
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
