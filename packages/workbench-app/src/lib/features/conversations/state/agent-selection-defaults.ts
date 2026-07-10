import {
  modelKey,
  scopedUsableModelOptions,
} from "@nervekit/workbench-ui/core/utils/model";
import {
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
  THINKING_LEVEL_ORDER,
} from "@nervekit/workbench-ui/state";
import type {
  AgentRecord,
  AuthProviderMetadata,
  ModelInfo,
  Settings,
} from "$lib/api";

export {
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
  THINKING_LEVEL_ORDER,
};

export type NewAgentComposerSelection = {
  selectedModelKey: string;
  selectedThinkingLevel: AgentRecord["thinkingLevel"];
  selectedMode: AgentRecord["mode"];
  selectedPermissionLevel: AgentRecord["permissionLevel"];
  selectedApprovalPolicy: AgentRecord["approvalPolicy"];
};

export function effectiveNewAgentDefaults(settings: Settings) {
  return settings.rememberLastAgentSelection
    ? settings.lastAgentSelection
    : {
        mode: settings.defaultMode,
        permissionLevel: settings.defaultPermissionLevel,
        approvalPolicy: settings.defaultApprovalPolicy,
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
    selectedApprovalPolicy: defaults.approvalPolicy,
  };
}
