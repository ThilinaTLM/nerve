import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  subscriptionUsageSchema,
  type SubscriptionQuota,
  type SubscriptionUsage,
  type SubscriptionUsageProvider,
} from "@nervekit/contracts/usage";

const API_TIMEOUT_MS = 5000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 30_000;
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

/**
 * GET `url` with the shared timeout: a 429 becomes `rate-limited` (honoring
 * `Retry-After`), any other failure becomes `error`.
 */
export async function fetchUsageApi<TBody = string>(
  url: string,
  init: Pick<RequestInit, "headers" | "redirect">,
  readBody: (response: Response) => Promise<TBody>,
): Promise<UsageApiResponse<TBody>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      method: "GET",
      signal: controller.signal,
    });
    if (res.ok) return { kind: "success", body: await readBody(res) };
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

/** Time-window quota without count fields (Anthropic and Codex windows). */
export function windowQuota(
  id: string,
  label: string,
  window: Pick<
    SubscriptionQuota,
    "usedPercent" | "resetsAt" | "resetAfterSeconds" | "windowMinutes"
  >,
): SubscriptionQuota {
  return { id, label, ...window };
}

/** Reads a persisted snapshot; outdated or foreign files count as missing. */
async function readUsageCacheFile(
  path: string,
  provider: SubscriptionUsageProvider,
): Promise<{ data: SubscriptionUsage; time: number } | null> {
  try {
    const parsed = subscriptionUsageSchema.safeParse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (!parsed.success || parsed.data.provider !== provider) return null;
    return { data: parsed.data, time: (await stat(path)).mtimeMs };
  } catch {
    return null;
  }
}

async function writeUsageCacheFile(
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
export function createCachedUsageFetcher<TBody, TRequest = string>(options: {
  /** Names the files in the cache dir: `<cacheName>-usage.json` and `<cacheName>-usage.lock`. */
  cacheName: string;
  provider: SubscriptionUsageProvider;
  fetchApi: (request: TRequest) => Promise<UsageApiResponse<TBody>>;
  parseResponse: (body: TBody) => SubscriptionUsage | null;
}): (request: TRequest, cacheDir: string) => Promise<SubscriptionUsage | null> {
  let cache: CacheEntry | null = null;
  const cacheFile = (cacheDir: string) =>
    join(cacheDir, `${options.cacheName}-usage.json`);

  return async (request, cacheDir) => {
    const now = Date.now();

    if (
      cache &&
      now - cache.time < CACHE_MAX_AGE_MS &&
      cache.blockedUntil <= now
    ) {
      return cache.data;
    }

    const fileCache = await readUsageCacheFile(
      cacheFile(cacheDir),
      options.provider,
    );
    if (fileCache?.data && now - fileCache.time < CACHE_MAX_AGE_MS) {
      cache = { data: fileCache.data, time: fileCache.time, blockedUntil: 0 };
      return fileCache.data;
    }

    const lastKnown = cache?.data ?? fileCache?.data ?? null;

    if (cache && cache.blockedUntil > now) {
      return lastKnown;
    }

    const lockPath = join(cacheDir, `${options.cacheName}-usage.lock`);
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

    const resp = await options.fetchApi(request);
    if (resp.kind === "rate-limited") return backoff(resp.retryAfterMs);
    if (resp.kind === "error") return backoff(DEFAULT_RATE_LIMIT_BACKOFF_MS);

    const data = options.parseResponse(resp.body);
    if (!data) return backoff(DEFAULT_RATE_LIMIT_BACKOFF_MS);

    cache = { data, time: now, blockedUntil: 0 };
    await writeUsageCacheFile(cacheDir, cacheFile(cacheDir), data);
    return data;
  };
}
