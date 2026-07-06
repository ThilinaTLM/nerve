import {
  type AssistantMessageEvent,
  type Context,
  clampThinkingLevel,
  fauxAssistantMessage,
  getSupportedThinkingLevels,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import {
  ensureProviderForModel,
  getBuiltinProviderIds,
  getNerveFauxProvider,
  getRegisteredModel,
  getRegisteredModels,
  isBuiltinProvider,
  streamSimpleWithModel,
} from "./pi-ai-models.js";
import { normalizeImagesForModel } from "./runtime/image-normalization.js";
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
 * objects. Custom providers supply explicit connection settings; manual models
 * under built-in providers can inherit settings from pi-ai's provider catalog.
 */
export interface AgentCustomModel {
  provider: string;
  modelId: string;
  name: string;
  api?: string;
  baseUrl?: string;
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

function templateForCustomModel(
  model: AgentCustomModel,
): Model<string> | undefined {
  if (!isKnownProvider(model.provider)) return undefined;
  return (
    (getRegisteredModel(model.provider, model.modelId) as
      | Model<string>
      | undefined) ??
    (getRegisteredModels(model.provider)[0] as Model<string> | undefined)
  );
}

function toPiModel(model: AgentCustomModel): Model<string> | undefined {
  const template =
    model.api && model.baseUrl ? undefined : templateForCustomModel(model);
  const api = model.api ?? template?.api;
  const baseUrl = model.baseUrl ?? template?.baseUrl;
  if (!api || !baseUrl) return undefined;
  const resolved = {
    id: model.modelId,
    name: model.name,
    api,
    provider: model.provider,
    baseUrl,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap ?? template?.thinkingLevelMap,
    input: model.input ?? template?.input ?? ["text"],
    cost: model.cost ??
      template?.cost ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
    contextWindow: model.contextWindow ?? template?.contextWindow ?? 0,
    maxTokens: model.maxTokens ?? template?.maxTokens ?? 0,
    headers: { ...(template?.headers ?? {}), ...(model.headers ?? {}) },
    compat: (model.compat ?? template?.compat) as never,
  } as Model<string>;
  ensureProviderForModel(resolved);
  return resolved;
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

function customModelInfo(model: AgentCustomModel): AgentModelInfo | undefined {
  const resolved = toPiModel(model);
  if (!resolved) return undefined;
  const info = getAgentModelInfo(resolved);
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

const fauxResponseFactory: Parameters<
  ReturnType<typeof getNerveFauxProvider>["appendResponses"]
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

function userMessageText(message: Extract<Message, { role: "user" }>): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function isKnownProvider(provider: string): boolean {
  return isBuiltinProvider(provider);
}

function resolveAgentModelInternal(
  selection: AgentModelSelection | undefined,
  appendFauxResponse: boolean,
  customModels?: AgentCustomModel[],
): Model<string> {
  const custom = findCustomModel(activeCustomModels(customModels), selection);
  const customResolved = custom ? toPiModel(custom) : undefined;
  if (customResolved) return customResolved;
  if (selection && isKnownProvider(selection.provider)) {
    const builtinModel = getRegisteredModel(
      selection.provider,
      selection.modelId,
    );
    if (builtinModel) return builtinModel as Model<string>;
  }
  const faux = getNerveFauxProvider();
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
  return (async function* streamNormalizedPrompt() {
    const model = resolveAgentModel(input.model);
    const context: Context = {
      systemPrompt: input.systemPrompt,
      messages: await normalizeImagesForModel(input.messages, model),
    };
    yield* streamSimpleWithModel(model, context, {
      signal: input.signal,
      apiKey: input.apiKey,
      headers: input.headers,
      maxTokens: 4096,
    });
  })();
}

const COMPLETE_MODEL_LIST_PROVIDERS = new Set<string>([
  // Nerve supports Anthropic subscription OAuth, and newer Opus/Sonnet
  // models sort after older Claude 3.x IDs. Truncating the provider list hides
  // currently available subscription models such as claude-opus-4-8.
  "anthropic",
]);

function visibleModelsForProvider(provider: string): readonly Model<string>[] {
  const models = getRegisteredModels(provider) as readonly Model<string>[];
  return COMPLETE_MODEL_LIST_PROVIDERS.has(provider)
    ? models
    : models.slice(0, 8);
}

export function listAvailableModels(
  customModels?: AgentCustomModel[],
): AgentModelInfo[] {
  const faux = getNerveFauxProvider().models.map((model) =>
    getAgentModelInfo(model),
  );
  const configured = getBuiltinProviderIds().flatMap((provider) =>
    visibleModelsForProvider(provider).map((model) => getAgentModelInfo(model)),
  );
  const custom = (activeCustomModels(customModels) ?? [])
    .map((model) => customModelInfo(model))
    .filter((model): model is AgentModelInfo => Boolean(model));
  return [...faux, ...configured, ...custom];
}
