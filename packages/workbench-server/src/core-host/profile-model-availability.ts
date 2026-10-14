import type { AuthProviderMetadata } from "@nervekit/contracts/auth";
import type { ModelSelection } from "@nervekit/contracts/models";
import {
  listAvailableModels,
  type AgentCustomModel,
} from "@nervekit/harness/models";

/** Metadata/credential-presence only: never request auth or resolve a fallback model. */
export function createProfileModelInfo(options: {
  customModels(): AgentCustomModel[];
  providerMetadata(
    provider: string,
  ): Promise<
    | Pick<
        AuthProviderMetadata,
        "supportsApiKey" | "supportsOAuth" | "configured"
      >
    | undefined
  >;
}) {
  return async (selection: ModelSelection) => {
    const customModels = options.customModels();
    const custom = customModels.find(
      (model) =>
        model.provider === selection.provider &&
        model.modelId === selection.modelId,
    );
    const info = listAvailableModels(customModels)
      .reverse()
      .find(
        (model) =>
          model.provider === selection.provider &&
          model.modelId === selection.modelId,
      );
    if (!info) throw new Error("Unknown or unconfigured model");
    // An explicitly configured endpoint may be auth-free, even under a builtin provider name.
    // Its actual authentication requirements remain authoritative at request time.
    if (!custom?.baseUrl) {
      const auth = await options.providerMetadata(selection.provider);
      if (
        auth &&
        (auth.supportsApiKey || auth.supportsOAuth) &&
        !auth.configured
      )
        throw new Error(
          "Configure this provider's credentials in Settings → Providers",
        );
    }
    return info;
  };
}
