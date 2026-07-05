import {
  getModels,
  getProviders,
  getSupportedThinkingLevels,
  type KnownProvider,
  type Model,
} from "@earendil-works/pi-ai";
import type { ModelInfo } from "@nervekit/shared";

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
  return getProviders().flatMap((provider: KnownProvider) =>
    getModels(provider).map((model) => modelInfo(model as Model<string>)),
  );
}
