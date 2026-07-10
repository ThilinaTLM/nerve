import type {
  SandboxHttpKvSecretStoreConfig,
  SandboxSecretKvRef,
  SandboxSecretRef,
} from "@nervekit/contracts";
import type {
  ResolvedSecret,
  SecretStoreClient,
} from "./secret-store-registry.js";

type FetchLike = typeof fetch;
type ResolveAuthSecret = (
  ref: SandboxSecretRef,
  chain?: string[],
) => Promise<string>;

export class HttpKvSecretStoreClient implements SecretStoreClient {
  constructor(
    private readonly config: SandboxHttpKvSecretStoreConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly resolveAuthSecret?: ResolveAuthSecret,
  ) {}
  async resolve(
    ref: SandboxSecretKvRef,
    chain: string[] = [],
  ): Promise<ResolvedSecret> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 10_000,
    );
    try {
      const method = this.config.method ?? "POST";
      const url = new URL(this.config.endpoint);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...(await this.authHeaders(chain)),
      };
      const init: RequestInit = {
        method,
        signal: controller.signal,
        headers,
      };
      if (method === "GET") {
        url.searchParams.set(this.config.keyParam ?? "key", ref.key);
        if (ref.version)
          url.searchParams.set(
            this.config.versionParam ?? "version",
            ref.version,
          );
      } else {
        init.body = JSON.stringify({ key: ref.key, version: ref.version });
      }
      const response = await this.fetchImpl(url, init);
      if (!response.ok) throw new Error(`secret store HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 1024 * 1024)
        throw new Error("secret store response too large");
      const json = JSON.parse(text) as unknown;
      const pointer = this.config.response?.valueJsonPointer ?? "/value";
      const value = jsonPointer(json, pointer);
      if (typeof value !== "string")
        throw new Error(`secret value at ${pointer} is not a string`);
      return {
        value,
        expiresAt:
          stringAt(json, "/data/expiresAt") ?? stringAt(json, "/expiresAt"),
        refreshAfter:
          stringAt(json, "/data/refreshAfter") ??
          stringAt(json, "/refreshAfter"),
        cacheTtlMs:
          numberAt(json, "/data/cacheTtlMs") ?? numberAt(json, "/cacheTtlMs"),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async authHeaders(chain: string[]): Promise<Record<string, string>> {
    const auth = this.config.auth;
    if (!auth || auth.type === "none") return {};
    if (!this.resolveAuthSecret)
      throw new Error("secret store auth requires a secret resolver");
    if (auth.type === "api_key") {
      const value = await this.resolveAuthSecret(auth.apiKey, chain);
      const header = auth.header ?? "authorization";
      const scheme = auth.scheme ?? "Bearer";
      return { [header]: scheme ? `${scheme} ${value}` : value };
    }
    if (auth.type === "bearer") {
      return {
        authorization: `Bearer ${await this.resolveAuthSecret(auth.token, chain)}`,
      };
    }
    if (auth.type === "oauth" && auth.accessToken) {
      return {
        authorization: `Bearer ${await this.resolveAuthSecret(
          auth.accessToken,
          chain,
        )}`,
      };
    }
    return {};
  }
}
function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return value;
  return pointer
    .split("/")
    .slice(1)
    .reduce((current: unknown, part) => {
      const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
      return current && typeof current === "object"
        ? (current as Record<string, unknown>)[key]
        : undefined;
    }, value);
}

function stringAt(value: unknown, pointer: string): string | undefined {
  const resolved = jsonPointer(value, pointer);
  return typeof resolved === "string" ? resolved : undefined;
}

function numberAt(value: unknown, pointer: string): number | undefined {
  const resolved = jsonPointer(value, pointer);
  return typeof resolved === "number" ? resolved : undefined;
}
