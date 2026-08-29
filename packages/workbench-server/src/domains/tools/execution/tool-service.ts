/* eslint-disable max-lines -- Tool lifecycle orchestration remains centralized pending a follow-up service split. */
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  allToolDescriptors,
  type ExplainImageRequest,
  type ExplainImageResponse,
  toolRiskForName,
  type PermissionRootPaths,
} from "@nervekit/tools";
import { type AgentRecord } from "@nervekit/contracts/agents";
import {
  type ApprovalRecord,
  type ExploreReportSummaryPayload,
  type ResolveToolInteractionRequest,
  type ToolCallDetails,
  type ToolCallRecord,
  type ToolCallTranscriptRecord,
  type ToolInteraction,
  type ToolName,
  type UserQuestionRecord,
  type UserQuestionStatus,
} from "@nervekit/contracts/tools";
import {
  assertTransition,
  INTERRUPTED_TOOL_ERROR_CODE,
  isTerminalToolStatus,
  toolCallTransitions,
} from "@nervekit/contracts/events";
import { createId } from "@nervekit/contracts";
import { type Mode } from "@nervekit/contracts/settings";
import { type PermissionTarget } from "@nervekit/contracts/permissions";
import {
  type StartTaskRequest,
  type TaskRecord,
} from "@nervekit/contracts/tasks";
import { type ThinkingLevel } from "@nervekit/contracts/models";
import type {
  ConversationRuntime,
  ToolAnchor,
} from "../../runs/runtime/conversation-runtime.js";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { PerformanceDiagnosticsPort } from "../../../core/ports.js";
import type { PermissionExceptionService } from "../../permissions/permission-exceptions.service.js";
import type { PermissionPolicyService } from "../../permissions/permission-policy.service.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { RuntimeQueryCache } from "../../../infrastructure/persistence/query-cache/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import type { PlanService } from "../../plans/plan-service.js";
import type { PythonRuntimeService } from "./python-runtime.js";
import type { WorkbenchTaskService } from "../../tasks/adapters/workbench-task-service.js";
import {
  evaluateWorkbenchToolPermission,
  TodoStateService,
  ToolCallRepository,
} from "../index.js";
import { InteractionSessionService } from "../orchestration/interaction-session.service.js";
import { ConversationJournalRepository } from "../../conversations/conversation-journal.repository.js";
import { OrchestrationToolDispatcher } from "../orchestration/dispatcher.js";
import { toToolCallTranscriptRecord } from "../artifacts/tool-call-transcript-preview.js";
import { ToolExecutorService } from "./tool-executor.service.js";
import { prepareTerminalProjection } from "../artifacts/tool-result-preparation.js";
import { ToolResultPayloadStore } from "../artifacts/tool-result-payload-store.js";
import {
  toolTerminationPatch,
  type ToolTerminationOutcome,
} from "./tool-termination.js";

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
    reportBytes?: number;
    reportLines?: number;
    artifactId?: string;
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
        id?: string;
        role: "primary_result" | "supporting_data" | "overflow_recovery";
        path: string;
        format: {
          kind:
            | "markdown"
            | "text"
            | "json"
            | "jsonl"
            | "image"
            | "binary"
            | "directory_manifest";
          mediaType: string;
          encoding?: "utf-8";
        };
        bytes?: number;
        lines?: number;
        label: string;
        recommendedTools: Array<"read" | "grep" | "explain_image">;
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

async function assertWriteTargetBoundaries(
  targets: readonly PermissionTarget[],
  roots: PermissionRootPaths,
): Promise<void> {
  for (const target of targets) {
    if (
      target.kind !== "path" ||
      target.access !== "write" ||
      !("root" in target)
    )
      continue;
    const root = await realpath(roots[target.root]);
    const candidate = resolve(root, target.relativePath);
    let existing = candidate;
    for (;;) {
      try {
        existing = await realpath(existing);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = dirname(existing);
        if (parent === existing) throw error;
        existing = parent;
      }
    }
    const child = relative(root, existing);
    if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error(
        `Write target escapes the authorized ${target.root} root through a symbolic link.`,
      );
    }
  }
}

function durableApprovalScopes(
  scopes: readonly string[],
): Array<
  "single_call" | "always_conversation" | "always_project" | "always_user"
