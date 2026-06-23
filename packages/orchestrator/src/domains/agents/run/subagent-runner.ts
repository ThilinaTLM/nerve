import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AgentHarness,
  Conversation,
  JsonlConversationStorage,
  NodeExecutionEnv,
  resolveAgentModel,
} from "@nerve/agent";
import type {
  AgentRecord,
  ConversationRecord,
  CreateAgentRequest,
  ExploreStepPayload,
  ExploreUsageStatsPayload,
  Mode,
  ModelSelection,
  PermissionLevel,
  ThinkingLevel,
  WorkspaceScope,
} from "@nerve/shared";
import { createId } from "@nerve/shared";
import type { AuthManager } from "../../../auth.js";
import type { EventBus } from "../../../infrastructure/events/index.js";
import {
  type InitializedStorage,
  pathExists,
} from "../../../infrastructure/storage/index.js";
import type { ApplicationLogger } from "../../../logging.js";
import { loadHarnessResources } from "../../../resource-loader.js";
import type { RuntimeState } from "../../../runtime/runtime-state.js";
import type { HarnessManager } from "../../conversations/harness-manager.js";
import {
  activeToolNamesForExploreAgent,
  createAgentToolsForAgent,
} from "../../tools/agent-tool-adapter.js";
import type {
  ExploreProgressUpdate,
  ToolService,
} from "../../tools/tool-service.js";
import type { SubscriptionUsageService } from "../../usage/subscription-usage-service.js";
import type { AppendEntryFn } from "./message-mirror.js";

export type SubagentHistoryMode = "fresh" | "copy_parent";

export interface SubagentRunSpec {
  kind: string;
  parent: AgentRecord;
  projectId: string;
  projectDir: string;
  workerId?: string;
  mode: Mode;
  permissionLevel: PermissionLevel;
  prompt: string;
  systemPrompt: string;
  historyMode: SubagentHistoryMode;
  model?: ModelSelection;
  thinkingLevel?: ThinkingLevel;
  workspaceScope?: WorkspaceScope;
  task?: string;
  label?: string;
  taskIndex?: number;
  taskCount?: number;
  onProgress?: (update: ExploreProgressUpdate) => void;
  signal?: AbortSignal;
}

export type ExploreStatus = "completed" | "failed" | "aborted";

export interface SubagentRunOutput {
  agent: AgentRecord;
  status: ExploreStatus;
  report: string;
  usage?: ExploreUsageStatsPayload;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  steps?: ExploreStepPayload[];
}

export type ExploreMode = "single" | "parallel";

export interface ExploreTask {
  task: string;
  label?: string;
}

export interface ExploreRunPlan {
  mode: ExploreMode;
  context: string;
  splitRationale?: string;
  tasks: ExploreTask[];
}

export interface ExploreReport {
  agentId: string;
  task: string;
  label?: string;
  status: ExploreStatus;
  report: string;
  reportPath?: string;
  summaryPreview?: string;
  usage?: ExploreUsageStatsPayload;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  steps?: ExploreStepPayload[];
}

const EXPLORE_CONTEXT_MIN_LENGTH = 40;
const EXPLORE_TASK_MIN_LENGTH = 15;
const EXPLORE_SPLIT_RATIONALE_MIN_LENGTH = 40;
const EXPLORE_MAX_PARALLEL_TASKS = 5;
const EXPLORE_MAX_RECORDED_STEPS = 50;

export interface SubagentRunnerDeps {
  storage: InitializedStorage;
  events: EventBus;
  auth: AuthManager;
  tools: ToolService;
  harnessManager: HarnessManager;
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
  getConversation: (conversationId: string) => ConversationRecord;
  updateConversation: (conversation: ConversationRecord) => Promise<void>;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
}

export class SubagentRunner {
  constructor(private readonly deps: SubagentRunnerDeps) {}

