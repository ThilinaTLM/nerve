import type { RunHydratedState } from "@nervekit/host-runtime";
import type { RunLike } from "../daemon/run-summaries.js";
import type { SandboxRunUnitOfWork } from "../agent/run-transition-store.js";
import { mapRunStatusToSandbox } from "./run-status.js";

/**
 * Derives normalized run views (RunLike rows and pending-wait summaries) from
 * the canonical coordinator transition projections. This is the only source of
 * daemon run summaries and snapshots; no incumbent run store is consulted.
 */
export class SandboxRunQueryAdapter {
  constructor(private readonly unitOfWork: SandboxRunUnitOfWork) {}

  async states(): Promise<readonly RunHydratedState[]> {
    return this.unitOfWork.list();
  }

  async runLikes(): Promise<RunLike[]> {
    return (await this.states()).map((state) => this.runLike(state));
  }

  private runLike(state: RunHydratedState): RunLike {
    const run = state.run;
    const promptEntry = state.transitions
      .flatMap((transition) => transition.entries)
      .find((entry) => entry.role === "user");
    return {
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      status: mapRunStatusToSandbox(run.status),
      updatedAt: run.updatedAt,
      createdAt: run.createdAt,
      terminalAt: run.terminalAt,
      prompt: promptEntry?.text,
      lastCheckpointId: run.lastCheckpointId,
      error: run.failure
        ? {
            code: run.failure.code,
            message: run.failure.message,
            redactionVersion: 1,
          }
        : undefined,
    };
  }
}
