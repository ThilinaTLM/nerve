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
  // Recovery gates workbench startup; the refresh may wait on provider APIs.
  const unregisterReconnect = onWorkbenchReconnect(() => {
    void refreshSubscriptionUsage().catch(() => undefined);
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
