import { join } from "node:path";
import type {
  SubscriptionQuota,
  SubscriptionUsage,
} from "@nervekit/contracts/usage";
import {
  API_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_BACKOFF_MS,
  createCachedUsageFetcher,
  numberValue,
  parseRetryAfterMs,
  readUsageCacheFile,
  windowQuota,
  writeUsageCacheFile,
  type UsageApiResponse,
} from "./cached-usage-fetch.js";

const API_HOST = "api.anthropic.com";
const API_PATH = "/api/oauth/usage";
const API_URL = `https://${API_HOST}${API_PATH}`;

function cacheFile(cacheDir: string): string {
  return join(cacheDir, "anthropic-usage.json");
}

function readCacheFile(cacheDir: string) {
  return readUsageCacheFile(cacheFile(cacheDir), "anthropic");
}

async function writeCacheFile(
  cacheDir: string,
  data: SubscriptionUsage,
): Promise<void> {
  await writeUsageCacheFile(cacheDir, cacheFile(cacheDir), data);
}

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

async function fetchApi(token: string): Promise<UsageApiResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: controller.signal,
    });
    if (res.ok) return { kind: "success", body: await res.text() };
    if (res.status === 429) {
      return {
        kind: "rate-limited",
        retryAfterMs:
          parseRetryAfterMs(res.headers.get("retry-after"), Date.now()) ??
          DEFAULT_RATE_LIMIT_BACKOFF_MS,
      };
    }
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch Anthropic subscription usage (5h session + 7d weekly) using an OAuth
 * bearer token. Memoized for {@link CACHE_MAX_AGE_MS} with rate-limit backoff;
 * the last good snapshot is served on transient failures.
 */
export const fetchAnthropicUsage = createCachedUsageFetcher({
  lockFileName: "anthropic-usage.lock",
  readCacheFile,
  writeCacheFile,
  fetchApi: fetchApi,
  parseResponse: parseAnthropicUsageResponse,
});
