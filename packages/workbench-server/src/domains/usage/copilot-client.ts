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
  writeUsageCacheFile,
  type UsageApiResponse,
} from "./cached-usage-fetch.js";

/** GitHub OAuth token (not the exchanged Copilot token) and optional GHE host. */
export type CopilotUsageRequest = {
  githubToken: string;
  enterpriseUrl?: string;
};

// Same client identity pi-ai uses for the Copilot token exchange.
const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
};

const PLAN_LABELS: Record<string, string> = {
  individual: "Pro",
  individual_pro: "Pro+",
  individual_max: "Max",
  individual_edu: "Student",
  business: "Business",
  enterprise: "Enterprise",
};

function cacheFile(cacheDir: string): string {
  return join(cacheDir, "copilot-usage.json");
}

function readCacheFile(cacheDir: string) {
  return readUsageCacheFile(cacheFile(cacheDir), "github-copilot");
}

async function writeCacheFile(
  cacheDir: string,
  data: SubscriptionUsage,
): Promise<void> {
  await writeUsageCacheFile(cacheDir, cacheFile(cacheDir), data);
}

/** `api.github.com`, or `api.<host>` for GitHub Enterprise (GHE.com) logins. */
export function copilotApiHost(enterpriseUrl: string | undefined): string {
  const raw = enterpriseUrl?.trim();
  if (!raw) return "api.github.com";
  try {
    const host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    ).hostname.toLowerCase();
    if (!host || host === "github.com" || host === "api.github.com") {
      return "api.github.com";
    }
    return host.startsWith("api.") ? host : `api.${host}`;
  } catch {
    return "api.github.com";
  }
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function planLabel(user: Json): string | null {
  if (user.access_type_sku === "free_limited_copilot") return "Free";
  if (user.access_type_sku === "free_educational_quota") return "Student";
  const plan = typeof user.copilot_plan === "string" ? user.copilot_plan : "";
  return PLAN_LABELS[plan] ?? (plan || null);
}

type QuotaName = { id: string; label: string; unit: string };

/**
 * Normalizes one `quota_snapshots` entry, mirroring VS Code's own reading of
 * the payload. Returns `null` for snapshots without an allocation.
 */
function snapshotQuota(
  raw: Json,
  name: QuotaName,
  accountReset: string | null,
): SubscriptionQuota | null {
  const entitlement = numberValue(raw.entitlement);
  const unlimited = raw.unlimited === true;
  if (!unlimited && entitlement === 0) return null;

  const resetAtSeconds = numberValue(raw.quota_reset_at);
  const resetsAt = resetAtSeconds
    ? new Date(resetAtSeconds * 1000).toISOString()
    : accountReset;
  const base = {
    ...name,
    resetsAt,
    resetAfterSeconds: null,
    windowMinutes: null,
  };
  const overageUsed = numberValue(raw.overage_count);
  const overage =
    typeof raw.overage_permitted === "boolean" || overageUsed != null
      ? { permitted: raw.overage_permitted === true, used: overageUsed ?? 0 }
      : undefined;

  if (unlimited) {
    // Pooled organization seats without a per-user budget: no cap to measure
    // against, only aggregate consumption.
    const creditsUsed = numberValue(raw.credits_used);
    return {
      ...base,
      usedPercent: null,
      unlimited: true,
      ...(creditsUsed != null && creditsUsed >= 0 ? { used: creditsUsed } : {}),
      ...(raw.has_quota === false ? { exhausted: true } : {}),
    };
  }

  const percentRemaining = numberValue(raw.percent_remaining);
  const remaining = numberValue(raw.quota_remaining ?? raw.remaining);
  const limit = entitlement != null && entitlement > 0 ? entitlement : null;
  let usedPercent =
    percentRemaining != null ? clampPercent(100 - percentRemaining) : null;
  let used: number | null = null;
  if (limit != null) {
    if (remaining != null) used = Math.max(0, limit - remaining);
    else if (usedPercent != null) used = (limit * usedPercent) / 100;
    if (usedPercent == null && used != null) {
      usedPercent = clampPercent((used / limit) * 100);
    }
  }
  if (usedPercent == null && used == null) return null;
  return {
    ...base,
    usedPercent,
    used,
    limit,
    ...(overage ? { overage } : {}),
  };
}

