import type { AuthProviderMetadata, ModelInfo, ModelSelection } from "../api";

export function modelKey(model: { provider: string; modelId: string }): string {
  return `${model.provider}:${model.modelId}`;
}

export function parseModelKey(key: string): ModelSelection | undefined {
  const [provider, ...modelParts] = key.split(":");
  const modelId = modelParts.join(":");
  return provider && modelId ? { provider, modelId } : undefined;
}

export function shortModelLabel(modelId: string): string {
  return modelId.replace(/^claude-/, "claude ").replace(/^gpt-/, "gpt ");
}

export function usableModelOptions(
  modelList: ModelInfo[],
  providers: AuthProviderMetadata[],
): ModelInfo[] {
  const configuredProviders = new Set(
    providers
      .filter((provider) => provider.configured)
      .map((provider) => provider.provider),
  );
  return modelList.filter(
    (model) => model.faux || configuredProviders.has(model.provider),
  );
}
