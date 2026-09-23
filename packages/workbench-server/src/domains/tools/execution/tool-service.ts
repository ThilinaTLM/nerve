import type { SubagentToolPort } from "@nervekit/tools/runtime";
import { isDeveloperChildToolAllowed } from "@nervekit/contracts/agents";
import {
  projectApproval,
  projectApprovals,
  projectQuestions,
} from "../orchestration/tool-interaction-projection.js";
import { reconcileToolResultPayloads } from "../artifacts/tool-result-reconciliation.js";
import { reconcileInterruptedToolCalls } from "./tool-call-recovery.js";
import { randomUUID } from "node:crypto";
import { requireToolDefinition } from "@nervekit/tools/catalog";
import { ApplicationError } from "../../../core/application-error.js";
import {
  PreDispatchError,
  ToolExecutionAlreadyClaimedError,
} from "./tool-execution-claim.js";
/* eslint-disable max-lines -- Durable transitions and lifecycle-local execution wiring retain one coordinator; projections and maintenance have separate owners. */
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { allToolDescriptors, toolRiskForName } from "@nervekit/tools/catalog";
import {
  type ExplainImageRequest,
  type ExplainImageResponse,
  type ImageGenerateRequest,
  type ImageGenerateResponse,
} from "@nervekit/tools/execution";
import { type PermissionRootPaths } from "@nervekit/tools/policy";
import { type AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationJournalEvent } from "@nervekit/contracts/conversations";
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
import type { PerformanceDiagnosticsPort } from "../../../core/ports/diagnostics.js";
import type { PermissionExceptionService } from "../../permissions/permission-exceptions.service.js";
import type { PermissionPolicyService } from "../../permissions/permission-policy.service.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import type { PlanService } from "../../plans/plan-service.js";
import type { PythonRuntimeService } from "./python-runtime.js";
import type { WorkbenchTaskService } from "../../tasks/adapters/workbench-task-service.js";
import { evaluateWorkbenchToolPermission } from "../permission/index.js";
import { TodoStateService } from "../orchestration/todo-state.service.js";
import type { ToolCallRepository } from "../artifacts/tool-call.repository.js";
import { InteractionSessionService } from "../orchestration/interaction-session.service.js";
import type { ConversationJournalRepository } from "../../conversations/conversation-journal.repository.js";
import { OrchestrationToolDispatcher } from "../orchestration/dispatcher.js";
import { toToolCallTranscriptRecord } from "../artifacts/tool-call-transcript-preview.js";
import { ToolExecutorService } from "./tool-executor.service.js";
import { prepareTerminalProjection } from "../artifacts/tool-result-preparation.js";
import type { ToolResultPayloadStore } from "../artifacts/tool-result-payload-store.js";
import {
  toolTerminationPatch,
  type ToolTerminationOutcome,
} from "./tool-termination.js";

type ToolCallPatch = Partial<Omit<ToolCallRecord, "id" | "createdAt">>;

type ApprovalScope = NonNullable<
  Extract<
    ResolveToolInteractionRequest["resolution"],
    { kind: "approval" }
  >["scope"]
>;

/** Internal signal: the same request already recorded this decision. */
class ApprovalDecisionReplay extends Error {
  constructor(readonly toolCall: ToolCallRecord) {
    super("Approval decision replay");
  }
}

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

