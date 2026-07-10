import type { SandboxSecretKvRef } from "@nervekit/contracts";

export type ResolvedSecret = {
  value: string;
  expiresAt?: string;
  refreshAfter?: string;
  cacheTtlMs?: number;
};

export interface SecretStoreClient {
  resolve(ref: SandboxSecretKvRef, chain?: string[]): Promise<ResolvedSecret>;
}
export class SecretStoreRegistry {
  private readonly stores = new Map<string, SecretStoreClient>();
  set(id: string, client: SecretStoreClient): void {
    this.stores.set(id, client);
  }
  get(id: string): SecretStoreClient | undefined {
    return this.stores.get(id);
  }
  list(): string[] {
    return Array.from(this.stores.keys()).sort();
  }
}
