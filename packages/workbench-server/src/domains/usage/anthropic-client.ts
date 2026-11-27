import type {
  SubscriptionQuota,
  SubscriptionUsage,
} from "@nervekit/contracts/usage";
import {
  createCachedUsageFetcher,
  fetchUsageApi,
  numberValue,
  windowQuota,
  type UsageApiResponse,
} from "./cached-usage-fetch.js";

const API_HOST = "api.anthropic.com";
const API_PATH = "/api/oauth/usage";
const API_URL = `https://${API_HOST}${API_PATH}`;

function normalizeIsoDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function toQuota(
  id: string,
  label: string,
  windowMinutes: number,
  raw: Record<string, unknown> | undefined,
): SubscriptionQuota | null {
  if (!raw) return null;
  const usedPercent = numberValue(raw.utilization);
  const resetsAt = normalizeIsoDateTime(raw.resets_at);
  if (usedPercent == null && resetsAt == null) return null;
  return windowQuota(id, label, {
    usedPercent,
    resetsAt,
    resetAfterSeconds: null,
    windowMinutes,
  });
}

export function parseAnthropicUsageResponse(
  raw: string,
): SubscriptionUsage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const quotas = [
    toQuota(
      "session",
      "Session",
      5 * 60,
      obj.five_hour as Record<string, unknown> | undefined,
    ),
    toQuota(
      "weekly",
      "Weekly",
      7 * 24 * 60,
      obj.seven_day as Record<string, unknown> | undefined,
    ),
  ].filter((quota) => quota !== null);
  if (quotas.length === 0) return null;
  return {
    provider: "anthropic",
    quotas,
    planType: null,
    updatedAt: new Date().toISOString(),
  };
}

function fetchApi(token: string): Promise<UsageApiResponse> {
  return fetchUsageApi(
    API_URL,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    },
    (res) => res.text(),
  );
}

/**
 * Fetch Anthropic subscription usage (5h session + 7d weekly) using an OAuth
 * bearer token. Memoized for {@link CACHE_MAX_AGE_MS} with rate-limit backoff;
 * the last good snapshot is served on transient failures.
 */
export const fetchAnthropicUsage = createCachedUsageFetcher({
  cacheName: "anthropic",
  provider: "anthropic",
  fetchApi,
  parseResponse: parseAnthropicUsageResponse,
});