export interface ToolServiceDependencies {
  readonly storage: InitializedStorage;
  readonly events: StreamLogRegistry;
  readonly tasks: WorkbenchTaskService;
  readonly pythonRuntime: PythonRuntimeService;
  readonly startTask: TaskStarter;
  readonly getAgent: (agentId: string) => AgentRecord;
  /** Invoked only during execution, after host composition has completed. */
  readonly runExplore: ExploreRunner;
  readonly subagents?: SubagentToolPort;
  readonly getApiKey: (provider: string) => Promise<string | undefined>;
  readonly explainImage: (
    request: ExplainImageRequest,
  ) => Promise<ExplainImageResponse>;
  readonly generateImage: (
    request: ImageGenerateRequest,
  ) => Promise<ImageGenerateResponse>;
  readonly plans: PlanService;
  readonly setAgentMode: (
    agentId: string,
    mode: Mode,
    reason: string,
  ) => Promise<AgentRecord>;
  readonly conversationRuntime: ConversationRuntime;
  readonly logger?: ApplicationLogger;
  readonly permissionExceptions?: PermissionExceptionService;
  readonly journal: ConversationJournalRepository;
  readonly resultPayloads: ToolResultPayloadStore;
  readonly performanceDiagnostics?: PerformanceDiagnosticsPort;
  readonly permissionPolicy?: PermissionPolicyService;
  readonly toolCallRepository: ToolCallRepository;
}

export class ToolService {
  private readonly todoState = new TodoStateService();
  private readonly interactionSessions: InteractionSessionService;
  private readonly dispatcher: OrchestrationToolDispatcher;
  private readonly executor: ToolExecutorService;

  readonly resultPayloads: ToolResultPayloadStore;
  private readonly waiters = new Map<
    string,
    Set<(toolCall: ToolCallRecord) => void>
  >();

  constructor(private readonly dependencies: ToolServiceDependencies) {
    this.resultPayloads = dependencies.resultPayloads;
    this.interactionSessions = new InteractionSessionService({
      events: this.dependencies.events,
      getToolCall: (id) => this.getToolCall(id),
      listToolCalls: () => this.listToolCalls(),
      updateToolCall: (id, patch, commit) =>
        this.updateToolCall(id, patch, commit),
      publishToolCallUpdated: (toolCall) =>
        this.publishToolCallUpdated(toolCall),
    });
    this.dispatcher = new OrchestrationToolDispatcher({
      storage: this.dependencies.storage,
      events: this.dependencies.events,
      tasks: this.dependencies.tasks,
      pythonRuntime: this.dependencies.pythonRuntime,
      startTask: this.dependencies.startTask,
      getAgent: this.dependencies.getAgent,
      runExplore: this.dependencies.runExplore,
      subagents: this.dependencies.subagents,
      getApiKey: this.dependencies.getApiKey,
      explainImage: this.dependencies.explainImage,
      generateImage: this.dependencies.generateImage,
      plans: this.dependencies.plans,
      setAgentMode: this.dependencies.setAgentMode,
      conversationRuntime: this.dependencies.conversationRuntime,
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
      payloads: this.resultPayloads,
      logger: this.dependencies.logger,
      diagnostics: this.dependencies.performanceDiagnostics,
    });
  }

  async hydrate(): Promise<void> {
    await this.resultPayloads.initialize();
    this.dependencies.plans.resetToolCallHydration();
    this.todoState.resetToolCallHydration();
    await this.dependencies.toolCallRepository.hydrate((toolCall) => {
      this.dependencies.plans.hydrateFromToolCall(toolCall);
      this.todoState.hydrateFromToolCall(toolCall);
    });
    await reconcileInterruptedToolCalls(
      this.dependencies.toolCallRepository.listActive(),
      (id, patch) => this.updateToolCall(id, patch),
      (record) => this.publishToolCallUpdated(record),
    );
  }

  async reconcileResultPayloads(): Promise<void> {
    await reconcileToolResultPayloads(
      this.dependencies.journal,
      this.resultPayloads,
    );
  }

  listTools() {
    return allToolDescriptors;
  }

  listToolCalls(): ToolCallRecord[] {
    return this.dependencies.toolCallRepository.listActive();
  }

  async listToolCallPreviews(
    query: Parameters<ToolCallRepository["listPreviews"]>[0] = {},
  ): Promise<ToolCallTranscriptRecord[]> {
    return this.dependencies.toolCallRepository.listPreviews(query);
  }

  queryToolCallPreviews(
    query: Parameters<ToolCallRepository["queryPreviews"]>[0] = {},
  ): ReturnType<ToolCallRepository["queryPreviews"]> {
    return this.dependencies.toolCallRepository.queryPreviews(query);
  }

