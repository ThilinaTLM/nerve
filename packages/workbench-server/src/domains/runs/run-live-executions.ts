import type { RunExecutionControl } from "@nervekit/host-runtime";

/** Non-authoritative live controls; canonical state is always transition-backed. */
export class WorkbenchLiveExecutions {
  private readonly controls = new Map<string, RunExecutionControl>();

  set(runId: string, control: RunExecutionControl): void {
    this.controls.set(runId, control);
  }

  get(runId: string): RunExecutionControl | undefined {
    return this.controls.get(runId);
  }

  delete(runId: string): void {
    this.controls.delete(runId);
  }
}
