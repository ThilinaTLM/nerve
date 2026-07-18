import {
  getSupportedThinkingLevels,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { ModelInfo } from "@nervekit/contracts";

const models = builtinModels();

export function registerSandboxManagerProvider(provider: Provider): void {
  models.setProvider(provider);
}

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
  return models.getModels().map((model) => modelInfo(model as Model<string>));
}
