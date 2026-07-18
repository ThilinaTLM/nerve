import {
  type Api,
  type AuthInteraction,
  type AuthResult,
  type Credential,
  type CredentialStore,
  type Model,
  type MutableModels,
  type OAuthCredentials,
  type Provider,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  AgentRequestAuth,
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
} from "@nervekit/contracts";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import {
  PiAiCredentialStore,
  providerApiKeySecretName,
  providerOAuthSecretName,
} from "./pi-ai-credential-store.js";

export { providerApiKeySecretName, providerOAuthSecretName };

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

function displayNameForProvider(provider: string): string {
  const known: Record<string, string> = {
    confluence: "Confluence",
    jira: "Jira",
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
    radius: "RADIUS_API_KEY",
    confluence: "CONFLUENCE_API_TOKEN",
    jira: "JIRA_API_TOKEN",
    tavily: "TAVILY_API_KEY",
    xai: "XAI_API_KEY",
  };
  return (
    known[provider] ??
    `${provider.replaceAll(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`
  );
}

function asProviderCredential(
  credential: Credential | undefined,
): ProviderCredential | undefined {
  if (!credential) return undefined;
  if (credential.type === "oauth") return credential;
  return credential.key ? { type: "api_key", key: credential.key } : undefined;
}

function requestAuth(
  resolution: AuthResult | undefined,
): AgentRequestAuth | undefined {
  if (!resolution) return undefined;
  const headers = resolution.auth.headers
    ? Object.fromEntries(
        Object.entries(resolution.auth.headers).filter(
          (entry): entry is [string, string] => entry[1] !== null,
        ),
      )
    : undefined;
  const result: AgentRequestAuth = {
    apiKey: resolution.auth.apiKey,
    baseUrl: resolution.auth.baseUrl,
    headers,
    env: resolution.env,
  };
  return Object.values(result).some((value) => value !== undefined)
    ? result
    : undefined;
}

export type AuthManagerOptions = {
  credentials?: CredentialStore;
  models?: MutableModels;
};

export class AuthManager {
  readonly credentials: CredentialStore;
  readonly models: MutableModels;

  constructor(
    private readonly secrets: SecretProvider,
    options: AuthManagerOptions = {},
  ) {
    this.credentials = options.credentials ?? new PiAiCredentialStore(secrets);
    this.models =
      options.models ?? builtinModels({ credentials: this.credentials });
  }

  getProvider(providerId: string): Provider | undefined {
    return this.models.getProvider(providerId);
  }

  async getCredential(
    provider: string,
  ): Promise<ProviderCredential | undefined> {
    return asProviderCredential(await this.credentials.read(provider));
  }

  async setApiKey(provider: string, apiKey: string): Promise<void> {
    await this.credentials.modify(provider, async () => ({
      type: "api_key",
      key: apiKey,
    }));
  }

  async setOAuth(
    provider: string,
    credential: OAuthCredentials,
  ): Promise<void> {
    await this.credentials.modify(provider, async () => ({
      type: "oauth",
      ...credential,
    }));
  }

  async loginOAuth(
    provider: string,
    interaction: AuthInteraction,
  ): Promise<OAuthCredential> {
    const credential = await this.models.login(provider, "oauth", interaction);
    if (credential.type !== "oauth") {
      throw new Error(
        `OAuth login for ${provider} returned a non-OAuth credential`,
      );
    }
    await this.models.refresh({ force: true, signal: interaction.signal });
    return credential;
  }

  async deleteCredential(provider: string): Promise<void> {
    if (this.models.getProvider(provider)) await this.models.logout(provider);
    else await this.credentials.delete(provider);
  }

  async credentialType(
    provider: string,
  ): Promise<ProviderCredential["type"] | undefined> {
    return (await this.getCredential(provider))?.type;
  }

  async getApiKey(provider: string): Promise<string | undefined> {
    const knownProvider = this.models.getProvider(provider);
    if (knownProvider) {
      return (await this.models.getAuth(provider))?.auth.apiKey;
    }
    const credential = await this.getCredential(provider);
    return credential?.type === "api_key" ? credential.key : credential?.access;
  }

  async requestAuthForModel(
    model: ModelSelection | undefined,
  ): Promise<AgentRequestAuth | undefined> {
    if (!model || model.provider === "nerve-faux") return undefined;
    const registered = this.models.getModel(model.provider, model.modelId);
    if (registered) return this.requestAuthForPiModel(registered);
    const apiKey = await this.getApiKey(model.provider);
    return apiKey ? { apiKey } : undefined;
  }

  async requestAuthForPiModel(
    model: Model<Api>,
  ): Promise<AgentRequestAuth | undefined> {
    if (model.provider === "nerve-faux") return undefined;
    if (this.models.getProvider(model.provider)) {
      return requestAuth(await this.models.getAuth(model));
    }
    const apiKey = await this.getApiKey(model.provider);
    return apiKey ? { apiKey } : undefined;
  }

  async refreshModels(options: { allowNetwork?: boolean } = {}): Promise<void> {
    await this.models.refresh({ allowNetwork: options.allowNetwork ?? true });
  }

  async listProviderMetadata(
    models: ModelInfo[],
    customProviderNames?: ReadonlyMap<string, string>,
  ): Promise<AuthProviderMetadata[]> {
    const runtimeProviders = new Map(
      this.models.getProviders().map((provider) => [provider.id, provider]),
    );
    const providers = new Set<string>(runtimeProviders.keys());
    for (const model of models) {
      if (model.provider !== "nerve-faux") providers.add(model.provider);
    }
    providers.add("tavily");
    providers.add("jira");
    providers.add("confluence");
    for (const credential of await this.credentials.list()) {
      providers.add(credential.providerId);
    }

    const items = await Promise.all(
      [...providers].sort().map(async (providerId) => {
        const provider = runtimeProviders.get(providerId);
        const credential = await this.getCredential(providerId);
        const checked = provider
          ? await this.models.checkAuth(providerId).catch(() => undefined)
          : undefined;
        const supportsApiKey = provider ? Boolean(provider.auth.apiKey) : true;
        const supportsOAuth = Boolean(provider?.auth.oauth);
        return {
          provider: providerId,
          displayName:
            provider?.name ??
            customProviderNames?.get(providerId) ??
            displayNameForProvider(providerId),
          supportsApiKey,
          supportsOAuth,
          oauthName:
            provider?.auth.oauth?.loginLabel ?? provider?.auth.oauth?.name,
          configured: Boolean(credential ?? checked),
          credentialType: credential?.type ?? checked?.type,
          envVar:
            supportsApiKey && providerId !== "tavily"
              ? providerEnvVarName(providerId)
              : undefined,
          warning:
            providerId === "anthropic" && credential?.type === "oauth"
              ? ANTHROPIC_OAUTH_WARNING
              : undefined,
        } satisfies AuthProviderMetadata;
      }),
    );

    return items.filter((item) => item.supportsApiKey || item.supportsOAuth);
  }
}
