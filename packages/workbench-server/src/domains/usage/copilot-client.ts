import type {
  SubscriptionQuota,
  SubscriptionUsage,
} from "@nervekit/contracts/usage";
import {
  createCachedUsageFetcher,
  fetchUsageApi,
  numberValue,
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

/** Copilot Free's legacy shape: monthly chat allowance and what is left. */
function legacyChatQuota(
  monthly: Json | undefined,
  left: Json | undefined,
  name: QuotaName,
  resetsAt: string | null,
): SubscriptionQuota | null {
  const limit = numberValue(monthly?.chat);
  const remaining = numberValue(left?.chat);
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

/**
 * Parse a `copilot_internal/user` payload into a normalized snapshot.
 * Completions quotas are ignored: Nerve has no inline completions. Unlimited
 * chat snapshots are dropped too: chat is billed in AI credits, which the
 * premium snapshot already reports.
 */
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
  if (premium) {
    const quota = snapshotQuota(premium, credits, accountReset);
    if (quota) quotas.push(quota);
  }
  if (chat && chat.unlimited !== true) {
    // Under token-based billing a capped chat snapshot (Copilot Free) is the
    // plan's credit allowance rather than a message count.
    const name = tokenBased
      ? credits
      : { id: "chat", label: "Chat messages", unit: "messages" };
    const quota = quotas.some((q) => q.id === name.id)
      ? null
      : snapshotQuota(chat, name, accountReset);
    if (quota) quotas.push(quota);
  }
  if (!chat) {
    const quota = legacyChatQuota(
      record(user.monthly_quotas),
      record(user.limited_user_quotas),
      { id: "chat", label: "Chat messages", unit: "messages" },
      isoDate(user.limited_user_reset_date) ?? accountReset,
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

function fetchApi(
  request: CopilotUsageRequest,
): Promise<UsageApiResponse<unknown>> {
  const host = copilotApiHost(request.enterpriseUrl);
  return fetchUsageApi(
    `https://${host}/copilot_internal/user`,
    {
      headers: {
        ...COPILOT_HEADERS,
        Authorization: `token ${request.githubToken}`,
        accept: "application/json",
      },
      redirect: "error",
    },
    (res) => res.json(),
  );
}

/**
 * Fetch GitHub Copilot plan usage (monthly AI credits or premium requests)
 * from the internal entitlement endpoint used by VS Code. Memoized with
 * rate-limit backoff like the other usage fetchers.
 */
export const fetchCopilotUsage = createCachedUsageFetcher({
  cacheName: "copilot",
  provider: "github-copilot",
  fetchApi,
  parseResponse: parseCopilotUsageResponse,
});