  async runExplore(
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
    const plan = exploreRunPlanArg(args);
    const tasks = plan.tasks;
    const batchId = createId("run");
    throwIfAborted(options.signal);
    publishExploreProgress(options.onProgress, {
      taskCount: tasks.length,
      phase: "queued",
      message:
        plan.mode === "single"
          ? "Starting 1 explore agent."
          : `Starting ${tasks.length} parallel explore agents.`,
    });
    const settledReports = await Promise.allSettled(
      tasks.map(async (task, index) => {
        throwIfAborted(options.signal);
        publishExploreProgress(options.onProgress, {
          taskIndex: index,
          taskCount: tasks.length,
          label: task.label,
          phase: "started",
          message: `Explore ${index + 1}/${tasks.length} started: ${task.label ?? task.task}`,
        });
        const output = await this.runSubagent({
          kind: "explore",
          parent,
          projectId: parent.projectId,
          projectDir: parent.projectDir,
          workerId: parent.workerId,
          mode: "coding",
          permissionLevel: "read_only",
          prompt: exploreUserPrompt(task, plan),
          systemPrompt: exploreSystemPrompt(),
          historyMode: "fresh",
          model: this.deps.storage.settings.exploreAgent.model,
          thinkingLevel: this.deps.storage.settings.exploreAgent.thinkingLevel,
          workspaceScope: parent.workspaceScope,
          task: task.task,
          label: task.label,
          taskIndex: index,
          taskCount: tasks.length,
          onProgress: options.onProgress,
          signal: options.signal,
        });
        const reportPath = await this.writeExploreReport({
          batchId,
          task,
          index,
          plan,
          output,
        });
        publishExploreProgress(options.onProgress, {
          agentId: output.agent.id,
          taskIndex: index,
          taskCount: tasks.length,
          label: task.label,
          phase: output.status === "completed" ? "completed" : "failed",
          message:
            output.status === "completed"
              ? `Report written: ${reportPath}`
              : `Failure report written: ${reportPath}`,
        });
        return {
          agentId: output.agent.id,
          task: task.task,
          label: task.label,
          status: output.status,
          report: output.report,
          reportPath,
          summaryPreview: summaryPreview(output.report),
          usage: output.usage,
          model: output.model,
          stopReason: output.stopReason,
          errorMessage: output.errorMessage,
          steps: output.steps,
        };
      }),
    );
    const reports: ExploreReport[] = [];
    for (const result of settledReports) {
      if (result.status === "rejected") {
        if (options.signal?.aborted) throw abortError();
        throw result.reason;
      }
      reports.push(result.value);
    }
    if (options.signal?.aborted) throw abortError();

    const summary = formatExploreReports(reports);
    await this.deps.events.publish("agent.explore_completed", {
      parentAgentId: parent.id,
      reports,
    });
    return {
      reports,
      contentBlocks: [{ type: "text", text: summary }],
    };
  }

