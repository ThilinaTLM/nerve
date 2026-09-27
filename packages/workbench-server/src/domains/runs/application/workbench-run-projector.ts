import type { ConversationRunRetrySnapshot } from "@nervekit/contracts/conversations";
import {
  runFailureCategorySchema,
  type RunRecord,
  type RunTransitionRecord,
} from "@nervekit/contracts/runs";
import {
  isTerminalRunStatus,
  type RunHydratedState,
  type RunTransitionObserverPort,
} from "../runtime/index.js";
import type { RuntimeState } from "../../../app/runtime/runtime-projections.js";

export class WorkbenchRunProjector implements RunTransitionObserverPort {
  constructor(private readonly state: RuntimeState) {}

  async committed(transition: RunTransitionRecord): Promise<void> {
    const entries = transition.entries ?? [];
    for (const entry of entries) {
      this.state.appendConversationEntry(entry);
    }
    this.projectConversationRuntime(transition.run, retrySnapshot(transition));
  }

  async rebuild(input: {
    /** Full hydrated states of currently-active runs only. */
    readonly activeStates: readonly RunHydratedState[];
    /** Lightweight records remain available to callers for other rebuilders. */
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
      background:
        this.state.agents.get(run.agentId)?.executionKind === "async_developer",
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      startedAt: run.startedAt ?? run.createdAt,
    });

    if (run.status === "retrying") {
      runtime.projectStatus(run.runId, "retrying", retry);
      return;
    }
    if (run.status === "executing_tools") {
      runtime.projectStatus(run.runId, "executing_tools");
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
}

function isActiveRun(run: RunRecord): boolean {
  return !isTerminalRunStatus(run.status);
}

function retrySnapshotFromState(
  state: RunHydratedState,
): ConversationRunRetrySnapshot | undefined {
  for (let index = state.transitions.length - 1; index >= 0; index -= 1) {
    const retry = retrySnapshot(state.transitions[index]);
    if (retry) return retry;
  }
  return undefined;
}

function failureCategory(value: unknown) {
  const parsed = runFailureCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
      ...(failureCategory(record.failureCategory)
        ? { failureCategory: failureCategory(record.failureCategory) }
        : {}),
      ...(typeof record.httpStatus === "number"
        ? { httpStatus: record.httpStatus }
        : {}),
      failedEntryId:
        typeof record.failedEntryId === "string"
          ? record.failedEntryId
          : undefined,
    };
  }
  return undefined;
}
