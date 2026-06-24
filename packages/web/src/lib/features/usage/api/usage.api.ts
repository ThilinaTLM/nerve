import type { SubscriptionUsage } from "@nervekit/shared";
import { apiGet } from "../../../core/api/client";

export async function getSubscriptionUsage(): Promise<SubscriptionUsage[]> {
  return (
    await apiGet<{ usage: SubscriptionUsage[] }>("/api/usage/subscription")
  ).usage;
}
