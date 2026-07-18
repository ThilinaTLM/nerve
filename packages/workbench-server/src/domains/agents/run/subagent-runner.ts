import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AgentHarness,
  Conversation,
  JsonlConversationStorage,
  NodeExecutionEnv,
  resolveAgentModel,
} from "@nervekit/host-runtime/harness";
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
} from "@nervekit/contracts";
import { createId } from "@nervekit/contracts";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import {
  type InitializedStorage,
  pathExists,
} from "../../../infrastructure/storage/index.js";
import type { AuthManager } from "../../auth/index.js";
import type { ConversationHarnessStorage } from "../../conversations/conversation-harness-storage.js";
import {
  activeToolNamesForExploreAgent,
  createAgentToolsForAgent,
} from "../../tools/agent-tool-adapter.js";
import type {
  ExploreProgressUpdate,
  ToolService,
} from "../../tools/tool-service.js";
import type { SubscriptionUsageService } from "../../usage/subscription-usage-service.js";
import { loadHarnessResources } from "../prompting/resource-loader.js";

export { exploreRunPlanArg, exploreSystemPrompt } from "./explore-helpers.js";

import {
  abortError,
  addExploreUsage,
  asRecord,
  assistantMessageText,
  emptyExploreUsage,
  exploreAssistantMetadata,
  exploreModelLabel,
  exploreProgressFromHarnessEvent,
  exploreReportEventSummary,
  exploreRunPlanArg,
  exploreSystemPrompt,
  exploreUserPrompt,
  formatExploreFailureReport,
  formatExploreReportFile,
  formatExploreReports,
  messageRole,
  publishExploreProgress,
  pushExploreStep,
  safeReportFileName,
  summaryPreview,
  throwIfAborted,
  toolNameFromHarnessEvent,
} from "./explore-helpers.js";

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
  thinkingLevel?: ThinkingLevel;
  stopReason?: string;
  errorMessage?: string;
  steps?: ExploreStepPayload[];
}

export type ExploreMode = "single" | "parallel";

export interface ExploreTask {
  task: string;
  label?: string;
  context?: string;
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
  thinkingLevel?: ThinkingLevel;
  stopReason?: string;
  errorMessage?: string;
  steps?: ExploreStepPayload[];
}

export interface SubagentRunnerDeps {
  storage: InitializedStorage;
  events: StreamLogRegistry;
  auth: AuthManager;
  tools: ToolService;
  harnessStorage: ConversationHarnessStorage;
  createAgent: (
    request: CreateAgentRequest,
    options?: { allowChildAuthorityExceed?: boolean },
  ) => Promise<AgentRecord>;
  setAgentStatus: (
    agent: AgentRecord,
    status: AgentRecord["status"],
  ) => Promise<void>;
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
    details: {
      outputLimits: {
        artifacts: Array<{
          kind: "transcript";
          path: string;
          label: string;
        }>;
      };
    };
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
          systemPrompt: exploreSystemPrompt(parent.projectDir),
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
          model: output.model,
          thinkingLevel: output.thinkingLevel,
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
          thinkingLevel: output.thinkingLevel,
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
      reports: reports.map(exploreReportEventSummary),
    });
    return {
      reports,
      contentBlocks: [{ type: "text", text: summary }],
      details: {
        outputLimits: {
          artifacts: reports.flatMap((report, index) =>
            report.reportPath
              ? [
                  {
                    kind: "transcript" as const,
                    path: report.reportPath,
                    label: `Explore report ${index + 1}: ${report.label ?? report.task}`,
                  },
                ]
              : [],
          ),
        },
      },
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
      thinkingLevel: child.thinkingLevel,
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
    try {
      throwIfAborted(spec.signal);
      await this.deps.setAgentStatus(child, "running");
      const storage = await this.openChildStorage(child, spec.historyMode);
      const conversation = new Conversation(storage);
      const model = resolveAgentModel(child.model);
      this.deps.subscriptionUsage.touchProvider(model.provider);
      const env = new NodeExecutionEnv({
        cwd: child.projectDir,
        shellPath: this.deps.storage.settings.runtime.shellPath,
      });
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
          publishExploreProgress(spec.onProgress, update);
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
        summary: summaryPreview(report),
      });
      return {
        agent: child,
        status: "completed",
        report,
        usage: usage.turns > 0 ? usage : undefined,
        model: modelId ?? exploreModelLabel(child.model),
        thinkingLevel: child.thinkingLevel,
        stopReason,
        errorMessage,
        steps,
      };
    } catch (error) {
      const aborted = abortRequested || spec.signal?.aborted === true;
      await this.deps
        .setAgentStatus(child, aborted ? "aborted" : "error")
        .catch(() => undefined);
      publishExploreProgress(spec.onProgress, {
        agentId: child.id,
        taskIndex: spec.taskIndex,
        taskCount: spec.taskCount,
        label: spec.label,
        thinkingLevel: child.thinkingLevel,
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
        context: { kind: spec.kind, aborted },
        error,
      });
      if (aborted) throw abortError();
      const message = error instanceof Error ? error.message : String(error);
      return {
        agent: child,
        status: "failed",
        report: formatExploreFailureReport(message),
        usage: usage.turns > 0 ? usage : undefined,
        model: modelId ?? exploreModelLabel(child.model),
        thinkingLevel: child.thinkingLevel,
        stopReason,
        errorMessage: errorMessage ?? message,
        steps,
      };
    } finally {
      removeSignalListener?.();
      await this.deps.updateConversation({
        ...this.deps.getConversation(spec.parent.conversationId),
        activeAgentId: spec.parent.id,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  private async openChildStorage(
    child: AgentRecord,
    historyMode: SubagentHistoryMode,
  ): Promise<JsonlConversationStorage> {
    const childDir = join(this.deps.storage.paths.home, "agents", child.id);
    await mkdir(childDir, { recursive: true, mode: 0o700 });
    const childPath = join(childDir, "conversation.jsonl");
    const env = new NodeExecutionEnv({
      cwd: child.projectDir,
      shellPath: this.deps.storage.settings.runtime.shellPath,
    });
    if (historyMode === "copy_parent") {
      const parentPath = this.deps.harnessStorage.conversationPath(
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
        parentConversationPath: this.deps.harnessStorage.conversationPath(
          child.conversationId,
        ),
      });
    }
    return JsonlConversationStorage.open(env, childPath);
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
}
