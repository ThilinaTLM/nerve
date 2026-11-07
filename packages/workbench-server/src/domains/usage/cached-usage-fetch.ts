import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SubscriptionUsage } from "@nervekit/contracts/usage";

export const API_TIMEOUT_MS = 5000;
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 30_000;
const CACHE_MAX_AGE_MS = 30_000;
const LOCK_MAX_AGE_MS = 10_000;

export type UsageApiResponse<TBody = string> =
  | { kind: "success"; body: TBody }
  | { kind: "rate-limited"; retryAfterMs: number }
  | { kind: "error" };

type CacheEntry = {
  data: SubscriptionUsage | null;
  time: number;
  blockedUntil: number;
};

export function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseRetryAfterMs(
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

async function readLock(path: string, nowMs: number): Promise<number | null> {
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
  path: string,
  blockedUntil: number,
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, JSON.stringify({ blockedUntil }), "utf8");
  } catch {
    // best-effort cross-process backoff
  }
}

export async function writeUsageCacheFile(
  cacheDir: string,
  path: string,
  data: SubscriptionUsage,
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, JSON.stringify(data), "utf8");
  } catch {
    // best-effort cache
  }
}

/**
 * Builds a memoized usage fetcher with an in-process cache, a file cache and a
 * cross-process lock file for rate-limit backoff. The last good snapshot is
 * served on transient failures.
 */
export function createCachedUsageFetcher<TBody>(options: {
  /** Basename of the cross-process lock file inside the cache dir. */
  lockFileName: string;
  readCacheFile: (cacheDir: string) => Promise<{
    data: SubscriptionUsage | null;
    time: number;
  } | null>;
  writeCacheFile: (cacheDir: string, data: SubscriptionUsage) => Promise<void>;
  fetchApi: (token: string) => Promise<UsageApiResponse<TBody>>;
  parseResponse: (body: TBody) => SubscriptionUsage | null;
}): (token: string, cacheDir: string) => Promise<SubscriptionUsage | null> {
  let cache: CacheEntry | null = null;

  return async (token, cacheDir) => {
    const now = Date.now();

    if (
      cache &&
      now - cache.time < CACHE_MAX_AGE_MS &&
      cache.blockedUntil <= now
    ) {
      return cache.data;
    }

    const fileCache = await options.readCacheFile(cacheDir);
    if (fileCache?.data && now - fileCache.time < CACHE_MAX_AGE_MS) {
      cache = { data: fileCache.data, time: fileCache.time, blockedUntil: 0 };
      return fileCache.data;
    }

    const lastKnown = cache?.data ?? fileCache?.data ?? null;

    if (cache && cache.blockedUntil > now) {
      return lastKnown;
    }

    const lockPath = join(cacheDir, options.lockFileName);
    const lockedUntil = await readLock(lockPath, now);
    if (lockedUntil) {
      cache = { data: lastKnown, time: now, blockedUntil: lockedUntil };
      return lastKnown;
    }

    await writeLock(cacheDir, lockPath, now + LOCK_MAX_AGE_MS);

    const backoff = async (backoffMs: number) => {
      await writeLock(cacheDir, lockPath, now + backoffMs);
      cache = { data: lastKnown, time: now, blockedUntil: now + backoffMs };
      return lastKnown;
    };

    const resp = await options.fetchApi(token);
    if (resp.kind === "rate-limited") return backoff(resp.retryAfterMs);
    if (resp.kind === "error") return backoff(DEFAULT_RATE_LIMIT_BACKOFF_MS);

    const data = options.parseResponse(resp.body);
    if (!data) return backoff(DEFAULT_RATE_LIMIT_BACKOFF_MS);

    cache = { data, time: now, blockedUntil: 0 };
    await options.writeCacheFile(cacheDir, data);
    return data;
  };
}
