import {
  type AssistantMessage,
  type ImageContent,
  streamSimple,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { runAgentLoop } from "../agent-loop.js";
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
  collectEntriesForBranchSummary,
  generateBranchSummary,
} from "./compaction/branch-summarization.js";
import {
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
} from "./compaction/compaction.js";
import {
  cloneHarnessResources,
  createModelUpdateEvent,
  createThinkingLevelUpdateEvent,
  createToolMap,
  prepareActiveToolsConfiguration,
  prepareToolConfiguration,
  validateToolNames,
} from "./configuration.js";
import type { ExecutionEnv } from "./env/types.js";
import { AgentHarnessError } from "./errors.js";
import type {
  AbortResult,
  AgentHarnessEvent,
  AgentHarnessEventResultMap,
  AgentHarnessOwnEvent,
  AgentHarnessPhase,
  NavigateTreeResult,
  PendingSessionWrite,
} from "./events.js";
import {
  AgentHarnessEventHub,
  normalizeHarnessError,
  normalizeHookError,
} from "./harness-events.js";
import { convertToLlm } from "./messages.js";
import type {
  AgentHarnessOptions,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  PromptTemplate,
  Skill,
} from "./options.js";
import { formatPromptTemplateInvocation } from "./prompt-templates.js";
import { toError } from "./result.js";
import { createFailureMessage, createUserMessage } from "./run/messages.js";
import type { Session } from "./session/session.js";
import { editorTextForNavigatedEntry } from "./session/text-extraction.js";
import {
  flushPendingSessionWrites as flushHarnessPendingSessionWrites,
  queueOrWriteMessage,
} from "./session-writes.js";
import { formatSkillInvocation } from "./skills.js";
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
  private session: Session;
  private phase: AgentHarnessPhase = "idle";
  private runAbortController?: AbortController;
  private runPromise?: Promise<void>;
  private pendingSessionWrites: PendingSessionWrite[] = [];
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
  private steerQueue: UserMessage[] = [];
  private steeringQueueMode: QueueMode;
  private followUpQueue: UserMessage[] = [];
  private followUpQueueMode: QueueMode;
  private nextTurnQueue: AgentMessage[] = [];
  private events = new AgentHarnessEventHub<TSkill, TPromptTemplate>();

  constructor(options: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>) {
    this.env = options.env;
    this.session = options.session;
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
    sessionId: string,
    streamOptions: AgentHarnessStreamOptions,
  ): Promise<AgentHarnessStreamOptions> {
    return this.events.emitBeforeProviderRequest(
      model,
      sessionId,
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
      steer: [...this.steerQueue],
      followUp: [...this.followUpQueue],
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
      session: this.session,
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
      };
      const requestOptions = await this.emitBeforeProviderRequest(
        model,
        turnState.sessionId,
        snapshotOptions,
      );
      return streamSimple(model, context, {
        cacheRetention: requestOptions.cacheRetention,
        headers: requestOptions.headers,
        maxRetries: requestOptions.maxRetries,
        maxRetryDelayMs: requestOptions.maxRetryDelayMs,
        metadata: requestOptions.metadata,
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
        sessionId: turnState.sessionId,
        timeoutMs: requestOptions.timeoutMs,
        transport: requestOptions.transport,
        apiKey: auth?.apiKey,
      });
    };
  }

  private async drainQueuedMessages(
    queue: AgentMessage[],
    mode: QueueMode,
  ): Promise<AgentMessage[]> {
    const messages = mode === "all" ? queue.splice(0) : queue.splice(0, 1);
    if (messages.length === 0) return messages;
    try {
      await this.emitQueueUpdate();
      return messages;
    } catch (error) {
      queue.unshift(...messages);
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
        await this.flushPendingSessionWrites();
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

  private async flushPendingSessionWrites(): Promise<void> {
    await flushHarnessPendingSessionWrites(
      this.session,
      this.pendingSessionWrites,
    );
  }

  private async handleAgentEvent(
    event: AgentEvent,
    signal?: AbortSignal,
  ): Promise<void> {
    if (event.type === "message_end") {
      await this.session.appendMessage(event.message);
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
      const hadPendingMutations = this.pendingSessionWrites.length > 0;
      await this.flushPendingSessionWrites();
      if (eventError) throw eventError;
      await this.emitOwn({ type: "save_point", hadPendingMutations });
      return;
    }
    if (event.type === "agent_end") {
      await this.flushPendingSessionWrites();
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
        await this.flushPendingSessionWrites();
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

  async skill(
    name: string,
    additionalInstructions?: string,
  ): Promise<AssistantMessage> {
    return this.runForegroundTurn((turnState) => {
      const skill = (turnState.resources.skills ?? []).find(
        (candidate) => candidate.name === name,
      );
      if (!skill) {
        throw new AgentHarnessError(
          "invalid_argument",
          `Unknown skill: ${name}`,
        );
      }
      return { text: formatSkillInvocation(skill, additionalInstructions) };
    });
  }

  async promptFromTemplate(
    name: string,
    args: string[] = [],
  ): Promise<AssistantMessage> {
    return this.runForegroundTurn((turnState) => {
      const template = (turnState.resources.promptTemplates ?? []).find(
        (candidate) => candidate.name === name,
      );
      if (!template) {
        throw new AgentHarnessError(
          "invalid_argument",
          `Unknown prompt template: ${name}`,
        );
      }
      return { text: formatPromptTemplateInvocation(template, args) };
    });
  }

  async steer(
    text: string,
    options?: { images?: ImageContent[] },
  ): Promise<void> {
    if (this.phase === "idle")
      throw new AgentHarnessError("invalid_state", "Cannot steer while idle");
    this.steerQueue.push(createUserMessage(text, options?.images));
    await this.emitQueueUpdate();
  }

  async followUp(
    text: string,
    options?: { images?: ImageContent[] },
  ): Promise<void> {
    if (this.phase === "idle")
      throw new AgentHarnessError(
        "invalid_state",
        "Cannot follow up while idle",
      );
    this.followUpQueue.push(createUserMessage(text, options?.images));
    await this.emitQueueUpdate();
  }

  async nextTurn(
    text: string,
    options?: { images?: ImageContent[] },
  ): Promise<void> {
    this.nextTurnQueue.push(createUserMessage(text, options?.images));
    await this.emitQueueUpdate();
  }

  async appendMessage(message: AgentMessage): Promise<void> {
    try {
      await queueOrWriteMessage(
        this.phase,
        this.pendingSessionWrites,
        this.session,
        message,
      );
    } catch (error) {
      throw normalizeHarnessError(error, "session");
    }
  }

  async compact(customInstructions?: string): Promise<{
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: unknown;
  }> {
    if (this.phase !== "idle")
      throw new AgentHarnessError("busy", "compact() requires idle harness");
    this.phase = "compaction";
    try {
      const model = this.model;
      if (!model)
        throw new AgentHarnessError(
          "invalid_state",
          "No model set for compaction",
        );
      const auth = await this.getApiKeyAndHeaders?.(model);
      if (!auth)
        throw new AgentHarnessError("auth", "No auth available for compaction");
      const branchEntries = await this.session.getBranch();
      const preparationResult = prepareCompaction(
        branchEntries,
        DEFAULT_COMPACTION_SETTINGS,
      );
      if (!preparationResult.ok) throw preparationResult.error;
      const preparation = preparationResult.value;
      if (!preparation)
        throw new AgentHarnessError("compaction", "Nothing to compact");
      const hookResult = await this.emitHook({
        type: "session_before_compact",
        preparation,
        branchEntries,
        customInstructions,
        signal: new AbortController().signal,
      });
      if (hookResult?.cancel)
        throw new AgentHarnessError("compaction", "Compaction cancelled");
      const provided = hookResult?.compaction;
      const compactResult = provided
        ? { ok: true as const, value: provided }
        : await compact(
            preparation,
            model,
            auth.apiKey,
            auth.headers,
            customInstructions,
            undefined,
            this.thinkingLevel,
          );
      if (!compactResult.ok) throw compactResult.error;
      const result = compactResult.value;
      const entryId = await this.session.appendCompaction(
        result.summary,
        result.firstKeptEntryId,
        result.tokensBefore,
        result.details,
        provided !== undefined,
      );
      const entry = await this.session.getEntry(entryId);
      if (entry?.type === "compaction") {
        await this.emitOwn({
          type: "session_compact",
          compactionEntry: entry,
          fromHook: provided !== undefined,
        });
      }
      return result;
    } catch (error) {
      throw normalizeHarnessError(error, "compaction");
    } finally {
      this.phase = "idle";
    }
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
    if (this.phase !== "idle")
      throw new AgentHarnessError(
        "busy",
        "navigateTree() requires idle harness",
      );
    this.phase = "branch_summary";
    try {
      const oldLeafId = await this.session.getLeafId();
      if (oldLeafId === targetId) return { cancelled: false };
      const targetEntry = await this.session.getEntry(targetId);
      if (!targetEntry)
        throw new AgentHarnessError(
          "invalid_argument",
          `Entry ${targetId} not found`,
        );
      const { entries, commonAncestorId } =
        await collectEntriesForBranchSummary(this.session, oldLeafId, targetId);
      const preparation = {
        targetId,
        oldLeafId,
        commonAncestorId,
        entriesToSummarize: entries,
        userWantsSummary: options?.summarize ?? false,
        customInstructions: options?.customInstructions,
        replaceInstructions: options?.replaceInstructions,
        label: options?.label,
      };
      const signal = new AbortController().signal;
      const hookResult = await this.emitHook({
        type: "session_before_tree",
        preparation,
        signal,
      });
      if (hookResult?.cancel) return { cancelled: true };
      let summaryEntry: NavigateTreeResult["summaryEntry"];
      let summaryText: string | undefined = hookResult?.summary?.summary;
      let summaryDetails: unknown = hookResult?.summary?.details;
      if (!summaryText && options?.summarize && entries.length > 0) {
        const model = this.model;
        if (!model)
          throw new AgentHarnessError(
            "invalid_state",
            "No model set for branch summary",
          );
        const auth = await this.getApiKeyAndHeaders?.(model);
        if (!auth)
          throw new AgentHarnessError(
            "auth",
            "No auth available for branch summary",
          );
        const branchSummary = await generateBranchSummary(entries, {
          model,
          apiKey: auth.apiKey,
          headers: auth.headers,
          signal: new AbortController().signal,
          customInstructions:
            hookResult?.customInstructions ?? options?.customInstructions,
          replaceInstructions:
            hookResult?.replaceInstructions ?? options?.replaceInstructions,
        });
        if (!branchSummary.ok) {
          if (branchSummary.error.code === "aborted")
            return { cancelled: true };
          throw new AgentHarnessError(
            "branch_summary",
            branchSummary.error.message,
            branchSummary.error,
          );
        }
        summaryText = branchSummary.value.summary;
        summaryDetails = {
          readFiles: branchSummary.value.readFiles,
          modifiedFiles: branchSummary.value.modifiedFiles,
        };
      }
      const { newLeafId, editorText } = editorTextForNavigatedEntry(
        targetEntry,
        targetId,
      );
      const summaryId = await this.session.moveTo(
        newLeafId,
        summaryText
          ? {
              summary: summaryText,
              details: summaryDetails,
              fromHook: hookResult?.summary !== undefined,
            }
          : undefined,
      );
      if (summaryId) {
        const entry = await this.session.getEntry(summaryId);
        if (entry?.type === "branch_summary") summaryEntry = entry;
      }
      await this.emitOwn({
        type: "session_tree",
        newLeafId: await this.session.getLeafId(),
        oldLeafId,
        summaryEntry,
        fromHook: hookResult?.summary !== undefined,
      });
      return { cancelled: false, editorText, summaryEntry };
    } catch (error) {
      throw normalizeHarnessError(error, "branch_summary");
    } finally {
      this.phase = "idle";
    }
  }

  getModel(): AnyModel {
    return this.model;
  }

  async setModel(model: AnyModel): Promise<void> {
    try {
      const previousModel = this.model;
      if (this.phase === "idle") {
        await this.session.appendModelChange(model.provider, model.id);
      } else {
        this.pendingSessionWrites.push({
          type: "model_change",
          provider: model.provider,
          modelId: model.id,
        });
      }
      this.model = model;
      await this.emitOwn(createModelUpdateEvent(model, previousModel, "set"));
    } catch (error) {
      throw normalizeHarnessError(error, "session");
    }
  }

  getThinkingLevel(): ThinkingLevel {
    return this.thinkingLevel;
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    try {
      const previousLevel = this.thinkingLevel;
      if (this.phase === "idle") {
        await this.session.appendThinkingLevelChange(level);
      } else {
        this.pendingSessionWrites.push({
          type: "thinking_level_change",
          thinkingLevel: level,
        });
      }
      this.thinkingLevel = level;
      await this.emitOwn(createThinkingLevelUpdateEvent(level, previousLevel));
    } catch (error) {
      throw normalizeHarnessError(error, "session");
    }
  }

  getTools(): TTool[] {
    return [...this.tools.values()];
  }

  async setTools(tools: TTool[], activeToolNames?: string[]): Promise<void> {
    try {
      const next = prepareToolConfiguration({
        currentTools: this.tools,
        currentActiveToolNames: this.activeToolNames,
        tools,
        activeToolNames,
        source: "set",
      });
      if (this.phase === "idle") {
        await this.session.appendActiveToolsChange(next.activeToolNames);
      } else {
        this.pendingSessionWrites.push({
          type: "active_tools_change",
          activeToolNames: [...next.activeToolNames],
        });
      }
      this.tools = next.tools;
      this.activeToolNames = [...next.activeToolNames];
      await this.emitOwn(next.event);
    } catch (error) {
      throw normalizeHarnessError(error, "invalid_argument");
    }
  }

  getActiveTools(): TTool[] {
    return this.activeToolNames.map((name) => {
      const tool = this.tools.get(name);
      if (!tool) {
        throw new AgentHarnessError(
          "invalid_state",
          `Active tool ${name} is not registered`,
        );
      }
      return tool;
    });
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    try {
      const next = prepareActiveToolsConfiguration({
        tools: this.tools,
        currentActiveToolNames: this.activeToolNames,
        activeToolNames: toolNames,
        source: "set",
      });
      if (this.phase === "idle") {
        await this.session.appendActiveToolsChange(next.activeToolNames);
      } else {
        this.pendingSessionWrites.push({
          type: "active_tools_change",
          activeToolNames: [...next.activeToolNames],
        });
      }
      this.activeToolNames = [...next.activeToolNames];
      await this.emitOwn(next.event);
    } catch (error) {
      throw normalizeHarnessError(error, "invalid_argument");
    }
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
    const previousResources = this.getResources();
    this.resources = cloneHarnessResources(resources);
    await this.emitOwn({
      type: "resources_update",
      resources: this.getResources(),
      previousResources,
    });
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
    const clearedSteer = [...this.steerQueue];
    const clearedFollowUp = [...this.followUpQueue];
    this.steerQueue = [];
    this.followUpQueue = [];
    this.runAbortController?.abort();
    const errors: Error[] = [];
    try {
      await this.emitQueueUpdate();
    } catch (error) {
      errors.push(toError(error));
    }
    try {
      await this.waitForIdle();
    } catch (error) {
      errors.push(toError(error));
    }
    try {
      await this.emitOwn({ type: "abort", clearedSteer, clearedFollowUp });
    } catch (error) {
      errors.push(toError(error));
    }
    if (errors.length > 0) {
      const [singleError] = errors;
      const cause =
        errors.length === 1 && singleError
          ? singleError
          : new AggregateError(errors, "Abort completed with errors");
      throw normalizeHarnessError(cause, "hook");
    }
    return { clearedSteer, clearedFollowUp };
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
