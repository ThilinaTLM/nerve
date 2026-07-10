import type { SubscriptionUsage } from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

export async function getSubscriptionUsage(): Promise<SubscriptionUsage[]> {
  return (
    await protocolRequest<{ usage: SubscriptionUsage[] }>(
      "usage.subscription.get",
      {},
    )
  ).result.usage;
}
