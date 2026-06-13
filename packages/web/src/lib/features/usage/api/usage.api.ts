import type { SubscriptionUsage } from "@nerve/shared";
import { apiGet } from "../../../shared/api/client";

export async function getSubscriptionUsage(): Promise<SubscriptionUsage[]> {
  return (
    await apiGet<{ usage: SubscriptionUsage[] }>("/api/usage/subscription")
  ).usage;
}
