import type { AgentRecord } from "@nervekit/contracts/agents";
import { normalizeRunFailure } from "@nervekit/contracts/runs";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";
import type { CoordinatorExecutionOptions } from "./coordinator-execution-options.js";
import type { RunExecutionOutcome } from "../../runs/runtime/index.js";
import {
  AgentTurnPreparationBlocker,
  type WorkbenchOriginatingTurn,
} from "./workbench-turn-preparation.js";
import { isAgentToolSuspension } from "@nervekit/harness/agent";
import { AgentHarnessError } from "@nervekit/harness";
import { waitForSequentialToolInteractionBatch } from "./sequential-tool-approval-batch.js";
import {
  ModelHistoryInvalidError,
  modelHistoryIntegrityError,
} from "../../conversations/model-history-navigation.js";

export async function handleWorkbenchHarnessError(options: {
  mechanics: WorkbenchAgentMechanics;
  agent: AgentRecord;
  coordinator: CoordinatorExecutionOptions;
  error: unknown;
  originatingTurn?: WorkbenchOriginatingTurn;
  abortRequested: boolean;
  runAbortController: AbortController;
}): Promise<RunExecutionOutcome> {
  const {
    mechanics,
    agent,
    coordinator,
    originatingTurn,
    abortRequested,
    runAbortController,
  } = options;
  // Foreground preparation is normalized by the harness before invocation;
  // later iteration boundaries can throw the blocker directly. Recover only
  // this known wrapper so both paths retain the captured failed revision.
  const source =
    options.error instanceof AgentHarnessError &&
    (options.error.cause instanceof AgentTurnPreparationBlocker ||
      modelHistoryIntegrityError(options.error.cause))
      ? options.error.cause
      : options.error;
  const error = modelHistoryIntegrityError(source) ?? source;
  const runId = coordinator.run.runId;
  const preparationBlocked =
    error instanceof AgentTurnPreparationBlocker ||
    error instanceof ModelHistoryInvalidError;
  if (preparationBlocked)
    await mechanics.deps.agentInputs?.recordAdmissionBlocker(
      agent.id,
      error.message,
      error instanceof AgentTurnPreparationBlocker
        ? error.configurationRevision
        : (agent.configurationRevision ?? 1),
    );
  if (isAgentToolSuspension(error)) {
    if (!originatingTurn)
      throw new Error(
        "Original provider tool authority is unavailable for sequential interaction staging",
      );
    await waitForSequentialToolInteractionBatch({
      agent,
      agentSnapshot: originatingTurn.actor,
      permissionContext: originatingTurn.permissionContext,
      toolAuthority: originatingTurn.toolAuthority,
      runId,
      suspension: error.data,
      deps: mechanics.deps,
      sink: coordinator.sink,
      checkpointCommand: (boundary, interactionId) =>
        coordinator.checkpointCommand(boundary, interactionId),
    });
    return { status: "suspended" };
  }
  return abortRequested || runAbortController.signal.aborted
    ? { status: "interrupted", message: "Agent run aborted." }
    : {
        status: "failed",
        failure: {
          code:
            error instanceof ModelHistoryInvalidError
              ? "MODEL_HISTORY_INVALID"
              : error instanceof AgentTurnPreparationBlocker
                ? "AGENT_CONFIGURATION_BLOCKED"
                : "EXECUTION_FAILED",
          ...normalizeRunFailure(error, "harness"),
          retryable: !preparationBlocked,
          ...(error instanceof ModelHistoryInvalidError
            ? { continuable: false }
            : {}),
        },
      };
}
