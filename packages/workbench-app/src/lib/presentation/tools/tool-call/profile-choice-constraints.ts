import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { ModelInfo } from "@nervekit/contracts/models";
import { supportedThinkingLevelsForModel } from "$lib/presentation/state/thinking-levels";
export function implementationModelCompatible(
  model: ModelInfo,
  requirements: LeadSettingsOverrides,
): boolean {
  const required = requirements.model;
  if (
    required &&
    (required.provider !== model.provider || required.modelId !== model.modelId)
  )
    return false;
  return (
    requirements.reasoningLevel === undefined ||
    supportedThinkingLevelsForModel(model).includes(requirements.reasoningLevel)
  );
}
