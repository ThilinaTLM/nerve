export type ManagerSecretResolveRequest = {
  key: string;
  version?: string;
};

export type ManagerSecretResolveResponse = {
  value: string;
  version?: string;
  expiresAt?: string;
};

export interface KvSecretStore {
  resolve(
    request: ManagerSecretResolveRequest,
  ): Promise<ManagerSecretResolveResponse>;
}

export class InMemoryKvSecretStore implements KvSecretStore {
  private readonly values = new Map<string, ManagerSecretResolveResponse>();

  set(
    key: string,
    value: string,
    metadata: Omit<ManagerSecretResolveResponse, "value"> = {},
  ): void {
    this.values.set(key, { ...metadata, value });
  }

  async resolve(
    request: ManagerSecretResolveRequest,
  ): Promise<ManagerSecretResolveResponse> {
    const value = this.values.get(request.key);
    if (!value) throw new Error(`Secret not found: ${request.key}`);
    if (request.version && value.version && request.version !== value.version) {
      throw new Error(`Secret version not found: ${request.key}`);
    }
    return { ...value };
  }
}
