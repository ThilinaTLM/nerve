import type {
  AgentRecord,
  AuthProviderMetadata,
  ModelInfo,
  Settings,
} from "$lib/api";
import { modelKey, scopedUsableModelOptions } from "$lib/core/utils/model";

export const THINKING_LEVEL_ORDER: AgentRecord["thinkingLevel"][] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export type NewAgentComposerSelection = {
  selectedModelKey: string;
  selectedThinkingLevel: AgentRecord["thinkingLevel"];
  selectedMode: AgentRecord["mode"];
  selectedPermissionLevel: AgentRecord["permissionLevel"];
};

export function supportedThinkingLevelsForModel(
  model: ModelInfo | undefined,
): AgentRecord["thinkingLevel"][] {
  return model?.supportedThinkingLevels?.length
    ? model.supportedThinkingLevels
    : ["off"];
}

export function clampThinkingLevelForModel(
  level: AgentRecord["thinkingLevel"],
  model: ModelInfo | undefined,
): AgentRecord["thinkingLevel"] {
  const supported = supportedThinkingLevelsForModel(model);
  if (supported.includes(level)) return level;

  const requestedIndex = THINKING_LEVEL_ORDER.indexOf(level);
  if (requestedIndex === -1) return supported[0] ?? "off";

  for (
    let index = requestedIndex;
    index < THINKING_LEVEL_ORDER.length;
    index++
  ) {
    const candidate = THINKING_LEVEL_ORDER[index];
    if (supported.includes(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index--) {
    const candidate = THINKING_LEVEL_ORDER[index];
    if (supported.includes(candidate)) return candidate;
  }
  return supported[0] ?? "off";
}

export function effectiveNewAgentDefaults(settings: Settings) {
  return settings.rememberLastAgentSelection
    ? settings.lastAgentSelection
    : {
        mode: settings.defaultMode,
        permissionLevel: settings.defaultPermissionLevel,
        model: settings.defaultModel,
        thinkingLevel: settings.defaultThinkingLevel,
      };
}

export function resolveNewAgentComposerSelection(
  settings: Settings,
  models: ModelInfo[],
  authProviders: AuthProviderMetadata[],
): NewAgentComposerSelection {
  const defaults = effectiveNewAgentDefaults(settings);
  const usable = scopedUsableModelOptions(
    models,
    authProviders,
    settings.scopedModels,
  );
  const defaultModel = defaults.model;
  const selectedModel = defaultModel
    ? usable.find((model) => modelKey(model) === modelKey(defaultModel))
    : undefined;
  const fallbackModel = selectedModel ?? usable[0];

  return {
    selectedModelKey: fallbackModel ? modelKey(fallbackModel) : "",
    selectedThinkingLevel: clampThinkingLevelForModel(
      defaults.thinkingLevel,
      fallbackModel,
    ),
    selectedMode: defaults.mode,
    selectedPermissionLevel: defaults.permissionLevel,
  };
}
