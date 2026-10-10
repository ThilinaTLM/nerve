import type { SubscriptionUsage } from "@nervekit/contracts/usage";
import { protocolRequest } from "$lib/application/startup/workbench-connection";

export async function getSubscriptionUsage(): Promise<SubscriptionUsage[]> {
  return (await protocolRequest("usage.subscription.get", {})).result.usage;
}
