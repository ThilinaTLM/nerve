import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AgentHarness,
  type AgentMessage,
  AgentToolSuspension,
  buildConversationContext,
  Conversation,
  calculateContextTokens,
  computeContextUsage,
  convertToLlm,
  deriveAutoCompactionPolicy,
  getModelContextWindow,
  isContextOverflowAssistantMessage,
  shouldAutoCompact,
} from "@nervekit/agent";
import {
  type AgentRecord,
  type ContextUsage,
  type ConversationEntry,
  type ConversationRecord,
  type ConversationRunRetryExhaustedData,
  type ConversationRunStatusDetails,
  type ConversationRunStatusState,
  type CreateAgentRequest,
  createId,
  deriveConversationTitle,
  type PromptRequest,
  parseInlineCommandPrompt,
  type ToolCallRecord,
  type ToolName,
} from "@nervekit/shared";
import { executeBash, type ToolExecutionResult } from "@nervekit/tools";
import type { AuthManager } from "../../../auth.js";
import { HttpError } from "../../../http/errors.js";
import type { EventBus } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage/index.js";
import type { ApplicationLogger } from "../../../logging.js";
import type { RuntimeState } from "../../../runtime/runtime-state.js";
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
import {
  bashExecutionMessageForToolCall,
  inlineCommandDisplayText,
  inlineCommandEntryDetails,
} from "./inline-command-results.js";
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

/** Max consecutive auto-continuations per conversation before stopping. */
const MAX_AUTO_CONTINUATIONS = 3;

/** Fixed handover instruction pushed after automatic compaction. */
const AUTO_CONTINUE_MESSAGE =
  "Continue the work using the context checkpoint above. Resume from the Next Steps and keep going until the task is complete. If everything is already finished, briefly confirm completion and stop.";

