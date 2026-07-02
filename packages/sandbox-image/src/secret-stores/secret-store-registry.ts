import type { SandboxSecretKvRef } from "@nervekit/shared";

export interface SecretStoreClient {
  resolve(ref: SandboxSecretKvRef, chain?: string[]): Promise<string>;
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
