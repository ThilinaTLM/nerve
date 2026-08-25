import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { ensureProviderForModel, getModelRegistry } from "./model-registry.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function withDetailedOpenAICodexReasoningSummary(payload: unknown): unknown {
  if (!isRecord(payload) || !isRecord(payload.reasoning)) return payload;
  return {
    ...payload,
    reasoning: { ...payload.reasoning, summary: "detailed" },
  };
}

export function withNerveSimpleStreamDefaults(
  model: Model<Api>,
  options?: SimpleStreamOptions,
): SimpleStreamOptions | undefined {
  if (model.api !== "openai-codex-responses") return options;
  const onPayload = options?.onPayload;
  return {
    ...options,
    onPayload: async (payload, payloadModel) => {
      const preferredPayload = withDetailedOpenAICodexReasoningSummary(payload);
      if (!onPayload) return preferredPayload;
      const replacement = await onPayload(preferredPayload, payloadModel);
      return replacement === undefined ? preferredPayload : replacement;
    },
  };
}

export function streamSimpleWithModel(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  ensureProviderForModel(model);
  const models = getModelRegistry();
  const streamOptions = withNerveSimpleStreamDefaults(model, options);
  const provider = models.getProvider(model.provider);
  if (options?.apiKey !== undefined && provider && !provider.auth.apiKey) {
    return provider.streamSimple(model, context, streamOptions);
  }
  return models.streamSimple(model, context, streamOptions);
}

export async function completeSimpleWithModel(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  return await streamSimpleWithModel(model, context, options).result();
}
