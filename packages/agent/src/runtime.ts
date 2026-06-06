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
  reasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
  contextWindow: number;
  maxOutputTokens: number;
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
): Model<string> {
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
): Model<string> {
  return resolveAgentModelInternal(selection, true);
}

export function getAgentModelInfo(model: Model<string>): AgentModelInfo {
  return {
    provider: model.provider,
    modelId: model.id,
    reasoning: model.reasoning,
    supportedThinkingLevels: getSupportedThinkingLevels(
      model,
    ) as ThinkingLevel[],
    contextWindow: model.contextWindow ?? 0,
    maxOutputTokens: model.maxTokens ?? 0,
  };
}

/** Resolve the context window for a model selection (0 when unknown). */
export function getModelContextWindow(selection?: AgentModelSelection): number {
  return resolveAgentModelInternal(selection, false).contextWindow ?? 0;
}

export function clampAgentThinkingLevel(
  selection: AgentModelSelection | undefined,
  requested: ThinkingLevel | undefined,
): ThinkingLevel {
  const model = resolveAgentModelInternal(selection, false);
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

export function listAvailableModels(): AgentModelInfo[] {
  const faux = getFauxProvider().models.map((model) =>
    getAgentModelInfo(model),
  );
  const configured = getProviders().flatMap((provider) =>
    getModels(provider)
      .slice(0, 8)
      .map((model) => getAgentModelInfo(model as Model<string>)),
  );
  return [...faux, ...configured];
}
