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

const providerDisplayNames: Record<string, string> = {
  "nerve-faux": "Nerve Faux",
  anthropic: "Anthropic",
  google: "Google",
  "google-vertex": "Google Vertex",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  openrouter: "OpenRouter",
  xai: "xAI",
};

function titleCaseProviderToken(token: string): string {
  const known: Record<string, string> = {
    ai: "AI",
    api: "API",
    aws: "AWS",
    cn: "CN",
    gpt: "GPT",
    oauth: "OAuth",
    ui: "UI",
  };
  const lower = token.toLowerCase();
  return known[lower] ?? lower[0].toUpperCase() + lower.slice(1);
}

export function providerDisplayName(provider: string): string {
  return (
    providerDisplayNames[provider] ??
    provider
      .split(/[-_\s/]+/)
      .filter(Boolean)
      .map(titleCaseProviderToken)
      .join(" ")
  );
}

export function modelDisplayName(model: ModelInfo): string {
  return model.name || model.label || model.modelId;
}

export function modelNameCounts(models: ModelInfo[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const model of models) {
    const name = modelDisplayName(model);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

export function modelNameIsDuplicate(
  model: ModelInfo,
  models: ModelInfo[],
): boolean {
  return (modelNameCounts(models).get(modelDisplayName(model)) ?? 0) > 1;
}

export function contextualModelLabel(
  model: ModelInfo,
  models: ModelInfo[],
): string {
  const name = modelDisplayName(model);
  return modelNameIsDuplicate(model, models)
    ? `${providerDisplayName(model.provider)} / ${name}`
    : name;
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

export function scopedUsableModelOptions(
  modelList: ModelInfo[],
  providers: AuthProviderMetadata[],
  scopedModels: ModelSelection[] | undefined,
): ModelInfo[] {
  const usable = usableModelOptions(modelList, providers);
  if (!scopedModels?.length) return usable;
  const scopedKeys = new Set(scopedModels.map(modelKey));
  return usable.filter((model) => scopedKeys.has(modelKey(model)));
}

export function authenticatedRealModelOptions(
  modelList: ModelInfo[],
  providers: AuthProviderMetadata[],
): ModelInfo[] {
  return usableModelOptions(modelList, providers).filter(
    (model) => !model.faux,
  );
}
