import { readFile } from "node:fs/promises";
import type { SandboxConfigV1, SandboxSecretRef } from "@nervekit/shared";
import type { SecretStoreRegistry } from "../secret-stores/secret-store-registry.js";

export class SecretResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretResolutionError";
  }
}
type CacheEntry = { value: string; expiresAt: number };

export class SecretResolver {
  private readonly cache = new Map<string, CacheEntry>();
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly registry?: SecretStoreRegistry,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  async resolve(ref: SandboxSecretRef, chain: string[] = []): Promise<string> {
    const cacheKey = JSON.stringify(ref);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const resolved = await this.resolveUncached(ref, chain);
    if (resolved.value.length > 1024 * 1024)
      throw new SecretResolutionError("Resolved secret value is too large");
    const cacheUntil = cacheDeadline(resolved);
    if (cacheUntil > Date.now()) {
      while (this.cache.size >= (resolved.cache?.maxEntries ?? 128)) {
        const first = this.cache.keys().next().value;
        if (!first) break;
        this.cache.delete(first);
      }
      this.cache.set(cacheKey, {
        value: resolved.value,
        expiresAt: cacheUntil,
      });
    }
    return resolved.value;
  }

  private async resolveUncached(
    ref: SandboxSecretRef,
    chain: string[],
  ): Promise<{
    value: string;
    expiresAt?: string;
    refreshAfter?: string;
    cacheTtlMs?: number;
    cache?: { enabled?: boolean; ttlMs?: number; maxEntries?: number };
  }> {
    if ("env" in ref) {
      const value = this.env[ref.env];
      if (value === undefined)
        throw new SecretResolutionError(`Missing env secret: ${ref.env}`);
      return { value };
    }
    if ("file" in ref)
      return readFile(ref.file, "utf8").then((value) => ({
        value: value.trimEnd(),
      }));
    const storeId = ref.kv.store ?? this.config.secretStores?.defaultStore;
    if (!storeId)
      throw new SecretResolutionError(
        "KV secret ref requires store or secretStores.defaultStore",
      );
    if (chain.includes(storeId))
      throw new SecretResolutionError(
        `Recursive secret-store auth chain: ${[...chain, storeId].join(" -> ")}`,
      );
    const storeConfig = this.config.secretStores?.stores?.[storeId];
    if (storeConfig?.type === "http_kv")
      assertSafeHttpEndpoint(storeConfig.endpoint);
    const store = this.registry?.get(storeId);
    if (!store)
      throw new SecretResolutionError(`Unknown secret store: ${storeId}`);
    return {
      ...(await store.resolve(ref.kv, [...chain, storeId])),
      cache: storeConfig?.cache,
    };
  }
}

function cacheDeadline(resolved: {
  expiresAt?: string;
  refreshAfter?: string;
  cacheTtlMs?: number;
  cache?: { enabled?: boolean; ttlMs?: number };
}): number {
  const deadlines: number[] = [];
  if (resolved.refreshAfter) deadlines.push(Date.parse(resolved.refreshAfter));
  if (resolved.expiresAt)
    deadlines.push(Date.parse(resolved.expiresAt) - 60_000);
  if (resolved.cacheTtlMs !== undefined)
    deadlines.push(Date.now() + resolved.cacheTtlMs);
  if (resolved.cache?.enabled)
    deadlines.push(Date.now() + (resolved.cache.ttlMs ?? 60_000));
  const finite = deadlines.filter((deadline) => Number.isFinite(deadline));
  return finite.length ? Math.min(...finite) : 0;
}

function assertSafeHttpEndpoint(endpoint: string): void {
  const url = new URL(endpoint);
  if (url.protocol === "https:") return;
  const host = url.hostname;
  const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  const privateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(
    host,
  );
  if (url.protocol === "http:" && (localHosts.has(host) || privateIpv4)) return;
  throw new SecretResolutionError(
    "HTTP secret store endpoints must use TLS or a local-private host",
  );
}
