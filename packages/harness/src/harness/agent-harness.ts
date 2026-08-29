import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
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
} from "../agent/contracts/index.js";
import {
  cloneHarnessResources,
  createToolMap,
  validateToolNames,
} from "./configuration/tools.js";
import type { Conversation } from "../conversation/conversation.js";
import { flushPendingConversationWrites as flushHarnessPendingConversationWrites } from "./run/conversation-writes.js";
import type { ExecutionEnv } from "../environment/contracts.js";
import { AgentHarnessError } from "../errors.js";
import type {
  AbortResult,
  AgentHarnessEvent,
  AgentHarnessEventResultMap,
  AgentHarnessOwnEvent,
  AgentHarnessPhase,
  NavigateTreeResult,
  PendingConversationWrite,
} from "./lifecycle/events.js";
import {
  abortHarnessRun,
  getHarnessActiveTools,
  interruptHarnessRun,
  requestHarnessAbort,
  type HarnessConfigurationState,
  setHarnessActiveTools,
  setHarnessModel,
  setHarnessResources,
  setHarnessThinkingLevel,
  setHarnessTools,
} from "./configuration/configuration-mutations.js";
import {
  continueHarnessRun,
  type HarnessContinuationState,
} from "./run/continuation.js";
import { AgentHarnessEventHub } from "./lifecycle/event-hub.js";
import {
  type HarnessInvocationState,
  invokePromptTemplate,
  invokeSkill,
} from "../resources/invocations.js";
import {
  compactHarnessConversation,
  type HarnessMaintenanceContext,
  navigateHarnessTree,
} from "./maintenance/operations.js";
import {
  appendExternalHarnessMessage,
  appendHarnessMessage,
  drainHarnessQueue,
  enqueueAutomaticFollowUp,
  enqueueHarnessMessage as enqueueHarnessQueueMessage,
  enqueueNextTurn,
  followUpHarness,
  hasQueuedHarnessInput,
  type HarnessQueueState,
  type InboundQueuedMessage,
  promoteAllQueuedHarnessMessages,
  removeQueuedHarnessMessage,
  steerHarness,
} from "./queue/operations.js";
import { convertToLlm } from "../messages/messages.js";
import type {
  AgentHarnessOptions,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  PromptTemplate,
  Skill,
} from "./configuration/options.js";
import {
  emitHarnessRunFailure,
  type HarnessEventProcessingContext,
  processHarnessAgentEvent,
} from "./lifecycle/event-processing.js";
import { createHarnessStreamFn, executeHarnessTurn } from "./run/execution.js";
import { cloneStreamOptions } from "./configuration/stream-options.js";
import {
  type AgentHarnessTurnState,
  createTurnState as createAgentHarnessTurnState,
} from "./configuration/turn-state.js";
import { HarnessTurnController } from "./run/turn-controller.js";
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
  private forceDrainAll = false;
  private nextTurnQueue: AgentMessage[] = [];
  private readonly queuedMessageWrites = new WeakMap<
    AgentMessage,
    { id?: string; timestamp?: string }
  >();
  private events = new AgentHarnessEventHub<TSkill, TPromptTemplate>();
  private readonly turnController: HarnessTurnController<
    TSkill,
    TPromptTemplate,
    TTool
  >;
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
    this.turnController = new HarnessTurnController({
      getPhase: () => this.phase,
      setPhase: (phase) => {
        this.phase = phase;
      },
      startRunPromise: () => this.startRunPromise(),
      createTurnState: () => this.createTurnState(),
      executeTurn: (turnState, text, turnOptions) =>
        this.executeTurn(turnState, text, turnOptions),
    });
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
    return createHarnessStreamFn({
      getTurnState,
      getApiKeyAndHeaders: this.getApiKeyAndHeaders,
      emitBeforeProviderRequest: (model, conversationId, streamOptions) =>
        this.emitBeforeProviderRequest(model, conversationId, streamOptions),
      emitBeforeProviderPayload: (model, payload) =>
        this.emitBeforeProviderPayload(model, payload),
      emitAfterProviderResponse: async (status, headers, signal) =>
        await this.emitOwn(
          { type: "after_provider_response", status, headers },
          signal,
        ),
    });
  }

  private async drainQueuedMessages(
    queue: InboundQueuedMessage[],
    mode: QueueMode,
  ): Promise<AgentMessage[]> {
    return await drainHarnessQueue({
      queue,
      mode,
      queuedMessageWrites: this.queuedMessageWrites,
      emitQueueUpdate: () => this.emitQueueUpdate(),
      emitQueueDrained: async (messageIds) =>
        await this.emitOwn({ type: "queue_drained", messageIds }),
    });
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
      prepareNextTurn: async (context) => {
        await this.flushPendingConversationWrites();
        const boundaryResult = await this.emitHook({
          type: "iteration_boundary",
          message: context.message,
          toolResults: context.toolResults,
          hasMoreToolCalls: context.hasMoreToolCalls,
          signal:
            this.runAbortController?.signal ?? new AbortController().signal,
        });
        if (boundaryResult?.followUp && !context.hasMoreToolCalls) {
          await enqueueAutomaticFollowUp(
            this.queueState(),
            boundaryResult.followUp,
          );
        }
        const nextTurnState = await this.createTurnState();
        setTurnState(nextTurnState);
        return {
          context: this.createContext(nextTurnState),
          model: nextTurnState.model,
          thinkingLevel: nextTurnState.thinkingLevel,
        };
      },
      getSteeringMessages: async () => {
        const forceDrainAll = this.forceDrainAll;
        this.forceDrainAll = false;
        return this.drainQueuedMessages(
          this.steerQueue,
          forceDrainAll ? "all" : this.steeringQueueMode,
        );
      },
      getFollowUpMessages: async () =>
        this.drainQueuedMessages(this.followUpQueue, this.followUpQueueMode),
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

  private eventProcessingContext(): HarnessEventProcessingContext {
    return {
      conversation: this.conversation,
      pendingConversationWrites: this.pendingConversationWrites,
      queuedMessageWrites: this.queuedMessageWrites,
      flushPendingConversationWrites: () =>
        this.flushPendingConversationWrites(),
      emitAny: (event, signal) => this.emitAny(event, signal),
      emitOwn: (event, signal) => this.emitOwn(event as never, signal),
      settle: () => {
        this.phase = "idle";
      },
      getNextTurnCount: () => this.nextTurnQueue.length,
    };
  }

  private async handleAgentEvent(
    event: AgentEvent,
    signal?: AbortSignal,
  ): Promise<void> {
    await processHarnessAgentEvent(
      this.eventProcessingContext(),
      event,
      signal,
    );
  }

  private async emitRunFailure(
    model: AnyModel,
    error: unknown,
    aborted: boolean,
    signal: AbortSignal,
  ): Promise<AgentMessage[]> {
    return await emitHarnessRunFailure({
      context: this.eventProcessingContext(),
      model,
      error,
      aborted,
      signal,
    });
  }

  private async executeTurn(
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    text: string,
    options?: { images?: ImageContent[] },
  ): Promise<AssistantMessage> {
    return await executeHarnessTurn({
      turnState,
      text,
      images: options?.images,
      nextTurnQueue: this.nextTurnQueue,
      emitQueueUpdate: () => this.emitQueueUpdate(),
      emitBeforeAgentStart: (event) => this.emitHook(event),
      createContext: (state, systemPrompt) =>
        this.createContext(state, systemPrompt),
      createLoopConfig: (getTurnState, setTurnState) =>
        this.createLoopConfig(getTurnState, setTurnState),
      createStreamFn: (getTurnState) => this.createStreamFn(getTurnState),
      handleAgentEvent: (event, signal) => this.handleAgentEvent(event, signal),
      emitRunFailure: (error, aborted, signal, model) =>
        this.emitRunFailure(model, error, aborted, signal),
      setRunAbortController: (controller) => {
        this.runAbortController = controller;
      },
      setIdle: () => {
        this.phase = "idle";
      },
      flushPendingConversationWrites: () =>
        this.flushPendingConversationWrites(),
    });
  }

  private runForegroundTurn(
    resolvePrompt: (
      turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    ) =>
      | { text: string; options?: { images?: ImageContent[] } }
      | Promise<{ text: string; options?: { images?: ImageContent[] } }>,
  ): Promise<AssistantMessage> {
    return this.turnController.runForegroundTurn(resolvePrompt);
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
    return followUpHarness(this.queueState(), text, options);
  }

  hasQueuedInput(): boolean {
    return hasQueuedHarnessInput(this.queueState());
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

  forcePush(): Promise<void> {
    if (promoteAllQueuedHarnessMessages(this.queueState()) === 0) {
      throw new AgentHarnessError(
        "invalid_state",
        "No queued messages to force push",
      );
    }
    this.forceDrainAll = true;
    interruptHarnessRun(this.configurationState());
    return Promise.resolve();
  }

  requestAbort(): AbortResult {
    this.forceDrainAll = false;
    return requestHarnessAbort(this.configurationState());
  }

  async abort(): Promise<AbortResult> {
    this.forceDrainAll = false;
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
