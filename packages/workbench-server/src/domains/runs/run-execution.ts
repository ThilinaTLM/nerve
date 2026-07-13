import type { RunRecord } from "@nervekit/contracts";
import type {
  RunExecution,
  RunExecutionFactoryPort,
  RunExecutionSink,
} from "@nervekit/host-runtime";
import type { WorkbenchLiveExecutions } from "./run-live-executions.js";

/**
 * Host execution mechanics boundary. The cutover moves the harness/tool/message
 * mechanics in the workbench harness execution adapter behind this port; lifecycle ownership
 * remains exclusively in RunCoordinator.
 */
export interface WorkbenchRunExecutionAdapter {
  create(run: RunRecord, sink: RunExecutionSink): Promise<RunExecution>;
}

export class WorkbenchRunExecutionFactory implements RunExecutionFactoryPort {
  constructor(
    private readonly adapter: WorkbenchRunExecutionAdapter,
    private readonly live: WorkbenchLiveExecutions,
  ) {}

  async create(run: RunRecord, sink: RunExecutionSink): Promise<RunExecution> {
    const execution = await this.adapter.create(run, sink);
    const control = execution.control;
    return {
      control,
      execute: async (input) => {
        this.live.set(run.runId, control);
        try {
          return await execution.execute(input);
        } finally {
          this.live.delete(run.runId);
        }
      },
    };
  }
}
