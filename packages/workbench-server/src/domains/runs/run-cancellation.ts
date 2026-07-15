import type { RunRecord } from "@nervekit/contracts";
import type { RunCancellationPort } from "@nervekit/host-runtime";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import { isActiveTaskStatus } from "../tasks/index.js";
import type { WorkbenchTaskService } from "../tasks/workbench-task-service.js";
import type { ToolService } from "../tools/tool-service.js";
import type { WorkbenchLiveExecutions } from "./run-live-executions.js";
import type { WorkbenchRunUnitOfWork } from "./run-transition.repository.js";

type Evidence = "confirmed" | "not_running";

export class WorkbenchRunCancellation implements RunCancellationPort {
  private cancelRun?: (runId: string, reason?: string) => Promise<unknown>;

  constructor(
    private readonly live: WorkbenchLiveExecutions,
    private readonly tools: ToolService,
    private readonly tasks: WorkbenchTaskService,
    private readonly state: RuntimeState,
    private readonly unitOfWork: WorkbenchRunUnitOfWork,
  ) {}

  bindCancelRun(
    cancelRun: (runId: string, reason?: string) => Promise<unknown>,
  ) {
    this.cancelRun = cancelRun;
  }

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
    for (const task of active) {
      await this.tasks.cancelTask(task.id, { timeoutMs: 5000 });
      if (isActiveTaskStatus(this.tasks.getTask(task.id).status)) {
        throw new Error(
          `Task ${task.id} did not produce process-exit evidence`,
        );
      }
    }
    return "confirmed";
  }

  async cancelSubagents(run: RunRecord): Promise<Evidence> {
    const childAgents = [...this.state.agents.values()].filter(
      (agent) => agent.parentAgentId === run.agentId,
    );
    if (childAgents.length === 0) return "not_running";
    // Check each child's active scope directly instead of listing all runs.
    const children = [];
    for (const child of childAgents) {
      const active = await this.unitOfWork.findActive(
        `${child.conversationId}:${child.id}`,
      );
      if (active) children.push(active);
    }
    if (children.length === 0) return "not_running";
    if (!this.cancelRun)
      throw new Error("Child run cancellation is unavailable");
    for (const child of children) {
      await this.cancelRun(
        child.run.runId,
        `parent run ${run.runId} cancelled`,
      );
    }
    return "confirmed";
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
