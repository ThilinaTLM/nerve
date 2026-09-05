import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationRunRetrySnapshot } from "@nervekit/contracts/conversations";
import type { RunRecord, RunTransitionRecord } from "@nervekit/contracts/runs";
import {
  isTerminalRunStatus,
  type RunHydratedState,
  type RunTransitionObserverPort,
} from "../runtime/index.js";
import type { RuntimeState } from "../../../app/runtime/runtime-projections.js";

export class WorkbenchRunProjector implements RunTransitionObserverPort {
  constructor(
    private readonly state: RuntimeState,
    private readonly update: (
      agent: AgentRecord,
      status: AgentRecord["status"],
    ) => Promise<void>,
  ) {}

  async committed(transition: RunTransitionRecord): Promise<void> {
    this.projectConversationRuntime(transition.run, retrySnapshot(transition));
    await this.projectAgentStatus(transition.run);
  }

  async rebuild(input: {
    /** Full hydrated states of currently-active runs only. */
    readonly activeStates: readonly RunHydratedState[];
    /** Lightweight records (metadata) for every run, incl. terminal history. */
    readonly runRecords: readonly RunRecord[];
  }): Promise<void> {
    this.state.conversationRuntime.reset();
    for (const state of input.activeStates) {
      if (isActiveRun(state.run)) {
        this.projectConversationRuntime(
          state.run,
          retrySnapshotFromState(state),
        );
      }
    }

    const latestByAgent = new Map<string, RunRecord>();
    for (const run of input.runRecords) {
      const current = latestByAgent.get(run.agentId);
      if (
        !current ||
        current.updatedAt < run.updatedAt ||
        (current.updatedAt === run.updatedAt && current.revision < run.revision)
      ) {
        latestByAgent.set(run.agentId, run);
      }
    }
    for (const run of latestByAgent.values()) {
      await this.projectAgentStatus(run, { preserveNewerAgentStatus: true });
    }
  }

  private projectConversationRuntime(
    run: RunRecord,
    retry?: ConversationRunRetrySnapshot,
  ): void {
    const runtime = this.state.conversationRuntime;
    if (run.status === "completed") {
      runtime.completeRun(run.runId);
      return;
    }
    if (run.status === "failed") {
      runtime.failRun(run.runId);
      return;
    }
    if (run.status === "cancelled") {
      runtime.cancelRun(run.runId);
      return;
    }

    runtime.startRun({
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      startedAt: run.startedAt ?? run.createdAt,
    });

    if (run.status === "settling") {
      runtime.projectStatus(run.runId, "settling");
      return;
    }
    if (run.status === "retrying") {
      runtime.projectStatus(run.runId, "retrying", retry);
      return;
    }
    if (run.status === "waiting" || run.status === "suspended") {
      runtime.projectStatus(run.runId, "waiting");
      return;
    }
    if (run.status === "cancellation_requested") {
      runtime.projectStatus(run.runId, "aborting");
      return;
    }
    if (run.status === "cancellation_failed") {
      runtime.projectStatus(run.runId, "retrying");
      return;
    }
    if (run.status === "interrupted") {
      runtime.projectStatus(run.runId, "interrupted");
      return;
    }
    runtime.projectStatus(run.runId, "running");
  }

  private async projectAgentStatus(
    run: RunRecord,
    options: { preserveNewerAgentStatus?: boolean } = {},
  ): Promise<void> {
    const agent = this.state.agents.get(run.agentId);
    if (!agent) return;
    if (options.preserveNewerAgentStatus && agent.updatedAt > run.updatedAt) {
      return;
    }
    const status = agentStatusForRun(run.status);
    if (agent.status === status) return;
    await this.update(agent, status);
  }
}

export function agentStatusForRun(
  status: RunRecord["status"],
): AgentRecord["status"] {
  if (
    [
      "starting",
      "running",
      "retrying",
      "settling",
      "cancellation_requested",
    ].includes(status)
  ) {
    return "running";
  }
  if (status === "waiting" || status === "suspended") {
    return "awaiting_user";
  }
  if (status === "completed") return "idle";
  if (status === "cancelled") return "aborted";
  return "error";
}

function isActiveRun(run: RunRecord): boolean {
  return !isTerminalRunStatus(run.status);
}

function retrySnapshotFromState(
  state: RunHydratedState,
): ConversationRunRetrySnapshot | undefined {
  for (let index = state.transitions.length - 1; index >= 0; index -= 1) {
    const retry = retrySnapshot(state.transitions[index]!);
    if (retry) return retry;
  }
  return undefined;
}

function retrySnapshot(
  transition: Pick<RunTransitionRecord, "events">,
): ConversationRunRetrySnapshot | undefined {
  const events = transition.events ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "run.retrying") continue;
    const data = event.data;
    if (!data || typeof data !== "object") return undefined;
    const record = data as Record<string, unknown>;
    if (
      typeof record.attempt !== "number" ||
      typeof record.maxRetries !== "number" ||
      typeof record.delayMs !== "number" ||
      typeof record.retryAt !== "string"
    ) {
      return undefined;
    }
    return {
      attempt: record.attempt,
      maxRetries: record.maxRetries,
      delayMs: record.delayMs,
      retryAt: record.retryAt,
      errorMessage:
        typeof record.errorMessage === "string"
          ? record.errorMessage
          : "Run retry scheduled",
      failedEntryId:
        typeof record.failedEntryId === "string"
          ? record.failedEntryId
          : undefined,
    };
  }
  return undefined;
}
