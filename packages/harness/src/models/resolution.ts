import type { Message, Model } from "@earendil-works/pi-ai";
import {
  clampThinkingLevel,
  fauxAssistantMessage,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "../agent/types/index.js";
import {
  ensureProviderForModel,
  getBuiltinProviderIds,
  getNerveFauxProvider,
  getRegisteredModel,
  getRegisteredModels,
  isBuiltinProvider,
} from "./model-registry.js";
import { getScriptedProviderModel } from "./scripted-provider.js";
import type {
  AgentCustomModel,
  AgentModelInfo,
  AgentModelSelection,
} from "./types.js";

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
    samplingParams: model.samplingParams ?? template?.samplingParams,
    headers: { ...(template?.headers ?? {}), ...(model.headers ?? {}) },
    compat: (model.compat ?? template?.compat) as never,
  } as Model<string>;
  ensureProviderForModel(resolved);
  return resolved;
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
  const custom = findCustomModel(customModels, selection);
  const customResolved = custom ? toPiModel(custom) : undefined;
  if (customResolved) return customResolved;
  const scriptedModel = getScriptedProviderModel(selection);
  if (scriptedModel) return scriptedModel;
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
    input: (model.input ?? ["text"]) as ("text" | "image")[],
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

export function listAvailableModels(
  customModels?: AgentCustomModel[],
): AgentModelInfo[] {
  const faux = getNerveFauxProvider().models.map((model) =>
    getAgentModelInfo(model),
  );
  const configured = getBuiltinProviderIds().flatMap((provider) =>
    getRegisteredModels(provider).map((model) =>
      getAgentModelInfo(model as Model<string>),
    ),
  );
  const custom = (customModels ?? [])
    .map((model) => customModelInfo(model))
    .filter((model): model is AgentModelInfo => Boolean(model));
  return [...faux, ...configured, ...custom];
}
