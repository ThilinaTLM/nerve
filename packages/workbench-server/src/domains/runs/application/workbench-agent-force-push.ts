import { ApplicationError } from "../../../core/application-error.js";
import type { AgentInputService } from "../runtime/agent-inputs.js";
import type { RunCoordinator, RunHydratedState } from "../runtime/index.js";

export async function forcePushAgentInputs(
  deps: {
    inputs?: AgentInputService;
    coordinator: RunCoordinator;
    canInterrupt?(runId: string): Promise<boolean>;
    findActive(): Promise<RunHydratedState | undefined>;
    withControl<T>(action: () => Promise<T>): Promise<T>;
  },
  agentId: string,
  requestId: string,
) {
  return deps.withControl(async () => {
    const state = await deps.findActive();
    if (!state)
      throw new ApplicationError(
        409,
        "AGENT_NOT_RUNNING",
        "Agent has no active run.",
      );
    const attemptId = state.run.executionId;
    if (!deps.inputs) {
      const prompts = await deps.coordinator.forcePush(state.run.runId);
      return {
        accepted: true as const,
        runId: state.run.runId,
        queuedPromptIds: prompts.map((prompt) => prompt.id),
      };
    }
    let receipt:
      | Awaited<ReturnType<AgentInputService["requestForcePush"]>>
      | undefined;
    await deps.coordinator.interruptTurn(state.run.runId, async (current) => {
      if (current.agentId !== agentId || current.executionId !== attemptId)
        throw new ApplicationError(
          409,
          "TURN_SUPERSEDED",
          "The active execution changed before interruption; refresh and try again.",
        );
      if (deps.canInterrupt && !(await deps.canInterrupt(current.runId)))
        throw new ApplicationError(
          409,
          "TURN_NOT_INTERRUPTIBLE",
          "Resolve pending interactions or recovery issues before force-pushing.",
        );
      receipt = await deps.inputs!.requestForcePush(
        agentId,
        state.run.runId,
        attemptId,
        requestId,
      );
      return receipt.interrupt;
    });
    await deps.inputs.acknowledgeForcePush(
      agentId,
      receipt!.requestId,
      attemptId,
    );
    return {
      accepted: true as const,
      runId: state.run.runId,
      queuedPromptIds: receipt!.inputIds,
    };
  });
}
