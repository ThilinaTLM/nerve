import type { RunRecord } from "@nervekit/contracts";
import type { RunCancellationPort } from "@nervekit/host-runtime";
import type { WorkbenchSubagentExecutions } from "../agents/run/workbench-subagent-executions.js";
import { isActiveTaskStatus } from "../tasks/index.js";
import type { WorkbenchTaskService } from "../tasks/workbench-task-service.js";
import type { ToolService } from "../tools/tool-service.js";
import type { WorkbenchLiveExecutions } from "./run-live-executions.js";
import type { WorkbenchRunUnitOfWork } from "./run-transition.repository.js";

type Evidence = "confirmed" | "not_running";

export class WorkbenchRunCancellation implements RunCancellationPort {
  constructor(
    private readonly live: WorkbenchLiveExecutions,
    private readonly tools: ToolService,
    private readonly tasks: WorkbenchTaskService,
    private readonly subagents: WorkbenchSubagentExecutions,
    private readonly unitOfWork: WorkbenchRunUnitOfWork,
  ) {}

  async cancelModel(run: RunRecord): Promise<Evidence> {
    const control = this.live.get(run.runId);
    if (!control) return "not_running";
    await control.cancel("run cancelled");
    return "confirmed";
  }

  async cancelTools(run: RunRecord): Promise<Evidence> {
    // Only actively-executing tool calls are this target's responsibility.
    // Suspended tool calls (waiting_for_user/pending_approval) belong to the
    // interaction target, which the coordinator cancels durably.
    const isRunning = (status: string) =>
      status === "running" || status === "requested";
    const active = this.tools
      .listToolCalls()
      .filter(
        (toolCall) =>
          toolCall.runId === run.runId && isRunning(toolCall.status),
      );
    if (active.length === 0) return "not_running";
    await this.tools.terminateNonTerminalToolCallsForRun(
      run.runId,
      "Tool execution was interrupted because the run was cancelled.",
    );
    const remaining = this.tools
      .listToolCalls()
      .some(
        (toolCall) =>
          toolCall.runId === run.runId && isRunning(toolCall.status),
      );
    if (remaining) throw new Error("Tool cancellation was not confirmed");
    return "confirmed";
  }

  async cancelTasks(run: RunRecord): Promise<Evidence> {
    const active = this.tasks
      .listTasks({ includeForeground: true })
      .filter(
        (task) =>
          task.origin.kind === "agent_tool" &&
          task.origin.runId === run.runId &&
          isActiveTaskStatus(task.status),
      );
    if (active.length === 0) return "not_running";
    const cancelled = await Promise.all(
      active.map((task) =>
        this.tasks.cancelTask(task.id, {
          signal: "SIGKILL",
          timeoutMs: 5000,
          reason: "Run cancelled.",
        }),
      ),
    );
    const unconfirmed = cancelled.find((task) =>
      isActiveTaskStatus(this.tasks.getTask(task.id).status),
    );
    if (unconfirmed) {
      throw new Error(
        `Task ${unconfirmed.id} did not produce process-exit evidence`,
      );
    }
    return "confirmed";
  }

  async cancelSubagents(run: RunRecord): Promise<Evidence> {
    return (await this.subagents.cancelRun(run.runId)) > 0
      ? "confirmed"
      : "not_running";
  }

  async cancelInteraction(run: RunRecord): Promise<Evidence> {
    const state = await this.unitOfWork.load(run.runId);
    if (!state) return "not_running";
    const interaction = state.interactions.find(
      (candidate) => candidate.id === state.run.activeInteractionId,
    );
    if (!interaction) return "not_running";
    if (interaction.status !== "cancelled") {
      throw new Error("Pending interaction cancellation was not committed");
    }
    await this.live.get(run.runId)?.cancel("interaction cancelled");
    return "confirmed";
  }
}
