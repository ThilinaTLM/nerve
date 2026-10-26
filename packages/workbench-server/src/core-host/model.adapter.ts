import type { ModelPort } from "@nervekit/conversation-core";
import { resolveAgentModel } from "@nervekit/harness/models";
import type { AuthManager } from "../domains/auth/index.js";
import type { ProviderCatalogStore } from "../domains/providers/provider-catalog.store.js";
import type { InitializedStorage } from "../infrastructure/storage-bootstrap/index.js";
export type ModelConfiguration =
  InitializedStorage["configuration"]["providers"];

export function createModelPort(
  auth: AuthManager,
  catalog: ProviderCatalogStore,
  getCredential: (name: string) => Promise<string | undefined>,
): ModelPort & {
  resolve(
    selection: Parameters<ModelPort["resolve"]>[0],
    configuration?: ModelConfiguration,
  ): ReturnType<ModelPort["resolve"]>;
} {
  return {
    async resolve(selection, configuration?: ModelConfiguration) {
      const selected = configuration?.models.find(
        (model) =>
          model.provider === selection.provider &&
          model.modelId === selection.modelId,
      );
      const provider = configuration?.providers.find(
        (provider) => provider.id === selection.provider,
      );
      const headers = async (
        entries: ModelConfiguration["providers"][number]["headers"] = {},
      ) =>
        Object.fromEntries(
          await Promise.all(
            Object.entries(entries).map(async ([name, source]) => {
              const value =
                "value" in source
                  ? source.value
                  : await getCredential(source.credential);
              if (value === undefined)
                throw new Error("Model header credential unavailable");
              return [name, value];
            }),
          ),
        );
      const custom = configuration
        ? selected
          ? [
              {
                ...selected,
                api: selected.api ?? provider?.api,
                baseUrl: selected.baseUrl ?? provider?.baseUrl,
                headers: {
                  ...(await headers(provider?.headers)),
                  ...(await headers(selected.headers)),
                },
                compat: selected.compat ?? provider?.compat,
              },
            ]
          : []
        : await catalog.resolvedModelsWithCredentials(getCredential);
      const model = resolveAgentModel(selection, custom);
      if (
        model.provider !== selection.provider ||
        model.id !== selection.modelId
      )
        throw new Error(
          `Model unavailable: ${selection.provider}/${selection.modelId}`,
        );
      const credentials = await auth.requestAuthForPiModel(model);
      return { model, ...credentials };
    },
  };
}
