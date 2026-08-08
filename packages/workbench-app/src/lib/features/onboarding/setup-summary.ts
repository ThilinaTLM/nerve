import type { ModelInfo, ModelSelection, Settings } from "@nervekit/contracts";

export type AgentDefaultsSetupSummary = {
  configured: boolean;
  text: string;
};

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function modelLabel(
  selection: ModelSelection | undefined,
  models: ModelInfo[],
  fallback: string,
): string {
  if (!selection) return fallback;
  const model = models.find(
    (candidate) =>
      candidate.provider === selection.provider &&
      candidate.modelId === selection.modelId,
  );
  return model?.name || model?.label || selection.modelId;
}

export function summarizeAgentDefaults(
  settings: Pick<
    Settings,
    | "defaultMode"
    | "defaultPermissionLevel"
    | "defaultModel"
    | "defaultThinkingLevel"
    | "exploreAgent"
  >,
  models: ModelInfo[],
): AgentDefaultsSetupSummary {
  const main = modelLabel(
    settings.defaultModel,
    models,
    "First available scoped model",
  );
  const explore = modelLabel(
    settings.exploreAgent.model,
    models,
    "Default model",
  );
  return {
    configured: Boolean(settings.defaultModel && settings.exploreAgent.model),
    text: `${titleCase(settings.defaultMode)} · ${titleCase(settings.defaultPermissionLevel)} · Main: ${main} (${settings.defaultThinkingLevel}) · Explore: ${explore} (${settings.exploreAgent.thinkingLevel})`,
  };
}
