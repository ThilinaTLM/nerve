import { resolve } from "node:path";
import type {
  AgentRecord,
  ApprovalRecord,
  Mode,
  StartTaskRequest,
  TaskRecord,
  ToolCallRecord,
  ToolName,
  UserQuestionRecord,
  UserQuestionStatus,
} from "@nervekit/shared";
import { createId } from "@nervekit/shared";
import { allToolDescriptors, toolRiskForName } from "@nervekit/tools";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { ApplicationLogger } from "../../logging.js";
import type {
  ConversationRuntime,
  ToolAnchor,
} from "../conversations/conversation-runtime.js";
import type { PlanService } from "../plans/plan-service.js";
import type { PythonRuntimeService } from "../runtime/python-runtime-service.js";
import type { TaskManager } from "../tasks/task-manager.js";
import {
  ApprovalRepository,
  evaluateToolPolicy,
  TodoStateService,
  ToolCallRepository,
  UserQuestionRepository,
} from "./index.js";
import { InteractionSessionService } from "./interaction-session.service.js";
import { OrchestrationToolDispatcher } from "./orchestration-tool-dispatcher.js";
import { toToolCallTranscriptRecord } from "./tool-call-transcript-preview.js";
import { ToolExecutorService } from "./tool-executor.service.js";

export interface ToolExecutionResponse {
  toolCall: ToolCallRecord;
  approval?: ApprovalRecord;
}

export type ToolRequestOptions = {
  signal?: AbortSignal;
  sourceToolCallId?: string;
  providerToolCallId?: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
  contentIndex?: number;
  anchor?: ToolAnchor;
  durableSuspend?: boolean;
  hidden?: boolean;
  continueAfterPromotedTask?: boolean;
  useForegroundBash?: boolean;
};

export type ExploreProgressUpdate = {
  type: "explore_progress";
  timestamp: string;
  agentId?: string;
  taskIndex?: number;
  taskCount?: number;
  label?: string;
  model?: string;
  phase:
    | "queued"
    | "started"
    | "tool_call"
    | "tool_result"
    | "assistant"
    | "completed"
    | "failed";
  message: string;
};

export type ExploreRunResult = {
  reports: Array<{
    agentId: string;
    task: string;
    label?: string;
    status?: "completed" | "failed" | "aborted";
    report: string;
    reportPath?: string;
    summaryPreview?: string;
    usage?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      totalTokens: number;
      cost: number;
      turns: number;
    };
    model?: string;
    stopReason?: string;
    errorMessage?: string;
    steps?: Array<{
      type: "tool_call" | "tool_result" | "assistant";
      toolName?: string;
      message: string;
      timestamp?: string;
    }>;
  }>;
  contentBlocks?: Array<{ type: "text"; text: string }>;
};

export type ExploreRunner = (
  parent: AgentRecord,
  args: Record<string, unknown>,
  options?: {
    onProgress?: (update: ExploreProgressUpdate) => void;
    signal?: AbortSignal;
  },
) => Promise<ExploreRunResult>;

export type TaskStarter = (
  request: StartTaskRequest & {
    origin?: TaskRecord["origin"];
    completion?: TaskRecord["completion"];
    visibility?: TaskRecord["visibility"];
  },
) => Promise<TaskRecord>;

