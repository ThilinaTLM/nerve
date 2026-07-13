import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  subscriptionUsageSchema,
  type SubscriptionUsage,
  type SubscriptionWindow,
} from "@nervekit/contracts";

const API_URL = "https://chatgpt.com/backend-api/wham/usage";
const API_TIMEOUT_MS = 5000;
const CACHE_MAX_AGE_MS = 30_000;
const LOCK_MAX_AGE_MS = 10_000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 30_000;
const ACCOUNT_ID_CLAIM = "https://api.openai.com/auth.chatgpt_account_id";

type CacheEntry = {
  data: SubscriptionUsage | null;
  time: number;
  blockedUntil: number;
};

type HeaderLike = Record<string, string | number | boolean | null | undefined>;

let cache: CacheEntry | null = null;

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
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile(cacheDir), JSON.stringify(data), "utf8");
  } catch {
    // best-effort cache
  }
}

function lockFile(cacheDir: string): string {
  return join(cacheDir, "codex-usage.lock");
}

async function readLock(
  cacheDir: string,
  nowMs: number,
): Promise<number | null> {
  const path = lockFile(cacheDir);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      blockedUntil?: unknown;
    };
    const blockedUntil = Number(parsed.blockedUntil);
    return Number.isFinite(blockedUntil) && blockedUntil > nowMs
      ? blockedUntil
      : null;
  } catch {
    try {
      const blockedUntil = (await stat(path)).mtimeMs + LOCK_MAX_AGE_MS;
      return blockedUntil > nowMs ? blockedUntil : null;
    } catch {
      return null;
    }
  }
}

async function writeLock(
  cacheDir: string,
  blockedUntil: number,
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      lockFile(cacheDir),
      JSON.stringify({ blockedUntil }),
      "utf8",
    );
  } catch {
    // best-effort cross-process backoff
  }
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function headerValue(headers: HeaderLike, name: string): string | undefined {
  const wanted = `x-codex-${name}`.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value != null) return String(value);
  }
  return undefined;
}

function headerNumber(headers: HeaderLike, name: string): number | null {
  return numberValue(headerValue(headers, name));
}

function headerResetAfter(
  headers: HeaderLike,
  prefix: string,
  nowMs: number,
): number | null {
  return (
    headerNumber(headers, `${prefix}-reset-after-seconds`) ??
    resetAfterFromResetAt(headerNumber(headers, `${prefix}-reset-at`), nowMs)
  );
}

function headerWindow(
  headers: HeaderLike,
  prefix: string,
  nowMs: number,
): SubscriptionWindow | null {
  const usedPercent = headerNumber(headers, `${prefix}-used-percent`);
  if (usedPercent == null) return null;
  return {
    usedPercent,
    resetsAt: null,
    resetAfterSeconds: headerResetAfter(headers, prefix, nowMs),
    windowMinutes: headerNumber(headers, `${prefix}-window-minutes`),
  };
}

