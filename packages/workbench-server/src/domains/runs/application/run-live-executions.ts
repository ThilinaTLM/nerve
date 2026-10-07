import type { AgentRecord } from "@nervekit/contracts/agents";
import type { RunExecutionControl } from "../runtime/index.js";

export interface WorkbenchLiveExecutionControl extends RunExecutionControl {
  updateAgentRuntimeConfig?(agent: AgentRecord): Promise<void>;
}

/** Non-authoritative live controls; canonical state is always transition-backed. */
export class WorkbenchLiveExecutions {
  private readonly controls = new Map<string, WorkbenchLiveExecutionControl>();

  set(runId: string, control: WorkbenchLiveExecutionControl): void {
    this.controls.set(runId, control);
  }

  get(runId: string): WorkbenchLiveExecutionControl | undefined {
    return this.controls.get(runId);
  }

  delete(runId: string): void {
    this.controls.delete(runId);
  }
}
