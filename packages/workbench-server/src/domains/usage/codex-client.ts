import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  subscriptionUsageSchema,
  type SubscriptionUsage,
  type SubscriptionWindow,
} from "@nervekit/contracts/usage";
import {
  API_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_BACKOFF_MS,
  createCachedUsageFetcher,
  numberValue,
  parseRetryAfterMs,
  writeUsageCacheFile,
  type UsageApiResponse,
} from "./cached-usage-fetch.js";

const API_URL = "https://chatgpt.com/backend-api/wham/usage";
const ACCOUNT_ID_CLAIM = "https://api.openai.com/auth.chatgpt_account_id";

function cacheFile(cacheDir: string): string {
  return join(cacheDir, "codex-usage.json");
}

async function readCacheFile(cacheDir: string): Promise<{
  data: SubscriptionUsage | null;
  time: number;
} | null> {
  const path = cacheFile(cacheDir);
  try {
    const parsed = subscriptionUsageSchema.safeParse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (!parsed.success || parsed.data.provider !== "openai-codex") return null;
    return {
      data: normalizeCodexSnapshot(parsed.data),
      time: (await stat(path)).mtimeMs,
    };
  } catch {
    return null;
  }
}

async function writeCacheFile(
  cacheDir: string,
  data: SubscriptionUsage,
): Promise<void> {
  await writeUsageCacheFile(cacheDir, cacheFile(cacheDir), data);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeResetAt(value: number | null): number | null {
  if (value == null) return null;
  return value > 10_000_000_000 ? Math.round(value / 1000) : value;
}

function resetAfterFromResetAt(
  resetAt: number | null,
  nowMs: number,
): number | null {
  const normalized = normalizeResetAt(resetAt);
  if (normalized == null) return null;
  return Math.max(0, Math.round(normalized - nowMs / 1000));
}

type ApiWindow = Record<string, unknown> | null | undefined;

function parseApiWindow(
  window: ApiWindow,
  nowMs: number,
): SubscriptionWindow | null {
  if (!window) return null;
  const usedPercent = numberValue(window.used_percent ?? window.usedPercent);
  const resetAfterSeconds =
    numberValue(window.reset_after_seconds ?? window.resetAfterSeconds) ??
    resetAfterFromResetAt(
      numberValue(window.reset_at ?? window.resetAt),
      nowMs,
    );
  const limitWindowSeconds = numberValue(
    window.limit_window_seconds ?? window.windowSeconds,
  );
  const windowMinutes =
    numberValue(window.window_minutes ?? window.windowMinutes) ??
    (limitWindowSeconds != null ? limitWindowSeconds / 60 : null);
  if (
    usedPercent == null &&
    resetAfterSeconds == null &&
    windowMinutes == null
  ) {
    return null;
  }
  return { usedPercent, resetsAt: null, resetAfterSeconds, windowMinutes };
}

const SESSION_WINDOW_MINUTES = 5 * 60;
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;

function isApproximateWindow(
  windowMinutes: number | null,
  expectedMinutes: number,
): boolean {
  return (
    windowMinutes != null &&
    windowMinutes >= expectedMinutes * 0.95 &&
    windowMinutes <= expectedMinutes * 1.05
  );
}

type CodexWindowSlot = "session" | "weekly";

function durationSlot(window: SubscriptionWindow): CodexWindowSlot | null {
  if (isApproximateWindow(window.windowMinutes, SESSION_WINDOW_MINUTES)) {
    return "session";
  }
  if (isApproximateWindow(window.windowMinutes, WEEKLY_WINDOW_MINUTES)) {
    return "weekly";
  }
  return null;
}

/** Classify Codex windows by duration before falling back to provider position. */
function classifyCodexWindows(
  primary: SubscriptionWindow | null,
  secondary: SubscriptionWindow | null,
): Pick<SubscriptionUsage, "session" | "weekly"> {
  let session: SubscriptionWindow | null = null;
  let weekly: SubscriptionWindow | null = null;
  const unassigned: Array<{
    window: SubscriptionWindow;
    fallback: CodexWindowSlot;
  }> = [];

  for (const candidate of [
    { window: primary, fallback: "session" as const },
    { window: secondary, fallback: "weekly" as const },
  ]) {
    if (!candidate.window) continue;
    const slot = durationSlot(candidate.window);
    if (slot === "session" && !session) session = candidate.window;
    else if (slot === "weekly" && !weekly) weekly = candidate.window;
    else
      unassigned.push({
        window: candidate.window,
        fallback: candidate.fallback,
      });
  }

  for (const candidate of unassigned) {
    if (candidate.fallback === "session" && !session) {
      session = candidate.window;
    } else if (candidate.fallback === "weekly" && !weekly) {
      weekly = candidate.window;
    } else if (!session) {
      session = candidate.window;
    } else if (!weekly) {
      weekly = candidate.window;
    }
  }

  return { session, weekly };
}

function normalizeCodexSnapshot(
  snapshot: SubscriptionUsage,
): SubscriptionUsage {
  return {
    ...snapshot,
    ...classifyCodexWindows(snapshot.session, snapshot.weekly),
  };
}

/** Parse a Codex usage JSON payload into a normalized snapshot. */
export function parseCodexUsageResponse(
  payload: unknown,
  nowMs = Date.now(),
): SubscriptionUsage | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const api = payload as {
    plan_type?: unknown;
    planType?: unknown;
    rate_limit?: {
      primary_window?: ApiWindow;
      primaryWindow?: ApiWindow;
      secondary_window?: ApiWindow;
      secondaryWindow?: ApiWindow;
    } | null;
  };
  const primary = parseApiWindow(
    api.rate_limit?.primary_window ?? api.rate_limit?.primaryWindow,
    nowMs,
  );
  const secondary = parseApiWindow(
    api.rate_limit?.secondary_window ?? api.rate_limit?.secondaryWindow,
    nowMs,
  );
  if (!primary && !secondary) return null;
  const { session, weekly } = classifyCodexWindows(primary, secondary);
  return {
    provider: "openai-codex",
    session,
    weekly,
    planType: stringValue(api.plan_type ?? api.planType),
    updatedAt: new Date().toISOString(),
  };
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractAccountId(token: string): string | null {
  const [, payload] = token.split(".");
  if (!payload) return null;
  const claims = decodeBase64UrlJson(payload);
  return stringValue(
    claims?.[ACCOUNT_ID_CLAIM] ??
      claims?.chatgpt_account_id ??
      claims?.account_id,
  );
}

async function fetchApi(
  token: string,
  accountId: string | null,
): Promise<UsageApiResponse<unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      accept: "application/json",
      "user-agent": "nerve/0.0.0",
    };
    if (accountId) headers["chatgpt-account-id"] = accountId;
    const res = await fetch(API_URL, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (res.ok) return { kind: "success", body: await res.json() };
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
 * Fetch Codex subscription usage from the backend endpoint using an OAuth
 * bearer token. Memoized for {@link CACHE_MAX_AGE_MS} with rate-limit backoff.
 */
export const fetchCodexUsage = createCachedUsageFetcher({
  lockFileName: "codex-usage.lock",
  readCacheFile,
  writeCacheFile,
  fetchApi: (token) => fetchApi(token, extractAccountId(token)),
  parseResponse: parseCodexUsageResponse,
});
