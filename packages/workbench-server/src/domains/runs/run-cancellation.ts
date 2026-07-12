import type { RunRecord } from "@nervekit/contracts";
import type { RunCancellationPort } from "@nervekit/host-runtime";
import type { ToolService } from "../tools/tool-service.js";
import type { WorkbenchLiveExecutions } from "./run-live-executions.js";

type Evidence = "confirmed" | "not_running";

export class WorkbenchRunCancellation implements RunCancellationPort {
  constructor(
    private readonly live: WorkbenchLiveExecutions,
    private readonly tools: ToolService,
  ) {}

  async cancelModel(run: RunRecord): Promise<Evidence> {
    const control = this.live.get(run.runId);
    if (!control) return "not_running";
    await control.cancel("run cancelled");
    return "confirmed";
  }

  async cancelTools(run: RunRecord): Promise<Evidence> {
    await this.tools.terminateNonTerminalToolCallsForRun(
      run.runId,
      "Tool execution was interrupted because the run was cancelled.",
    );
    return "confirmed";
  }

  async cancelTasks(run: RunRecord): Promise<Evidence> {
    void run;
    // Task cancellation is supplied by the execution adapter once task origin
    // lookup is moved off AgentRunState.
    return "not_running";
  }

  async cancelSubagents(run: RunRecord): Promise<Evidence> {
    void run;
    return "not_running";
  }

  async cancelInteraction(run: RunRecord): Promise<Evidence> {
    void run;
    return "not_running";
  }
}
