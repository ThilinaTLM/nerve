import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SubscriptionUsage, SubscriptionWindow } from "@nervekit/shared";

const API_HOST = "api.anthropic.com";
const API_PATH = "/api/oauth/usage";
const API_URL = `https://${API_HOST}${API_PATH}`;
const API_TIMEOUT_MS = 5000;
const CACHE_MAX_AGE_MS = 30_000;
const LOCK_MAX_AGE_MS = 10_000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 30_000;

type CacheEntry = {
  data: SubscriptionUsage | null;
  time: number;
  blockedUntil: number;
};

let cache: CacheEntry | null = null;

function cacheFile(cacheDir: string): string {
  return join(cacheDir, "anthropic-usage.json");
}

async function readCacheFile(cacheDir: string): Promise<{
  data: SubscriptionUsage | null;
  time: number;
} | null> {
  const path = cacheFile(cacheDir);
  try {
    const raw = await readFile(path, "utf8");
    return {
      data: JSON.parse(raw) as SubscriptionUsage,
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
  return join(cacheDir, "anthropic-usage.lock");
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

function toWindow(
  raw: Record<string, unknown> | undefined,
): SubscriptionWindow | null {
  if (!raw) return null;
  const usedPercent = raw.utilization != null ? Number(raw.utilization) : null;
  const resetsAt = typeof raw.resets_at === "string" ? raw.resets_at : null;
  if (usedPercent == null && resetsAt == null) return null;
  return {
    usedPercent:
      usedPercent != null && Number.isFinite(usedPercent) ? usedPercent : null,
    resetsAt,
    resetAfterSeconds: null,
    windowMinutes: null,
  };
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
  const session = toWindow(
    obj.five_hour as Record<string, unknown> | undefined,
  );
  const weekly = toWindow(obj.seven_day as Record<string, unknown> | undefined);
  if (!session && !weekly) return null;
  return {
    provider: "anthropic",
    session,
    weekly,
    planType: null,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchApi(
  token: string,
): Promise<
  | { kind: "success"; body: string }
  | { kind: "rate-limited"; retryAfterMs: number }
  | { kind: "error" }
> {
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
export async function fetchAnthropicUsage(
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

  const resp = await fetchApi(token);
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

  const data = parseAnthropicUsageResponse(resp.body);
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
