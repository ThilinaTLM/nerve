import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import { runAgentLoop } from "../../agent/loop/agent-loop.js";
import { streamSimpleWithModel } from "../../models/model-streaming.js";
import { isAgentToolSuspension } from "../../agent/suspension.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  StreamFn,
} from "../../agent/contracts/index.js";
import type { AgentHarnessTurnState } from "../configuration/turn-state.js";
import { AgentHarnessError } from "../../errors.js";
import type {
  AgentHarnessResources,
  PromptTemplate,
  Skill,
} from "../configuration/options.js";
import type { AgentHarnessStreamOptions } from "../configuration/options.js";
import { mergeHeaders } from "../configuration/stream-options.js";
import type { BeforeAgentStartResult } from "../lifecycle/events.js";
import { normalizeHookError } from "../lifecycle/event-hub.js";
import { toError } from "../../result.js";
import { createUserMessage } from "./run-messages.js";

export function createHarnessStreamFn<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(options: {
  getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>;
  getApiKeyAndHeaders?: (
    model: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>["model"],
  ) => Promise<
    | {
        apiKey?: string;
        baseUrl?: string;
        headers?: Record<string, string>;
        env?: Record<string, string>;
      }
    | undefined
  >;
  emitBeforeProviderRequest: (
    model: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>["model"],
    conversationId: string,
    streamOptions: AgentHarnessStreamOptions,
  ) => Promise<AgentHarnessStreamOptions>;
  emitBeforeProviderPayload: (
    model: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>["model"],
    payload: unknown,
  ) => Promise<unknown>;
  emitAfterProviderResponse: (
    status: number,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<void>;
}): StreamFn {
  return async (model, context, streamOptions) => {
    const turnState = options.getTurnState();
    const auth = await options.getApiKeyAndHeaders?.(model);
    const requestModel = auth?.baseUrl
      ? { ...model, baseUrl: auth.baseUrl }
      : model;
    const snapshotOptions: AgentHarnessStreamOptions = {
      ...turnState.streamOptions,
      headers: mergeHeaders(turnState.streamOptions.headers, auth?.headers),
      env: {
        ...(turnState.streamOptions.env ?? {}),
        ...(auth?.env ?? {}),
      },
    };
    if (Object.keys(snapshotOptions.env ?? {}).length === 0) {
      snapshotOptions.env = undefined;
    }
    const requestOptions = await options.emitBeforeProviderRequest(
      requestModel,
      turnState.conversationId,
      snapshotOptions,
    );
    return streamSimpleWithModel(requestModel, context, {
      cacheRetention: requestOptions.cacheRetention,
      headers: requestOptions.headers,
      maxRetries: requestOptions.maxRetries,
      maxRetryDelayMs: requestOptions.maxRetryDelayMs,
      metadata: requestOptions.metadata,
      env: requestOptions.env,
      onPayload: async (payload) =>
        await options.emitBeforeProviderPayload(requestModel, payload),
      onResponse: async (response) => {
        const headers = { ...(response.headers as Record<string, string>) };
        await options.emitAfterProviderResponse(
          response.status,
          headers,
          streamOptions?.signal,
        );
      },
      reasoning: streamOptions?.reasoning,
      signal: streamOptions?.signal,
      sessionId: turnState.conversationId,
      timeoutMs: requestOptions.timeoutMs,
      transport: requestOptions.transport,
      apiKey: auth?.apiKey,
    });
  };
}

export interface HarnessTurnExecution<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
> {
  turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>;
  text: string;
  images?: ImageContent[];
  nextTurnQueue: AgentMessage[];
  emitQueueUpdate: () => Promise<void>;
  emitBeforeAgentStart: (event: {
    type: "before_agent_start";
    prompt: string;
    images?: ImageContent[];
    systemPrompt: string;
    resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  }) => Promise<BeforeAgentStartResult | undefined>;
  createContext: (
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    systemPrompt?: string,
  ) => AgentContext;
  createLoopConfig: (
    getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    setTurnState: (
      turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    ) => void,
  ) => AgentLoopConfig;
  createStreamFn: (
    getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
  ) => StreamFn;
  handleAgentEvent: (event: AgentEvent, signal: AbortSignal) => Promise<void>;
  emitRunFailure: (
    error: unknown,
    aborted: boolean,
    signal: AbortSignal,
    model: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>["model"],
  ) => Promise<AgentMessage[]>;
  setRunAbortController: (controller: AbortController | undefined) => void;
  setIdle: () => void;
  flushPendingConversationWrites: () => Promise<void>;
}

export async function executeHarnessTurn<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  execution: HarnessTurnExecution<TSkill, TPromptTemplate, TTool>,
): Promise<AssistantMessage> {
  let activeTurnState = execution.turnState;
  const promptMessage = createUserMessage(execution.text, execution.images);
  let messages: AgentMessage[] = [promptMessage];

  if (execution.nextTurnQueue.length > 0) {
    const queuedMessages = execution.nextTurnQueue.splice(0);
    try {
      await execution.emitQueueUpdate();
    } catch (error) {
      execution.nextTurnQueue.unshift(...queuedMessages);
      throw normalizeHookError(error);
    }
    messages = [...queuedMessages, promptMessage];
  }

  const beforeResult = await execution.emitBeforeAgentStart({
    type: "before_agent_start",
    prompt: execution.text,
    images: execution.images,
    systemPrompt: execution.turnState.systemPrompt,
    resources: execution.turnState.resources,
  });
  if (beforeResult?.messages)
    messages = [...messages, ...beforeResult.messages];

  const abortController = new AbortController();
  const getTurnState = () => activeTurnState;
  const setTurnState = (
    nextTurnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
  ) => {
    activeTurnState = nextTurnState;
  };
  execution.setRunAbortController(abortController);

  const runResultPromise = (async () => {
    try {
      return await runAgentLoop(
        messages,
        execution.createContext(
          execution.turnState,
          beforeResult?.systemPrompt,
        ),
        execution.createLoopConfig(getTurnState, setTurnState),
        (event) => execution.handleAgentEvent(event, abortController.signal),
        abortController.signal,
        execution.createStreamFn(getTurnState),
      );
    } catch (error) {
      if (isAgentToolSuspension(error)) {
        execution.setIdle();
        throw error;
      }
      if (error instanceof AgentHarnessError && error.code === "hook") {
        execution.setIdle();
        throw error;
      }
      try {
        return await execution.emitRunFailure(
          error,
          abortController.signal.aborted,
          abortController.signal,
          activeTurnState.model,
        );
      } catch (failureError) {
        const cause = new AggregateError(
          [toError(error), toError(failureError)],
          "Agent run failed and failure reporting failed",
        );
        throw new AgentHarnessError("unknown", cause.message, cause);
      }
    }
  })();

  try {
    const newMessages = await runResultPromise;
    for (const message of [...newMessages].reverse()) {
      if (message.role === "assistant") return message;
    }
    throw new AgentHarnessError(
      "invalid_state",
      "AgentHarness prompt completed without an assistant message",
    );
  } finally {
    try {
      await execution.flushPendingConversationWrites();
    } finally {
      execution.setRunAbortController(undefined);
    }
  }
}
