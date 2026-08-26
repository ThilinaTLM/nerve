import type { AgentCustomModel } from "@nervekit/harness";
import {
  type CustomProvider,
  type HeaderConfig,
  type ModelDefinition,
  type ProviderCatalog,
  providerCatalogSchema,
} from "@nervekit/contracts";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import { writeHomeConfiguration } from "../../infrastructure/configuration/index.js";
import { resolveProjectConfiguration } from "../../infrastructure/configuration/index.js";

/** Non-sensitive provider/model metadata stored in config/providers.json. */
export class ProviderCatalogStore {
  #catalog: ProviderCatalog = { version: 1, providers: [], models: [] };
  #loaded = false;

  constructor(private readonly storage: InitializedStorage) {}

  async load(): Promise<ProviderCatalog> {
    this.#catalog = toCatalog(this.storage.configuration.providers);
    this.#loaded = true;
    return this.#catalog;
  }

  async ensureLoaded(): Promise<void> {
    if (!this.#loaded) await this.load();
  }

  get catalog(): ProviderCatalog {
    return this.#catalog;
  }

  private async write(next: ProviderCatalog): Promise<ProviderCatalog> {
    const validated = providerCatalogSchema.parse(next);
    const authentication = this.storage.configuration.providers.authentication;
    this.storage.configuration = await writeHomeConfiguration(
      this.storage.paths,
      {
        ...this.storage.configuration,
        providers: {
          version: 1,
          providers: validated.providers.map(({ headers, ...provider }) => ({
            ...provider,
            headers: mapLiteralHeaders(headers),
          })),
          models: validated.models.map(({ headers, ...model }) => ({
            ...model,
            ...(headers ? { headers: mapLiteralHeaders(headers) } : {}),
          })),
          authentication,
        },
      },
    );
    this.#catalog = validated;
    return validated;
  }

  async upsertProvider(provider: CustomProvider): Promise<ProviderCatalog> {
    await this.ensureLoaded();
    return this.write({
      ...this.#catalog,
      providers: [
        ...this.#catalog.providers.filter((item) => item.id !== provider.id),
        provider,
      ],
    });
  }

  async deleteProvider(id: string): Promise<ProviderCatalog> {
    await this.ensureLoaded();
    return this.write({
      ...this.#catalog,
      providers: this.#catalog.providers.filter(
        (provider) => provider.id !== id,
      ),
      models: this.#catalog.models.filter((model) => model.provider !== id),
    });
  }

  async upsertModel(model: ModelDefinition): Promise<ProviderCatalog> {
    await this.ensureLoaded();
    return this.write({
      ...this.#catalog,
      models: [
        ...this.#catalog.models.filter(
          (item) =>
            item.provider !== model.provider || item.modelId !== model.modelId,
        ),
        model,
      ],
    });
  }

  async deleteModel(
    provider: string,
    modelId: string,
  ): Promise<ProviderCatalog> {
    await this.ensureLoaded();
    return this.write({
      ...this.#catalog,
      models: this.#catalog.models.filter(
        (model) => model.provider !== provider || model.modelId !== modelId,
      ),
    });
  }

  async resolvedModelsWithCredentials(
    getCredential: (name: string) => Promise<string | undefined>,
    projectDir?: string,
  ): Promise<AgentCustomModel[]> {
    const configuration = projectDir
      ? await resolveProjectConfiguration(this.storage, projectDir)
      : this.storage.configuration;
    const providers = new Map(
      configuration.providers.providers.map((provider) => [
        provider.id,
        provider,
      ]),
    );
    return Promise.all(
      configuration.providers.models.map(async (model) => {
        const provider = providers.get(model.provider);
        return {
          ...model,
          ...((model.api ?? provider?.api)
            ? { api: model.api ?? provider?.api }
            : {}),
          ...((model.baseUrl ?? provider?.baseUrl)
            ? { baseUrl: model.baseUrl ?? provider?.baseUrl }
            : {}),
          headers: {
            ...(provider
              ? await resolveHeaders(provider.headers, getCredential)
              : {}),
            ...(model.headers
              ? await resolveHeaders(model.headers, getCredential)
              : {}),
          },
          compat: model.compat ?? provider?.compat,
        } as AgentCustomModel;
      }),
    );
  }

  providerDisplayNames(): Map<string, string> {
    return new Map(
      this.#catalog.providers.map((provider) => [
        provider.id,
        provider.displayName,
      ]),
    );
  }

  resolvedModels(): AgentCustomModel[] {
    const providerById = new Map(
      this.#catalog.providers.map((provider) => [provider.id, provider]),
    );
    return this.#catalog.models.map((model) => {
      const provider = providerById.get(model.provider);
      return {
        provider: model.provider,
        modelId: model.modelId,
        name: model.name,
        ...((model.api ?? provider?.api)
          ? { api: model.api ?? provider?.api }
          : {}),
        ...((model.baseUrl ?? provider?.baseUrl)
          ? { baseUrl: model.baseUrl ?? provider?.baseUrl }
          : {}),
        reasoning: model.reasoning,
        supportedThinkingLevels: model.supportedThinkingLevels,
        thinkingLevelMap: model.thinkingLevelMap,
        input: model.input,
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        samplingParams: model.samplingParams,
        headers: { ...(provider?.headers ?? {}), ...(model.headers ?? {}) },
        compat: model.compat ?? provider?.compat,
      } as AgentCustomModel;
    });
  }
}

function toCatalog(
  config: InitializedStorage["configuration"]["providers"],
): ProviderCatalog {
  return providerCatalogSchema.parse({
    version: 1,
    providers: config.providers.map((provider) => ({
      ...provider,
      headers: resolveLiteralHeaders(provider.headers),
    })),
    models: config.models.map((model) => ({
      ...model,
      ...(model.headers
        ? { headers: resolveLiteralHeaders(model.headers) }
        : {}),
    })),
  });
}

function resolveLiteralHeaders(
  headers: Record<string, HeaderConfig>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) =>
      "value" in value ? [[name, value.value]] : [],
    ),
  );
}

async function resolveHeaders(
  headers: Record<string, HeaderConfig>,
  getCredential: (name: string) => Promise<string | undefined>,
): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const [name, source] of Object.entries(headers)) {
    const value =
      "value" in source ? source.value : await getCredential(source.credential);
    if (value !== undefined) output[name] = value;
  }
  return output;
}

function mapLiteralHeaders(
  headers: Record<string, string>,
): Record<string, { value: string }> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, { value }]),
  );
}