  countToolCalls(): number {
    return this.dependencies.toolCallRepository.count();
  }

  /** Whether the tool-call records were loaded from the persisted snapshot. */
  get toolCallHydrationSource(): "canonical_projection" {
    return this.dependencies.toolCallRepository.hydrationSource;
  }

  listApprovals(status?: ApprovalRecord["status"]): ApprovalRecord[] {
    return projectApprovals(
      status === "pending"
        ? this.listToolCalls()
        : this.dependencies.toolCallRepository.listInteractionRecords(),
      (record, ordinal) =>
        this.dependencies.journal.isActionableToolInteraction(
          record as ToolCallRecord,
          ordinal,
        ),
      status,
    );
  }

  listUserQuestions(status?: UserQuestionStatus): UserQuestionRecord[] {
    return projectQuestions(
      status === "pending"
        ? this.listToolCalls()
        : this.dependencies.toolCallRepository.listInteractionRecords(),
      (record, ordinal) =>
        this.dependencies.journal.isActionableToolInteraction(
          record as ToolCallRecord,
          ordinal,
        ),
      status,
    );
  }

  async removeRecordsForConversations(
    conversationIds: Iterable<string>,
    agentIds: Iterable<string> = [],
  ): Promise<void> {
    const conversations = new Set(conversationIds);
    if (conversations.size === 0) return;
    const agents = new Set(agentIds);
    for (const toolCall of this.dependencies.toolCallRepository.records.values()) {
      if (conversations.has(toolCall.conversationId))
        agents.add(toolCall.agentId);
    }
    await this.dependencies.toolCallRepository.removeForConversations(
      conversations,
    );
    for (const agentId of agents) this.todoState.delete(agentId);
  }

