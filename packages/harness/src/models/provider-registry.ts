import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createProvider,
  envApiKeyAuth,
  type FauxProviderHandle,
  fauxProvider,
  type Model,
  type Provider,
  type ProviderStreams,
  type RegisterFauxProviderOptions,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import { bedrockConverseStreamApi } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { piMessagesApi } from "@earendil-works/pi-ai/api/pi-messages.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const models = builtinModels();
const builtinProviderIds = new Set<string>(
  models.getProviders().map((provider) => provider.id),
);
const customProviderModels = new Map<string, Map<string, Model<Api>>>();

const apiStreams: Partial<Record<Api, ProviderStreams>> = {
  "anthropic-messages": anthropicMessagesApi(),
  "azure-openai-responses": azureOpenAIResponsesApi(),
  "bedrock-converse-stream": bedrockConverseStreamApi(),
  "google-generative-ai": googleGenerativeAIApi(),
  "google-vertex": googleVertexApi(),
  "mistral-conversations": mistralConversationsApi(),
  "openai-codex-responses": openAICodexResponsesApi(),
  "openai-completions": openAICompletionsApi(),
  "openai-responses": openAIResponsesApi(),
  "pi-messages": piMessagesApi(),
};

export type ManagedFauxProviderHandle = FauxProviderHandle & {
  unregister: () => void;
};

let nerveFaux: ManagedFauxProviderHandle | undefined;

export function registerManagedFauxProvider(
  options: RegisterFauxProviderOptions = {},
): ManagedFauxProviderHandle {
  const provider = fauxProvider(options);
  models.setProvider(provider.provider);
  return {
    ...provider,
    unregister: () => {
      models.deleteProvider(provider.provider.id);
    },
  };
}

export function getNerveFauxProvider(): ManagedFauxProviderHandle {
  if (!nerveFaux) {
    nerveFaux = registerManagedFauxProvider({
      provider: "nerve-faux",
      models: [{ id: "faux-fast", name: "Nerve Faux Fast" }],
      tokensPerSecond: 80,
      tokenSize: { min: 10, max: 22 },
    });
  }
  return nerveFaux;
}

export function isBuiltinProvider(provider: string): boolean {
  return builtinProviderIds.has(provider);
}

export function getBuiltinProviderIds(): string[] {
  return Array.from(builtinProviderIds);
}

/**
 * Installs an application-owned provider object into the harness runtime.
 * Dynamic provider model state is shared, while request credentials remain
 * resolved by the application and passed explicitly to streams.
 */
export function registerManagedProvider(provider: Provider): void {
  models.setProvider(provider);
  builtinProviderIds.add(provider.id);
}

export function getRegisteredModel(
  provider: string,
  modelId: string,
): Model<Api> | undefined {
  return models.getModel(provider, modelId);
}

export function getRegisteredModels(provider: string): readonly Model<Api>[] {
  return models.getModels(provider);
}

function registerCustomProvider(providerId: string): void {
  const byModelId = customProviderModels.get(providerId);
  if (!byModelId) return;
  const providerModels = Array.from(byModelId.values());
  models.setProvider(
    createProvider({
      id: providerId,
      name: providerId,
      auth: { apiKey: envApiKeyAuth(`${providerId} API key`, []) },
      models: providerModels,
      api: apiStreams,
    }),
  );
}

export function ensureProviderForModel(model: Model<Api>): void {
  if (isBuiltinProvider(model.provider) || model.provider === "nerve-faux") {
    return;
  }
  if (models.getModel(model.provider, model.id)) {
    return;
  }
  if (!apiStreams[model.api]) {
    throw new Error(`Unsupported pi-ai API for custom provider: ${model.api}`);
  }
  let byModelId = customProviderModels.get(model.provider);
  if (!byModelId) {
    byModelId = new Map();
    customProviderModels.set(model.provider, byModelId);
  }
  const existing = byModelId.get(model.id);
  if (existing === model) return;
  byModelId.set(model.id, model);
  registerCustomProvider(model.provider);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function withDetailedOpenAICodexReasoningSummary(payload: unknown): unknown {
  if (!isRecord(payload) || !isRecord(payload.reasoning)) return payload;
  return {
    ...payload,
    reasoning: {
      ...payload.reasoning,
      summary: "detailed",
    },
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
  const streamOptions = withNerveSimpleStreamDefaults(model, options);
  const provider = models.getProvider(model.provider);
  if (options?.apiKey !== undefined && provider && !provider.auth.apiKey) {
    // Isolated workers receive already-resolved request auth but do not own the
    // persistent OAuth credential store. Dispatch the provider directly after
    // the application has applied credential-derived model fields.
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
