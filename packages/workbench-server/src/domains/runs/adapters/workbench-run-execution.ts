import type { RunRecord } from "@nervekit/contracts/runs";
import type {
  RunExecution,
  RunExecutionFactoryPort,
  RunExecutionSink,
} from "../runtime/index.js";
import type { WorkbenchExploreAdmission } from "../../agents/execution/workbench-explore-admission.js";
import type { WorkbenchLiveExecutions } from "../application/run-live-executions.js";

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
    private readonly exploreAdmission: WorkbenchExploreAdmission,
  ) {}

  async create(run: RunRecord, sink: RunExecutionSink): Promise<RunExecution> {
    const execution = await this.adapter.create(run, sink);
    const control = execution.control;
    return {
      control,
      execute: async (input) => {
        this.live.set(run.runId, control);
        try {
          const outcome = await execution.execute(input);
          if (outcome.status !== "suspended") {
            this.exploreAdmission.clearRun(run.runId);
          }
          return outcome;
        } catch (error) {
          this.exploreAdmission.clearRun(run.runId);
          throw error;
        } finally {
          this.live.delete(run.runId);
        }
      },
    };
  }
}
