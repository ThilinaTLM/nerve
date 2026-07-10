import type { SubscriptionUsage } from "@nervekit/contracts";
import { protocolRequest } from "../../../core/protocol/http-client";

export async function getSubscriptionUsage(): Promise<SubscriptionUsage[]> {
  return (
    await protocolRequest<{ usage: SubscriptionUsage[] }>(
      "usage.subscription.get",
      {},
    )
  ).result.usage;
}
