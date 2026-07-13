import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentRecord,
  ConversationEntry,
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
import type { EventBus } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage/index.js";
import type { ExploreProgressUpdate } from "../../tools/tool-service.js";

export { exploreRunPlanArg, exploreSystemPrompt } from "./explore-helpers.js";

import {
  abortError,
  exploreModelLabel,
  exploreRunPlanArg,
  exploreSystemPrompt,
  exploreUserPrompt,
  formatExploreFailureReport,
  formatExploreReportFile,
  formatExploreReports,
  publishExploreProgress,
  safeReportFileName,
  summaryPreview,
  throwIfAborted,
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
  events: EventBus;
  createAgent: (
    request: CreateAgentRequest,
    options?: { allowChildAuthorityExceed?: boolean },
  ) => Promise<AgentRecord>;
  getConversation: (conversationId: string) => ConversationRecord;
  updateConversation: (conversation: ConversationRecord) => Promise<void>;
  logger: ApplicationLogger;
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
      thinkingLevel: child.thinkingLevel,
      phase: "started",
      message: `Agent ${child.id} started.`,
    });
    try {
      throwIfAborted(spec.signal);
      const result = await this.deps.runChild({
        agent: child,
        prompt: spec.prompt,
        signal: spec.signal,
      });
      const assistant = [...result.entries]
        .reverse()
        .find((entry) => entry.role === "assistant");
      const report = assistant?.text.trim() ?? "";
      if (result.status !== "completed" || !report) {
        if (result.status === "cancelled" || spec.signal?.aborted) {
          throw abortError();
        }
        throw new Error(
          result.failureMessage || "Explore agent completed without a report.",
        );
      }
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
        usage: assistant?.usage ? { ...assistant.usage, turns: 1 } : undefined,
        model: exploreModelLabel(child.model),
        thinkingLevel: child.thinkingLevel,
        stopReason: "stop",
        steps: [
          {
            type: "assistant",
            message: summaryPreview(report),
            timestamp: assistant?.createdAt,
          },
        ],
      };
    } catch (error) {
      if (spec.signal?.aborted) throw abortError();
      const message = error instanceof Error ? error.message : String(error);
      publishExploreProgress(spec.onProgress, {
        agentId: child.id,
        taskIndex: spec.taskIndex,
        taskCount: spec.taskCount,
        label: spec.label,
        thinkingLevel: child.thinkingLevel,
        phase: "failed",
        message,
      });
      await this.deps.logger.warn("Subagent run failed", {
        agentId: child.id,
        conversationId: child.conversationId,
        projectId: child.projectId,
        error,
      });
      return {
        agent: child,
        status: "failed",
        report: formatExploreFailureReport(message),
        model: exploreModelLabel(child.model),
        thinkingLevel: child.thinkingLevel,
        errorMessage: message,
      };
    } finally {
      await this.deps.updateConversation({
        ...this.deps.getConversation(spec.parent.conversationId),
        activeAgentId: spec.parent.id,
        updatedAt: new Date().toISOString(),
      });
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
}
