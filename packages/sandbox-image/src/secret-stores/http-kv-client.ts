import type {
  SandboxHttpKvSecretStoreConfig,
  SandboxSecretKvRef,
} from "@nervekit/shared";
import type { SecretStoreClient } from "./secret-store-registry.js";

type FetchLike = typeof fetch;
export class HttpKvSecretStoreClient implements SecretStoreClient {
  constructor(
    private readonly config: SandboxHttpKvSecretStoreConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  async resolve(ref: SandboxSecretKvRef): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 10_000,
    );
    try {
      const method = this.config.method ?? "POST";
      const url = new URL(this.config.endpoint);
      const init: RequestInit = {
        method,
        signal: controller.signal,
        headers: { "content-type": "application/json" },
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
      return value;
    } finally {
      clearTimeout(timeout);
    }
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
