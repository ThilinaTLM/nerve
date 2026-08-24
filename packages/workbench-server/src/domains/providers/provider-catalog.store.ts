import type { AgentCustomModel } from "@nervekit/harness";
import {
  type CustomProvider,
  defaultProviderCatalog,
  type ModelDefinition,
  type ProviderCatalog,
  providerCatalogSchema,
} from "@nervekit/contracts";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";

/**
 * Canonical store for non-sensitive provider/model metadata. API keys remain
 * in the encrypted secret store via `AuthManager`.
 */
export class ProviderCatalogStore {
  #catalog: ProviderCatalog = defaultProviderCatalog;
  #loaded = false;

  constructor(private readonly storage: InitializedStorage) {}

  async load(): Promise<ProviderCatalog> {
    const document = await this.storage.canonicalStore.readDocument<unknown>(
      "provider_catalog",
      "global",
      "catalog",
    );
    const parsed = providerCatalogSchema.safeParse(document?.data ?? {});
    this.#catalog = parsed.success ? parsed.data : defaultProviderCatalog;
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
    const current = await this.storage.canonicalStore.readDocument(
      "provider_catalog",
      "global",
      "catalog",
    );
    await this.storage.canonicalStore.writeDocument({
      namespace: "provider_catalog",
      scopeId: "global",
      documentId: "catalog",
      data: validated,
      expectedRevision: current?.revision ?? 0,
    });
    this.#catalog = validated;
    return validated;
  }

  async upsertProvider(provider: CustomProvider): Promise<ProviderCatalog> {
    await this.ensureLoaded();
    const providers = this.#catalog.providers.filter(
      (existing) => existing.id !== provider.id,
    );
    providers.push(provider);
    return this.write({ ...this.#catalog, providers });
  }

  async deleteProvider(id: string): Promise<ProviderCatalog> {
    await this.ensureLoaded();
    return this.write({
      ...this.#catalog,
      providers: this.#catalog.providers.filter(
        (provider) => provider.id !== id,
      ),
      // Cascade: drop models that belonged to the removed provider.
      models: this.#catalog.models.filter((model) => model.provider !== id),
    });
  }

  async upsertModel(model: ModelDefinition): Promise<ProviderCatalog> {
    await this.ensureLoaded();
    const models = this.#catalog.models.filter(
      (existing) =>
        !(
          existing.provider === model.provider &&
          existing.modelId === model.modelId
        ),
    );
    models.push(model);
    return this.write({ ...this.#catalog, models });
  }

  async deleteModel(
    provider: string,
    modelId: string,
  ): Promise<ProviderCatalog> {
    await this.ensureLoaded();
    return this.write({
      ...this.#catalog,
      models: this.#catalog.models.filter(
        (model) => !(model.provider === provider && model.modelId === modelId),
      ),
    });
  }

  /** Display names keyed by custom provider id (for auth metadata). */
  providerDisplayNames(): Map<string, string> {
    return new Map(
      this.#catalog.providers.map((provider) => [
        provider.id,
        provider.displayName,
      ]),
    );
  }

  /**
   * Flatten the catalog into runtime-ready model definitions, inheriting
   * connection settings (api/baseUrl/headers/compat) from a model's custom
   * provider when present. Built-in provider models may omit connection settings;
   * the agent runtime resolves those from pi-ai's provider catalog.
   */
  resolvedModels(): AgentCustomModel[] {
    const providerById = new Map(
      this.#catalog.providers.map((provider) => [provider.id, provider]),
    );
    const resolved: AgentCustomModel[] = [];
    for (const model of this.#catalog.models) {
      const provider = providerById.get(model.provider);
      const api = model.api ?? provider?.api;
      const baseUrl = model.baseUrl ?? provider?.baseUrl;
      resolved.push({
        provider: model.provider,
        modelId: model.modelId,
        name: model.name,
        ...(api ? { api } : {}),
        ...(baseUrl ? { baseUrl } : {}),
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
      });
    }
    return resolved;
  }
}
