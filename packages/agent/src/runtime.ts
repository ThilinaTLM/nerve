import {
  type AssistantMessageEvent,
  type Context,
  clampThinkingLevel,
  fauxAssistantMessage,
  getModel,
  getModels,
  getProviders,
  getSupportedThinkingLevels,
  type KnownProvider,
  type Message,
  type Model,
  registerFauxProvider,
  streamSimple,
} from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "./types.js";

export interface AgentModelSelection {
  provider: string;
  modelId: string;
}

export interface AgentModelInfo extends AgentModelSelection {
  name: string;
  reasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
  contextWindow: number;
  maxOutputTokens: number;
}

/**
 * A user-defined model (custom provider or manually-added model). The
 * orchestrator owns persistence; the runtime turns these into pi-ai `Model`
 * objects so unknown providers resolve without falling back to the faux model.
 */
export interface AgentCustomModel {
  provider: string;
  modelId: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  supportedThinkingLevels?: ThinkingLevel[];
  thinkingLevelMap?: Record<string, string | null>;
  input?: ("text" | "image")[];
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

function toPiModel(model: AgentCustomModel): Model<string> {
  return {
    id: model.modelId,
    name: model.name,
    api: model.api,
    provider: model.provider,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap,
    input: model.input ?? ["text"],
    cost: model.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? 0,
    maxTokens: model.maxTokens ?? 0,
    headers: model.headers,
    compat: model.compat as never,
  } as Model<string>;
}

let customModelProvider: (() => AgentCustomModel[]) | undefined;

/**
 * Register a source of user-defined models (custom providers / manual models).
 * When set, resolution and listing functions consult it unless an explicit
 * `customModels` argument is passed. The orchestrator wires this to its
 * persisted provider catalog so unknown providers resolve correctly.
 */
export function setCustomModelProvider(
  provider: (() => AgentCustomModel[]) | undefined,
): void {
  customModelProvider = provider;
}

function activeCustomModels(
  explicit?: AgentCustomModel[],
): AgentCustomModel[] | undefined {
  return explicit ?? customModelProvider?.();
}

function findCustomModel(
  customModels: AgentCustomModel[] | undefined,
  selection: AgentModelSelection | undefined,
): AgentCustomModel | undefined {
  if (!customModels || !selection) return undefined;
  return customModels.find(
    (model) =>
      model.provider === selection.provider &&
      model.modelId === selection.modelId,
  );
}

function customModelInfo(model: AgentCustomModel): AgentModelInfo {
  const info = getAgentModelInfo(toPiModel(model));
  return model.supportedThinkingLevels
    ? { ...info, supportedThinkingLevels: model.supportedThinkingLevels }
    : info;
}

export interface AgentPromptInput {
  systemPrompt?: string;
  messages: Message[];
  model?: AgentModelSelection;
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

let fauxProvider: ReturnType<typeof registerFauxProvider> | undefined;

const fauxResponseFactory: Parameters<
  ReturnType<typeof registerFauxProvider>["appendResponses"]
>[0][number] = (context) => {
  const latest = [...context.messages]
    .reverse()
    .find((message) => message.role === "user");
  const prompt = latest ? userMessageText(latest) : "";
  return fauxAssistantMessage(
    [
      "I’m the temporary Nerve agent runtime.",
      "",
      prompt
        ? `I received your prompt: “${prompt.slice(0, 240)}${prompt.length > 240 ? "…" : ""}”`
        : "I did not receive a user prompt.",
      "",
      "The orchestrator, HTTP API, WebSocket event stream, and prompt plumbing are connected. Real provider execution can use a configured model/API key; otherwise this faux model keeps local development deterministic.",
    ].join("\n"),
  );
};

function getFauxProvider(): ReturnType<typeof registerFauxProvider> {
  if (!fauxProvider) {
    fauxProvider = registerFauxProvider({
      provider: "nerve-faux",
      models: [{ id: "faux-fast", name: "Nerve Faux Fast" }],
      tokensPerSecond: 80,
      tokenSize: { min: 10, max: 22 },
    });
  }
  return fauxProvider;
}

function userMessageText(message: Extract<Message, { role: "user" }>): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function isKnownProvider(provider: string): provider is KnownProvider {
  return (getProviders() as string[]).includes(provider);
}

function resolveAgentModelInternal(
  selection: AgentModelSelection | undefined,
  appendFauxResponse: boolean,
  customModels?: AgentCustomModel[],
): Model<string> {
  const custom = findCustomModel(activeCustomModels(customModels), selection);
  if (custom) return toPiModel(custom);
  if (selection && isKnownProvider(selection.provider)) {
    return getModel(
      selection.provider,
      selection.modelId as never,
    ) as Model<string>;
  }
  const faux = getFauxProvider();
  if (appendFauxResponse) faux.appendResponses([fauxResponseFactory]);
  return faux.getModel();
}

export function resolveAgentModel(
  selection?: AgentModelSelection,
  customModels?: AgentCustomModel[],
): Model<string> {
  return resolveAgentModelInternal(selection, true, customModels);
}

export function getAgentModelInfo(model: Model<string>): AgentModelInfo {
  return {
    provider: model.provider,
    modelId: model.id,
    name: model.name || model.id,
    reasoning: model.reasoning,
    supportedThinkingLevels: getSupportedThinkingLevels(
      model,
    ) as ThinkingLevel[],
    contextWindow: model.contextWindow ?? 0,
    maxOutputTokens: model.maxTokens ?? 0,
  };
}

/** Resolve the context window for a model selection (0 when unknown). */
export function getModelContextWindow(
  selection?: AgentModelSelection,
  customModels?: AgentCustomModel[],
): number {
  return (
    resolveAgentModelInternal(selection, false, customModels).contextWindow ?? 0
  );
}

export function clampAgentThinkingLevel(
  selection: AgentModelSelection | undefined,
  requested: ThinkingLevel | undefined,
  customModels?: AgentCustomModel[],
): ThinkingLevel {
  const model = resolveAgentModelInternal(selection, false, customModels);
  return clampThinkingLevel(model, requested ?? "off") as ThinkingLevel;
}

export function streamAgentPrompt(
  input: AgentPromptInput,
): AsyncIterable<AssistantMessageEvent> {
  const model = resolveAgentModel(input.model);
  const context: Context = {
    systemPrompt: input.systemPrompt,
    messages: input.messages,
  };
  return streamSimple(model, context, {
    signal: input.signal,
    apiKey: input.apiKey,
    headers: input.headers,
    maxTokens: 4096,
  });
}

const COMPLETE_MODEL_LIST_PROVIDERS = new Set<string>([
  // Nerve supports Anthropic subscription OAuth, and newer Opus/Sonnet
  // models sort after older Claude 3.x IDs. Truncating the provider list hides
  // currently available subscription models such as claude-opus-4-8.
  "anthropic",
]);

function visibleModelsForProvider(provider: KnownProvider): Model<never>[] {
  const models = getModels(provider);
  return COMPLETE_MODEL_LIST_PROVIDERS.has(provider)
    ? models
    : models.slice(0, 8);
}

export function listAvailableModels(
  customModels?: AgentCustomModel[],
): AgentModelInfo[] {
  const faux = getFauxProvider().models.map((model) =>
    getAgentModelInfo(model),
  );
  const configured = getProviders().flatMap((provider) =>
    visibleModelsForProvider(provider).map((model) =>
      getAgentModelInfo(model as Model<string>),
    ),
  );
  const custom = (activeCustomModels(customModels) ?? []).map((model) =>
    customModelInfo(model),
  );
  return [...faux, ...configured, ...custom];
}
