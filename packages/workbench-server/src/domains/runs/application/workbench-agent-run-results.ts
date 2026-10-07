import type { AgentCompletion } from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import { ApplicationError } from "../../../core/application-error.js";
import { TERMINAL_STATUSES, type RunHydratedState } from "../runtime/index.js";
import type { WorkbenchRunUnitOfWork } from "../persistence/run-transition.repository.js";
import type { WorkbenchAgentControls } from "./workbench-run.service.js";
export async function waitForAgentRun(
  unitOfWork: WorkbenchRunUnitOfWork,
  controls: WorkbenchAgentControls | undefined,
  getHistory: (agentId: string) => Promise<ConversationEntry[]>,
  identity: { agentId: string; runId: string; attemptId: string },
  signal?: AbortSignal,
): Promise<AgentCompletion> {
  const state = await waitForRun(unitOfWork, identity.runId, signal);
  if (state.run.agentId !== identity.agentId)
    throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
  if (controls?.getCompletion)
    return controls.getCompletion(
      identity.agentId,
      identity.runId,
      identity.attemptId,
    );
  const entries = await getHistory(identity.agentId);
  const response = entries
    .filter(
      (entry) => entry.runId === identity.runId && entry.role === "assistant",
    )
    .at(-1);
  return {
    ...identity,
    attemptId: state.run.executionId,
    submittedAttemptId: identity.attemptId,
    outcome:
      state.run.status === "completed"
        ? "completed"
        : state.run.status === "cancelled"
          ? "cancelled"
          : state.run.status === "interrupted"
            ? "interrupted"
            : "failed",
    completedAt: state.run.terminalAt ?? state.run.updatedAt,
    response: response
      ? {
          entryId: response.id,
          runId: identity.runId,
          text: response.text,
          complete: state.run.status === "completed",
        }
      : undefined,
  };
}

export async function waitForRun(
  unitOfWork: WorkbenchRunUnitOfWork,
  runId: string,
  signal?: AbortSignal,
  unref = false,
): Promise<RunHydratedState> {
  while (true) {
    signal?.throwIfAborted();
    const state = await unitOfWork.loadFresh(runId);
    if (!state)
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    if (
      TERMINAL_STATUSES.has(state.run.status) ||
      state.run.status === "interrupted"
    )
      return state;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 25);
      if (unref) timer.unref();
    });
  }
}