  async requestTool(
    agent: AgentRecord,
    toolName: ToolName,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<ToolExecutionResponse> {
    const now = new Date().toISOString();
    const latestAgent = this.dependencies.getAgent(agent.id);
    const resolvedPolicy =
      await this.dependencies.permissionPolicy?.resolve(latestAgent);
    const exceptions = resolvedPolicy
      ? []
      : this.dependencies.permissionExceptions
        ? await this.dependencies.permissionExceptions.effective(
            latestAgent.projectId,
          )
        : this.dependencies.storage.settings.permissions.exceptions;
    const rules = resolvedPolicy
      ? undefined
      : this.dependencies.permissionExceptions
        ? await this.dependencies.permissionExceptions.effectiveRules(
            latestAgent.projectId,
          )
        : undefined;
    const evaluation = evaluateWorkbenchToolPermission(
      latestAgent,
      toolName,
      args,
      {
        dataDir: this.dependencies.storage.paths.home,
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
    await this.dependencies.toolCallRepository.create(toolCall);
    await this.emitToolCallLifecycle(toolCall, options);
    await this.dependencies.events.publish("policy.evaluated", {
      toolCallId: toolCall.id,
      agentId: agent.id,
      conversationId: agent.conversationId,
      projectId: agent.projectId,
      toolName,
      risk: evaluation.risk,
      decision,
      reason: evaluation.reason,
    });
    await this.dependencies.logger?.info("Tool policy evaluated", {
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
      await this.dependencies.logger?.warn("Tool denied by policy", {
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
              permissionRuleSetId:
                evaluation.permissionEvaluation?.selectedRuleSetId,
            },
          },
        ],
      });
      const approval = projectApproval(pending, 0);
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
      await this.dependencies.logger?.info("Tool approval requested", {
        toolCallId: pending.id,
        agentId: pending.agentId,
        conversationId: pending.conversationId,
        projectId: pending.projectId,
        runId: pending.runId,
        context: { toolName: pending.toolName, risk: pending.risk },
      });
      return { toolCall: pending, approval };
    }

    const claimed = await this.claimApprovedExecution(toolCall.id);
    return { toolCall: await this.executor.executeClaimed(claimed, options) };
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
    return this.dependencies.toolCallRepository.findByProviderToolCallId(
      providerToolCallId,
    );
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
    const latestAgent = this.dependencies.getAgent(agent.id);
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
    await this.dependencies.toolCallRepository.create(toolCall);
    await this.publishToolCallUpdated(toolCall);
    await this.dependencies.logger?.warn("Tool call failed before execution", {
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
    const stale = this.dependencies.toolCallRepository
      .listActive()
      .filter(
        (toolCall) => toolCall.runId === runId && !isTerminalToolCall(toolCall),
      );
    return await Promise.all(
      stale.map(async (toolCall) => {
        const settlement = await this.settleToolCallTermination(
          toolCall.id,
          outcome,
        );
        if (settlement.owned) {
          await this.publishToolCallUpdated(settlement.record);
          await this.dependencies.logger?.warn(
            "Tool call terminated after run ended",
            {
              toolCallId: settlement.record.id,
              agentId: settlement.record.agentId,
              conversationId: settlement.record.conversationId,
              projectId: settlement.record.projectId,
              runId: settlement.record.runId,
              context: {
                toolName: settlement.record.toolName,
                outcome: settlement.record.status,
              },
            },
          );
        }
        return settlement.record;
      }),
    );
  }

  /**
   * Projects one approval decision onto its tool record. Pending-state and
   * idempotency checks run inside the tool-record lock, never against a cached
   * approval list. `commit` persists the authoritative decision (run transition
   * or lifecycle command) atomically with this projection.
   */
  async projectApprovalDecision(
    input: {
      toolCallId: string;
      ordinal: number;
      /** The revision the decider observed; checked inside the lock. */
      expectedRevision?: number;
      decision: "allow" | "deny";
      note?: string;
      scope?: ApprovalScope;
      resolutionRequestId: string;
    },
    commit: (
      next: ToolCallRecord,
      events: ConversationJournalEvent[],
    ) => Promise<void>,
  ): Promise<{ toolCall: ToolCallRecord; replayed: boolean }> {
    const resolvedAt = new Date().toISOString();
    // A resolved interaction never changes again, and a denied record is
    // terminal (immutable), so answer replays and conflicts from the record
    // before entering the revision path. Pending state is rechecked in-lock.
    const settled = async () => {
      const toolCall = await this.getToolCallDetails(input.toolCallId);
      const interaction = toolCall.interactions[input.ordinal];
      if (
        interaction?.kind !== "approval" ||
        interaction.status === "pending"
      ) {
        return undefined;
      }
      if (
        interaction.status === "resolved" &&
        interaction.resolutionRequestId === input.resolutionRequestId &&
        interaction.resolution?.action === input.decision
      ) {
        return { toolCall, replayed: true };
      }
      throw new ApplicationError(
        409,
        "APPROVAL_ALREADY_RESOLVED",
        "Approval was already resolved by another request.",
      );
    };
    const early = await settled();
    if (early) return early;
    try {
      const toolCall = await this.reviseToolCall(
        input.toolCallId,
        undefined,
        (current) => {
          const interaction = current.interactions.find(
            (candidate) =>
              candidate.ordinal === input.ordinal &&
              candidate.kind === "approval",
          );
          if (!interaction) {
            throw new ApplicationError(
              404,
              "APPROVAL_NOT_FOUND",
              "Approval was not found.",
            );
          }
          if (interaction.status !== "pending") {
            if (
              interaction.status === "resolved" &&
              interaction.resolutionRequestId === input.resolutionRequestId &&
              interaction.resolution?.action === input.decision
            ) {
              throw new ApprovalDecisionReplay(current);
            }
            throw new ApplicationError(
              409,
              "APPROVAL_ALREADY_RESOLVED",
              "Approval was already resolved by another request.",
            );
          }
          if (
            input.expectedRevision !== undefined &&
            current.revision !== input.expectedRevision
          ) {
            throw new ApplicationError(
              409,
              "TOOL_CALL_REVISION_CONFLICT",
              "The tool call changed before this interaction was resolved.",
            );
          }
          const interactions = current.interactions.map((candidate) =>
            candidate === interaction
              ? {
                  ...candidate,
                  status: "resolved" as const,
                  updatedAt: resolvedAt,
                  resolvedAt,
                  resolutionRequestId: input.resolutionRequestId,
                  resolution: {
                    action: input.decision,
                    note: input.note,
                    scope: input.scope,
                  },
                }
              : candidate,
          );
          const denial = input.note ?? "Denied by user.";
          return {
            interactions,
            status: input.decision === "allow" ? "committed" : "denied",
            supervision: current.supervision
              ? {
                  ...current.supervision,
                  status: input.decision === "allow" ? "approved" : "denied",
                  source: "user",
                  decidedAt: resolvedAt,
                }
              : undefined,
            ...(input.decision === "deny"
              ? {
                  error: denial,
                  ...denialProjection(current, denial, "user"),
                }
              : {}),
          } as ToolCallPatch;
        },
        commit,
      );
      return { toolCall, replayed: false };
    } catch (error) {
      if (error instanceof ApprovalDecisionReplay) {
        return { toolCall: error.toolCall, replayed: true };
      }
      // A concurrent decision may have made the record terminal meanwhile.
      const late = await settled();
      if (late) return late;
      throw error;
    }
  }

  /**
   * Acquires the durable execution claim for an approved draft. Approval
   * status, the current revision, policy boundary, and the caller's context
   * check are all read inside the tool-record lock, after every preceding
   * committed revision is observed. The returned `running` record is the
   * dispatch boundary; no external effect has started before it exists.
   */
  async claimApprovedExecution(
    toolCallId: string,
    check?: (current: ToolCallRecord) => Promise<void>,
  ): Promise<ToolCallRecord> {
    return this.reviseToolCall(toolCallId, undefined, async (current) => {
      if (current.status === "running" || isTerminalToolCall(current)) {
        throw new ToolExecutionAlreadyClaimedError(current);
      }
      if (
        current.status !== "committed" ||
        current.phase !== "drafted" ||
        current.supervision?.status !== "approved"
      ) {
        throw new PreDispatchError(
          "not_approved",
          "Tool execution requires a durably approved draft.",
        );
      }
      await check?.(current);
      try {
        await this.assertExecutionBoundary(current);
      } catch (error) {
        throw new PreDispatchError(
          "policy_changed",
          error instanceof Error ? error.message : String(error),
        );
      }
      return {
        status: "running",
        phase: "executing",
        execution: {
          kind: requireToolDefinition(current.toolName).executionKind,
          status: "running",
          executionId: `exec_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        },
      };
    });
  }

  /** Runs an already claimed tool outside every storage lock. */
  executeClaimed(
    toolCall: ToolCallRecord,
    options: ToolRequestOptions = {},
  ): Promise<ToolCallRecord> {
    return this.executor.executeClaimed(toolCall, options);
  }

  /**
   * Terminally settles a not-yet-dispatched approved tool. The error records
   * that no invocation started, so it is never mistaken for an unknown outcome.
   */
  async settleBeforeDispatch(
    toolCallId: string,
    status: "failed" | "cancelled",
    message: string,
  ): Promise<ToolCallRecord> {
    try {
      const settled = await this.reviseToolCall(
        toolCallId,
        undefined,
        (current) => {
          if (current.status !== "committed") {
            throw new ToolExecutionAlreadyClaimedError(current);
          }
          return {
            status,
            error: message,
            errorDetails: {
              code: "TOOL_NOT_DISPATCHED",
              message,
              details: { phase: "pre_dispatch" },
            },
          };
        },
      );
      await this.publishToolCallUpdatedSafely(
        settled,
        "settle_before_dispatch",
      );
      return settled;
    } catch (error) {
      if (error instanceof ToolExecutionAlreadyClaimedError) {
        return error.toolCall;
      }
      throw error;
    }
  }

  /**
   * Terminally settles a possibly dispatched tool whose outcome was never
   * proven, after an explicit recovery decision. The message states that the
   * effect may have happened; nothing is executed again.
   */
  async settleUnknownOutcome(
    toolCallId: string,
    message: string,
  ): Promise<ToolCallRecord> {
    const current = await this.getToolCallDetails(toolCallId);
    if (isTerminalToolCall(current)) return current;
    const settled = await this.updateToolCall(toolCallId, {
      status: "failed",
      error: message,
      errorDetails: {
        code: "TOOL_OUTCOME_UNKNOWN",
        message,
        details: { phase: "post_dispatch" },
      },
    });
    await this.publishToolCallUpdatedSafely(settled, "settle_unknown_outcome");
    return settled;
  }

  private async publishToolCallUpdatedSafely(
    toolCall: ToolCallRecord,
    operation: string,
  ): Promise<void> {
    await this.publishToolCallUpdated(toolCall).catch(
      async (error: unknown) => {
        await this.dependencies.logger
          ?.warn("Tool call update publication failed", {
            toolCallId: toolCall.id,
            context: {
              operation,
              failureType: error instanceof Error ? error.name : typeof error,
            },
          })
          .catch(() => undefined);
      },
    );
  }

  async resolveInteraction(
    request: ResolveToolInteractionRequest,
    commit?: (
      next: ToolCallRecord,
      events: ConversationJournalEvent[],
    ) => Promise<void>,
  ): Promise<ToolCallRecord> {
    if (request.resolution.kind === "approval") {
      // Approvals have one authority: ApprovalCheckpointService, which records
      // the decision durably and releases execution as lifecycle work.
      throw new Error("Approval decisions must use projectApprovalDecision.");
    }
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
    const next = await this.updateToolCall(
      current.id,
      { interactions, status: "running" },
      commit,
    );
    await this.publishToolCallUpdated(next);
    return next;
  }

  async answerUserQuestion(
    questionId: string,
    answer: string,
    resolutionRequestId?: string,
    commit?: (
      next: ToolCallRecord,
      events: ConversationJournalEvent[],
    ) => Promise<void>,
  ): Promise<UserQuestionRecord> {
    return this.interactionSessions.answerUserQuestion(
      questionId,
      answer,
      resolutionRequestId,
      commit,
    );
  }

  async dismissUserQuestion(
    questionId: string,
    reason?: string,
    resolutionRequestId?: string,
    commit?: (
      next: ToolCallRecord,
      events: ConversationJournalEvent[],
    ) => Promise<void>,
  ): Promise<UserQuestionRecord> {
    return this.interactionSessions.dismissUserQuestion(
      questionId,
      reason,
      resolutionRequestId,
      commit,
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
            ? resolvePendingForResume(interaction, now, this.dependencies.plans)
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
    return this.dependencies.toolCallRepository.get(toolCallId);
  }

  async getToolCallDetails(toolCallId: string): Promise<ToolCallRecord> {
    return await this.dependencies.toolCallRepository.getCanonical(toolCallId);
  }

  async getToolCallUiDetails(toolCallId: string): Promise<ToolCallDetails> {
    return await this.dependencies.toolCallRepository.getDetails(toolCallId);
  }

  async readToolCallResult(
    toolCallId: string,
    byteOffset: number,
    byteLimit: number,
  ) {
    return await this.dependencies.toolCallRepository.readResult(
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
    await this.publishToolCallUpdated(failed).catch(async (error: unknown) => {
      await this.dependencies.logger
        ?.warn("Tool call update publication failed", {
          toolCallId: failed.id,
          context: {
            operation: "abandon_pending_interaction",
            failureType: error instanceof Error ? error.name : typeof error,
          },
        })
        .catch(() => undefined);
    });
    return failed;
  }

  private async assertExecutionBoundary(
    toolCall: ToolCallRecord,
  ): Promise<void> {
    const agent = this.dependencies.getAgent(toolCall.agentId);
    if (
      agent.executionKind === "async_developer" &&
      !isDeveloperChildToolAllowed(toolCall.toolName)
    ) {
      throw new Error(
        "Tool is unavailable for autonomous developer teammates.",
      );
    }
    const resolvedPolicy =
      await this.dependencies.permissionPolicy?.resolve(agent);
    const exceptions = resolvedPolicy
      ? []
      : this.dependencies.permissionExceptions
        ? await this.dependencies.permissionExceptions.effective(
            agent.projectId,
          )
        : this.dependencies.storage.settings.permissions.exceptions;
    const rules = resolvedPolicy
      ? undefined
      : this.dependencies.permissionExceptions
        ? await this.dependencies.permissionExceptions.effectiveRules(
            agent.projectId,
          )
        : undefined;
    const evaluation = evaluateWorkbenchToolPermission(
      agent,
      toolCall.toolName as ToolName,
      toolCall.args as Record<string, unknown>,
      {
        dataDir: this.dependencies.storage.paths.home,
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
    outcome: ToolTerminationOutcome,
  ): Promise<{ record: ToolCallRecord; owned: boolean }> {
    try {
      return {
        record: await this.reviseToolCall(toolCallId, undefined, (current) => {
          if (isTerminalToolStatus(current.status)) {
            throw new ToolExecutionAlreadyClaimedError(current);
          }
          return {
            ...toolTerminationPatch(current, outcome),
            interactions: cancelPendingInteractions(current.interactions),
          };
        }),
        owned: true,
      };
    } catch (error) {
      if (error instanceof ToolExecutionAlreadyClaimedError) {
        return { record: error.toolCall, owned: false };
      }
      throw error;
    }
  }

  private async updateToolCall(
    toolCallId: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
    commit?: (
      next: ToolCallRecord,
      events: ConversationJournalEvent[],
    ) => Promise<void>,
  ): Promise<ToolCallRecord> {
    const current = this.getToolCall(toolCallId);
    return this.updateToolCallAtRevision(
      toolCallId,
      current.revision,
      patch,
      commit,
    );
  }

  private async updateToolCallAtRevision(
    toolCallId: string,
    expectedRevision: number,
    patch: ToolCallPatch,
    commit?: (
      next: ToolCallRecord,
      events: ConversationJournalEvent[],
    ) => Promise<void>,
  ): Promise<ToolCallRecord> {
    const current = this.getToolCall(toolCallId);
    if (current.revision !== expectedRevision) {
      throw new Error(`Stale tool-call revision for ${toolCallId}.`);
    }
    return this.reviseToolCall(
      toolCallId,
      expectedRevision,
      () => patch,
      commit,
    );
  }

  /**
   * Applies a patch computed from the current record inside the tool-record
   * lock. `patchFor` may throw to abort without writing.
   */
  private async reviseToolCall(
    toolCallId: string,
    expectedRevision: number | undefined,
    patchFor: (
      current: ToolCallRecord,
    ) => ToolCallPatch | Promise<ToolCallPatch>,
    commit?: (
      next: ToolCallRecord,
      events: ConversationJournalEvent[],
    ) => Promise<void>,
  ): Promise<ToolCallRecord> {
    const updatedAt = new Date().toISOString();
    const mutate = async (record: ToolCallRecord): Promise<ToolCallRecord> => {
      const patch = await patchFor(record);
      if (patch.status && patch.status !== record.status) {
        assertTransition(
          toolCallTransitions,
          record.status,
          patch.status,
          `tool call ${toolCallId}`,
        );
      }
      const terminal =
        patch.status &&
        ["completed", "denied", "failed", "cancelled"].includes(patch.status);
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
    };
    const next = commit
      ? await this.dependencies.toolCallRepository.replaceWithCommit(
          toolCallId,
          expectedRevision,
          mutate,
          commit,
        )
      : await this.dependencies.toolCallRepository.replace(
          toolCallId,
          expectedRevision,
          mutate,
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
      await this.dependencies.journal.load(toolCall.conversationId)
    ).revision;
    await this.dependencies.events.publish("toolCall.updated", {
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
