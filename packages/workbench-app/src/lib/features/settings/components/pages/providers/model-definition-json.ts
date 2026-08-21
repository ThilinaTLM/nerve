import {
  piModelConfigSchema,
  supportedThinkingLevelsForPiModel,
  type PiModelConfig,
} from "@nervekit/contracts";
import type { ModelDefinition } from "$lib/api";

export const DEFAULT_MODEL_JSON = JSON.stringify(
  {
    id: "model-id",
    name: "Model name",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 16_384,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  },
  null,
  2,
);

export type ModelJsonParseResult =
  | { success: true; model: ModelDefinition }
  | { success: false; error: string };

function issueMessage(issue: {
  path?: PropertyKey[];
  message: string;
}): string {
  const path = issue.path?.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function modelDefinitionFromPiConfig(
  provider: string,
  config: PiModelConfig,
): ModelDefinition {
  return {
    provider,
    modelId: config.id,
    name: config.name ?? config.id,
    ...(config.api ? { api: config.api } : {}),
    reasoning: config.reasoning,
    supportedThinkingLevels: supportedThinkingLevelsForPiModel(config),
    ...(config.thinkingLevelMap
      ? { thinkingLevelMap: config.thinkingLevelMap }
      : {}),
    input: config.input,
    cost: config.cost,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    ...(config.samplingParams ? { samplingParams: config.samplingParams } : {}),
    ...(config.headers ? { headers: config.headers } : {}),
    ...(config.compat ? { compat: config.compat } : {}),
  };
}

export function parseModelDefinitionJson(
  text: string,
  provider: string,
  existingModelId?: string,
): ModelJsonParseResult {
  if (!provider) return { success: false, error: "Select a provider." };

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      success: false,
      error: error instanceof SyntaxError ? error.message : "Invalid JSON.",
    };
  }

  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "providers" in value
  ) {
    return {
      success: false,
      error:
        "Paste one model object from the provider's models array, not the full providers configuration.",
    };
  }

  const parsed = piModelConfigSchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      error: issueMessage(
        parsed.error.issues[0] ?? { message: "Invalid model." },
      ),
    };
  }
  if (existingModelId && parsed.data.id !== existingModelId) {
    return {
      success: false,
      error: `Model id cannot be changed while editing (${existingModelId}).`,
    };
  }
  return {
    success: true,
    model: modelDefinitionFromPiConfig(provider, parsed.data),
  };
}

export function modelDefinitionToJson(model: ModelDefinition): string {
  const config = {
    id: model.modelId,
    name: model.name,
    ...(model.api ? { api: model.api } : {}),
    reasoning: model.reasoning,
    input: model.input,
    ...(model.thinkingLevelMap
      ? { thinkingLevelMap: model.thinkingLevelMap }
      : {}),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: model.cost,
    ...(model.samplingParams ? { samplingParams: model.samplingParams } : {}),
    ...(model.headers ? { headers: model.headers } : {}),
    ...(model.compat ? { compat: model.compat } : {}),
  };
  return JSON.stringify(config, null, 2);
}
