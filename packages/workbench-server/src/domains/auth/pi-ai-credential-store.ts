import type {
  ApiKeyCredential,
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredential,
} from "@earendil-works/pi-ai";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";

export function providerApiKeySecretName(provider: string): string {
  return `provider:${provider}:apiKey`;
}

export function providerOAuthSecretName(provider: string): string {
  return `provider:${provider}:oauth`;
}

function parseOAuthCredential(
  value: string | undefined,
): OAuthCredential | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as Partial<OAuthCredential>;
  if (
    parsed.type !== "oauth" ||
    typeof parsed.access !== "string" ||
    typeof parsed.refresh !== "string" ||
    typeof parsed.expires !== "number"
  ) {
    return undefined;
  }
  return parsed as OAuthCredential;
}

/** pi-ai credential storage backed by Nerve's encrypted secret provider. */
export class PiAiCredentialStore implements CredentialStore {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly secrets: SecretProvider) {}

  async read(providerId: string): Promise<Credential | undefined> {
    const oauth = parseOAuthCredential(
      await this.secrets.get(providerOAuthSecretName(providerId)),
    );
    if (oauth) return oauth;
    const key = await this.secrets.get(providerApiKeySecretName(providerId));
    return key ? { type: "api_key", key } : undefined;
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const byProvider = new Map<string, CredentialInfo>();
    for (const name of await this.secrets.list()) {
      const apiKey = /^provider:(.+):apiKey$/.exec(name);
      const oauth = /^provider:(.+):oauth$/.exec(name);
      if (apiKey) {
        byProvider.set(apiKey[1], {
          providerId: apiKey[1],
          type: "api_key",
        });
      }
      if (oauth) {
        byProvider.set(oauth[1], {
          providerId: oauth[1],
          type: "oauth",
        });
      }
    }
    return [...byProvider.values()].sort((a, b) =>
      a.providerId.localeCompare(b.providerId),
    );
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.serialized(async () => {
      const current = await this.read(providerId);
      const next = await fn(current);
      if (!next) return current;
      await this.write(providerId, next);
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.serialized(async () => {
      await this.secrets.delete(providerApiKeySecretName(providerId));
      await this.secrets.delete(providerOAuthSecretName(providerId));
    });
  }

  private async write(
    providerId: string,
    credential: Credential,
  ): Promise<void> {
    if (credential.type === "oauth") {
      await this.secrets.set(
        providerOAuthSecretName(providerId),
        JSON.stringify(credential),
      );
      await this.secrets.delete(providerApiKeySecretName(providerId));
      return;
    }
    await this.writeApiKey(providerId, credential);
  }

  private async writeApiKey(
    providerId: string,
    credential: ApiKeyCredential,
  ): Promise<void> {
    if (!credential.key) {
      throw new Error(`API-key credential for ${providerId} has no key`);
    }
    await this.secrets.set(
      providerApiKeySecretName(providerId),
      credential.key,
    );
    await this.secrets.delete(providerOAuthSecretName(providerId));
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation, operation);
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
