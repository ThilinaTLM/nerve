/* eslint-disable max-lines -- Central harness implementation; provider env forwarding is a small extension pending broader split. */
import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import { runAgentLoop } from "../agent-loop.js";
import { streamSimpleWithModel } from "../pi-ai-models.js";
import { isAgentToolSuspension } from "../suspension.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AnyModel,
  QueueMode,
  StreamFn,
  ThinkingLevel,
} from "../types.js";
import {
  cloneHarnessResources,
  createToolMap,
  validateToolNames,
} from "./configuration.js";
import type { Conversation } from "./conversation/conversation.js";
import { flushPendingConversationWrites as flushHarnessPendingConversationWrites } from "./conversation-writes.js";
import type { ExecutionEnv } from "./env/types.js";
import { AgentHarnessError } from "./errors.js";
import type {
  AbortResult,
  AgentHarnessEvent,
  AgentHarnessEventResultMap,
  AgentHarnessOwnEvent,
  AgentHarnessPhase,
  NavigateTreeResult,
  PendingConversationWrite,
} from "./events.js";
import {
  abortHarnessRun,
  getHarnessActiveTools,
  type HarnessConfigurationState,
  setHarnessActiveTools,
  setHarnessModel,
  setHarnessResources,
  setHarnessThinkingLevel,
  setHarnessTools,
} from "./harness-configuration-methods.js";
import {
  continueHarnessRun,
  type HarnessContinuationState,
} from "./harness-continuation.js";
import {
  AgentHarnessEventHub,
  normalizeHarnessError,
  normalizeHookError,
} from "./harness-events.js";
import {
  type HarnessInvocationState,
  invokePromptTemplate,
  invokeSkill,
} from "./harness-invocations.js";
import {
  compactHarnessConversation,
  type HarnessMaintenanceContext,
  navigateHarnessTree,
} from "./harness-maintenance.js";
import {
  coalesceQueuedUserEntries,
  takeQueuedMessageEntries,
} from "./harness-queue-coalescing.js";
import {
  appendExternalHarnessMessage,
  appendHarnessMessage,
  enqueueHarnessMessage as enqueueHarnessQueueMessage,
  enqueueNextTurn,
  type HarnessQueueState,
  type InboundQueuedMessage,
  removeQueuedHarnessMessage,
  steerHarness,
} from "./harness-queue-methods.js";
import { convertToLlm } from "./messages.js";
import type {
  AgentHarnessOptions,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  PromptTemplate,
  Skill,
} from "./options.js";
import { toError } from "./result.js";
import { createFailureMessage, createUserMessage } from "./run/messages.js";
import { cloneStreamOptions, mergeHeaders } from "./stream-options.js";
import {
  type AgentHarnessTurnState,
  createTurnState as createAgentHarnessTurnState,
} from "./turn-state.js";
export class AgentHarness<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentTool = AgentTool,
> {
  readonly env: ExecutionEnv;
  private conversation: Conversation;
  private phase: AgentHarnessPhase = "idle";
  runAbortController?: AbortController;
  private runPromise?: Promise<void>;
  private pendingConversationWrites: PendingConversationWrite[] = [];
  private model: AnyModel;
  private thinkingLevel: ThinkingLevel;
  private systemPrompt: AgentHarnessOptions<
    TSkill,
    TPromptTemplate,
    TTool
  >["systemPrompt"];
  private streamOptions: AgentHarnessStreamOptions;
  private getApiKeyAndHeaders?: AgentHarnessOptions["getApiKeyAndHeaders"];
  private resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  private tools = new Map<string, TTool>();
  private activeToolNames: string[];
  private steerQueue: InboundQueuedMessage[] = [];
  private steeringQueueMode: QueueMode;
  private followUpQueue: InboundQueuedMessage[] = [];
  private followUpQueueMode: QueueMode;
  private nextTurnQueue: AgentMessage[] = [];
  private readonly queuedMessageWrites = new WeakMap<
    AgentMessage,
    { id?: string; timestamp?: string }
  >();
  private events = new AgentHarnessEventHub<TSkill, TPromptTemplate>();
  constructor(options: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>) {
    this.env = options.env;
    this.conversation = options.conversation;
    this.resources = options.resources ?? {};
    this.streamOptions = cloneStreamOptions(options.streamOptions);
    this.systemPrompt = options.systemPrompt;
    this.getApiKeyAndHeaders = options.getApiKeyAndHeaders;
    this.tools = createToolMap(options.tools ?? []);
    this.model = options.model;
    this.thinkingLevel = options.thinkingLevel ?? "off";
    this.activeToolNames = options.activeToolNames
      ? [...options.activeToolNames]
      : [...this.tools.keys()];
    this.validateToolNames(this.activeToolNames);
    this.steeringQueueMode = options.steeringMode ?? "one-at-a-time";
    this.followUpQueueMode = options.followUpMode ?? "one-at-a-time";
  }
  private async emitOwn(
    event: AgentHarnessOwnEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.events.emitOwn(event, signal);
  }
  private async emitAny(
    event: AgentHarnessEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.events.emitAny(event, signal);
  }
  private async emitHook<TType extends keyof AgentHarnessEventResultMap>(
    event: Extract<AgentHarnessOwnEvent, { type: TType }>,
  ): Promise<AgentHarnessEventResultMap[TType] | undefined> {
    return this.events.emitHook(event);
  }

  private async emitBeforeProviderRequest(
    model: AnyModel,
    conversationId: string,
    streamOptions: AgentHarnessStreamOptions,
  ): Promise<AgentHarnessStreamOptions> {
    return this.events.emitBeforeProviderRequest(
      model,
      conversationId,
      streamOptions,
    );
  }

  private async emitBeforeProviderPayload(
    model: AnyModel,
    payload: unknown,
  ): Promise<unknown> {
    return this.events.emitBeforeProviderPayload(model, payload);
  }

  private async emitQueueUpdate(): Promise<void> {
    await this.emitOwn({
      type: "queue_update",
      steer: this.steerQueue.map((entry) => entry.message),
      followUp: this.followUpQueue.map((entry) => entry.message),
      nextTurn: [...this.nextTurnQueue],
    });
  }

  private startRunPromise(): () => void {
    let finish = () => {};
    this.runPromise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return () => {
      this.runPromise = undefined;
      finish();
    };
  }

  private async createTurnState(): Promise<
    AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>
  > {
    return createAgentHarnessTurnState({
      env: this.env,
      conversation: this.conversation,
      resources: this.getResources(),
      streamOptions: this.streamOptions,
      systemPrompt: this.systemPrompt,
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      tools: this.tools,
      activeToolNames: this.activeToolNames,
    });
  }

  private createContext(
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    systemPrompt?: string,
  ): AgentContext {
    return {
      systemPrompt: systemPrompt ?? turnState.systemPrompt,
      messages: turnState.messages.slice(),
      tools: turnState.activeTools.slice(),
    };
  }

  private createStreamFn(
    getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
  ): StreamFn {
    return async (model, context, streamOptions) => {
      const turnState = getTurnState();
      const auth = await this.getApiKeyAndHeaders?.(model);
      const snapshotOptions: AgentHarnessStreamOptions = {
        ...turnState.streamOptions,
        headers: mergeHeaders(turnState.streamOptions.headers, auth?.headers),
        env: {
          ...(turnState.streamOptions.env ?? {}),
          ...(auth?.env ?? {}),
        },
      };
      if (Object.keys(snapshotOptions.env ?? {}).length === 0)
        snapshotOptions.env = undefined;
      const requestOptions = await this.emitBeforeProviderRequest(
        model,
        turnState.conversationId,
        snapshotOptions,
      );
      return streamSimpleWithModel(model, context, {
        cacheRetention: requestOptions.cacheRetention,
        headers: requestOptions.headers,
        maxRetries: requestOptions.maxRetries,
        maxRetryDelayMs: requestOptions.maxRetryDelayMs,
        metadata: requestOptions.metadata,
        env: requestOptions.env,
        onPayload: async (payload) =>
          await this.emitBeforeProviderPayload(model, payload),
        onResponse: async (response) => {
          const headers = { ...(response.headers as Record<string, string>) };
          await this.emitOwn(
            {
              type: "after_provider_response",
              status: response.status,
              headers,
            },
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

  private async drainQueuedMessages(
    queue: InboundQueuedMessage[],
    mode: QueueMode,
  ): Promise<AgentMessage[]> {
    const entries = takeQueuedMessageEntries(queue, mode);
    if (entries.length === 0) return [];
    try {
      await this.emitQueueUpdate();
      const groups = coalesceQueuedUserEntries(entries);
      for (const group of groups) {
        if (group.entries.length !== 1) continue;
        const [entry] = group.entries;
        if (entry?.source === "harness" && (entry.id || entry.timestamp)) {
          this.queuedMessageWrites.set(group.message, {
            id: entry.id,
            timestamp: entry.timestamp,
          });
        }
      }
      return groups.map((group) => group.message);
    } catch (error) {
      queue.unshift(...entries);
      throw normalizeHookError(error);
    }
  }

  private createLoopConfig(
    getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    setTurnState: (
      turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    ) => void,
  ): AgentLoopConfig {
    const turnState = getTurnState();
    return {
      model: turnState.model,
      reasoning:
        turnState.thinkingLevel === "off" ? undefined : turnState.thinkingLevel,
      convertToLlm,
      transformContext: async (messages) => {
        const result = await this.emitHook({
          type: "context",
          messages: [...messages],
        });
        return result?.messages ?? messages;
      },
      beforeToolCall: async ({ toolCall, args }) => {
        const result = await this.emitHook({
          type: "tool_call",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: args as Record<string, unknown>,
        });
        return result
          ? { block: result.block, reason: result.reason }
          : undefined;
      },
      afterToolCall: async ({ toolCall, args, result, isError }) => {
        const patch = await this.emitHook({
          type: "tool_result",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: args as Record<string, unknown>,
          content: result.content,
          details: result.details,
          isError,
        });
        return patch
          ? {
              content: patch.content,
              details: patch.details,
              isError: patch.isError,
              terminate: patch.terminate,
            }
          : undefined;
      },
      prepareNextTurn: async () => {
        await this.flushPendingConversationWrites();
        const nextTurnState = await this.createTurnState();
        setTurnState(nextTurnState);
        return {
          context: this.createContext(nextTurnState),
          model: nextTurnState.model,
          thinkingLevel: nextTurnState.thinkingLevel,
        };
      },
      getSteeringMessages: async () =>
        this.drainQueuedMessages(this.steerQueue, this.steeringQueueMode),
      getFollowUpMessages: async () => [],
    };
  }

  private validateToolNames(
    toolNames: string[],
    tools: Map<string, TTool> = this.tools,
  ): void {
    validateToolNames(toolNames, tools);
  }

  private async flushPendingConversationWrites(): Promise<void> {
    await flushHarnessPendingConversationWrites(
      this.conversation,
      this.pendingConversationWrites,
    );
  }

  private async handleAgentEvent(
    event: AgentEvent,
    signal?: AbortSignal,
  ): Promise<void> {
    if (event.type === "message_end") {
      const queuedWrite = this.queuedMessageWrites.get(event.message);
      this.queuedMessageWrites.delete(event.message);
      if (queuedWrite?.id) {
        await this.conversation.appendMessageWithId(
          queuedWrite.id,
          event.message,
          queuedWrite.timestamp,
        );
      } else {
        await this.conversation.appendMessage(event.message);
      }
      await this.emitAny(event, signal);
      return;
    }
    if (event.type === "turn_end") {
      let eventError: unknown;
      try {
        await this.emitAny(event, signal);
      } catch (error) {
        eventError = error;
      }
      const hadPendingMutations = this.pendingConversationWrites.length > 0;
      await this.flushPendingConversationWrites();
      if (eventError) throw eventError;
      await this.emitOwn({ type: "save_point", hadPendingMutations });
      return;
    }
    if (event.type === "agent_end") {
      await this.flushPendingConversationWrites();
      this.phase = "idle";
      await this.emitAny(event, signal);
      await this.emitOwn(
        { type: "settled", nextTurnCount: this.nextTurnQueue.length },
        signal,
      );
      return;
    }
    await this.emitAny(event, signal);
  }

  private async emitRunFailure(
    model: AnyModel,
    error: unknown,
    aborted: boolean,
    signal: AbortSignal,
  ): Promise<AgentMessage[]> {
    const failureMessage = createFailureMessage(model, error, aborted);
    await this.handleAgentEvent(
      { type: "message_start", message: failureMessage },
      signal,
    );
    await this.handleAgentEvent(
      { type: "message_end", message: failureMessage },
      signal,
    );
    await this.handleAgentEvent(
      { type: "turn_end", message: failureMessage, toolResults: [] },
      signal,
    );
    await this.handleAgentEvent(
      { type: "agent_end", messages: [failureMessage] },
      signal,
    );
    return [failureMessage];
  }

  private async executeTurn(
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    text: string,
    options?: { images?: ImageContent[] },
  ): Promise<AssistantMessage> {
    let activeTurnState = turnState;
    const promptMessage = createUserMessage(text, options?.images);
    let messages: AgentMessage[] = [promptMessage];
    if (this.nextTurnQueue.length > 0) {
      const queuedMessages = this.nextTurnQueue.splice(0);
      try {
        await this.emitQueueUpdate();
      } catch (error) {
        this.nextTurnQueue.unshift(...queuedMessages);
        throw normalizeHookError(error);
      }
      messages = [...queuedMessages, promptMessage];
    }
    const beforeResult = await this.emitHook({
      type: "before_agent_start",
      prompt: text,
      images: options?.images,
      systemPrompt: turnState.systemPrompt,
      resources: turnState.resources,
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
    this.runAbortController = abortController;
    const runResultPromise = (async () => {
      try {
        return await runAgentLoop(
          messages,
          this.createContext(turnState, beforeResult?.systemPrompt),
          this.createLoopConfig(getTurnState, setTurnState),
          (event) => this.handleAgentEvent(event, abortController.signal),
          abortController.signal,
          this.createStreamFn(getTurnState),
        );
      } catch (error) {
        if (isAgentToolSuspension(error)) {
          this.phase = "idle";
          throw error;
        }
        try {
          return await this.emitRunFailure(
            activeTurnState.model,
            error,
            abortController.signal.aborted,
            abortController.signal,
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
        if (message.role === "assistant") {
          return message;
        }
      }
      throw new AgentHarnessError(
        "invalid_state",
        "AgentHarness prompt completed without an assistant message",
      );
    } finally {
      try {
        await this.flushPendingConversationWrites();
      } finally {
        this.runAbortController = undefined;
      }
    }
  }

  private async runForegroundTurn(
    resolvePrompt: (
      turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    ) =>
      | { text: string; options?: { images?: ImageContent[] } }
      | Promise<{ text: string; options?: { images?: ImageContent[] } }>,
  ): Promise<AssistantMessage> {
    if (this.phase !== "idle") {
      throw new AgentHarnessError("busy", "AgentHarness is busy");
    }
    this.phase = "turn";
    const finishRunPromise = this.startRunPromise();
    try {
      const turnState = await this.createTurnState();
      const prompt = await resolvePrompt(turnState);
      return await this.executeTurn(turnState, prompt.text, prompt.options);
    } catch (error) {
      this.phase = "idle";
      throw normalizeHarnessError(error, "unknown");
    } finally {
      finishRunPromise();
    }
  }

  async prompt(
    text: string,
    options?: { images?: ImageContent[] },
  ): Promise<AssistantMessage> {
    return this.runForegroundTurn(() => ({ text, options }));
  }

  async continue(): Promise<AssistantMessage> {
    return continueHarnessRun(
      this as unknown as HarnessContinuationState<
        TSkill,
        TPromptTemplate,
        TTool
      >,
    );
  }

  async skill(
    name: string,
    additionalInstructions?: string,
  ): Promise<AssistantMessage> {
    return invokeSkill(
      this as unknown as HarnessInvocationState<TSkill, TPromptTemplate, TTool>,
      name,
      additionalInstructions,
    );
  }

  async promptFromTemplate(
    name: string,
    args: string[] = [],
  ): Promise<AssistantMessage> {
    return invokePromptTemplate(
      this as unknown as HarnessInvocationState<TSkill, TPromptTemplate, TTool>,
      name,
      args,
    );
  }

  private queueState(): HarnessQueueState {
    return this as unknown as HarnessQueueState;
  }

  async steer(
    text: string,
    options?: { images?: ImageContent[]; id?: string },
  ): Promise<void> {
    return steerHarness(this.queueState(), text, options);
  }

  async followUp(
    text: string,
    options?: { images?: ImageContent[]; id?: string },
  ): Promise<void> {
    return this.steer(text, options);
  }

  async removeQueuedMessage(id: string): Promise<boolean> {
    return removeQueuedHarnessMessage(this.queueState(), id);
  }

  async enqueueHarnessMessage(input: {
    id?: string;
    message: AgentMessage;
    timestamp?: string;
    delivery?: InboundQueuedMessage["delivery"];
    priority?: InboundQueuedMessage["priority"];
  }): Promise<void> {
    return enqueueHarnessQueueMessage(this.queueState(), input);
  }

  async nextTurn(
    text: string,
    options?: { images?: ImageContent[] },
  ): Promise<void> {
    return enqueueNextTurn(this.queueState(), text, options);
  }

  async appendMessage(message: AgentMessage): Promise<void> {
    return appendHarnessMessage(this.queueState(), message);
  }

  async appendExternalMessage(input: {
    id: string;
    message: AgentMessage;
    timestamp?: string;
  }): Promise<void> {
    return appendExternalHarnessMessage(this.queueState(), input);
  }

  async compact(customInstructions?: string): Promise<{
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: unknown;
  }> {
    return compactHarnessConversation(
      this.maintenanceContext(),
      customInstructions,
    );
  }

  async navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<NavigateTreeResult> {
    return navigateHarnessTree(this.maintenanceContext(), targetId, options);
  }

  private maintenanceContext(): HarnessMaintenanceContext<
    TSkill,
    TPromptTemplate,
    TTool
  > {
    return {
      getPhase: () => this.phase,
      setPhase: (phase) => {
        this.phase = phase;
      },
      conversation: this.conversation,
      getModel: () => this.model,
      getThinkingLevel: () => this.thinkingLevel,
      getApiKeyAndHeaders: this.getApiKeyAndHeaders,
      emitHook: (event) => this.emitHook(event as never),
      emitOwn: (event) => this.emitOwn(event as never),
    };
  }

  private configurationState(): HarnessConfigurationState<
    TSkill,
    TPromptTemplate,
    TTool
  > {
    return this as unknown as HarnessConfigurationState<
      TSkill,
      TPromptTemplate,
      TTool
    >;
  }

  getModel(): AnyModel {
    return this.model;
  }

  async setModel(model: AnyModel): Promise<void> {
    return setHarnessModel(this.configurationState(), model);
  }

  getThinkingLevel(): ThinkingLevel {
    return this.thinkingLevel;
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return setHarnessThinkingLevel(this.configurationState(), level);
  }

  getTools(): TTool[] {
    return [...this.tools.values()];
  }

  async setTools(tools: TTool[], activeToolNames?: string[]): Promise<void> {
    return setHarnessTools(this.configurationState(), tools, activeToolNames);
  }

  getActiveTools(): TTool[] {
    return getHarnessActiveTools(this.configurationState());
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    return setHarnessActiveTools(this.configurationState(), toolNames);
  }

  getSteeringMode(): QueueMode {
    return this.steeringQueueMode;
  }

  async setSteeringMode(mode: QueueMode): Promise<void> {
    this.steeringQueueMode = mode;
  }

  getFollowUpMode(): QueueMode {
    return this.followUpQueueMode;
  }

  async setFollowUpMode(mode: QueueMode): Promise<void> {
    this.followUpQueueMode = mode;
  }

  getResources(): AgentHarnessResources<TSkill, TPromptTemplate> {
    return cloneHarnessResources(this.resources);
  }

  async setResources(
    resources: AgentHarnessResources<TSkill, TPromptTemplate>,
  ): Promise<void> {
    return setHarnessResources(this.configurationState(), resources);
  }

  getStreamOptions(): AgentHarnessStreamOptions {
    return cloneStreamOptions(this.streamOptions);
  }

  async setStreamOptions(
    streamOptions: AgentHarnessStreamOptions,
  ): Promise<void> {
    this.streamOptions = cloneStreamOptions(streamOptions);
  }

  async abort(): Promise<AbortResult> {
    return abortHarnessRun(this.configurationState());
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise;
  }

  subscribe(
    listener: (
      event: AgentHarnessEvent<TSkill, TPromptTemplate>,
      signal?: AbortSignal,
    ) => Promise<void> | void,
  ): () => void {
    return this.events.subscribe(listener);
  }

  on<TType extends keyof AgentHarnessEventResultMap>(
    type: TType,
    handler: (
      event: Extract<AgentHarnessOwnEvent, { type: TType }>,
    ) =>
      | Promise<AgentHarnessEventResultMap[TType]>
      | AgentHarnessEventResultMap[TType],
  ): () => void {
    return this.events.on(type, handler);
  }
}
