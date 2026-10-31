import type { ModelInfo } from "@nervekit/contracts/models";
import type { ConversationTitlesSettings } from "@nervekit/contracts/settings";

export function isTitleModelCompatible(model: ModelInfo): boolean {
  return (
    !model.faux && model.input.includes("text") && model.maxOutputTokens > 0
  );
}
export function titleSettingsStatus(
  settings: ConversationTitlesSettings,
  models: readonly ModelInfo[],
): "off" | "no-model" | "unavailable" | "ready" {
  if (!settings.enabled) return "off";
  if (!settings.model) return "no-model";
  return models.some(
    (model) =>
      model.provider === settings.model?.provider &&
      model.modelId === settings.model?.modelId &&
      isTitleModelCompatible(model),
  )
    ? "ready"
    : "unavailable";
}
