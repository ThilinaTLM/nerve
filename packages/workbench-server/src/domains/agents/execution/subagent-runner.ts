import { join } from "node:path";
import { createId } from "@nervekit/contracts";
import type {
  AgentRecord,
  AgentCompletion,
  CreateAgentRequest,
  WorkspaceScope,
} from "@nervekit/contracts/agents";
import type {
  ExploreStepPayload,
  ExploreUsageStatsPayload,
  ToolArtifactClaim,
} from "@nervekit/contracts/tools";
import type { Mode } from "@nervekit/contracts/settings";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
import type { PermissionLevel } from "@nervekit/contracts/permissions";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import { storagePaths } from "../../../infrastructure/storage-bootstrap/paths.js";
import type { ExploreProgressUpdate } from "../../tools/execution/tool-service.js";
import type { CapabilityService } from "../../capabilities/capability.service.js";
import type { WorkbenchExploreAdmission } from "./workbench-explore-admission.js";
import type { WorkbenchSubagentExecutions } from "./workbench-subagent-executions.js";
import { activeToolNamesForExploreAgent } from "../../tools/orchestration/agent-tool-adapter.js";
import {
  abortError,
  exploreModelLabel,
  exploreReportEventSummary,
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
import {
  formatAgentReadyExploreReport,
  persistExploreReport,
  type PersistedExploreReport,
} from "./explore-report-format.js";
export { exploreRunPlanArg, exploreSystemPrompt } from "./explore-helpers.js";

export type SubagentHistoryMode = "fresh" | "copy_parent";

export interface SubagentRunSpec {
  kind: "explore";
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
  label: string;
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

/** Identities returned by common admission, never inferred from mutable child state. */
export interface ExploreRunIdentity {
  agentId: string;
  runId: string;
  attemptId: string;
}

export interface ExploreRuntime {
  submitRun(
    agentId: string,
    text: string,
    parent: { agentId: string; runId?: string },
  ): Promise<ExploreRunIdentity>;
  waitForRun(run: ExploreRunIdentity): Promise<AgentCompletion>;
  /** Exact-run cancellation; must not stop a later execution of the child. */
  cancelRun(run: ExploreRunIdentity): Promise<void>;
}

export interface SubagentRunnerDeps {
  storage: InitializedStorage;
  events: StreamLogRegistry;
  createAgent: (request: CreateAgentRequest) => Promise<AgentRecord>;
  runtime: ExploreRuntime;
  logger: ApplicationLogger;
  executions: WorkbenchSubagentExecutions;
  exploreAdmission: WorkbenchExploreAdmission;
  capabilities: CapabilityService;
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
    let settledReports: PromiseSettledResult<ExploreReport>[];
    try {
      const settings = await this.deps.capabilities.settings(
        parent.projectId,
        parent.conversationId,
      );
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
              mode: parent.mode,
              permissionLevel: "read_only",
              prompt: exploreUserPrompt(task, plan),
              systemPrompt: exploreSystemPrompt(parent.projectDir),
              historyMode: "fresh",
              model: settings.exploreAgent.model ?? parent.model,
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
    // Explore never imports parent history. A newly created identity selects an
    // empty agent-scoped context through the same runtime as every other agent.
    if (spec.historyMode !== "fresh")
      throw new Error("Explore requires fresh agent context.");
    throwIfAborted(spec.signal);
    const child = await this.deps.createAgent({
      conversationId: spec.parent.conversationId,
      projectId: spec.projectId,
      projectDir: spec.projectDir,
      parentAgentId: spec.parent.id,
      name: spec.label,
      task: spec.task ?? spec.prompt,
      mode: spec.parent.mode === "planning" ? "planning" : spec.mode,
      permissionLevel: "read_only",
      readOnlyCeiling: true,
      workspaceScope: {
        roots: spec.workspaceScope?.roots ?? [spec.projectDir],
        readonly: true,
      },
      orchestrationPolicy: {
        preset: "explore",
        parentCancellation: "attached",
        completionReporting: "parent",
      },
      tools: activeToolNamesForExploreAgent(),
      model: spec.model,
      thinkingLevel: spec.thinkingLevel,
      systemPrompt: spec.systemPrompt,
    });
    let completionSnapshot: AgentCompletion | undefined;
    let run: ExploreRunIdentity | undefined;
    let unregister: (() => void) | undefined;
    let cancellation: Promise<void> | undefined;
    // Attachment forwards cancellation only. Admission, harness ownership and
    // terminal projection belong to the common runtime, not this waiting wrapper.
    const cancel = () => {
      if (run && !cancellation) {
        cancellation = this.deps.runtime.cancelRun(run);
        // Signal listeners cannot await; keep rejection observed until finally.
        void cancellation.catch(() => undefined);
      }
      return cancellation;
    };
    const onAbort = () => {
      void cancel();
    };
    try {
      throwIfAborted(spec.signal);
      run = await this.deps.runtime.submitRun(child.id, spec.prompt, {
        agentId: spec.parent.id,
        runId: spec.parentRunId,
      });
      if (run.agentId !== child.id)
        throw new Error("Explore admission returned a different agent.");
      unregister = spec.parentRunId
        ? this.deps.executions.register(
            spec.parentRunId,
            run.runId,
            async () => {
              await cancel();
              await this.deps.runtime.waitForRun(run!);
            },
          )
        : undefined;
      spec.signal?.addEventListener("abort", onAbort, { once: true });
      // Covers cancellation while admission was in flight.
      if (spec.signal?.aborted) void cancel();
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
      const completion = await this.deps.runtime.waitForRun(run);
      // A safe retry changes terminal execution identity, not assignment/run.
      // Validate original-attempt proof when available (historical snapshots may omit it).
      if (
        completion.agentId !== run.agentId ||
        completion.runId !== run.runId ||
        (completion.submittedAttemptId !== undefined &&
          completion.submittedAttemptId !== run.attemptId) ||
        (completion.response && completion.response.runId !== run.runId)
      ) {
        throw new Error("Explore completion does not match the submitted run.");
      }
      completionSnapshot = completion;
      throwIfAborted(spec.signal);
      if (completion.outcome === "cancelled") throw abortError();
      if (completion.outcome !== "completed")
        throw new Error(`Explore run ${completion.outcome}.`);
      const report = completion.response?.text.trim();
      if (!report || !completion.response?.complete)
        throw new Error("Explore agent completed without a report.");
      return {
        agent: child,
        status: "completed",
        report,
        usage: completion.usage,
        model: completion.model ?? exploreModelLabel(completion.modelSelection),
        thinkingLevel: completion.thinkingLevel,
        steps: completion.steps,
        stopReason: completion.stopReason,
      };
    } catch (error) {
      if (
        spec.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      )
        throw abortError();
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.logger.warn("Subagent run failed", {
        agentId: child.id,
        conversationId: child.conversationId,
        projectId: child.projectId,
        runId: run?.runId,
        context: { preset: "explore" },
        error,
      });
      return {
        agent: child,
        status: "failed",
        report: formatExploreFailureReport(message),
        usage: completionSnapshot?.usage,
        model:
          completionSnapshot?.model ??
          exploreModelLabel(completionSnapshot?.modelSelection),
        thinkingLevel: completionSnapshot?.thinkingLevel,
        steps: completionSnapshot?.steps,
        stopReason: completionSnapshot?.stopReason,
        errorMessage: message,
      };
    } finally {
      unregister?.();
      spec.signal?.removeEventListener("abort", onAbort);
      await cancellation;
    }
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
