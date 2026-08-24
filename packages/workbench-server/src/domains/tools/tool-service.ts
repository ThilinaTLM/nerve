/* eslint-disable max-lines -- Tool lifecycle orchestration remains centralized pending a follow-up service split. */
import { resolve } from "node:path";
import {
  allToolDescriptors,
  type ExplainImageRequest,
  type ExplainImageResponse,
  toolRiskForName,
} from "@nervekit/tools";
import {
  type AgentRecord,
  type ApprovalRecord,
  assertTransition,
  createId,
  type ExploreReportSummaryPayload,
  type Mode,
  type ResolveToolInteractionRequest,
  type StartTaskRequest,
  type TaskRecord,
  type ThinkingLevel,
  type ToolCallDetails,
  type ToolCallRecord,
  type ToolCallTranscriptRecord,
  type ToolInteraction,
  type ToolName,
  toolCallTransitions,
  type UserQuestionRecord,
  type UserQuestionStatus,
} from "@nervekit/contracts";
import type {
  ConversationRuntime,
  ToolAnchor,
} from "../runs/runtime/conversation-runtime.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { PermissionExceptionService } from "../permissions/permission-exceptions.service.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { RuntimeProjectionStore } from "../../infrastructure/runtime-projection-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { PlanService } from "../plans/plan-service.js";
import type { PythonRuntimeService } from "../runtime/python-runtime-service.js";
import type { WorkbenchTaskService } from "../tasks/workbench-task-service.js";
import {
  evaluateWorkbenchToolPermission,
  TodoStateService,
  ToolCallRepository,
} from "./index.js";
import { InteractionSessionService } from "./interaction-session.service.js";
import { ConversationJournalRepository } from "../conversations/conversation-journal.repository.js";
import { OrchestrationToolDispatcher } from "./orchestration-tool-dispatcher.js";
import { toToolCallTranscriptRecord } from "./tool-call-transcript-preview.js";
import { ToolExecutorService } from "./tool-executor.service.js";
import { ToolResultPayloadStore } from "./tool-result-payload-store.js";

const HOST_RESTART_TOOL_ERROR =
  "Tool execution was interrupted because the host restarted.";

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
  forceApproval?: boolean;
  hidden?: boolean;
  continueAfterPromotedTask?: boolean;
  useForegroundBash?: boolean;
  onLifecycle?: (toolCall: ToolCallRecord) => Promise<void>;
};

export type ExploreProgressUpdate = {
  type: "explore_progress";
  timestamp: string;
  agentId?: string;
  taskIndex?: number;
  taskCount?: number;
  label?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  phase:
    | "queued"
    | "started"
    | "tool_call"
    | "tool_result"
    | "assistant"
    | "completed"
    | "failed";
  message: string;
  /** Bounded terminal projection for progressive per-child report rendering. */
  report?: ExploreReportSummaryPayload;
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
    thinkingLevel?: ThinkingLevel;
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
  details?: {
    outputLimits?: {
      artifacts?: Array<{
        kind: "transcript";
        path: string;
        label?: string;
      }>;
    };
  };
};

export type ExploreRunner = (
  parent: AgentRecord,
  args: Record<string, unknown>,
  options?: {
    onProgress?: (update: ExploreProgressUpdate) => void;
    signal?: AbortSignal;
    parentRunId?: string;
  },
) => Promise<ExploreRunResult>;

export type TaskStarter = (
  request: StartTaskRequest & {
    origin?: TaskRecord["origin"];
    completion?: TaskRecord["completion"];
    visibility?: TaskRecord["visibility"];
  },
) => Promise<TaskRecord>;

function durableApprovalScopes(
  scopes: readonly string[],
): Array<"single_call" | "always_project" | "always_user"> {
  const mapped = scopes.map((scope) =>
    scope === "always" ? "always_user" : scope,
  );
  return [...new Set(mapped)].filter(
    (scope): scope is "single_call" | "always_project" | "always_user" =>
      scope === "single_call" ||
      scope === "always_project" ||
      scope === "always_user",
  );
}