/** Parse Codex rate-limit usage from provider response headers. */
export function parseCodexUsageHeaders(
  headers: HeaderLike,
  nowMs = Date.now(),
): SubscriptionUsage | null {
  const primary = headerWindow(headers, "primary", nowMs);
  const secondary = headerWindow(headers, "secondary", nowMs);
  if (!primary && !secondary) return null;
  const { session, weekly } = classifyCodexWindows(primary, secondary);
  return {
    provider: "openai-codex",
    session,
    weekly,
    planType: headerValue(headers, "plan-type") ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function mergeWindow(
  base: SubscriptionWindow | null,
  update: SubscriptionWindow | null,
): SubscriptionWindow | null {
  if (!base) return update;
  if (!update) return base;
  return {
    usedPercent: update.usedPercent ?? base.usedPercent,
    resetsAt: update.resetsAt ?? base.resetsAt,
    resetAfterSeconds: update.resetAfterSeconds ?? base.resetAfterSeconds,
    windowMinutes: update.windowMinutes ?? base.windowMinutes,
  };
}

/** Merge a newer snapshot over a base, preferring defined fields. */
export function mergeCodexUsage(
  base: SubscriptionUsage | null,
  update: SubscriptionUsage,
): SubscriptionUsage {
  const normalizedUpdate = normalizeCodexSnapshot(update);
  if (!base) return normalizedUpdate;

  const normalizedBase = normalizeCodexSnapshot(base);
  let updateSession = normalizedUpdate.session;
  let updateWeekly = normalizedUpdate.weekly;

  // Rolling headers can omit window duration. Preserve the known slot from the
  // full snapshot when there is only one active Codex window.
  if (
    updateSession?.windowMinutes == null &&
    !updateWeekly &&
    !normalizedBase.session &&
    normalizedBase.weekly
  ) {
    updateWeekly = updateSession;
    updateSession = null;
  }

  return {
    provider: "openai-codex",
    session: mergeWindow(normalizedBase.session, updateSession),
    weekly: mergeWindow(normalizedBase.weekly, updateWeekly),
    planType: normalizedUpdate.planType ?? normalizedBase.planType,
    updatedAt: normalizedUpdate.updatedAt,
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

function parseRetryAfterMs(
  header: string | null,
  nowMs: number,
): number | null {
  const trimmed = header?.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const s = Number.parseInt(trimmed, 10);
    return s > 0 ? s * 1000 : null;
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return ms > nowMs ? ms - nowMs : null;
}

async function fetchApi(
  token: string,
  accountId: string | null,
): Promise<
  | { kind: "success"; body: unknown }
  | { kind: "rate-limited"; retryAfterMs: number }
  | { kind: "error" }
> {
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
 * bearer token. Memoized for {@link CACHE_MAX_AGE_MS} with rate-limit backoff;
 * live updates also arrive via {@link parseCodexUsageHeaders}.
 */
export async function fetchCodexUsage(
  token: string,
  cacheDir: string,
): Promise<SubscriptionUsage | null> {
  const now = Date.now();

  if (
    cache &&
    now - cache.time < CACHE_MAX_AGE_MS &&
    cache.blockedUntil <= now
  ) {
    return cache.data;
  }

  const fileCache = await readCacheFile(cacheDir);
  if (fileCache?.data && now - fileCache.time < CACHE_MAX_AGE_MS) {
    cache = { data: fileCache.data, time: fileCache.time, blockedUntil: 0 };
    return fileCache.data;
  }

  const lastKnown = cache?.data ?? fileCache?.data ?? null;

  if (cache && cache.blockedUntil > now) {
    return lastKnown;
  }

  const lockedUntil = await readLock(cacheDir, now);
  if (lockedUntil) {
    cache = { data: lastKnown, time: now, blockedUntil: lockedUntil };
    return lastKnown;
  }

  await writeLock(cacheDir, now + LOCK_MAX_AGE_MS);

  const resp = await fetchApi(token, extractAccountId(token));
  if (resp.kind === "rate-limited") {
    await writeLock(cacheDir, now + resp.retryAfterMs);
    cache = {
      data: lastKnown,
      time: now,
      blockedUntil: now + resp.retryAfterMs,
    };
    return lastKnown;
  }
  if (resp.kind === "error") {
    await writeLock(cacheDir, now + DEFAULT_RATE_LIMIT_BACKOFF_MS);
    cache = {
      data: lastKnown,
      time: now,
      blockedUntil: now + DEFAULT_RATE_LIMIT_BACKOFF_MS,
    };
    return lastKnown;
  }

  const data = parseCodexUsageResponse(resp.body);
  if (!data) {
    await writeLock(cacheDir, now + DEFAULT_RATE_LIMIT_BACKOFF_MS);
    cache = {
      data: lastKnown,
      time: now,
      blockedUntil: now + DEFAULT_RATE_LIMIT_BACKOFF_MS,
    };
    return lastKnown;
  }

  cache = { data, time: now, blockedUntil: 0 };
  await writeCacheFile(cacheDir, data);
  return data;
}

/** Persist a header-derived snapshot into the cache. */
export async function writeCodexUsageCache(
  cacheDir: string,
  data: SubscriptionUsage,
): Promise<void> {
  cache = { data, time: Date.now(), blockedUntil: 0 };
  await writeCacheFile(cacheDir, data);
}
