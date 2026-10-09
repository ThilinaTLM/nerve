import type { ModelPort } from "@nervekit/conversation-core";
import { resolveAgentModel } from "@nervekit/harness/models";
import type { AuthManager } from "../domains/auth/index.js";
import type { ProviderCatalogStore } from "../domains/providers/provider-catalog.store.js";

export function createModelPort(
  auth: AuthManager,
  catalog: ProviderCatalogStore,
  getCredential: (name: string) => Promise<string | undefined>,
): ModelPort {
  return {
    async resolve(selection) {
      const custom = await catalog.resolvedModelsWithCredentials(getCredential);
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