> {
  const mapped = scopes.map((scope) =>
    scope === "always" ? "always_user" : scope,
  );
  return [...new Set(mapped)].filter(
    (
      scope,
    ): scope is
      | "single_call"
      | "always_conversation"
      | "always_project"
      | "always_user" =>
      scope === "single_call" ||
      scope === "always_conversation" ||
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
    queryCache: RuntimeQueryCache,
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
    private readonly performanceDiagnostics?: PerformanceDiagnosticsPort,
    private readonly permissionPolicy?: PermissionPolicyService,
  ) {
    this.conversationJournal =
      journal ?? new ConversationJournalRepository(storage);
    this.resultPayloads =
      resultPayloads ?? new ToolResultPayloadStore(storage.paths.home);
    this.toolCallRepository = new ToolCallRepository(
      this.conversationJournal,
      queryCache,
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
      diagnostics: this.performanceDiagnostics,
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
      suggestedRules: interaction.request.suggestedRules,
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
    const resolvedPolicy = await this.permissionPolicy?.resolve(latestAgent);
    const exceptions = resolvedPolicy
      ? []
      : this.permissionExceptions
        ? await this.permissionExceptions.effective(latestAgent.projectId)
        : this.storage.settings.permissions.exceptions;
    const rules = resolvedPolicy
      ? undefined
      : this.permissionExceptions
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
        policy: resolvedPolicy?.policy,
        roots: resolvedPolicy?.roots,
        policyDiagnostic: resolvedPolicy?.diagnostics.at(-1),
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
      permissionEvaluation: evaluation.permissionEvaluation,
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
        ...denialProjection(toolCall, evaluation.reason, "policy"),
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
              offeredScopes: evaluation.permissionEvaluation?.suggestedRules
                .length
                ? [
                    "single_call",
                    "always_conversation",
                    "always_project",
                    "always_user",
                  ]
                : evaluation.suggestedExceptions?.length
                  ? ["single_call", "always_project", "always_user"]
                  : ["single_call"],
              suggestedExceptions: evaluation.suggestedExceptions ?? [],
              suggestedRules:
                evaluation.permissionEvaluation?.suggestedRules ?? [],
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
    outcome: ToolTerminationOutcome,
  ): Promise<ToolCallRecord[]> {
    if (!runId) return [];
    const stale = this.toolCallRepository
      .listActive()
      .filter(
        (toolCall) => toolCall.runId === runId && !isTerminalToolCall(toolCall),
      );
    return await Promise.all(
      stale.map(async (toolCall) => {
        const settlement = await this.settleToolCallTermination(toolCall.id, {
          ...toolTerminationPatch(toolCall, outcome),
          interactions: cancelPendingInteractions(toolCall.interactions),
        });
        if (settlement.owned) {
          await this.publishToolCallUpdated(settlement.record);
          await this.logger?.warn("Tool call terminated after run ended", {
            toolCallId: settlement.record.id,
            agentId: settlement.record.agentId,
            conversationId: settlement.record.conversationId,
            projectId: settlement.record.projectId,
            runId: settlement.record.runId,
            context: {
              toolName: settlement.record.toolName,
              outcome: settlement.record.status,
            },
          });
        }
        return settlement.record;
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
        toolTerminationPatch(toolCall, {
          status: "failed",
          code: INTERRUPTED_TOOL_ERROR_CODE,
          message: HOST_RESTART_TOOL_ERROR,
        }),
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
      | "always_conversation"
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
      ...(decision === "deny"
        ? {
            error: note ?? "Denied by user.",
            ...denialProjection(current, note ?? "Denied by user.", "user"),
          }
        : {}),
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
      ...(denied
        ? {
            error: denialNote ?? "Denied by user.",
            supervision: current.supervision
              ? {
                  ...current.supervision,
                  status: "denied" as const,
                  source: "user" as const,
                  decidedAt: now,
                }
              : undefined,
            ...denialProjection(
              current,
              denialNote ?? "Denied by user.",
              "user",
            ),
          }
        : {}),
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

  async readToolCallResult(
    toolCallId: string,
    byteOffset: number,
    byteLimit: number,
  ) {
    return await this.toolCallRepository.readResult(
      toolCallId,
      byteOffset,
      byteLimit,
    );
  }

  toolResultRecoveryArtifact(toolCall: ToolCallRecord) {
    return toolCall.resultPayload
      ? this.resultPayloads.recoveryArtifact(toolCall.resultPayload)
      : undefined;
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
    const resolvedPolicy = await this.permissionPolicy?.resolve(agent);
    const exceptions = resolvedPolicy
      ? []
      : this.permissionExceptions
        ? await this.permissionExceptions.effective(agent.projectId)
        : this.storage.settings.permissions.exceptions;
    const rules = resolvedPolicy
      ? undefined
      : this.permissionExceptions
        ? await this.permissionExceptions.effectiveRules(agent.projectId)
        : undefined;
    const evaluation = evaluateWorkbenchToolPermission(
      agent,
      toolCall.toolName as ToolName,
      toolCall.args as Record<string, unknown>,
      {
        dataDir: this.storage.paths.home,
        exceptions,
        rules,
        policy: resolvedPolicy?.policy,
        roots: resolvedPolicy?.roots,
        policyDiagnostic: resolvedPolicy?.diagnostics.at(-1),
      },
    );
    if (evaluation.permissionEvaluation && resolvedPolicy) {
      await assertWriteTargetBoundaries(
        evaluation.permissionEvaluation.normalizedTargets,
        resolvedPolicy.roots,
      );
    }
    if (
      evaluation.decision === "deny" ||
      !evaluation.supervision ||
      (toolCall.supervision?.source !== "user" &&
        evaluation.supervision.policySnapshotHash !==
          toolCall.supervision?.decision.policySnapshotHash) ||
      JSON.stringify(evaluation.normalizedArgs) !==
        JSON.stringify(toolCall.args)
    ) {
      throw new Error(
        "Tool approval is stale or its execution target no longer satisfies policy.",
      );
    }
  }

  private async settleToolCallTermination(
    toolCallId: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<{ record: ToolCallRecord; owned: boolean }> {
    try {
      return {
        record: await this.updateToolCall(toolCallId, patch),
        owned: true,
      };
    } catch (error) {
      const current = this.getToolCall(toolCallId);
      if (isTerminalToolStatus(current.status)) {
        return { record: current, owned: false };
      }
      throw error;
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

function denialProjection(
  toolCall: ToolCallRecord,
  error: string,
  denialSource: "user" | "policy",
) {
  return prepareTerminalProjection(undefined, {
    toolName: toolCall.toolName,
    args: toolCall.args,
    status: "denied",
    phase: "denied",
    error,
    denialSource,
  });
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

function cancelPendingInteractions(
  interactions: ToolCallRecord["interactions"],
): ToolCallRecord["interactions"] {
  const cancelledAt = new Date().toISOString();
  return interactions.map((interaction) =>
    interaction.status === "pending"
      ? {
          ...interaction,
          status: "cancelled" as const,
          updatedAt: cancelledAt,
          cancelledAt,
        }
      : interaction,
  );
}

function isTerminalToolCall(toolCall: ToolCallRecord): boolean {
  return isTerminalToolStatus(toolCall.status);
}
