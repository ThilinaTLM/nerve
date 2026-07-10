import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import {
  builtinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";
import type { ModelInfo } from "@nervekit/contracts";

const models = builtinModels();
const providerIds = getBuiltinProviders();

function modelInfo(model: Model<string>): ModelInfo {
  return {
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    label: model.name,
    reasoning: model.reasoning,
    supportedThinkingLevels: getSupportedThinkingLevels(model),
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxTokens,
  };
}

export function listSandboxManagerModels(): ModelInfo[] {
  return providerIds.flatMap((provider) =>
    models
      .getModels(provider)
      .map((model) => modelInfo(model as Model<string>)),
  );
}
