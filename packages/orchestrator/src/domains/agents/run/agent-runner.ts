import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AgentHarness,
  AgentToolSuspension,
  Conversation,
  calculateContextTokens,
  deriveAutoCompactionPolicy,
  getModelContextWindow,
  isContextOverflowAssistantMessage,
} from "@nervekit/agent-runtime";
import type { ToolExecutionResult } from "@nervekit/agent-tools";
import {
  type AgentRecord,
  type ContextUsage,
  type ConversationEntry,
  type ConversationRecord,
  type ConversationRunRetryExhaustedData,
  type ConversationRunStatusDetails,
  type ConversationRunStatusState,
  type CreateAgentRequest,
  type PromptRequest,
  parseInlineCommandPrompt,
  type QueuedPromptRecord,
  type ToolCallRecord,
  type ToolName,
} from "@nervekit/contracts";
import { HttpError } from "../../../http/errors.js";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { EventBus } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage/index.js";
import type { RuntimeState } from "../../../runtime/runtime-state.js";
import type { AuthManager } from "../../auth/index.js";
import type { ConversationService } from "../../conversations/conversation-service.js";
import type { HarnessManager } from "../../conversations/harness-manager.js";
import type { CompactionService } from "../../conversations/operations/index.js";
import type { PythonRuntimeService } from "../../runtime/python-runtime-service.js";
import { activeToolNamesForAgent } from "../../tools/agent-tool-adapter.js";
import type {
  ExploreProgressUpdate,
  ToolService,
} from "../../tools/tool-service.js";
import type { SubscriptionUsageService } from "../../usage/subscription-usage-service.js";
import type { AgentSuspensionService } from "../agent-suspension.service.js";
import type { PromptQueueRepository } from "../prompt-queue.repository.js";
import { runAgentPromptSession } from "./agent-run-session.js";
import { delay, isRetryableAssistantError } from "./agent-runner-shared.js";
import { AutoCompactionRunner } from "./auto-compaction-runner.js";
import { InlineCommandRunner } from "./inline-command-runner.js";
import type { AppendEntryFn, MessageMirror } from "./message-mirror.js";
import { type ExploreReport, SubagentRunner } from "./subagent-runner.js";

export interface AgentRunnerDeps {
  storage: InitializedStorage;
  events: EventBus;
  auth: AuthManager;
  tools: ToolService;
  pythonRuntime: PythonRuntimeService;
  suspensions: AgentSuspensionService;
  harnessManager: HarnessManager;
  conversationService: ConversationService;
  compactionService: CompactionService;
  state: RuntimeState;
  createAgent: (
    request: CreateAgentRequest,
    options?: { allowChildAuthorityExceed?: boolean },
  ) => Promise<AgentRecord>;
  setAgentStatus: (
    agent: AgentRecord,
    status: AgentRecord["status"],
  ) => Promise<void>;
  appendEntry: AppendEntryFn;
  updateConversation: (conversation: ConversationRecord) => Promise<void>;
  messageMirror: MessageMirror;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
  promptQueue: PromptQueueRepository;
}

export class AgentRunner {
  readonly subagents: SubagentRunner;
  readonly inlineCommands: InlineCommandRunner;
  readonly autoCompaction: AutoCompactionRunner;
  readonly autoContinuationCounts = new Map<string, number>();

  constructor(readonly deps: AgentRunnerDeps) {
    this.subagents = new SubagentRunner({
      storage: deps.storage,
      events: deps.events,
      auth: deps.auth,
      tools: deps.tools,
      harnessManager: deps.harnessManager,
      state: deps.state,
      createAgent: deps.createAgent,
      setAgentStatus: deps.setAgentStatus,
      appendEntry: deps.appendEntry,
      getConversation: (conversationId) =>
        deps.state.getConversation(conversationId),
      updateConversation: deps.updateConversation,
      subscriptionUsage: deps.subscriptionUsage,
      logger: deps.logger.child({ component: "subagent-runner" }),
    });
    this.inlineCommands = new InlineCommandRunner(
      deps,
      this.terminateRunToolCalls.bind(this),
    );
    this.autoCompaction = new AutoCompactionRunner(
      deps,
      this.autoContinuationCounts,
      this.continueAgent.bind(this),
    );
  }