export class ToolService {
  readonly toolCalls: Map<string, ToolCallRecord>;
  private readonly toolCallRepository: ToolCallRepository;
  private readonly todoState = new TodoStateService();
  private readonly interactionSessions: InteractionSessionService;
  private readonly dispatcher: OrchestrationToolDispatcher;
  private readonly executor: ToolExecutorService;
  private readonly conversationJournal: ConversationJournalRepository;
  readonly resultPayloads: ToolResultPayloadStore;
  private readonly waiters = new Map<
    string,
    Set<(toolCall: ToolCallRecord) => void>
  >();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: StreamLogRegistry,
    index: RuntimeProjectionStore,
    private readonly tasks: WorkbenchTaskService,
    private readonly pythonRuntime: PythonRuntimeService,
    private readonly startTask: TaskStarter,
    private readonly getAgent: (agentId: string) => AgentRecord,
    private readonly runExplore: ExploreRunner,
    private readonly getApiKey: (
      provider: string,
    ) => Promise<string | undefined>,
    private readonly explainImage: (
      request: ExplainImageRequest,
    ) => Promise<ExplainImageResponse>,
    private readonly plans: PlanService,
    private readonly setAgentMode: (
      agentId: string,
      mode: Mode,
      reason: string,
    ) => Promise<AgentRecord>,
    private readonly conversationRuntime: ConversationRuntime,
    private readonly logger?: ApplicationLogger,
    private readonly permissionExceptions?: PermissionExceptionService,
    journal?: ConversationJournalRepository,
    resultPayloads?: ToolResultPayloadStore,
  ) {
    this.conversationJournal =
      journal ?? new ConversationJournalRepository(storage);
    this.resultPayloads =
      resultPayloads ?? new ToolResultPayloadStore(storage.paths.home);
    this.toolCallRepository = new ToolCallRepository(
      this.conversationJournal,
      index,
      this.resultPayloads,
    );
    this.toolCalls = this.toolCallRepository.records;
    this.interactionSessions = new InteractionSessionService({
      events: this.events,
      getToolCall: (id) => this.getToolCall(id),
      listToolCalls: () => this.listToolCalls(),
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
      explainImage: this.explainImage,
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
      claimExecution: (id, expectedRevision, patch) =>
        this.updateToolCallAtRevision(id, expectedRevision, patch),
      assertExecutionBoundary: (toolCall) =>
        this.assertExecutionBoundary(toolCall),

      payloads: this.resultPayloads,
      logger: this.logger,
    });
  }

  async hydrate(): Promise<void> {
    await this.resultPayloads.initialize();
    this.plans.resetToolCallHydration();
    this.todoState.resetToolCallHydration();
    await this.toolCallRepository.hydrate((toolCall) => {
      this.plans.hydrateFromToolCall(toolCall);
      this.todoState.hydrateFromToolCall(toolCall);
    });
    await this.reconcileInterruptedToolCallsOnStartup();
  }

  async reconcileResultPayloads(): Promise<void> {
    const referenced = new Set<string>();
    for (const state of await this.conversationJournal.hydrateAll()) {
      for (const toolCall of state.toolCalls.values()) {
        if (toolCall.resultPayload) {
          referenced.add(this.resultPayloads.path(toolCall.resultPayload));
        }
      }
    }
    await this.resultPayloads.reconcile(referenced);
  }

  listTools() {
    return allToolDescriptors;
  }

  listToolCalls(): ToolCallRecord[] {
    return this.toolCallRepository.listActive();
  }

  listToolCallPreviews(
    query: Parameters<ToolCallRepository["listPreviews"]>[0] = {},
  ): ToolCallTranscriptRecord[] {
    return this.toolCallRepository.listPreviews(query);
  }

  queryToolCallPreviews(
    query: Parameters<ToolCallRepository["queryPreviews"]>[0] = {},
  ): ReturnType<ToolCallRepository["queryPreviews"]> {
    return this.toolCallRepository.queryPreviews(query);
  }

  countToolCalls(): number {
    return this.toolCallRepository.count();
  }

  /** Whether the tool-call records were loaded from the persisted snapshot. */
  get toolCallHydrationSource(): "journal" {
    return this.toolCallRepository.hydrationSource;
  }

  listApprovals(status?: ApprovalRecord["status"]): ApprovalRecord[] {
    return this.projectApprovals(status);
  }

  listUserQuestions(status?: UserQuestionStatus): UserQuestionRecord[] {
    return this.projectQuestions(status);
  }

  private projectApprovals(
    status?: ApprovalRecord["status"],
  ): ApprovalRecord[] {
    const toolCalls =
      status === "pending"
        ? this.listToolCalls()
        : this.listToolCallPreviews({ limit: 1_000 });
    return toolCalls
      .flatMap((toolCall) =>
        toolCall.interactions.flatMap((interaction) =>
          interaction.kind === "approval" &&
          (interaction.status !== "pending" ||
            this.conversationJournal.isActionableToolInteraction(
              toolCall as ToolCallRecord,
              interaction.ordinal,
            ))
            ? [this.projectApproval(toolCall, interaction.ordinal)]
            : [],
        ),
      )
      .filter((approval) => status === undefined || approval.status === status);
  }

  private projectApproval(
    toolCall: ToolCallRecord | ToolCallTranscriptRecord,
    ordinal: number,
  ): ApprovalRecord {
    const interaction = toolCall.interactions[ordinal];
    if (!interaction || interaction.kind !== "approval")
      throw new Error("Approval interaction not found.");
    return {
      id: `approval_${toolCall.id}_${ordinal}`,
      toolCallId: toolCall.id,
      agentId: toolCall.agentId,
      conversationId: toolCall.conversationId,
      projectId: toolCall.projectId,
      risk: interaction.request.risk,
      reason: interaction.request.reason,
      status:
        interaction.status === "pending"
          ? "pending"
          : interaction.resolution?.action === "allow"
            ? "granted"
            : "denied",
      requestedAt: interaction.requestedAt,
      resolvedAt: interaction.resolvedAt,
      resolutionNote: interaction.resolution?.note,
      offeredScopes: durableApprovalScopes(interaction.request.offeredScopes),
      suggestedExceptions: interaction.request.suggestedExceptions,
    };
  }

  private projectQuestions(status?: UserQuestionStatus): UserQuestionRecord[] {
    const toolCalls =
      status === "pending"
        ? this.listToolCalls()
        : this.listToolCallPreviews({ limit: 1_000 });
    return toolCalls
      .flatMap((toolCall) =>
        toolCall.interactions.flatMap((interaction) => {
          if (
            interaction.kind !== "user_input" ||
            (interaction.status === "pending" &&
              !this.conversationJournal.isActionableToolInteraction(
                toolCall as ToolCallRecord,
                interaction.ordinal,
              ))
          )
            return [];
          const projected: UserQuestionRecord = {
            id: `question_${toolCall.id}_${interaction.ordinal}`,
            toolCallId: toolCall.id,
            agentId: toolCall.agentId,
            conversationId: toolCall.conversationId,
            projectId: toolCall.projectId,
            question: interaction.request.question,
            context: interaction.request.context,
            recommendation: interaction.request.recommendation,
            status:
              interaction.status === "pending"
                ? "pending"
                : interaction.resolution?.action === "answer"
                  ? "answered"
                  : "dismissed",
            answer:
              interaction.resolution?.action === "answer"
                ? interaction.resolution.answer
                : undefined,
            dismissedReason:
              interaction.resolution?.action === "dismiss"
                ? interaction.resolution.reason
                : undefined,
            requestedAt: interaction.requestedAt,
            resolvedAt: interaction.resolvedAt,
            updatedAt: interaction.updatedAt,
          };
          return [projected];
        }),
      )
      .filter((question) => status === undefined || question.status === status);
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
    const exceptions = this.permissionExceptions
      ? await this.permissionExceptions.effective(latestAgent.projectId)
      : this.storage.settings.permissions.exceptions;
    const rules = this.permissionExceptions
      ? await this.permissionExceptions.effectiveRules(latestAgent.projectId)
      : undefined;
    const evaluation = evaluateWorkbenchToolPermission(
      latestAgent,
      toolName,
      args,
      {
        dataDir: this.storage.paths.home,
        exceptions,
        rules,
      },
    );
    const decision =
      evaluation.decision === "allow" && options.forceApproval === true
        ? "approval"
        : evaluation.decision;
    const supervisionDecision = evaluation.supervision
      ? {
          ...evaluation.supervision,
          ...(decision === "approval" &&
          evaluation.supervision.decision === "allow"
            ? {
                decision: "prompt" as const,
                reason: "The tool group requires approval.",
              }
            : {}),
        }
      : undefined;
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
      status: "committed",
      phase: "drafted",
      supervision: supervisionDecision
        ? {
            status:
              decision === "allow"
                ? "approved"
                : decision === "deny"
                  ? "denied"
                  : "pending",
            source:
              decision === "allow"
                ? "automatic"
                : decision === "deny"
                  ? "policy"
                  : undefined,
            decision: supervisionDecision,
            decidedAt: decision === "approval" ? undefined : now,
          }
        : undefined,
      revision: 1,
      attempt: 0,
      interactions: [],
      hidden: options.hidden === true ? true : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.toolCallRepository.create(toolCall);
    await this.emitToolCallLifecycle(toolCall, options);
    await this.events.publish("policy.evaluated", {
      toolCallId: toolCall.id,
      agentId: agent.id,
      conversationId: agent.conversationId,
      projectId: agent.projectId,
      toolName,
      risk: evaluation.risk,
      decision,
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
        decision,
        reason: evaluation.reason,
      },
    });

    if (decision === "deny") {
      const denied = await this.updateToolCall(toolCall.id, {
        status: "denied",
        error: evaluation.reason,
      });
      await this.emitToolCallLifecycle(denied, options);
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

    if (decision === "approval") {
      const requestedAt = new Date().toISOString();
      const pending = await this.updateToolCall(toolCall.id, {
        status: "waiting",
        interactions: [
          {
            ordinal: 0,
            kind: "approval",
            status: "pending",
            requestedAt,
            updatedAt: requestedAt,
            request: {
              risk: evaluation.risk,
              reason: evaluation.reason,
              offeredScopes: evaluation.suggestedExceptions?.length
                ? ["single_call", "always_project", "always_user"]
                : ["single_call"],
              suggestedExceptions: evaluation.suggestedExceptions ?? [],
            },
          },
        ],
      });
      const approval = this.projectApproval(pending, 0);
      try {
        await this.emitToolCallLifecycle(pending, options);
      } catch (error) {
        const failedAt = new Date().toISOString();
        const failed = await this.updateToolCall(pending.id, {
          status: "failed",
          error: "Approval registration failed before the run could suspend.",
          interactions: pending.interactions.map((interaction) => ({
            ...interaction,
            status: "cancelled" as const,
            updatedAt: failedAt,
            cancelledAt: failedAt,
          })),
        });
        await this.emitToolCallLifecycle(failed, options).catch(
          () => undefined,
        );
        throw error;
      }
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
    if (response.toolCall.status !== "waiting") return response.toolCall;
    if (options.durableSuspend) return response.toolCall;
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
      status: "failed",
      revision: 1,
      attempt: 0,
      interactions: [],
      hidden: options.hidden === true ? true : undefined,
      error: errorMessage,
      errorDetails: {
        code: "INVALID_TOOL_ARGUMENTS",
        message: errorMessage,
      },
      result: {
        content: errorMessage,
        contentBlocks: [{ type: "text", text: errorMessage }],
      },
      createdAt: now,
      updatedAt: now,
      settledAt: now,
    };
    await this.toolCallRepository.create(toolCall);
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

  /** Terminalize every live tool call before its run becomes terminal. */
  async terminateNonTerminalToolCallsForRun(
    runId: string,
    errorMessage: string,
  ): Promise<ToolCallRecord[]> {
    if (!runId) return [];
    const stale = this.toolCallRepository
      .listActive()
      .filter(
        (toolCall) => toolCall.runId === runId && !isTerminalToolCall(toolCall),
      );
    return await Promise.all(
      stale.map(async (toolCall) => {
        const failed = await this.updateToolCall(
          toolCall.id,
          interruptedToolCallPatch(errorMessage),
        );
        await this.publishToolCallUpdated(failed);
        await this.logger?.warn("Tool call terminated after run ended", {
          toolCallId: failed.id,
          agentId: failed.agentId,
          conversationId: failed.conversationId,
          projectId: failed.projectId,
          runId: failed.runId,
          context: { toolName: failed.toolName },
        });
        return failed;
      }),
    );
  }

  private async reconcileInterruptedToolCallsOnStartup(): Promise<void> {
    const interrupted = this.toolCallRepository
      .listActive()
      .filter(
        (toolCall) =>
          toolCall.status === "committed" || toolCall.status === "running",
      );
    for (const toolCall of interrupted) {
      const failed = await this.updateToolCall(
        toolCall.id,
        interruptedToolCallPatch(HOST_RESTART_TOOL_ERROR),
      );
      await this.publishToolCallUpdated(failed);
    }
  }

  async decideApproval(
    approvalId: string,
    decision: "allow" | "deny",
    note?: string,
    resolutionRequestId?: string,
    scope?:
      | "single_call"
      | "same_tool_same_args"
      | "run"
      | "always"
      | "always_project"
      | "always_user",
  ): Promise<ApprovalRecord> {
    const approval = this.projectApprovals().find(
      (candidate) => candidate.id === approvalId,
    );
    if (!approval || approval.status !== "pending")
      throw new Error("Approval is not pending.");
    const current = this.getToolCall(approval.toolCallId);
    const ordinal = Number(approvalId.slice(approvalId.lastIndexOf("_") + 1));
    const resolvedAt = new Date().toISOString();
    const interactions = current.interactions.map((interaction) =>
      interaction.ordinal === ordinal && interaction.kind === "approval"
        ? {
            ...interaction,
            status: "resolved" as const,
            updatedAt: resolvedAt,
            resolvedAt,
            resolutionRequestId,
            resolution: { action: decision, note, scope },
          }
        : interaction,
    );
    const updated = await this.updateToolCall(current.id, {
      interactions,
      status: decision === "allow" ? "committed" : "denied",
      supervision: current.supervision
        ? {
            ...current.supervision,
            status: decision === "allow" ? "approved" : "denied",
            source: "user",
            decidedAt: resolvedAt,
          }
        : undefined,
      ...(decision === "deny" ? { error: note ?? "Denied by user." } : {}),
    });
    const decided = this.projectApproval(updated, ordinal);
    return decided;
  }

  async finalizeDecidedApproval(approvalId: string): Promise<ToolCallRecord> {
    const approval = this.projectApprovals().find(
      (candidate) => candidate.id === approvalId,
    );
    if (!approval) throw new Error("Approval not found.");
    const toolCall = this.getToolCall(approval.toolCallId);
    if (isTerminalToolCall(toolCall)) return toolCall;
    if (approval.status === "pending")
      throw new Error("Approval is still pending.");
    return this.executor.executeAllowedTool(toolCall.id);
  }

  async grantApproval(
    approvalId: string,
    note?: string,
  ): Promise<ToolCallRecord> {
    await this.decideApproval(approvalId, "allow", note);
    return this.finalizeDecidedApproval(approvalId);
  }

  async denyApproval(
    approvalId: string,
    note?: string,
  ): Promise<ToolCallRecord> {
    await this.decideApproval(approvalId, "deny", note);
    return this.finalizeDecidedApproval(approvalId);
  }

  async resolveInteraction(
    request: ResolveToolInteractionRequest,
  ): Promise<ToolCallRecord> {
    const current = this.getToolCall(request.toolCallId);
    const interaction = current.interactions[request.interactionOrdinal];
    if (!interaction || interaction.kind !== request.resolution.kind) {
      throw new Error("Tool interaction kind or ordinal does not match.");
    }
    if (interaction.status === "resolved") {
      if (interaction.resolutionRequestId === request.resolutionRequestId)
        return current;
      throw new Error("Tool interaction has already been resolved.");
    }
    if (current.revision !== request.expectedRevision) {
      throw new Error(
        `Tool call revision conflict: expected ${request.expectedRevision}, current ${current.revision}.`,
      );
    }
    const now = new Date().toISOString();
    const resolution = { ...request.resolution };
    delete (resolution as { kind?: string }).kind;
    const interactions = current.interactions.map((candidate) =>
      candidate.ordinal === request.interactionOrdinal
        ? ({
            ...candidate,
            status: "resolved" as const,
            updatedAt: now,
            resolvedAt: now,
            resolutionRequestId: request.resolutionRequestId,
            resolution,
          } as ToolInteraction)
        : candidate,
    );
    const denied =
      request.resolution.kind === "approval" &&
      request.resolution.action === "deny";
    const denialNote =
      request.resolution.kind === "approval"
        ? request.resolution.note
        : undefined;
    const next = await this.updateToolCall(current.id, {
      interactions,
      status: denied ? "denied" : "running",
      ...(denied ? { error: denialNote ?? "Denied by user." } : {}),
    });
    await this.publishToolCallUpdated(next);
    return next;
  }

  async answerUserQuestion(
    questionId: string,
    answer: string,
    resolutionRequestId?: string,
  ): Promise<UserQuestionRecord> {
    return this.interactionSessions.answerUserQuestion(
      questionId,
      answer,
      resolutionRequestId,
    );
  }

  async dismissUserQuestion(
    questionId: string,
    reason?: string,
    resolutionRequestId?: string,
  ): Promise<UserQuestionRecord> {
    return this.interactionSessions.dismissUserQuestion(
      questionId,
      reason,
      resolutionRequestId,
    );
  }

  userQuestionResult(question: UserQuestionRecord): Record<string, unknown> {
    return this.interactionSessions.userQuestionResult(question);
  }

  async resumeToolCall(toolCallId: string): Promise<ToolCallRecord> {
    const current = this.getToolCall(toolCallId);
    if (current.status !== "waiting") return current;
    const pending = current.interactions.find(
      (interaction) => interaction.status === "pending",
    );
    const now = new Date().toISOString();
    const interactions = pending
      ? current.interactions.map((interaction) =>
          interaction.ordinal === pending.ordinal
            ? resolvePendingForResume(interaction, now, this.plans)
            : interaction,
        )
      : current.interactions;
    const resumed = await this.updateToolCall(toolCallId, {
      status: "running",
      interactions,
    });
    await this.publishToolCallUpdated(resumed);
    return resumed;
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

  async getToolCallDetails(toolCallId: string): Promise<ToolCallRecord> {
    return await this.toolCallRepository.getCanonical(toolCallId);
  }

  async getToolCallUiDetails(toolCallId: string): Promise<ToolCallDetails> {
    return await this.toolCallRepository.getDetails(toolCallId);
  }

  toolResultPayloadPath(toolCall: ToolCallRecord): string | undefined {
    return toolCall.resultPayload
      ? this.resultPayloads.path(toolCall.resultPayload)
      : undefined;
  }

  async abandonPendingInteraction(
    toolCallId: string,
    reason: string,
  ): Promise<ToolCallRecord> {
    const toolCall = await this.getToolCallDetails(toolCallId);
    const now = new Date().toISOString();
    if (
      toolCall.status !== "waiting" ||
      !toolCall.interactions.some(
        (interaction) => interaction.status === "pending",
      )
    ) {
      return toolCall;
    }
    const failed = await this.updateToolCall(toolCallId, {
      status: "failed",
      error: reason,
      interactions: toolCall.interactions.map((interaction) =>
        interaction.status === "pending"
          ? {
              ...interaction,
              status: "cancelled" as const,
              updatedAt: now,
              cancelledAt: now,
            }
          : interaction,
      ),
    });
    await this.publishToolCallUpdated(failed).catch(() => undefined);
    return failed;
  }

  private async assertExecutionBoundary(
    toolCall: ToolCallRecord,
  ): Promise<void> {
    const agent = this.getAgent(toolCall.agentId);
    const exceptions = this.permissionExceptions
      ? await this.permissionExceptions.effective(agent.projectId)
      : this.storage.settings.permissions.exceptions;
    const rules = this.permissionExceptions
      ? await this.permissionExceptions.effectiveRules(agent.projectId)
      : undefined;
    const evaluation = evaluateWorkbenchToolPermission(
      agent,
      toolCall.toolName as ToolName,
      toolCall.args as Record<string, unknown>,
      { dataDir: this.storage.paths.home, exceptions, rules },
    );
    if (
      evaluation.decision === "deny" ||
      !evaluation.supervision ||
      evaluation.supervision.policySnapshotHash !==
        toolCall.supervision?.decision.policySnapshotHash ||
      JSON.stringify(evaluation.normalizedArgs) !==
        JSON.stringify(toolCall.args)
    ) {
      throw new Error(
        "Tool approval is stale or its execution target no longer satisfies policy.",
      );
    }
  }

  private async updateToolCall(
    toolCallId: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord> {
    const current = this.getToolCall(toolCallId);
    return this.updateToolCallAtRevision(toolCallId, current.revision, patch);
  }

  private async updateToolCallAtRevision(
    toolCallId: string,
    expectedRevision: number,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord> {
    const current = this.getToolCall(toolCallId);
    if (current.revision !== expectedRevision) {
      throw new Error(`Stale tool-call revision for ${toolCallId}.`);
    }
    if (patch.status && patch.status !== current.status) {
      assertTransition(
        toolCallTransitions,
        current.status,
        patch.status,
        `tool call ${toolCallId}`,
      );
    }
    const updatedAt = new Date().toISOString();
    const terminal =
      patch.status &&
      ["completed", "denied", "failed", "cancelled"].includes(patch.status);
    const next = await this.toolCallRepository.replace(
      toolCallId,
      expectedRevision,
      (record) => {
        const candidate: ToolCallRecord = {
          ...record,
          ...patch,
          ...(patch.status ? { phase: phaseForStatus(patch.status) } : {}),
          ...(patch.status === "running" && record.status !== "running"
            ? { attempt: record.attempt + 1 }
            : {}),
          ...(terminal ? { settledAt: updatedAt } : {}),
          ...(terminal && record.execution
            ? {
                execution: {
                  ...record.execution,
                  status:
                    patch.status === "completed"
                      ? ("completed" as const)
                      : patch.status === "cancelled"
                        ? ("cancelled" as const)
                        : patch.status === "failed" || patch.status === "denied"
                          ? ("failed" as const)
                          : ("interrupted" as const),
                  endedAt: updatedAt,
                },
              }
            : {}),
          updatedAt,
        };
        if (
          Object.hasOwn(patch, "result") &&
          !Object.hasOwn(patch, "resultPreview")
        ) {
          candidate.resultPreview = toToolCallTranscriptRecord({
            ...candidate,
            resultPreview: undefined,
          }).resultPreview;
        }
        return candidate;
      },
    );
    if (isTerminalToolCall(next)) this.notifyWaiters(next);
    return next;
  }

  /**
   * Emit one tool-call lifecycle update. When a run execution owns the tool
   * (an `onLifecycle` sink is provided) the RunCoordinator commits and
   * publishes the durable `toolCall.updated` event; publishing here as well
   * would duplicate it outside canonical run ordering. Non-run tool calls
   * (no sink) publish directly.
   */
  private async emitToolCallLifecycle(
    toolCall: ToolCallRecord,
    options: ToolRequestOptions,
  ): Promise<void> {
    if (options.onLifecycle) {
      await options.onLifecycle(toolCall);
      return;
    }
    await this.publishToolCallUpdated(toolCall);
  }

  private async publishToolCallUpdated(
    toolCall: ToolCallRecord,
  ): Promise<void> {
    const conversationRevision = (
      await this.conversationJournal.load(toolCall.conversationId)
    ).revision;
    await this.events.publish("toolCall.updated", {
      conversationId: toolCall.conversationId,
      conversationRevision,
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

  private notifyWaiters(toolCall: ToolCallRecord): void {
    const waiters = this.waiters.get(toolCall.id);
    if (!waiters) return;
    this.waiters.delete(toolCall.id);
    for (const waiter of waiters) waiter(toolCall);
  }
}

function resolvePendingForResume(
  interaction: ToolInteraction,
  now: string,
  plans: PlanService,
): ToolInteraction {
  if (interaction.status !== "pending") return interaction;
  if (interaction.kind === "approval") {
    return {
      ...interaction,
      status: "resolved",
      updatedAt: now,
      resolvedAt: now,
      resolution: { action: "allow" },
    };
  }
  if (interaction.kind === "user_input") {
    return {
      ...interaction,
      status: "resolved",
      updatedAt: now,
      resolvedAt: now,
      resolution: { action: "dismiss", reason: "Resumed without an answer." },
    };
  }
  const review = plans
    .listPlanReviews()
    .find((candidate) => candidate.planPath === interaction.request.planPath);
  const action =
    review?.status === "accepted"
      ? "accept"
      : review?.status === "accepted_in_new_chat"
        ? "accept_in_new_chat"
        : review?.status === "changes_requested"
          ? "request_changes"
          : "discard";
  return {
    ...interaction,
    status: "resolved",
    updatedAt: now,
    resolvedAt: now,
    resolution: { action, feedback: review?.feedback },
  };
}

function phaseForStatus(
  status: ToolCallRecord["status"],
): NonNullable<ToolCallRecord["phase"]> {
  switch (status) {
    case "committed":
    case "waiting":
      return "drafted";
    case "running":
      return "executing";
    case "completed":
      return "completed";
    case "denied":
      return "denied";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
  }
}

function interruptedToolCallPatch(errorMessage: string) {
  return {
    status: "failed" as const,
    error: errorMessage,
    errorDetails: {
      code: "interrupted",
      message: errorMessage,
    },
    result: {
      content: errorMessage,
      contentBlocks: [{ type: "text" as const, text: errorMessage }],
    },
  };
}

function isTerminalToolCall(toolCall: ToolCallRecord): boolean {
  return (
    toolCall.status === "completed" ||
    toolCall.status === "denied" ||
    toolCall.status === "failed"
  );
}
