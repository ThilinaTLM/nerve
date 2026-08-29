import { storagePaths } from "../../../infrastructure/storage-bootstrap/paths.js";
import { resolveProjectSettings } from "../../../infrastructure/configuration/index.js";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AgentCustomModel,
  AgentHarness,
  Conversation,
  resolveAgentModel,
} from "@nervekit/harness";
import { NodeExecutionEnv } from "@nervekit/harness/node";
import type {
  AgentRecord,
  CreateAgentRequest,
  ExploreStepPayload,
  ExploreUsageStatsPayload,
  Mode,
  ModelSelection,
  PermissionLevel,
  ThinkingLevel,
  ToolArtifactClaim,
  WorkspaceScope,
} from "@nervekit/contracts";
import { createId } from "@nervekit/contracts";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import { type InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import type { AuthManager } from "../../auth/index.js";
import type { ConversationHarnessStorage } from "../../conversations/conversation-harness-storage.js";
import {
  activeToolNamesForExploreAgent,
  createAgentToolsForAgent,
} from "../../tools/orchestration/agent-tool-adapter.js";
import type {
  ExploreProgressUpdate,
  ToolService,
} from "../../tools/execution/tool-service.js";
import type { SubscriptionUsageService } from "../../usage/subscription-usage-service.js";
import type { WorkbenchExploreAdmission } from "./workbench-explore-admission.js";
import type { WorkbenchSubagentExecutions } from "./workbench-subagent-executions.js";
import type { AgentBrowserSkillCatalog } from "../prompting/agent-browser-skills.js";
import type { SubagentTranscriptLiveService } from "../subagent-transcript-live.service.js";
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
import {
  formatAgentReadyExploreReport,
  persistExploreReport,
  type PersistedExploreReport,
} from "./explore-report-format.js";

export type SubagentHistoryMode = "fresh" | "copy_parent";

export interface SubagentRunSpec {
  kind: string;
  parent: AgentRecord;
  projectId: string;
  projectDir: string;
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
  parentRunId?: string;
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
  reportBytes?: number;
  reportLines?: number;
  artifactId?: string;
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
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
  executions: WorkbenchSubagentExecutions;
  exploreAdmission: WorkbenchExploreAdmission;
  agentBrowserSkills: AgentBrowserSkillCatalog;
  transcriptLive: SubagentTranscriptLiveService;
  customModels?: (projectDir?: string) => Promise<AgentCustomModel[]>;
}

export class SubagentRunner {
  constructor(private readonly deps: SubagentRunnerDeps) {}

  async runExplore(
    parent: AgentRecord,
    args: Record<string, unknown>,
    options: {
      onProgress?: (update: ExploreProgressUpdate) => void;
      signal?: AbortSignal;
      parentRunId?: string;
    } = {},
  ): Promise<{
    reports: ExploreReport[];
    contentBlocks: [{ type: "text"; text: string }];
    details: {
      outputLimits: {
        artifacts: ToolArtifactClaim[];
      };
    };
  }> {
    const plan = exploreRunPlanArg(args);
    const tasks = plan.tasks;
    const batchId = createId("run");
    throwIfAborted(options.signal);
    const admission = this.deps.exploreAdmission.reserveBatch(
      options.parentRunId,
      tasks.length,
    );
    publishExploreProgress(options.onProgress, {
      taskCount: tasks.length,
      phase: "queued",
      message:
        plan.mode === "single"
          ? "Starting 1 explore agent."
          : `Starting ${tasks.length} parallel explore agents.`,
    });
    const settings = await resolveProjectSettings(
      this.deps.storage,
      parent.projectDir,
    );
    let settledReports: PromiseSettledResult<ExploreReport>[];
    try {
      settledReports = await Promise.allSettled(
        tasks.map(async (task, index) => {
          throwIfAborted(options.signal);
          const release = await admission.acquire(options.signal, () =>
            publishExploreProgress(options.onProgress, {
              taskIndex: index,
              taskCount: tasks.length,
              label: task.label,
              phase: "queued",
              message: `Explore ${index + 1}/${tasks.length} is waiting for an active-agent slot.`,
            }),
          );
          publishExploreProgress(options.onProgress, {
            taskIndex: index,
            taskCount: tasks.length,
            label: task.label,
            phase: "started",
            message: `Explore ${index + 1}/${tasks.length} started: ${task.label ?? task.task}`,
          });
          let output: SubagentRunOutput;
          try {
            output = await this.runSubagent({
              kind: "explore",
              parent,
              projectId: parent.projectId,
              projectDir: parent.projectDir,
              mode: "coding",
              permissionLevel: "read_only",
              prompt: exploreUserPrompt(task, plan),
              systemPrompt: exploreSystemPrompt(parent.projectDir),
              historyMode: "fresh",
              model: settings.exploreAgent.model,
              thinkingLevel: settings.exploreAgent.thinkingLevel,
              workspaceScope: parent.workspaceScope,
              task: task.task,
              label: task.label,
              taskIndex: index,
              taskCount: tasks.length,
              onProgress: options.onProgress,
              signal: options.signal,
              parentRunId: options.parentRunId,
            });
          } finally {
            release();
          }
          const completeReport = formatAgentReadyExploreReport(
            formatExploreReportFile(task, plan, output),
          );
          let persisted: PersistedExploreReport | undefined;
          let persistenceError: string | undefined;
          try {
            persisted = await this.writeExploreReport({
              batchId,
              task,
              index,
              plan,
              output,
              report: completeReport,
            });
          } catch (error) {
            persistenceError = `Explore report persistence failed: ${error instanceof Error ? error.message : String(error)}`;
          }
          const reportText = persistenceError
            ? formatExploreFailureReport(persistenceError)
            : completeReport;
          const artifactId = persisted
            ? `explore_report_${index + 1}`
            : undefined;
          const report: ExploreReport = {
            agentId: output.agent.id,
            task: task.task,
            label: task.label,
            status: persistenceError ? "failed" : output.status,
            report: reportText,
            reportPath: persisted?.path,
            reportBytes: persisted?.bytes,
            reportLines: persisted?.lines,
            artifactId,
            summaryPreview: summaryPreview(
              persistenceError ? reportText : output.report,
            ),
            usage: output.usage,
            model: output.model,
            thinkingLevel: output.thinkingLevel,
            stopReason: output.stopReason,
            errorMessage: persistenceError ?? output.errorMessage,
            steps: output.steps,
          };
          publishExploreProgress(options.onProgress, {
            agentId: output.agent.id,
            taskIndex: index,
            taskCount: tasks.length,
            label: task.label,
            model: output.model,
            thinkingLevel: output.thinkingLevel,
            phase: report.status === "completed" ? "completed" : "failed",
            message: persisted
              ? report.status === "completed"
                ? `Report written: ${persisted.path}`
                : `Failure report written: ${persisted.path}`
              : (persistenceError ?? "Explore report was not persisted."),
            report: exploreReportEventSummary(report),
          });
          return report;
        }),
      );
    } finally {
      admission.finish();
    }
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
                    id: report.artifactId ?? `explore_report_${index + 1}`,
                    role: "primary_result" as const,
                    path: report.reportPath,
                    format: {
                      kind: "markdown" as const,
                      mediaType: "text/markdown",
                      encoding: "utf-8" as const,
                    },
                    bytes: report.reportBytes,
                    lines: report.reportLines,
                    label: `Explore report ${index + 1}: ${report.label ?? report.task}`,
                    recommendedTools: ["read", "grep"] as ("read" | "grep")[],
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
    await this.deps.transcriptLive.register({
      parentAgentId: spec.parent.id,
      child,
      runId,
    });
    const abortController = new AbortController();
    const abortFromParent = () => abortController.abort(spec.signal?.reason);
    if (spec.signal?.aborted) abortFromParent();
    else
      spec.signal?.addEventListener("abort", abortFromParent, { once: true });
    const signal = abortController.signal;
    const steps: ExploreStepPayload[] = [];
    let usage = emptyExploreUsage();
    let modelId: string | undefined;
    let stopReason: string | undefined;
    let errorMessage: string | undefined;
    let abortRequested = false;
    let harness: AgentHarness | undefined;
    let settleRun!: () => void;
    const runSettled = new Promise<void>((resolve) => {
      settleRun = resolve;
    });
    const abortRun = async () => {
      abortRequested = true;
      abortController.abort();
      harness?.requestAbort();
      // Cancellation is confirmed only after the child projects its terminal
      // status, not merely after its AbortController is tripped.
      await runSettled;
    };
    const unregister = spec.parentRunId
      ? this.deps.executions.register(spec.parentRunId, runId, abortRun)
      : undefined;
    try {
      throwIfAborted(signal);
      await this.deps.setAgentStatus(child, "running");
      const storage = await this.openChildStorage(child, spec.historyMode);
      const conversation = new Conversation(storage);
      const settings = await resolveProjectSettings(
        this.deps.storage,
        child.projectDir,
      );
      const model = resolveAgentModel(
        child.model,
        (await this.deps.customModels?.(child.projectDir)) ?? [],
      );
      this.deps.subscriptionUsage.touchProvider(model.provider);
      const env = new NodeExecutionEnv({
        cwd: child.projectDir,
        shellPath: settings.runtime.shellPath,
      });
      const resources = await loadHarnessResources(child.projectDir, {
        storageHome: this.deps.storage.paths.home,
        disabledSkillNames: settings.skills.disabled,
        enabledAgentBrowserSkillNames: settings.skills.agentBrowser.enabled,
        agentBrowserSkills: this.deps.agentBrowserSkills.skills,
      });
      const activeToolNames = activeToolNamesForExploreAgent();
      harness = new AgentHarness({
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
        getApiKeyAndHeaders: (requestModel) =>
          this.deps.auth.requestAuthForPiModel(requestModel),
        systemPrompt: () => spec.systemPrompt,
      });
      harness.subscribe(async (event) => {
        await this.deps.transcriptLive.handleHarnessEvent(child.id, event);
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
      const onSignalAbort = () => {
        abortRequested = true;
        void harness?.abort();
      };
      signal.addEventListener("abort", onSignalAbort, { once: true });
      throwIfAborted(signal);
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
      await this.deps.transcriptLive.complete(child.id, "completed");
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
      const aborted = abortRequested || signal.aborted;
      const terminalMessage =
        error instanceof Error ? error.message : String(error);
      await this.deps.transcriptLive
        .complete(child.id, aborted ? "aborted" : "failed", terminalMessage)
        .catch(() => undefined);
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
      const message = terminalMessage;
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
      unregister?.();
      spec.signal?.removeEventListener("abort", abortFromParent);
      settleRun();
    }
  }
  private async openChildStorage(
    child: AgentRecord,
    historyMode: SubagentHistoryMode,
  ) {
    const storage = await this.deps.harnessStorage.openAgentStorage(child);
    if (
      historyMode === "copy_parent" &&
      (await storage.getEntries()).length === 0
    ) {
      for (const entry of await this.deps.harnessStorage.modelEntries(
        child.conversationId,
      )) {
        await storage.appendEntry(entry);
      }
    }
    return storage;
  }

  private async writeExploreReport(input: {
    batchId: string;
    task: ExploreTask;
    plan: ExploreRunPlan;
    index: number;
    output: SubagentRunOutput;
    report: string;
  }): Promise<PersistedExploreReport> {
    const dir = join(
      storagePaths(this.deps.storage.paths.home).reportsPath,
      "conversations",
      input.output.agent.conversationId,
      input.batchId,
    );
    const fileName = safeReportFileName(
      input.task.label ?? input.task.task,
      input.index,
      input.output.agent.id,
    );
    const reportPath = join(dir, fileName);
    return await persistExploreReport(reportPath, input.report);
  }
}