  async activeToolNamesFor(agent: AgentRecord): Promise<ToolName[]> {
    const pythonAvailable = await this.deps.pythonRuntime.isAvailableForProject(
      agent.projectDir,
    );
    return activeToolNamesForAgent(agent, {
      pythonAvailable,
      disabledToolNames: this.deps.storage.settings.tools.disabled,
      jiraEnabled: this.deps.storage.settings.tools.jira.enabled,
      confluenceEnabled: this.deps.storage.settings.tools.confluence.enabled,
    });
  }

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    const agent = this.deps.state.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (agent.status === "awaiting_user") {
      throw new HttpError(
        409,
        "AGENT_AWAITING_USER",
        "Agent is awaiting a human-in-the-loop tool response.",
      );
    }
    const inlineCommand = parseInlineCommandPrompt(request.text);
    const activeRun = this.deps.state.runs.get(agent.id);
    if (activeRun && inlineCommand) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }
    if (activeRun) {
      const behavior = request.behavior ?? "steer";
      if (behavior === "reject-if-busy") {
        throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
      }
      const callback =
        behavior === "follow-up" ? activeRun.followUp : activeRun.steer;
      if (!callback) {
        throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
      }
      const queuedPrompt = await this.deps.promptQueue.enqueue({
        agentId: agent.id,
        conversationId: agent.conversationId,
        projectId: agent.projectId,
        runId: activeRun.runId,
        behavior,
        text: request.text,
        images: request.images,
      });
      this.deps.state.conversationRuntime.queuePrompt(
        activeRun.runId,
        queuedPrompt,
      );
      await this.deps.events.publish("conversation.prompt.queued", {
        conversationId: agent.conversationId,
        agentId: agent.id,
        projectId: agent.projectId,
        runId: activeRun.runId,
        queuedPrompt,
      });
      try {
        await callback(request.text, request, queuedPrompt.id);
        const accepted = await this.deps.promptQueue.markAccepted(
          queuedPrompt.id,
          agent.id,
          activeRun.runId,
        );
        if (accepted)
          this.deps.state.conversationRuntime.queuePrompt(
            activeRun.runId,
            accepted,
          );
      } catch (error) {
        await this.deps.promptQueue.markFailed(
          queuedPrompt.id,
          agent.id,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      return;
    }
    if (inlineCommand) {
      void this.runInlineCommandPrompt(agent, inlineCommand.command).catch(
        () => undefined,
      );
      return;
    }
    void this.runAgentPrompt(agent, request).catch(() => undefined);
  }

  async executeInlineBashCommand(
    agent: AgentRecord,
    command: string,
    options: {
      runId: string;
      signal?: AbortSignal;
      continueAfterPromotedTask?: boolean;
      useForegroundBash?: boolean;
    },
  ): Promise<ToolCallRecord> {
    return this.inlineCommands.executeBashCommand(agent, command, options);
  }

  async executeInlinePromptBlockCommand(
    agent: AgentRecord,
    command: string,
    options: { signal?: AbortSignal },
  ): Promise<ToolExecutionResult> {
    return this.inlineCommands.executePromptBlockCommand(
      agent,
      command,
      options,
    );
  }

  async runInlineCommandPrompt(
    agent: AgentRecord,
    command: string,
  ): Promise<ConversationEntry> {
    return this.inlineCommands.runPrompt(agent, command);
  }

  async continueAgent(agentId: string): Promise<void> {
    const agent = this.deps.state.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (this.deps.state.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }
    void this.runAgentPrompt(
      agent,
      { text: "Continue after resolved tool result." },
      { continue: true },
    ).catch(() => undefined);
  }

  async continueFromFailedTurn(
    agentId: string,
    failedEntryId: string,
  ): Promise<void> {
    const agent = this.deps.state.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (this.deps.state.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }
    const conversation = this.deps.state.getConversation(agent.conversationId);
    const project = this.deps.state.getProject(agent.projectId);
    const storage = await this.deps.harnessManager.openStorage(
      conversation,
      project.dir,
    );
    const failedEntry = await storage.getEntry(failedEntryId);
    const failedMessage =
      failedEntry?.type === "message" ? failedEntry.message : undefined;
    if (
      failedEntry?.type !== "message" ||
      failedMessage?.role !== "assistant" ||
      failedMessage.stopReason !== "error" ||
      failedEntry.parentId === null
    ) {
      throw new HttpError(
        400,
        "INVALID_FAILED_ENTRY",
        "Failed entry is not a retryable assistant failure.",
      );
    }
    await new Conversation(storage).moveTo(failedEntry.parentId);
    void this.runAgentPrompt(
      agent,
      { text: "Continue from failed model request." },
      { continue: true },
    ).catch(() => undefined);
  }

  /**
   * Resume a run that ended without a clean stop (interruption or a loop exception with
   * no re-runnable failed model turn). Inspects the conversation leaf: if it is an
   * assistant message, rewind to its parent and re-run that turn; otherwise (a user or
   * tool-result leaf) continue forward from the current leaf.
   */
  async resumeRun(agentId: string): Promise<void> {
    const agent = this.deps.state.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (this.deps.state.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }
    const conversation = this.deps.state.getConversation(agent.conversationId);
    const project = this.deps.state.getProject(agent.projectId);
    const storage = await this.deps.harnessManager.openStorage(
      conversation,
      project.dir,
    );
    const leafId = await storage.getLeafId();
    const leaf = leafId ? await storage.getEntry(leafId) : undefined;
    if (leaf?.type === "message" && leaf.message.role === "assistant") {
      if (leaf.parentId === null) {
        throw new HttpError(
          400,
          "INVALID_RESUME_TARGET",
          "Cannot resume from the root assistant message.",
        );
      }
      await new Conversation(storage).moveTo(leaf.parentId);
    }
    void this.runAgentPrompt(
      agent,
      { text: "Continue from interrupted run." },
      { continue: true },
    ).catch(() => undefined);
  }

  async abortAgent(agentId: string): Promise<void> {
    const agent = this.deps.state.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    const children = [...this.deps.state.agents.values()].filter(
      (child) => child.parentAgentId === agent.id,
    );
    await Promise.all(children.map((child) => this.abortAgent(child.id)));
    const run = this.deps.state.runs.get(agentId);
    if (!run) return;
    await this.deps.events.publish("agent.abort_requested", {
      agentId,
      runId: run.runId,
    });
    await run.abort();
  }

  runExplore(
    parent: AgentRecord,
    args: Record<string, unknown>,
    options: {
      onProgress?: (update: ExploreProgressUpdate) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<{
    reports: ExploreReport[];
    contentBlocks: [{ type: "text"; text: string }];
  }> {
    return this.subagents.runExplore(parent, args, options);
  }

  async runAgentPrompt(
    agent: AgentRecord,
    request: PromptRequest,
    options: { continue?: boolean } = {},
  ): Promise<ConversationEntry> {
    return runAgentPromptSession.call(this, agent, request, options);
  }

  async terminateRunToolCalls(
    runId: string,
    message = "Tool execution was interrupted because the agent run ended.",
  ): Promise<void> {
    try {
      await this.deps.tools.terminateNonTerminalToolCallsForRun(runId, message);
    } catch (error) {
      await this.deps.logger.warn("Failed to terminate run tool calls", {
        runId,
        error,
      });
    }
  }

  /**
   * Append a durable `run_status` entry for a non-clean run ending and publish the
   * corresponding `conversation.entry.appended` event. The entry is orchestrator-only
   * (`mirrorToHarness: false`) so it is never sent to the model. When `parentEntryId`
   * is omitted the entry is parented at the conversation's current leaf and becomes the
   * new active tail.
   */
  private async appendRunStatusEntry(input: {
    agent: AgentRecord;
    runId: string;
    state: ConversationRunStatusState;
    text: string;
    errorMessage?: string;
    failedEntryId?: string;
    parentEntryId?: string;
    attempt?: number;
    maxRetries?: number;
  }): Promise<ConversationRunRetryExhaustedData> {
    const details = {
      type: "agent_run_retry_status",
      state: input.state,
      runId: input.runId,
      failedEntryId: input.failedEntryId,
      attempt: input.attempt,
      maxRetries: input.maxRetries,
      errorMessage: input.errorMessage,
      retryable: true,
    } satisfies ConversationRunStatusDetails;
    const statusEntry = await this.deps.appendEntry(
      {
        conversationId: input.agent.conversationId,
        agentId: input.agent.id,
        runId: input.runId,
        ...(input.parentEntryId ? { parentEntryId: input.parentEntryId } : {}),
        role: "system",
        kind: "run_status",
        text: input.text,
        details,
      },
      { mirrorToHarness: false },
    );
    await this.deps.events.publish("conversation.entry.appended", {
      conversationId: input.agent.conversationId,
      agentId: input.agent.id,
      projectId: input.agent.projectId,
      runId: input.runId,
      entry: statusEntry,
    });
    return {
      statusEntryId: statusEntry.id,
      failedEntryId: details.failedEntryId,
      attempt: details.attempt,
      maxRetries: details.maxRetries,
      errorMessage: details.errorMessage,
      retryable: details.retryable,
    };
  }

  /**
   * Append a continuable status entry for a failed assistant turn. Emits a
   * `retry_exhausted` status when the failure is a retryable model error and retries
   * are enabled (preserving existing wording), otherwise a generic `failed` status.
   */
  async appendRunFailureStatus(
    agent: AgentRecord,
    runId: string,
    assistantEntry: ConversationEntry,
    assistant: AssistantMessage,
  ): Promise<ConversationRunRetryExhaustedData> {
    const settings = this.deps.storage.settings.retry;
    const retryExhausted =
      settings.enabled &&
      settings.maxRetries > 0 &&
      isRetryableAssistantError(assistant);
    if (retryExhausted) {
      return this.appendRunStatusEntry({
        agent,
        runId,
        state: "retry_exhausted",
        text: `Model request failed after ${settings.maxRetries} ${settings.maxRetries === 1 ? "retry" : "retries"}.`,
        errorMessage: assistant.errorMessage,
        failedEntryId: assistantEntry.id,
        parentEntryId: assistantEntry.id,
        attempt: settings.maxRetries,
        maxRetries: settings.maxRetries,
      });
    }
    return this.appendRunStatusEntry({
      agent,
      runId,
      state: "failed",
      text: "Agent run failed.",
      errorMessage: assistant.errorMessage,
      failedEntryId: assistantEntry.id,
      parentEntryId: assistantEntry.id,
    });
  }

  /**
   * Append a continuable `failed` status entry for an exception thrown inside the run
   * loop. When a failed assistant entry exists it is referenced (and hidden) so Continue
   * rewinds and re-runs that turn; otherwise the card is appended at the current leaf and
   * Continue resumes forward.
   */
  async appendRunErrorStatus(
    agent: AgentRecord,
    runId: string,
    message: string,
    lastAssistantEntry?: ConversationEntry,
  ): Promise<ConversationRunRetryExhaustedData> {
    return this.appendRunStatusEntry({
      agent,
      runId,
      state: "failed",
      text: "Agent run failed.",
      errorMessage: message,
      failedEntryId: lastAssistantEntry?.id,
      parentEntryId: lastAssistantEntry?.id,
    });
  }

  async runHarnessWithRetries(input: {
    harness: AgentHarness;
    conversation: Conversation;
    request: PromptRequest;
    continue: boolean;
    runId: string;
    agent: AgentRecord;
  }): Promise<AssistantMessage> {
    const settings = this.deps.storage.settings.retry;
    const latestAgent = () =>
      this.deps.state.agents.get(input.agent.id) ?? input.agent;
    const latestContextWindow = () =>
      getModelContextWindow(latestAgent().model);
    let attempt = 0;
    let continueRun = input.continue;
    let overflowCompactionAttempted = false;
    while (true) {
      const assistant = continueRun
        ? await input.harness.continue()
        : await input.harness.prompt(input.request.text, {
            images: input.request.images,
          });
      const contextWindow = latestContextWindow();
      if (
        this.deps.storage.settings.compaction.auto &&
        !overflowCompactionAttempted &&
        isContextOverflowAssistantMessage(assistant, contextWindow)
      ) {
        overflowCompactionAttempted = true;
        const recovered = await this.tryOverflowCompactionRecovery(
          input,
          assistant,
          contextWindow,
        );
        if (recovered) {
          continueRun = true;
          continue;
        }
        return assistant;
      }
      if (
        assistant.stopReason !== "error" ||
        !isRetryableAssistantError(assistant) ||
        !settings.enabled ||
        attempt >= settings.maxRetries
      ) {
        return assistant;
      }
      attempt += 1;
      const delayMs = settings.baseDelayMs * 2 ** (attempt - 1);
      const retryAt = new Date(Date.now() + delayMs).toISOString();
      const leafId = await input.conversation.getLeafId();
      const leaf = leafId
        ? await input.conversation.getEntry(leafId)
        : undefined;
      const failedEntryId = leaf?.type === "message" ? leaf.id : undefined;
      const retry = {
        attempt,
        maxRetries: settings.maxRetries,
        delayMs,
        retryAt,
        errorMessage: assistant.errorMessage,
        failedEntryId,
      };
      this.deps.state.conversationRuntime.markRetrying(input.runId, retry);
      await this.deps.events.publish("conversation.run.retrying", {
        agentId: input.agent.id,
        conversationId: input.agent.conversationId,
        projectId: input.agent.projectId,
        runId: input.runId,
        ...retry,
      });
      await this.deps.logger.warn("Retrying transient agent error", {
        agentId: input.agent.id,
        conversationId: input.agent.conversationId,
        projectId: input.agent.projectId,
        runId: input.runId,
        context: {
          attempt,
          maxRetries: settings.maxRetries,
          errorMessage: assistant.errorMessage,
        },
      });
      if (leaf?.parentId !== undefined)
        await input.conversation.moveTo(leaf.parentId);
      await delay(delayMs);
      this.deps.state.conversationRuntime.clearRetry(input.runId);
      continueRun = true;
    }
  }

  async tryOverflowCompactionRecovery(
    input: {
      conversation: Conversation;
      runId: string;
      agent: AgentRecord;
    },
    assistant: AssistantMessage,
    contextWindow: number,
  ): Promise<boolean> {
    const leafId = await input.conversation.getLeafId();
    const leaf = leafId ? await input.conversation.getEntry(leafId) : undefined;
    if (leaf?.type !== "message" || leaf.message.role !== "assistant") {
      return false;
    }
    const failedEntryId = leaf.id;
    const failedParentId = leaf.parentId;
    const policy = deriveAutoCompactionPolicy(
      contextWindow,
      this.deps.storage.settings.compaction.auto,
    );
    try {
      await input.conversation.moveTo(failedParentId);
      await this.deps.compactionService.compactConversation(
        input.agent.conversationId,
        {
          instructions:
            "Overflow recovery after the selected model hit its context limit.",
        },
        {
          reason: "overflow",
          agentId: input.agent.id,
          runId: input.runId,
          contextWindow: policy.contextWindow,
          contextTokens: calculateContextTokens(assistant.usage),
          thresholdTokens: policy.thresholdTokens,
          triggerReserveTokens: policy.triggerReserveTokens,
          keepRecentTokens: policy.keepRecentTokens,
          failedEntryId,
        },
      );
      await this.deps.logger.info(
        "Recovered context overflow with compaction",
        {
          agentId: input.agent.id,
          conversationId: input.agent.conversationId,
          projectId: input.agent.projectId,
          runId: input.runId,
          context: { failedEntryId, contextWindow: policy.contextWindow },
        },
      );
      return true;
    } catch (error) {
      await input.conversation.moveTo(failedEntryId).catch(() => undefined);
      await this.deps.logger.warn("Context overflow compaction failed", {
        agentId: input.agent.id,
        conversationId: input.agent.conversationId,
        projectId: input.agent.projectId,
        runId: input.runId,
        context: { failedEntryId },
        error,
      });
      return false;
    }
  }

  async maybeMarkQueuedPromptDelivered(
    agent: AgentRecord,
    runId: string,
    entry: ConversationEntry,
  ): Promise<void> {
    const pendingPrompts = (
      await this.deps.promptQueue.pendingForAgent(agent.id)
    ).filter((candidate) => queuedPromptBelongsToRun(candidate, runId));
    const exactPrompt = pendingPrompts.find(
      (candidate) => candidate.text === entry.text,
    );
    if (exactPrompt) {
      await this.markQueuedPromptDelivered(agent, runId, exactPrompt, entry.id);
      return;
    }
    const coalescedPrompts = queuedPromptsMatchingJoinedText(
      pendingPrompts,
      entry.text,
    );
    for (const prompt of coalescedPrompts) {
      await this.markQueuedPromptDelivered(agent, runId, prompt, entry.id);
    }
  }

  private async markQueuedPromptDelivered(
    agent: AgentRecord,
    runId: string,
    queuedPrompt: QueuedPromptRecord,
    entryId: string,
  ): Promise<void> {
    const delivered = await this.deps.promptQueue.markDelivered(
      queuedPrompt.id,
      agent.id,
      entryId,
    );
    if (!delivered) return;
    this.deps.state.conversationRuntime.removeQueuedPrompt(runId, delivered.id);
    await this.deps.events.publish("conversation.prompt.dequeued", {
      conversationId: agent.conversationId,
      agentId: agent.id,
      projectId: agent.projectId,
      runId,
      queuedPrompt: delivered,
      entryId,
    });
  }

  suspensionFromWaitingToolCall(
    agent: AgentRecord,
    runId: string,
    error: unknown,
  ): AgentToolSuspension | undefined {
    const message = error instanceof Error ? error.message : String(error);
    const toolCall = this.deps.tools
      .listToolCalls()
      .find(
        (candidate) =>
          candidate.agentId === agent.id &&
          candidate.runId === runId &&
          candidate.status === "waiting_for_user" &&
          (candidate.toolName === "ask_user" ||
            candidate.toolName === "plan_mode_present"),
      );
    if (!toolCall) return undefined;
    return new AgentToolSuspension({
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      reason: message || `Tool ${toolCall.toolName} is awaiting user input.`,
      remainingToolCalls: [],
    });
  }

  /** Compute compaction-aware context-window usage for a conversation. */
  async getContextUsage(conversationId: string): Promise<ContextUsage> {
    return this.autoCompaction.getContextUsage(conversationId);
  }

  async publishContextUsage(
    conversationId: string,
    agentId: string,
    runId: string,
  ): Promise<void> {
    return this.autoCompaction.publishContextUsage(
      conversationId,
      agentId,
      runId,
    );
  }

  async maybeAutoCompact(
    conversationId: string,
    agentId?: string,
    runId?: string,
  ): Promise<void> {
    return this.autoCompaction.maybeAutoCompact(conversationId, agentId, runId);
  }

  async continueAfterAutoCompaction(agent: AgentRecord): Promise<void> {
    return this.autoCompaction.continueAfterAutoCompaction(agent);
  }

  async appendAutoContinueMessage(
    agent: AgentRecord,
    text: string,
  ): Promise<ConversationEntry> {
    return this.autoCompaction.appendAutoContinueMessage(agent, text);
  }
}

function queuedPromptBelongsToRun(
  prompt: QueuedPromptRecord,
  runId: string,
): boolean {
  return (
    prompt.runId === runId &&
    (prompt.status === "accepted" || prompt.status === "queued")
  );
}

function queuedPromptsMatchingJoinedText(
  prompts: QueuedPromptRecord[],
  text: string,
): QueuedPromptRecord[] {
  const matches: QueuedPromptRecord[] = [];
  for (const prompt of prompts) {
    matches.push(prompt);
    if (matches.length < 2) continue;
    const joined = matches
      .map((candidate) => candidate.text.trimEnd())
      .join("\n\n");
    if (joined === text) return matches;
    if (!text.startsWith(joined)) return [];
  }
  return [];
}