  async runSubagent(spec: SubagentRunSpec): Promise<SubagentRunOutput> {
    const child = await this.deps.createAgent(
      {
        conversationId: spec.parent.conversationId,
        projectId: spec.projectId,
        projectDir: spec.projectDir,
        workerId: spec.workerId,
        parentAgentId: spec.parent.id,
        task: spec.task ?? spec.prompt,
        mode: spec.mode,
        permissionLevel: spec.permissionLevel,
        workspaceScope: spec.workspaceScope,
        model: spec.model,
        thinkingLevel: spec.thinkingLevel,
        systemPrompt: spec.systemPrompt,
      },
      { allowChildAuthorityExceed: true },
    );
    await this.deps.events.publish("agent.subagent_started", {
      parentAgentId: spec.parent.id,
      childAgentId: child.id,
      kind: spec.kind,
      task: spec.task ?? spec.prompt,
    });
    publishExploreProgress(spec.onProgress, {
      agentId: child.id,
      taskIndex: spec.taskIndex,
      taskCount: spec.taskCount,
      label: spec.label,
      model: exploreModelLabel(child.model),
      phase: "started",
      message: `Agent ${child.id} started.`,
    });

    const runId = createId("run");
    const steps: ExploreStepPayload[] = [];
    let usage = emptyExploreUsage();
    let modelId: string | undefined;
    let stopReason: string | undefined;
    let errorMessage: string | undefined;
    let abortRequested = false;
    let removeSignalListener: (() => void) | undefined;
    let resolveStopped: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    try {
      throwIfAborted(spec.signal);
      await this.deps.setAgentStatus(child, "running");
      const storage = await this.openChildStorage(child, spec.historyMode);
      const conversation = new Conversation(storage);
      const model = resolveAgentModel(child.model);
      this.deps.subscriptionUsage.touchProvider(model.provider);
      const env = new NodeExecutionEnv({ cwd: child.projectDir });
      const resources = await loadHarnessResources(child.projectDir);
      const activeToolNames = activeToolNamesForExploreAgent();
      const harness = new AgentHarness({
        env,
        conversation,
        resources: { skills: resources.skills },
        tools: createAgentToolsForAgent(child, this.deps.tools, {
          runId,
          hidden: true,
          allowedToolNames: activeToolNames,
        }),
        activeToolNames,
        model,
        thinkingLevel: child.thinkingLevel,
        getApiKeyAndHeaders: async (requestModel) => {
          if (requestModel.provider === "nerve-faux") return undefined;
          const apiKey = await this.deps.auth.getApiKey(requestModel.provider);
          return apiKey ? { apiKey } : undefined;
        },
        systemPrompt: () => spec.systemPrompt,
      });
      harness.subscribe((event) => {
        const update = exploreProgressFromHarnessEvent(event, child, spec);
        if (update) {
          // Only stream `tool_call` deltas live (the meaningful "what it's
          // doing" signal); publishing tool_result/assistant too would 2-3x the
          // per-event transcript re-render churn. Steps below keep full detail.
          if (update.phase === "tool_call") {
            publishExploreProgress(spec.onProgress, update);
          }
          if (
            update.phase === "tool_call" ||
            update.phase === "tool_result" ||
            update.phase === "assistant"
          ) {
            pushExploreStep(steps, {
              type: update.phase === "assistant" ? "assistant" : update.phase,
              toolName: toolNameFromHarnessEvent(event),
              message: update.message,
              timestamp: new Date().toISOString(),
            });
          }
        }
        const record = asRecord(event);
        if (
          record?.type === "message_end" &&
          messageRole(record.message) === "assistant"
        ) {
          const metadata = exploreAssistantMetadata(
            record.message as AssistantMessage,
          );
          if (metadata.usage) usage = addExploreUsage(usage, metadata.usage);
          if (metadata.model) modelId = metadata.model;
          if (metadata.stopReason) stopReason = metadata.stopReason;
          if (metadata.errorMessage) errorMessage = metadata.errorMessage;
        }
      });
      let abortPromise: Promise<unknown> | undefined;
      const abortRun = async () => {
        abortRequested = true;
        abortPromise ??= harness.abort();
        await abortPromise;
      };
      const onSignalAbort = () => {
        void abortRun();
      };
      if (spec.signal) {
        spec.signal.addEventListener("abort", onSignalAbort, { once: true });
        removeSignalListener = () =>
          spec.signal?.removeEventListener("abort", onSignalAbort);
      }
      this.deps.state.runs.set(child.id, {
        runId,
        abort: async () => {
          try {
            await abortRun();
          } finally {
            await stopped;
          }
        },
        messages: [],
      });
      throwIfAborted(spec.signal);
      const assistant = await harness.prompt(spec.prompt);
      if (usage.turns === 0) {
        const metadata = exploreAssistantMetadata(assistant);
        if (metadata.usage) usage = addExploreUsage(usage, metadata.usage);
        if (metadata.model) modelId = metadata.model;
        if (metadata.stopReason) stopReason = metadata.stopReason;
        if (metadata.errorMessage) errorMessage = metadata.errorMessage;
      }
      if (abortRequested || assistant.stopReason === "aborted") {
        throw abortError();
      }
      const report = assistantMessageText(assistant).trim();
      if (assistant.stopReason === "error") {
        throw new Error(
          errorMessage ?? report ?? "Explore agent stopped with an error.",
        );
      }
      if (!report) throw new Error("Explore agent completed without a report.");
      await this.deps.setAgentStatus(child, "idle");
      await this.deps.events.publish("agent.subagent_completed", {
        parentAgentId: spec.parent.id,
        childAgentId: child.id,
        kind: spec.kind,
        summary: report,
      });
      return {
        agent: child,
        status: "completed",
        report,
        usage: usage.turns > 0 ? usage : undefined,
        model: modelId,
        stopReason,
        errorMessage,
        steps,
      };
    } catch (error) {
      const aborted = abortRequested || spec.signal?.aborted === true;
      const latest = this.deps.state.agents.get(child.id) ?? child;
      await this.deps
        .setAgentStatus(latest, aborted ? "aborted" : "error")
        .catch(() => undefined);
      publishExploreProgress(spec.onProgress, {
        agentId: child.id,
        taskIndex: spec.taskIndex,
        taskCount: spec.taskCount,
        label: spec.label,
        phase: "failed",
        message: aborted
          ? "Agent run aborted."
          : error instanceof Error
            ? error.message
            : String(error),
      });
      await this.deps.logger.warn("Subagent run failed", {
        agentId: child.id,
        conversationId: child.conversationId,
        projectId: child.projectId,
        runId,
        context: {
          kind: spec.kind,
          aborted,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (aborted) throw abortError();
      const message = error instanceof Error ? error.message : String(error);
      return {
        agent: child,
        status: "failed",
        report: formatExploreFailureReport(message),
        usage: usage.turns > 0 ? usage : undefined,
        model: modelId,
        stopReason,
        errorMessage: errorMessage ?? message,
        steps,
      };
    } finally {
      removeSignalListener?.();
      const currentRun = this.deps.state.runs.get(child.id);
      if (currentRun?.runId === runId) this.deps.state.runs.delete(child.id);
      try {
        await this.deps.updateConversation({
          ...this.deps.getConversation(spec.parent.conversationId),
          activeAgentId: spec.parent.id,
          updatedAt: new Date().toISOString(),
        });
      } finally {
        resolveStopped();
      }
    }
  }

  private async writeExploreReport(input: {
    batchId: string;
    task: ExploreTask;
    plan: ExploreRunPlan;
    index: number;
    output: SubagentRunOutput;
  }): Promise<string> {
    const dir = join(
      this.deps.storage.paths.home,
      "explore-reports",
      input.output.agent.conversationId,
      input.batchId,
    );
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const fileName = safeReportFileName(
      input.task.label ?? input.task.task,
      input.index,
      input.output.agent.id,
    );
    const reportPath = join(dir, fileName);
    await writeFile(
      reportPath,
      formatExploreReportFile(input.task, input.plan, input.output),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    return reportPath;
  }

  private async openChildStorage(
    child: AgentRecord,
    historyMode: SubagentHistoryMode,
  ): Promise<JsonlConversationStorage> {
    const childDir = join(this.deps.storage.paths.home, "agents", child.id);
    await mkdir(childDir, { recursive: true, mode: 0o700 });
    const childPath = join(childDir, "conversation.jsonl");
    const env = new NodeExecutionEnv({ cwd: child.projectDir });
    if (historyMode === "copy_parent") {
      const parentPath = this.deps.harnessManager.conversationPath(
        child.conversationId,
      );
      if ((await pathExists(parentPath)) && !(await pathExists(childPath))) {
        await copyFile(parentPath, childPath);
        return JsonlConversationStorage.open(env, childPath);
      }
    }
    if (!(await pathExists(childPath))) {
      return JsonlConversationStorage.create(env, childPath, {
        cwd: child.projectDir,
        conversationId: child.conversationId,
        parentConversationPath: this.deps.harnessManager.conversationPath(
          child.conversationId,
        ),
      });
    }
    return JsonlConversationStorage.open(env, childPath);
  }
}

export function exploreRunPlanArg(
  args: Record<string, unknown>,
): ExploreRunPlan {
  const hasTask = typeof args.task === "string" && args.task.trim().length > 0;
  const hasTasks = Array.isArray(args.tasks);
  if (hasTask === hasTasks) {
    throw new Error("Explore requires exactly one of 'task' or 'tasks'.");
  }

  const context = optionalString(args.context);
  if (!context || context.length < EXPLORE_CONTEXT_MIN_LENGTH) {
    throw new Error(
      "Explore requires context summarizing the parent agent's initial grep/find/read work, what it found, and what remains unclear.",
    );
  }

  if (hasTask) {
    const task = String(args.task).trim();
    validateExploreTask(task, "Task");
    return {
      mode: "single",
      context,
      tasks: [{ task, label: optionalString(args.label) }],
    };
  }

  const tasks = args.tasks as unknown[];
  if (tasks.length < 2) {
    throw new Error(
      "Parallel explore requires at least 2 tasks. Use 'task' for single-agent exploration.",
    );
  }
  if (tasks.length > EXPLORE_MAX_PARALLEL_TASKS) {
    throw new Error(
      `Explore supports at most ${EXPLORE_MAX_PARALLEL_TASKS} parallel tasks.`,
    );
  }

  const splitRationale = optionalString(args.split_rationale);
  if (
    !splitRationale ||
    splitRationale.length < EXPLORE_SPLIT_RATIONALE_MIN_LENGTH
  ) {
    throw new Error(
      "Parallel explore requires split_rationale explaining why the tasks are independent and why this is the right number of sub-agents.",
    );
  }

  const normalized = tasks.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Explore task ${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const task = optionalString(record.task);
    if (!task) throw new Error(`Explore task ${index + 1} requires 'task'.`);
    validateExploreTask(task, `Task ${index + 1}`);
    return { task, label: optionalString(record.label) };
  });

  const dedupeKeys = normalized.map((task) =>
    normalizeTaskForDedupe(task.task),
  );
  if (new Set(dedupeKeys).size !== dedupeKeys.length) {
    throw new Error("Parallel explore tasks must be distinct.");
  }

  return { mode: "parallel", context, splitRationale, tasks: normalized };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("Agent run aborted.");
  error.name = "AbortError";
  return error;
}

function validateExploreTask(task: string, label: string): void {
  if (task.trim().length < EXPLORE_TASK_MIN_LENGTH) {
    throw new Error(
      `${label} is too vague. Make it specific enough for a child agent to investigate independently.`,
    );
  }
}

function normalizeTaskForDedupe(task: string): string {
  return task.toLowerCase().replace(/\s+/g, " ").trim();
}

function exploreUserPrompt(task: ExploreTask, plan: ExploreRunPlan): string {
  return [
    task.label ? `Exploration label: ${task.label}` : undefined,
    "Parent agent context:",
    plan.context,
    plan.splitRationale
      ? ["", "Parallel split rationale:", plan.splitRationale].join("\n")
      : undefined,
    "",
    "Exploration task:",
    task.task,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function publishExploreProgress(
  onProgress: ((update: ExploreProgressUpdate) => void) | undefined,
  update: Omit<ExploreProgressUpdate, "type" | "timestamp">,
): void {
  onProgress?.({
    type: "explore_progress",
    timestamp: new Date().toISOString(),
    ...update,
  });
}

/** Display label for the sub-agent's model, e.g. `provider/model-id`. */
function exploreModelLabel(
  selection: ModelSelection | undefined,
): string | undefined {
  return selection ? `${selection.provider}/${selection.modelId}` : undefined;
}

function exploreProgressFromHarnessEvent(
  event: unknown,
  child: AgentRecord,
  spec: SubagentRunSpec,
): Omit<ExploreProgressUpdate, "type" | "timestamp"> | undefined {
  if (!event || typeof event !== "object") return undefined;
  const record = event as Record<string, unknown>;
  const base = {
    agentId: child.id,
    taskIndex: spec.taskIndex,
    taskCount: spec.taskCount,
    label: spec.label,
    model: exploreModelLabel(child.model),
  };
  if (record.type === "tool_call") {
    const toolName =
      typeof record.toolName === "string" ? record.toolName : "tool";
    return {
      ...base,
      phase: "tool_call",
      message: summarizeToolCall(toolName, asRecord(record.input) ?? {}),
    };
  }
  if (record.type === "tool_result") {
    const toolName =
      typeof record.toolName === "string" ? record.toolName : "tool";
    return {
      ...base,
      phase: "tool_result",
      message: summarizeToolResult(toolName, record.details),
    };
  }
  if (
    record.type === "message_start" &&
    messageRole(record.message) === "assistant"
  ) {
    return {
      ...base,
      phase: "assistant",
      message: "Assistant response started.",
    };
  }
  return undefined;
}

function summarizeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case "read":
      return `read ${stringValue(args.path) ?? "file"}${rangeSuffix(args)}`;
    case "grep":
      return `grep ${quoteValue(args.pattern)}${pathSuffix(args)}`;
    case "find":
      return `find ${quoteValue(args.pattern)}${pathSuffix(args)}`;
    case "ls":
      return `list ${stringValue(args.path) ?? "."}`;
    case "task_logs":
      return `inspect task logs${stringValue(args.mode) ? ` (${stringValue(args.mode)})` : ""}`;
    case "task_list":
      return "list managed tasks";
    default:
      return `ran ${toolName}`;
  }
}

function summarizeToolResult(toolName: string, details: unknown): string {
  const result = asRecord(asRecord(details)?.result);
  if (toolName === "grep") {
    const matches = Array.isArray(result?.matches)
      ? result.matches.length
      : undefined;
    return matches === undefined
      ? "grep completed"
      : `grep completed with ${matches} matches`;
  }
  if (toolName === "find") {
    const entries = Array.isArray(result?.entries)
      ? result.entries.length
      : undefined;
    return entries === undefined
      ? "find completed"
      : `find completed with ${entries} paths`;
  }
  if (toolName === "ls") {
    const entries = Array.isArray(result?.entries)
      ? result.entries.length
      : undefined;
    return entries === undefined
      ? "list completed"
      : `list completed with ${entries} entries`;
  }
  if (toolName === "read") return "read completed";
  return `${toolName} completed`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptyExploreUsage(): ExploreUsageStatsPayload {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
    turns: 0,
  };
}

function addExploreUsage(
  a: ExploreUsageStatsPayload,
  b: ExploreUsageStatsPayload,
): ExploreUsageStatsPayload {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: Math.max(a.totalTokens, b.totalTokens),
    cost: a.cost + b.cost,
    turns: a.turns + b.turns,
  };
}

function pushExploreStep(
  steps: ExploreStepPayload[],
  step: ExploreStepPayload,
): void {
  steps.push(step);
  if (steps.length > EXPLORE_MAX_RECORDED_STEPS) steps.shift();
}

function toolNameFromHarnessEvent(event: unknown): string | undefined {
  return stringValue(asRecord(event)?.toolName);
}

function exploreAssistantMetadata(message: AssistantMessage): {
  usage?: ExploreUsageStatsPayload;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
} {
  const usageRecord = asRecord((message as { usage?: unknown }).usage);
  const cost = asRecord(usageRecord?.cost);
  return {
    usage: usageRecord
      ? {
          input: numberValue(usageRecord.input),
          output: numberValue(usageRecord.output),
          cacheRead: numberValue(usageRecord.cacheRead),
          cacheWrite: numberValue(usageRecord.cacheWrite),
          totalTokens:
            numberValue(usageRecord.totalTokens) ||
            numberValue(usageRecord.input) +
              numberValue(usageRecord.output) +
              numberValue(usageRecord.cacheRead) +
              numberValue(usageRecord.cacheWrite),
          cost: numberValue(cost?.total),
          turns: 1,
        }
      : undefined,
    model: stringValue((message as { model?: unknown }).model),
    stopReason: stringValue((message as { stopReason?: unknown }).stopReason),
    errorMessage: stringValue(
      (message as { errorMessage?: unknown }).errorMessage,
    ),
  };
}

function quoteValue(value: unknown): string {
  const text = stringValue(value);
  return text ? JSON.stringify(truncateInline(text, 80)) : "pattern";
}

function pathSuffix(args: Record<string, unknown>): string {
  const path = stringValue(args.path);
  const paths = Array.isArray(args.paths)
    ? args.paths.filter((value) => typeof value === "string")
    : [];
  if (path) return ` in ${path}`;
  if (paths.length > 0) return ` in ${paths.length} paths`;
  return "";
}

function rangeSuffix(args: Record<string, unknown>): string {
  const offset = typeof args.offset === "number" ? args.offset : undefined;
  const limit = typeof args.limit === "number" ? args.limit : undefined;
  if (offset === undefined && limit === undefined) return "";
  return ` (${offset ?? 1}${limit ? `+${limit}` : ""})`;
}

function messageRole(message: unknown): string | undefined {
  return asRecord(message)?.role as string | undefined;
}

function safeReportFileName(
  labelOrTask: string,
  index: number,
  agentId: string,
): string {
  const slug = labelOrTask
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${String(index + 1).padStart(2, "0")}-${slug || "explore"}-${agentId}.md`;
}

function formatExploreReportFile(
  task: ExploreTask,
  plan: ExploreRunPlan,
  output: SubagentRunOutput,
): string {
  return [
    `# Explore report: ${task.label ?? task.task}`,
    "",
    `- Child agent: \`${output.agent.id}\``,
    `- Created: ${new Date().toISOString()}`,
    `- Mode: ${plan.mode}`,
    `- Status: ${output.status}`,
    output.model ? `- Model: ${output.model}` : undefined,
    output.stopReason ? `- Stop reason: ${output.stopReason}` : undefined,
    output.errorMessage ? `- Error: ${output.errorMessage}` : undefined,
    output.usage ? `- Usage: ${formatExploreUsage(output.usage)}` : undefined,
    `- Task: ${task.task}`,
    `- Context: ${plan.context}`,
    plan.splitRationale
      ? `- Split rationale: ${plan.splitRationale}`
      : undefined,
    "",
    "---",
    "",
    output.report,
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function formatExploreUsage(usage: ExploreUsageStatsPayload): string {
  const parts: string[] = [];
  if (usage.turns)
    parts.push(`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`);
  if (usage.input) parts.push(`input ${usage.input}`);
  if (usage.output) parts.push(`output ${usage.output}`);
  if (usage.cacheRead) parts.push(`cache read ${usage.cacheRead}`);
  if (usage.cacheWrite) parts.push(`cache write ${usage.cacheWrite}`);
  if (usage.totalTokens) parts.push(`context ${usage.totalTokens}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  return parts.join(", ") || "none";
}

function formatExploreFailureReport(errorMessage: string): string {
  return [
    "# Findings",
    "",
    "## Summary",
    "- Explore agent failed before producing a successful report.",
    "",
    "## Relevant files",
    "- None identified before failure.",
    "",
    "## Architecture notes",
    "- Not available because the child agent run failed.",
    "",
    "## Evidence",
    `- Error: ${errorMessage}`,
    "",
    "## Open questions / risks",
    "- Re-run the focused exploration or inspect the child conversation for partial progress.",
  ].join("\n");
}

function summaryPreview(report: string): string {
  return truncateInline(
    report
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .filter((line) => line && !line.startsWith("- `"))
      .slice(0, 4)
      .join(" "),
    280,
  );
}

function truncateInline(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

export function exploreSystemPrompt(): string {
  return [
    "You are an Explore Agent specialized in reading and mapping codebases for a parent coding agent.",
    "Your job is to investigate the assigned area thoroughly using only the read-only tools made available to you.",
    "You cannot edit files, write files, run shell commands, start tasks, cancel tasks, ask the user questions, or change runtime state.",
    "Strategy:",
    "1. Start with grep/find/ls to locate relevant code quickly.",
    "2. Read targeted sections, not entire files, unless the file is small and central.",
    "3. Follow imports, references, call sites, tests, and schema definitions to understand connections.",
    "4. Gather concrete evidence from file paths, symbols, and nearby code.",
    "5. Stay scoped to the assigned task; if the task is broad, sample intelligently and call out gaps.",
    "6. Do not ask the user questions; make reasonable assumptions and state them.",
    "Return a concise but useful report in exactly this markdown structure:",
    "",
    "# Findings",
    "",
    "## Summary",
    "- One to five bullets with the key answer.",
    "",
    "## Relevant files",
    "- `path/to/file`: why it matters.",
    "",
    "## Architecture notes",
    "- Important flows, ownership boundaries, data shapes, or extension points.",
    "",
    "## Evidence",
    "- `path/to/file:line-or-symbol` — specific observation.",
    "",
    "## Open questions / risks",
    "- Unknowns, ambiguity, or follow-up checks. Use `None` if there are none.",
  ].join("\n");
}

function assistantMessageText(message: AssistantMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const record = block as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function formatExploreReports(reports: ExploreReport[]): string {
  if (reports.length === 1) {
    const report = reports[0];
    return [`Explore report from ${report.agentId}`, "", report.report].join(
      "\n",
    );
  }
  return reports
    .map((report, index) =>
      [
        `# Explore report ${index + 1}: ${report.label ?? report.task}`,
        "",
        `Child agent: ${report.agentId}`,
        `Status: ${report.status}`,
        "",
        report.report,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}
