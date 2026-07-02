import { readFile } from "node:fs/promises";
import type { SandboxConfigV1, SandboxSecretRef } from "@nervekit/shared";
import type { SecretStoreRegistry } from "../secret-stores/secret-store-registry.js";

export class SecretResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretResolutionError";
  }
}
export class SecretResolver {
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly registry?: SecretStoreRegistry,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  async resolve(ref: SandboxSecretRef, chain: string[] = []): Promise<string> {
    if ("env" in ref) {
      const value = this.env[ref.env];
      if (value === undefined)
        throw new SecretResolutionError(`Missing env secret: ${ref.env}`);
      return value;
    }
    if ("file" in ref)
      return readFile(ref.file, "utf8").then((value) => value.trimEnd());
    const storeId = ref.kv.store ?? this.config.secretStores?.defaultStore;
    if (!storeId)
      throw new SecretResolutionError(
        "KV secret ref requires store or secretStores.defaultStore",
      );
    if (chain.includes(storeId))
      throw new SecretResolutionError(
        `Recursive secret-store auth chain: ${[...chain, storeId].join(" -> ")}`,
      );
    const store = this.registry?.get(storeId);
    if (!store)
      throw new SecretResolutionError(`Unknown secret store: ${storeId}`);
    return store.resolve(ref.kv, [...chain, storeId]);
  }
}
