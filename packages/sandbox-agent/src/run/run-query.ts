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
    const entries = state.transitions.flatMap(
      (transition) => transition.entries,
    );
    const promptEntry = entries.find((entry) => entry.role === "user");
    const latestTools = new Map<
      string,
      RunHydratedState["transitions"][number]["toolCalls"][number]
    >();
    for (const transition of state.transitions) {
      for (const toolCall of transition.toolCalls) {
        latestTools.set(toolCall.id, toolCall);
      }
    }
    return {
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      status:
        run.status === "waiting" &&
        state.interactions.find((item) => item.id === run.activeInteractionId)
          ?.kind === "approval"
          ? "waiting_for_approval"
          : mapRunStatusToSandbox(run.status),
      updatedAt: run.updatedAt,
      createdAt: run.createdAt,
      terminalAt: run.terminalAt,
      prompt: promptEntry?.text,
      lastCheckpointId: run.lastCheckpointId,
      transcript: entries.map((entry, index) => ({
        entryId: entry.id,
        index,
        role: entry.role,
        content: { text: entry.text },
        createdAt: entry.createdAt,
      })),
      toolCalls: [...latestTools.values()].map((call) => ({
        toolCallId: call.id,
        toolName: call.toolName,
        status: sandboxToolStatus(call.status),
        displayArgs: call.argsPreview,
        turnId: call.turnId,
        liveMessageId: call.liveMessageId,
        contentIndex: call.contentIndex,
        requestedAt: call.createdAt,
        startedAt: call.status === "running" ? call.updatedAt : undefined,
        completedAt: ["completed", "error", "denied"].includes(call.status)
          ? call.updatedAt
          : undefined,
        error: call.errorDetails
          ? { ...call.errorDetails, redactionVersion: 1 }
          : undefined,
      })),
      checkpoints: state.checkpoints.map((checkpoint) => ({
        checkpointId: checkpoint.checkpointId,
        status: mapRunStatusToSandbox(run.status),
        createdAt: checkpoint.createdAt,
      })),
      executions: [
        {
          executionId: run.executionId,
          attempt: run.attempt,
          status: executionStatus(run.status),
          startedAt: run.startedAt ?? run.createdAt,
          completedAt: run.terminalAt,
          recoverability: run.recoverability,
          error: run.failure,
          lastCheckpointId: run.lastCheckpointId,
        },
      ],
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

function executionStatus(status: string) {
  if (status === "starting" || status === "retrying") return "starting";
  if (status === "running" || status === "cancellation_requested")
    return "streaming";
  if (status === "waiting" || status === "suspended") return "waiting";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

function sandboxToolStatus(status: string) {
  switch (status) {
    case "pending_approval":
      return "waiting_for_approval" as const;
    case "waiting_for_user":
      return "waiting_for_input" as const;
    case "running":
      return "started" as const;
    case "error":
    case "denied":
      return "failed" as const;
    default:
      return status as "requested" | "completed";
  }
}