export class AgentRunner {
  readonly subagents: SubagentRunner;
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
  }

  async activeToolNamesFor(agent: AgentRecord): Promise<ToolName[]> {
    const pythonAvailable = await this.deps.pythonRuntime.isAvailableForProject(
      agent.projectDir,
    );
    return activeToolNamesForAgent(agent, { pythonAvailable });
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
    const toolCall = await this.deps.tools.requestToolAndWait(
      agent,
      "bash",
      { command },
      {
        runId: options.runId,
        signal: options.signal,
        continueAfterPromotedTask: options.continueAfterPromotedTask,
        useForegroundBash: options.useForegroundBash,
      },
    );
    if (options.signal?.aborted) throw new Error("Command execution aborted.");
    return toolCall;
  }

  async executeInlinePromptBlockCommand(
    agent: AgentRecord,
    command: string,
    options: { signal?: AbortSignal },
  ): Promise<ToolExecutionResult> {
    return executeBash(
      { command },
      {
        cwd: agent.projectDir,
        signal: options.signal,
        dataDir: this.deps.storage.paths.home,
      },
    );
  }

  async runInlineCommandPrompt(
    agent: AgentRecord,
    command: string,
  ): Promise<ConversationEntry> {
    if (this.deps.state.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }

    const runId = createId("run");
    const entryId = createId("entry");
    const abortController = new AbortController();
    let abortRequested = false;
    const startedAt = new Date().toISOString();
    const runStartedAt = performance.now();

    try {
      const conversation = this.deps.state.getConversation(
        agent.conversationId,
      );
      const project = this.deps.state.getProject(agent.projectId);
      this.deps.state.conversationRuntime.startRun({
        agentId: agent.id,
        projectId: agent.projectId,
        conversationId: agent.conversationId,
        runId,
        startedAt,
      });
      await this.deps.events.publish("conversation.run.started", {
        agentId: agent.id,
        projectId: agent.projectId,
        conversationId: agent.conversationId,
        runId,
        parentEntryId: conversation.activeEntryId,
        startedAt,
      });
      this.deps.state.runs.set(agent.id, {
        runId,
        abort: () => {
          abortRequested = true;
          this.deps.state.conversationRuntime.markAborting(runId);
          abortController.abort();
        },
        messages: this.deps.conversationService.getForAgent(agent.id) ?? [],
      });
      await this.deps.setAgentStatus(agent, "running");

      const toolCall = await this.executeInlineBashCommand(agent, command, {
        runId,
        signal: abortController.signal,
        continueAfterPromotedTask: false,
        useForegroundBash: false,
      });
      const createdAt = new Date().toISOString();
      await this.deps.harnessManager.appendAgentMessageWithId(
        agent,
        entryId,
        bashExecutionMessageForToolCall(toolCall, createdAt),
        createdAt,
      );
      const entry = await this.deps.appendEntry(
        {
          id: entryId,
          conversationId: agent.conversationId,
          agentId: agent.id,
          runId,
          role: "system",
          kind: "message",
          text: inlineCommandDisplayText(toolCall),
          details: inlineCommandEntryDetails(toolCall),
          createdAt,
        },
        { mirrorToHarness: false },
      );
      await this.deps.events.publish("conversation.entry.appended", {
        conversationId: agent.conversationId,
        agentId: agent.id,
        runId,
        entry,
      });

      if (
        this.deps.state.getConversationEntries(agent.conversationId).length ===
        1
      ) {
        const title = deriveConversationTitle(`! ${command}`);
        if (title) {
          const latestConversation = this.deps.state.getConversation(
            agent.conversationId,
          );
          await this.deps.updateConversation({
            ...latestConversation,
            title,
            updatedAt: createdAt,
          });
          await this.deps.events.publish("conversation.updated", {
            conversation: this.deps.state.conversations.get(
              agent.conversationId,
            ),
          });
        }
      }

      const storage = await this.deps.harnessManager.openStorage(
        conversation,
        project.dir,
      );
      const branch = await storage.getPathToRoot(await storage.getLeafId());
      const messages = convertToLlm(buildConversationContext(branch).messages);
      this.deps.conversationService.setForAgent(agent.id, messages);

      const latest = this.deps.state.agents.get(agent.id);
      if (latest) await this.deps.setAgentStatus(latest, "idle");
      this.deps.state.runs.delete(agent.id);
      this.deps.state.conversationRuntime.completeRun(runId);
      const completedAt = new Date().toISOString();
      await this.deps.events.publish("conversation.run.completed", {
        agentId: agent.id,
        projectId: agent.projectId,
        runId,
        conversationId: agent.conversationId,
        finalEntryId: entry.id,
        completedAt,
      });
      await this.deps.logger.info("Inline command run completed", {
        agentId: agent.id,
        conversationId: agent.conversationId,
        projectId: agent.projectId,
        runId,
        durationMs: Math.round(performance.now() - runStartedAt),
        context: { finalEntryId: entry.id },
      });
      return entry;
    } catch (error) {
      this.deps.state.runs.delete(agent.id);
      const aborted = abortRequested || abortController.signal.aborted;
      const latest = this.deps.state.agents.get(agent.id);
      if (latest)
        await this.deps.setAgentStatus(latest, aborted ? "aborted" : "error");
      this.deps.state.conversationRuntime.failRun(runId);
      await this.terminateRunToolCalls(runId);
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.events.publish("conversation.run.failed", {
        agentId: agent.id,
        projectId: agent.projectId,
        runId,
        conversationId: agent.conversationId,
        message,
        aborted,
        failedAt: new Date().toISOString(),
      });
      await this.deps.logger[aborted ? "warn" : "error"](
        aborted ? "Inline command run aborted" : "Inline command run failed",
        {
          agentId: agent.id,
          conversationId: agent.conversationId,
          projectId: agent.projectId,
          runId,
          durationMs: Math.round(performance.now() - runStartedAt),
          context: { aborted },
          error,
        },
      );
      throw error;
    }
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
    const queuedPrompt = (await this.deps.promptQueue.pendingForAgent(agent.id))
      .filter(
        (candidate) =>
          candidate.runId === runId &&
          (candidate.status === "accepted" || candidate.status === "queued") &&
          candidate.text === entry.text,
      )
      .at(0);
    if (!queuedPrompt) return;
    const delivered = await this.deps.promptQueue.markDelivered(
      queuedPrompt.id,
      agent.id,
      entry.id,
    );
    if (!delivered) return;
    this.deps.state.conversationRuntime.removeQueuedPrompt(runId, delivered.id);
    await this.deps.events.publish("conversation.prompt.dequeued", {
      conversationId: agent.conversationId,
      agentId: agent.id,
      projectId: agent.projectId,
      runId,
      queuedPrompt: delivered,
      entryId: entry.id,
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
    const conversation = this.deps.state.getConversation(conversationId);
    const project = this.deps.state.getProject(conversation.projectId);
    const storage = await this.deps.harnessManager.openStorage(
      conversation,
      project.dir,
    );
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const messages = buildConversationContext(branch).messages;
    const agent = conversation.activeAgentId
      ? this.deps.state.agents.get(conversation.activeAgentId)
      : undefined;
    const contextWindow = getModelContextWindow(agent?.model);
    return computeContextUsage(messages, branch, contextWindow);
  }

  async publishContextUsage(
    conversationId: string,
    agentId: string,
    runId: string,
  ): Promise<void> {
    const contextUsage = await this.getContextUsage(conversationId);
    await this.deps.events.publish(
      "conversation.context.updated",
      { conversationId, agentId, runId, contextUsage },
      { durability: "transient" },
    );
  }

  async maybeAutoCompact(
    conversationId: string,
    agentId?: string,
    runId?: string,
  ): Promise<void> {
    if (!this.deps.storage.settings.compaction.auto) return;
    const conversation = this.deps.state.getConversation(conversationId);
    const agent =
      (agentId ? this.deps.state.agents.get(agentId) : undefined) ??
      (conversation.activeAgentId
        ? this.deps.state.agents.get(conversation.activeAgentId)
        : undefined);
    const contextWindow = getModelContextWindow(agent?.model);
    if (contextWindow <= 0) return;

    const project = this.deps.state.getProject(conversation.projectId);
    const storage = await this.deps.harnessManager.openStorage(
      conversation,
      project.dir,
    );
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const messages = buildConversationContext(branch).messages;
    const contextUsage = computeContextUsage(messages, branch, contextWindow);
    if (contextUsage.tokens === null) return;

    const policy = deriveAutoCompactionPolicy(
      contextWindow,
      this.deps.storage.settings.compaction.auto,
    );
    if (!shouldAutoCompact(contextUsage.tokens, policy)) return;
    await this.deps.compactionService.compactConversation(
      conversationId,
      {
        instructions:
          "Automatic compaction after the selected model approached its context window.",
      },
      {
        reason: "threshold",
        agentId: agent?.id,
        runId,
        contextWindow: policy.contextWindow,
        contextTokens: contextUsage.tokens,
        thresholdTokens: policy.thresholdTokens,
        triggerReserveTokens: policy.triggerReserveTokens,
        keepRecentTokens: policy.keepRecentTokens,
      },
    );
    // Compaction succeeded: hand the work back to the agent so it continues
    // from the fresh context checkpoint instead of stopping.
    if (agent) await this.continueAfterAutoCompaction(agent);
  }

  /**
   * Push a normal handover user message and start a continuation run after an
   * automatic compaction, bounded by a per-conversation runaway guard.
   */
  async continueAfterAutoCompaction(agent: AgentRecord): Promise<void> {
    const count = this.autoContinuationCounts.get(agent.conversationId) ?? 0;
    if (count >= MAX_AUTO_CONTINUATIONS) return;
    this.autoContinuationCounts.set(agent.conversationId, count + 1);
    const entry = await this.appendAutoContinueMessage(
      agent,
      AUTO_CONTINUE_MESSAGE,
    );
    await this.deps.events.publish("conversation.entry.appended", {
      conversationId: entry.conversationId,
      agentId: entry.agentId,
      runId: entry.runId,
      entry,
    });
    void this.continueAgent(agent.id).catch(() => undefined);
  }

  async appendAutoContinueMessage(
    agent: AgentRecord,
    text: string,
  ): Promise<ConversationEntry> {
    const message: AgentMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    const appended = await this.deps.harnessManager.appendAgentMessage(
      agent,
      message,
    );
    return this.deps.appendEntry(
      {
        id: appended.id,
        conversationId: agent.conversationId,
        agentId: agent.id,
        role: "user",
        text,
        createdAt: appended.timestamp,
      },
      { mirrorToHarness: false },
    );
  }
}