/** Copilot Free's legacy shape: monthly allowances and what is left. */
function legacyQuota(
  monthly: Json | undefined,
  left: Json | undefined,
  key: "chat" | "completions",
  name: QuotaName,
  resetsAt: string | null,
): SubscriptionQuota | null {
  const limit = numberValue(monthly?.[key]);
  const remaining = numberValue(left?.[key]);
  if (limit == null || limit <= 0 || remaining == null) return null;
  const used = Math.max(0, limit - remaining);
  return {
    ...name,
    usedPercent: clampPercent((used / limit) * 100),
    used,
    limit,
    resetsAt,
    resetAfterSeconds: null,
    windowMinutes: null,
  };
}

/** Parse a `copilot_internal/user` payload into a normalized snapshot. */
export function parseCopilotUsageResponse(
  payload: unknown,
): SubscriptionUsage | null {
  const user = record(payload);
  if (!user) return null;
  const tokenBased = user.token_based_billing === true;
  const accountReset =
    isoDate(user.quota_reset_date_utc) ?? isoDate(user.quota_reset_date);
  const credits: QuotaName = tokenBased
    ? { id: "credits", label: "AI credits", unit: "credits" }
    : { id: "requests", label: "Premium requests", unit: "requests" };

  const quotas: SubscriptionQuota[] = [];
  const snapshots = record(user.quota_snapshots);
  const premium = record(snapshots?.premium_interactions);
  const chat = record(snapshots?.chat);
  const completions = record(snapshots?.completions);
  if (premium) {
    const quota = snapshotQuota(premium, credits, accountReset);
    if (quota) quotas.push(quota);
  }
  if (chat) {
    // Under token-based billing a capped chat snapshot (Copilot Free) is the
    // plan's credit allowance rather than a message count.
    const name =
      chat.unlimited === true
        ? { id: "chat", label: "Chat", unit: "messages" }
        : tokenBased
          ? credits
          : { id: "chat", label: "Chat messages", unit: "messages" };
    const quota = quotas.some((q) => q.id === name.id)
      ? null
      : snapshotQuota(chat, name, accountReset);
    if (quota) quotas.push(quota);
  }
  const completionsName = {
    id: "completions",
    label: "Completions",
    unit: "completions",
  };
  if (completions) {
    const quota = snapshotQuota(completions, completionsName, accountReset);
    if (quota) quotas.push(quota);
  }

  const monthly = record(user.monthly_quotas);
  const left = record(user.limited_user_quotas);
  const freeReset = isoDate(user.limited_user_reset_date) ?? accountReset;
  if (!chat) {
    const quota = legacyQuota(
      monthly,
      left,
      "chat",
      { id: "chat", label: "Chat messages", unit: "messages" },
      freeReset,
    );
    if (quota) quotas.push(quota);
  }
  if (!completions) {
    const quota = legacyQuota(
      monthly,
      left,
      "completions",
      completionsName,
      freeReset,
    );
    if (quota) quotas.push(quota);
  }

  if (quotas.length === 0) return null;
  return {
    provider: "github-copilot",
    quotas,
    planType: planLabel(user),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchApi(
  request: CopilotUsageRequest,
): Promise<UsageApiResponse<unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const host = copilotApiHost(request.enterpriseUrl);
    const res = await fetch(`https://${host}/copilot_internal/user`, {
      method: "GET",
      headers: {
        ...COPILOT_HEADERS,
        Authorization: `token ${request.githubToken}`,
        accept: "application/json",
      },
      redirect: "error",
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
 * Fetch GitHub Copilot plan usage (monthly AI credits or premium requests)
 * from the internal entitlement endpoint used by VS Code. Memoized with
 * rate-limit backoff like the other usage fetchers.
 */
export const fetchCopilotUsage = createCachedUsageFetcher({
  lockFileName: "copilot-usage.lock",
  readCacheFile,
  writeCacheFile,
  fetchApi,
  parseResponse: parseCopilotUsageResponse,
});
