import type {
  SandboxAgentModelSelection,
  SandboxConfigV1,
} from "@nervekit/shared";

const builtinProviders = new Set([
  "anthropic",
  "openai",
  "openai-codex",
  "google",
  "xai",
  "ollama",
  "openrouter",
]);
export type ResolvedModel = SandboxAgentModelSelection & {
  builtin: boolean;
  limitations: string[];
};
export function resolveModelSelection(
  config: SandboxConfigV1,
  selection: SandboxAgentModelSelection,
): ResolvedModel {
  const custom = (config.modelCatalog?.models ?? []).find(
    (model) =>
      model.provider === selection.provider && model.model === selection.model,
  );
  if (custom) return { ...selection, builtin: false, limitations: [] };
  if (builtinProviders.has(selection.provider))
    return { ...selection, builtin: true, limitations: [] };
  throw new Error(
    `Unknown model selection ${selection.provider}/${selection.model}`,
  );
}
export function effectiveModelCatalog(
  config: SandboxConfigV1,
): ResolvedModel[] {
  return [
    resolveModelSelection(config, config.agent.mainModel),
    ...(config.agent.exploreModel
      ? [resolveModelSelection(config, config.agent.exploreModel)]
      : []),
  ];
}
