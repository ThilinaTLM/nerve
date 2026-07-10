import type { AgentCustomModel } from "@nervekit/agent-runtime";
import {
  type CustomProvider,
  defaultProviderCatalog,
  type ModelDefinition,
  type ProviderCatalog,
  providerCatalogSchema,
} from "@nervekit/contracts";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../infrastructure/storage/json.js";

/**
 * File-first store for user-defined providers and models, persisted to
 * `~/.nerve/providers.json`. Non-sensitive metadata only — API keys live in the
 * encrypted secret store via `AuthManager`.
 */
export class ProviderCatalogStore {
  #catalog: ProviderCatalog = defaultProviderCatalog;
  #loaded = false;

  constructor(private readonly path: string) {}

  async load(): Promise<ProviderCatalog> {
    if (await pathExists(this.path)) {
      const raw = await readJsonFile<unknown>(this.path).catch(() => undefined);
      const parsed = providerCatalogSchema.safeParse(raw ?? {});
      this.#catalog = parsed.success ? parsed.data : defaultProviderCatalog;
    } else {
      this.#catalog = defaultProviderCatalog;
    }
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
    await atomicWriteJson(this.path, validated, 0o600);
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
        headers: { ...(provider?.headers ?? {}), ...(model.headers ?? {}) },
        compat: model.compat ?? provider?.compat,
      });
    }
    return resolved;
  }
}
