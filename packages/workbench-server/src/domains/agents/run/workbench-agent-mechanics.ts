import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AgentHarness,
  AgentToolSuspension,
  Conversation,
  calculateContextTokens,
  deriveAutoCompactionPolicy,
  getModelContextWindow,
  isContextOverflowAssistantMessage,
} from "@nervekit/host-runtime/harness";
import type { ToolExecutionResult } from "@nervekit/host-runtime/tools";
import type {
  RunExecutionOutcome,
  RunExecutionSink,
} from "@nervekit/host-runtime";
import {
  type AgentRecord,
  type ContextUsage,
  type ConversationEntry,
  type ConversationRecord,
  type CreateAgentRequest,
  type PromptRequest,
  type RunRecord,
  parseInlineCommandPrompt,
  type ToolCallRecord,
  type ToolName,
} from "@nervekit/contracts";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { EventBus } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage/index.js";
import type { RuntimeState } from "../../../runtime/runtime-state.js";
import type { AuthManager } from "../../auth/index.js";
import type { ConversationService } from "../../conversations/conversation-service.js";
import type { ConversationHarnessStorage } from "../../conversations/conversation-harness-storage.js";
import type { CompactionService } from "../../conversations/operations/index.js";
import type { PythonRuntimeService } from "../../runtime/python-runtime-service.js";
import type { PlanService } from "../../plans/plan-service.js";
import { activeToolNamesForAgent } from "../../tools/agent-tool-adapter.js";
import type {
  ExploreProgressUpdate,
  ToolService,
} from "../../tools/tool-service.js";
import type { SubscriptionUsageService } from "../../usage/subscription-usage-service.js";
import { executeWorkbenchHarness } from "./workbench-harness-execution.js";
import { AutoCompactionRunner } from "./auto-compaction-runner.js";
import { InlineCommandRunner } from "./inline-command-runner.js";
import type { AppendEntryFn, MessageMirror } from "./message-mirror.js";
import { type ExploreReport, SubagentRunner } from "./subagent-runner.js";
import type { WorkbenchLiveExecutionControl } from "../../runs/run-live-executions.js";

export interface WorkbenchAgentMechanicsDeps {
  storage: InitializedStorage;
  events: EventBus;
  auth: AuthManager;
  tools: ToolService;
  pythonRuntime: PythonRuntimeService;
  plans: PlanService;
  harnessStorage: ConversationHarnessStorage;
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
  startAutomaticRun(agent: AgentRecord, prompt: string): Promise<void>;
  runChild(input: {
    agent: AgentRecord;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<{
    status: "completed" | "failed" | "cancelled";
    entries: ConversationEntry[];
    failureMessage?: string;
  }>;
}

export class WorkbenchAgentMechanics {
  readonly subagents: SubagentRunner;
  readonly inlineCommands: InlineCommandRunner;
  readonly autoCompaction: AutoCompactionRunner;
  readonly autoContinuationCounts = new Map<string, number>();

  constructor(readonly deps: WorkbenchAgentMechanicsDeps) {
    this.subagents = new SubagentRunner({
      storage: deps.storage,
      events: deps.events,
      createAgent: deps.createAgent,
      getConversation: (conversationId) =>
        deps.state.getConversation(conversationId),
      updateConversation: deps.updateConversation,
      logger: deps.logger.child({ component: "subagent-runner" }),
      runChild: deps.runChild,
    });
    this.inlineCommands = new InlineCommandRunner(deps);
    this.autoCompaction = new AutoCompactionRunner(
      deps,
      this.autoContinuationCounts,
      deps.startAutomaticRun,
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

  async runCoordinatorExecution(input: {
    run: RunRecord;
    sink: RunExecutionSink;
    command: "start" | "continue";
    prompt?: string;
    images?: PromptRequest["images"];
    signal: AbortSignal;
    installControl(control: WorkbenchLiveExecutionControl): void;
    checkpointCommand(
      boundary: "after_provider_response" | "suspension",
      interactionId?: string,
    ): Promise<import("@nervekit/host-runtime").CheckpointCommand>;
  }): Promise<RunExecutionOutcome> {
    const agent = this.deps.state.getAgent(input.run.agentId);
    const inline =
      input.command === "start"
        ? parseInlineCommandPrompt(input.prompt ?? "")
        : undefined;
    if (inline) {
      return this.inlineCommands.runCoordinatorPrompt({
        agent,
        command: inline.command,
        runId: input.run.runId,
        sink: input.sink,
        signal: input.signal,
      });
    }
    return (await executeWorkbenchHarness.call(
      this,
      agent,
      { text: input.prompt ?? "", images: input.images },
      {
        continue: input.command === "continue",
        coordinator: input,
      },
    )) as RunExecutionOutcome;
  }

  async runHarnessAttempt(input: {
    harness: AgentHarness;
    conversation: Conversation;
    request: PromptRequest;
    continue: boolean;
    runId: string;
    agent: AgentRecord;
  }): Promise<AssistantMessage> {
    const latestAgent = () =>
      this.deps.state.agents.get(input.agent.id) ?? input.agent;
    let assistant = input.continue
      ? await input.harness.continue()
      : await input.harness.prompt(input.request.text, {
          images: input.request.images,
        });
    const contextWindow = getModelContextWindow(latestAgent().model);
    if (
      this.deps.storage.settings.compaction.auto &&
      isContextOverflowAssistantMessage(assistant, contextWindow)
    ) {
      const recovered = await this.tryOverflowCompactionRecovery(
        input,
        assistant,
        contextWindow,
      );
      if (recovered) assistant = await input.harness.continue();
    }
    return assistant;
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
          (candidate.status === "pending_approval" ||
            (candidate.status === "waiting_for_user" &&
              (candidate.toolName === "ask_user" ||
                candidate.toolName === "plan_mode_present"))),
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

  resetAutoContinuationCount(conversationId: string): void {
    this.autoCompaction.resetContinuationCount(conversationId);
  }
}
