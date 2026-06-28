import type {
  OAuthCredentials,
  OAuthProviderInterface,
} from "@earendil-works/pi-ai/oauth";
import { getOAuthApiKey, getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import type {
  AgentRequestAuth,
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
} from "@nervekit/shared";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";

export type ApiKeyCredential = {
  type: "api_key";
  key: string;
};

export type OAuthCredential = {
  type: "oauth";
} & OAuthCredentials;

export type ProviderCredential = ApiKeyCredential | OAuthCredential;

const ANTHROPIC_OAUTH_WARNING =
  "Anthropic subscription auth may use paid extra usage outside normal Claude plan limits.";

export function providerApiKeySecretName(provider: string): string {
  return `provider:${provider}:apiKey`;
}

export function providerOAuthSecretName(provider: string): string {
  return `provider:${provider}:oauth`;
}

function displayNameForProvider(provider: string): string {
  const known: Record<string, string> = {
    tavily: "Tavily",
  };
  return known[provider] ?? provider;
}

export function providerEnvVarName(provider: string): string {
  const known: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    tavily: "TAVILY_API_KEY",
    xai: "XAI_API_KEY",
  };
  return (
    known[provider] ??
    `${provider.replaceAll(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`
  );
}

export function supportsStoredApiKey(provider: string): boolean {
  return provider !== "openai-codex" && provider !== "github-copilot";
}

function parseOAuthCredential(
  value: string | undefined,
): OAuthCredential | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as OAuthCredential;
  if (parsed.type !== "oauth") return undefined;
  return parsed;
}

function oauthProvidersById(): Map<string, OAuthProviderInterface> {
  return new Map(
    getOAuthProviders().map((provider) => [provider.id, provider]),
  );
}

export class AuthManager {
  private readonly refreshLocks = new Map<
    string,
    Promise<string | undefined>
  >();

  constructor(private readonly secrets: SecretProvider) {}

  async getCredential(
    provider: string,
  ): Promise<ProviderCredential | undefined> {
    const oauth = parseOAuthCredential(
      await this.secrets.get(providerOAuthSecretName(provider)),
    );
    if (oauth) return oauth;

    const key = await this.secrets.get(providerApiKeySecretName(provider));
    return key ? { type: "api_key", key } : undefined;
  }

  async setApiKey(provider: string, apiKey: string): Promise<void> {
    await this.secrets.set(providerApiKeySecretName(provider), apiKey);
    await this.secrets.delete(providerOAuthSecretName(provider));
  }

  async setOAuth(
    provider: string,
    credential: OAuthCredentials,
  ): Promise<void> {
    const stored: OAuthCredential = { type: "oauth", ...credential };
    await this.secrets.set(
      providerOAuthSecretName(provider),
      JSON.stringify(stored),
    );
    await this.secrets.delete(providerApiKeySecretName(provider));
  }

  async deleteCredential(provider: string): Promise<void> {
    await this.secrets.delete(providerApiKeySecretName(provider));
    await this.secrets.delete(providerOAuthSecretName(provider));
  }

  async credentialType(
    provider: string,
  ): Promise<ProviderCredential["type"] | undefined> {
    return (await this.getCredential(provider))?.type;
  }

  async getApiKey(provider: string): Promise<string | undefined> {
    const credential = await this.getCredential(provider);
    if (!credential) return undefined;
    if (credential.type === "api_key") return credential.key;

    const oauthProvider = oauthProvidersById().get(provider);
    if (!oauthProvider) return undefined;
    if (Date.now() < credential.expires)
      return oauthProvider.getApiKey(credential);

    const existing = this.refreshLocks.get(provider);
    if (existing) return existing;

    const refresh = this.refreshOAuth(provider).finally(() => {
      this.refreshLocks.delete(provider);
    });
    this.refreshLocks.set(provider, refresh);
    return refresh;
  }

  async requestAuthForModel(
    model: ModelSelection | undefined,
  ): Promise<AgentRequestAuth | undefined> {
    if (!model || model.provider === "nerve-faux") return undefined;
    const apiKey = await this.getApiKey(model.provider);
    return apiKey ? { apiKey } : undefined;
  }

  async listProviderMetadata(
    models: ModelInfo[],
    customProviderNames?: ReadonlyMap<string, string>,
  ): Promise<AuthProviderMetadata[]> {
    const oauthProviders = oauthProvidersById();
    const providers = new Set<string>();
    for (const model of models) {
      if (model.provider !== "nerve-faux") providers.add(model.provider);
    }
    providers.add("tavily");
    for (const provider of oauthProviders.keys()) {
      if (provider === "openai-codex" || provider === "anthropic") {
        providers.add(provider);
      }
    }
    for (const name of await this.secrets.list()) {
      const apiKeyMatch = /^provider:(.+):apiKey$/.exec(name);
      const oauthMatch = /^provider:(.+):oauth$/.exec(name);
      if (apiKeyMatch) providers.add(apiKeyMatch[1]);
      if (oauthMatch) providers.add(oauthMatch[1]);
    }

    const items = await Promise.all(
      [...providers].sort().map(async (provider) => {
        const oauthProvider = oauthProviders.get(provider);
        const credential = await this.getCredential(provider);
        return {
          provider,
          displayName:
            oauthProvider?.name ??
            customProviderNames?.get(provider) ??
            displayNameForProvider(provider),
          supportsApiKey: supportsStoredApiKey(provider),
          supportsOAuth:
            provider === "openai-codex" || provider === "anthropic",
          oauthName: oauthProvider?.name,
          configured: Boolean(credential),
          credentialType: credential?.type,
          envVar:
            supportsStoredApiKey(provider) && provider !== "tavily"
              ? providerEnvVarName(provider)
              : undefined,
          warning:
            provider === "anthropic" && credential?.type === "oauth"
              ? ANTHROPIC_OAUTH_WARNING
              : undefined,
        } satisfies AuthProviderMetadata;
      }),
    );

    return items.filter((item) => item.supportsApiKey || item.supportsOAuth);
  }

  private async refreshOAuth(provider: string): Promise<string | undefined> {
    const oauthCredentials: Record<string, OAuthCredentials> = {};
    for (const name of await this.secrets.list()) {
      const match = /^provider:(.+):oauth$/.exec(name);
      if (!match) continue;
      const credential = parseOAuthCredential(await this.secrets.get(name));
      if (credential) oauthCredentials[match[1]] = credential;
    }

    const result = await getOAuthApiKey(provider, oauthCredentials);
    if (!result) return undefined;
    await this.setOAuth(provider, result.newCredentials);
    return result.apiKey;
  }
}