export class ToolService {
  readonly toolCalls: Map<string, ToolCallRecord>;
  readonly approvals: Map<string, ApprovalRecord>;
  readonly userQuestions: Map<string, UserQuestionRecord>;
  private readonly toolCallRepository: ToolCallRepository;
  private readonly approvalRepository: ApprovalRepository;
  private readonly userQuestionRepository: UserQuestionRepository;
  private readonly todoState = new TodoStateService();
  private readonly interactionSessions: InteractionSessionService;
  private readonly dispatcher: OrchestrationToolDispatcher;
  private readonly executor: ToolExecutorService;
  private readonly waiters = new Map<
    string,
    Set<(toolCall: ToolCallRecord) => void>
  >();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    index: IndexStore,
    private readonly tasks: TaskManager,
    private readonly pythonRuntime: PythonRuntimeService,
    private readonly startTask: TaskStarter,
    private readonly getAgent: (agentId: string) => AgentRecord,
    private readonly runExplore: ExploreRunner,
    private readonly getApiKey: (
      provider: string,
    ) => Promise<string | undefined>,
    private readonly plans: PlanService,
    private readonly setAgentMode: (
      agentId: string,
      mode: Mode,
      reason: string,
    ) => Promise<AgentRecord>,
    private readonly conversationRuntime: ConversationRuntime,
    private readonly logger?: ApplicationLogger,
  ) {
    this.toolCallRepository = new ToolCallRepository(storage, index);
    this.approvalRepository = new ApprovalRepository(storage, index);
    this.userQuestionRepository = new UserQuestionRepository(storage, index);
    this.toolCalls = this.toolCallRepository.records;
    this.approvals = this.approvalRepository.records;
    this.userQuestions = this.userQuestionRepository.records;
    this.interactionSessions = new InteractionSessionService({
      userQuestionRepository: this.userQuestionRepository,
      events: this.events,
      updateToolCall: (id, patch) => this.updateToolCall(id, patch),
      publishToolCallUpdated: (toolCall) =>
        this.publishToolCallUpdated(toolCall),
    });
    this.dispatcher = new OrchestrationToolDispatcher({
      storage: this.storage,
      events: this.events,
      tasks: this.tasks,
      pythonRuntime: this.pythonRuntime,
      startTask: this.startTask,
      getAgent: this.getAgent,
      runExplore: this.runExplore,
      getApiKey: this.getApiKey,
      plans: this.plans,
      setAgentMode: this.setAgentMode,
      conversationRuntime: this.conversationRuntime,
      todoState: this.todoState,
      interactionSessions: this.interactionSessions,
      updateToolCall: (id, patch) => this.updateToolCall(id, patch),
      publishToolCallUpdated: (toolCall) =>
        this.publishToolCallUpdated(toolCall),
    });
    this.executor = new ToolExecutorService({
      getToolCall: (id) => this.getToolCall(id),
      updateToolCall: (id, patch) => this.updateToolCall(id, patch),
      publishToolCallUpdated: (toolCall) =>
        this.publishToolCallUpdated(toolCall),
      dispatcher: this.dispatcher,
      storageHome: this.storage.paths.home,
      logger: this.logger,
    });
  }

  async hydrate(): Promise<void> {
    const toolCalls = await this.toolCallRepository.hydrate();
    this.todoState.hydrateFromToolCalls(toolCalls);
    await this.approvalRepository.hydrate();
    await this.userQuestionRepository.hydrate();
  }

  listTools() {
    return allToolDescriptors;
  }

  listToolCalls(): ToolCallRecord[] {
    return this.toolCallRepository.list();
  }

  /** Compact the persisted tool-call log, dropping superseded append rows. */
  async compactToolCallLog(): Promise<void> {
    await this.toolCallRepository.compactPersisted();
  }

  toolCallLogPath(): string {
    return this.toolCallRepository.persistedPath();
  }

  listApprovals(status?: ApprovalRecord["status"]): ApprovalRecord[] {
    return this.approvalRepository.list(status);
  }

  listUserQuestions(status?: UserQuestionStatus): UserQuestionRecord[] {
    return this.userQuestionRepository.list(status);
  }

  async removeRecordsForConversations(
    conversationIds: Iterable<string>,
    agentIds: Iterable<string> = [],
  ): Promise<void> {
    const conversations = new Set(conversationIds);
    if (conversations.size === 0) return;
    const agents = new Set(agentIds);
    for (const toolCall of this.toolCalls.values()) {
      if (conversations.has(toolCall.conversationId))
        agents.add(toolCall.agentId);
    }
    await Promise.all([
      this.toolCallRepository.removeForConversations(conversations),
      this.approvalRepository.removeForConversations(conversations),
      this.userQuestionRepository.removeForConversations(conversations),
    ]);
    for (const agentId of agents) this.todoState.delete(agentId);
  }

  async requestTool(
    agent: AgentRecord,
    toolName: ToolName,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<ToolExecutionResponse> {
    const now = new Date().toISOString();
    const latestAgent = this.getAgent(agent.id);
    const evaluation = evaluateToolPolicy(latestAgent, toolName, args, {
      dataDir: this.storage.paths.home,
    });
    const providerToolCallId =
      options.providerToolCallId ?? options.sourceToolCallId;
    const anchor = options.anchor;
    const toolCall: ToolCallRecord = {
      id: createId("tool"),
      agentId: latestAgent.id,
      conversationId: latestAgent.conversationId,
      projectId: latestAgent.projectId,
      toolName,
      sourceToolCallId: providerToolCallId,
      providerToolCallId,
      runId: options.runId ?? anchor?.runId,
      turnId: options.turnId ?? anchor?.turnId,
      liveMessageId: options.liveMessageId ?? anchor?.liveMessageId,
      contentIndex: options.contentIndex ?? anchor?.contentIndex,
      risk: evaluation.risk,
      args: evaluation.normalizedArgs,
      cwd: evaluation.cwd,
      status: "requested",
      hidden: options.hidden === true ? true : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.upsertToolCall(toolCall);
    await this.publishToolCallUpdated(toolCall);
    await this.events.publish("policy.evaluated", {
      toolCallId: toolCall.id,
      agentId: agent.id,
      conversationId: agent.conversationId,
      projectId: agent.projectId,
      toolName,
      risk: evaluation.risk,
      decision: evaluation.decision,
      reason: evaluation.reason,
    });
    await this.logger?.info("Tool policy evaluated", {
      toolCallId: toolCall.id,
      agentId: agent.id,
      conversationId: agent.conversationId,
      projectId: agent.projectId,
      runId: toolCall.runId,
      context: {
        toolName,
        risk: evaluation.risk,
        decision: evaluation.decision,
        reason: evaluation.reason,
      },
    });

    if (evaluation.decision === "deny") {
      const denied = await this.updateToolCall(toolCall.id, {
        status: "denied",
        error: evaluation.reason,
      });
      await this.publishToolCallUpdated(denied);
      await this.logger?.warn("Tool denied by policy", {
        toolCallId: denied.id,
        agentId: denied.agentId,
        conversationId: denied.conversationId,
        projectId: denied.projectId,
        runId: denied.runId,
        context: { toolName: denied.toolName, reason: evaluation.reason },
      });
      return { toolCall: denied };
    }

    if (evaluation.decision === "approval") {
      const approval: ApprovalRecord = {
        id: createId("approval"),
        toolCallId: toolCall.id,
        agentId: agent.id,
        conversationId: agent.conversationId,
        projectId: agent.projectId,
        risk: evaluation.risk,
        reason: evaluation.reason,
        status: "pending",
        requestedAt: new Date().toISOString(),
      };
      await this.upsertApproval(approval);
      const pending = await this.updateToolCall(toolCall.id, {
        status: "pending_approval",
        approvalId: approval.id,
      });
      await this.publishToolCallUpdated(pending);
      await this.events.publish("approval.requested", {
        approval,
        toolCall: pending,
      });
      await this.logger?.info("Tool approval requested", {
        toolCallId: pending.id,
        agentId: pending.agentId,
        conversationId: pending.conversationId,
        projectId: pending.projectId,
        runId: pending.runId,
        context: { toolName: pending.toolName, risk: pending.risk },
      });
      return { toolCall: pending, approval };
    }

    return {
      toolCall: await this.executor.executeAllowedTool(toolCall.id, options),
    };
  }

  async requestToolAndWait(
    agent: AgentRecord,
    toolName: ToolName,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<ToolCallRecord> {
    const response = await this.requestTool(agent, toolName, args, options);
    if (isTerminalToolCall(response.toolCall)) return response.toolCall;
    if (response.toolCall.status !== "pending_approval")
      return response.toolCall;
    if (options.signal?.aborted) throw new Error("Tool execution aborted.");

    return new Promise<ToolCallRecord>((resolve, reject) => {
      const toolCallId = response.toolCall.id;
      const settle = (toolCall: ToolCallRecord) => {
        cleanup();
        resolve(toolCall);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("Tool execution aborted."));
      };
      const cleanup = () => {
        const waiters = this.waiters.get(toolCallId);
        waiters?.delete(settle);
        if (waiters && waiters.size === 0) this.waiters.delete(toolCallId);
        options.signal?.removeEventListener("abort", onAbort);
      };

      const current = this.getToolCall(toolCallId);
      if (isTerminalToolCall(current)) {
        resolve(current);
        return;
      }

      let waiters = this.waiters.get(toolCallId);
      if (!waiters) {
        waiters = new Set();
        this.waiters.set(toolCallId, waiters);
      }
      waiters.add(settle);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  findToolCallByProviderToolCallId(
    providerToolCallId: string | undefined,
  ): ToolCallRecord | undefined {
    if (!providerToolCallId) return undefined;
    return this.toolCallRepository.findByProviderToolCallId(providerToolCallId);
  }

  async recordProviderToolCallError(
    agent: AgentRecord,
    toolName: ToolName,
    args: Record<string, unknown>,
    errorMessage: string,
    options: ToolRequestOptions = {},
  ): Promise<ToolCallRecord> {
    const providerToolCallId =
      options.providerToolCallId ?? options.sourceToolCallId;
    const existing = this.findToolCallByProviderToolCallId(providerToolCallId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const latestAgent = this.getAgent(agent.id);
    const anchor = options.anchor;
    const cwd =
      typeof args.cwd === "string" && args.cwd.trim().length > 0
        ? resolve(latestAgent.projectDir, args.cwd)
        : resolve(latestAgent.projectDir);
    const toolCall: ToolCallRecord = {
      id: createId("tool"),
      agentId: latestAgent.id,
      conversationId: latestAgent.conversationId,
      projectId: latestAgent.projectId,
      toolName,
      sourceToolCallId: providerToolCallId,
      providerToolCallId,
      runId: options.runId ?? anchor?.runId,
      turnId: options.turnId ?? anchor?.turnId,
      liveMessageId: options.liveMessageId ?? anchor?.liveMessageId,
      contentIndex: options.contentIndex ?? anchor?.contentIndex,
      risk: toolRiskForName(toolName),
      args,
      cwd,
      status: "error",
      hidden: options.hidden === true ? true : undefined,
      error: errorMessage,
      result: {
        content: errorMessage,
        contentBlocks: [{ type: "text", text: errorMessage }],
      },
      createdAt: now,
      updatedAt: now,
    };
    await this.upsertToolCall(toolCall);
    await this.publishToolCallUpdated(toolCall);
    await this.logger?.warn("Tool call failed before execution", {
      toolCallId: toolCall.id,
      agentId: toolCall.agentId,
      conversationId: toolCall.conversationId,
      projectId: toolCall.projectId,
      runId: toolCall.runId,
      context: { toolName, providerToolCallId },
    });
    return toolCall;
  }

  /**
   * Terminalize tool calls left in a non-terminal *execution* state when a run
   * ends abnormally (aborted/failed/interrupted). Only `running` and
   * `requested` calls are reconciled; `pending_approval` and `waiting_for_user`
   * are intentional pauses resumed via approval / suspension flows and are left
   * untouched.
   */
  async terminateNonTerminalToolCallsForRun(
    runId: string,
    errorMessage: string,
  ): Promise<ToolCallRecord[]> {
    if (!runId) return [];
    const stale = this.toolCallRepository
      .list()
      .filter(
        (toolCall) =>
          toolCall.runId === runId &&
          (toolCall.status === "running" || toolCall.status === "requested"),
      );
    const terminated: ToolCallRecord[] = [];
    for (const toolCall of stale) {
      const failed = await this.updateToolCall(toolCall.id, {
        status: "error",
        error: errorMessage,
        result: {
          content: errorMessage,
          contentBlocks: [{ type: "text", text: errorMessage }],
        },
      });
      await this.publishToolCallUpdated(failed);
      await this.logger?.warn("Tool call terminated after run ended", {
        toolCallId: failed.id,
        agentId: failed.agentId,
        conversationId: failed.conversationId,
        projectId: failed.projectId,
        runId: failed.runId,
        context: { toolName: failed.toolName },
      });
      terminated.push(failed);
    }
    return terminated;
  }

  async grantApproval(
    approvalId: string,
    note?: string,
  ): Promise<ToolCallRecord> {
    const approval = this.getPendingApproval(approvalId);
    const granted: ApprovalRecord = {
      ...approval,
      status: "granted",
      resolvedAt: new Date().toISOString(),
    };
    await this.upsertApproval(granted);
    await this.events.publish("approval.granted", { approval: granted, note });
    const toolCall = this.getToolCall(granted.toolCallId);
    return this.executor.executeAllowedTool(toolCall.id);
  }

  async denyApproval(
    approvalId: string,
    note?: string,
  ): Promise<ToolCallRecord> {
    const approval = this.getPendingApproval(approvalId);
    const deniedApproval: ApprovalRecord = {
      ...approval,
      status: "denied",
      resolvedAt: new Date().toISOString(),
    };
    await this.upsertApproval(deniedApproval);
    const deniedToolCall = await this.updateToolCall(approval.toolCallId, {
      status: "denied",
      error: note ?? "Denied by user.",
    });
    await this.events.publish("approval.denied", {
      approval: deniedApproval,
      note,
    });
    await this.publishToolCallUpdated(deniedToolCall);
    return deniedToolCall;
  }

  async answerUserQuestion(
    questionId: string,
    answer: string,
  ): Promise<UserQuestionRecord> {
    return this.interactionSessions.answerUserQuestion(questionId, answer);
  }

  async dismissUserQuestion(
    questionId: string,
    reason?: string,
  ): Promise<UserQuestionRecord> {
    return this.interactionSessions.dismissUserQuestion(questionId, reason);
  }

  userQuestionResult(question: UserQuestionRecord): Record<string, unknown> {
    return this.interactionSessions.userQuestionResult(question);
  }

  async completeToolCall(
    toolCallId: string,
    result: unknown,
  ): Promise<ToolCallRecord> {
    const completed = await this.updateToolCall(toolCallId, {
      status: "completed",
      result,
      error: undefined,
    });
    await this.publishToolCallUpdated(completed);
    return completed;
  }

  getToolCall(toolCallId: string): ToolCallRecord {
    return this.toolCallRepository.get(toolCallId);
  }

  private getPendingApproval(approvalId: string): ApprovalRecord {
    return this.approvalRepository.getPending(approvalId);
  }

  private async updateToolCall(
    toolCallId: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord> {
    const current = this.getToolCall(toolCallId);
    const updated: ToolCallRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.upsertToolCall(updated);
    if (isTerminalToolCall(updated)) this.notifyWaiters(updated);
    return updated;
  }

  private async publishToolCallUpdated(
    toolCall: ToolCallRecord,
  ): Promise<void> {
    await this.events.publish("conversation.tool_call.updated", {
      conversationId: toolCall.conversationId,
      agentId: toolCall.agentId,
      projectId: toolCall.projectId,
      runId: toolCall.runId,
      turnId: toolCall.turnId,
      liveMessageId: toolCall.liveMessageId,
      contentIndex: toolCall.contentIndex,
      providerToolCallId:
        toolCall.providerToolCallId ?? toolCall.sourceToolCallId,
      toolCall: toToolCallTranscriptRecord(toolCall),
    });
  }

  private async upsertToolCall(toolCall: ToolCallRecord): Promise<void> {
    await this.toolCallRepository.upsert(toolCall);
  }

  private notifyWaiters(toolCall: ToolCallRecord): void {
    const waiters = this.waiters.get(toolCall.id);
    if (!waiters) return;
    this.waiters.delete(toolCall.id);
    for (const waiter of waiters) waiter(toolCall);
  }

  private async upsertApproval(approval: ApprovalRecord): Promise<void> {
    await this.approvalRepository.upsert(approval);
  }
}

function isTerminalToolCall(toolCall: ToolCallRecord): boolean {
  return (
    toolCall.status === "completed" ||
    toolCall.status === "denied" ||
    toolCall.status === "error"
  );
}
