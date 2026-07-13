import type { AgentRecord } from "@nervekit/contracts";
import type { AgentMessage } from "@nervekit/host-runtime/harness";
import type { RunExecutionControl } from "@nervekit/host-runtime";

export interface WorkbenchLiveExecutionControl extends RunExecutionControl {
  removeQueuedPrompt?(promptId: string): void;
  updateAgentRuntimeConfig?(agent: AgentRecord): Promise<void>;
  appendExternalMessage?(input: {
    id: string;
    message: AgentMessage;
    timestamp: string;
  }): Promise<void>;
  enqueueHarnessMessage?(input: {
    id: string;
    message: AgentMessage;
    timestamp: string;
    delivery?: {
      taskId?: string;
      event?: string;
      pendingNotificationId?: string;
    };
  }): Promise<void>;
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
