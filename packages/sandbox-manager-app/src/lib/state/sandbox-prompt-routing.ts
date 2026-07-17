import type { OperationParams, SandboxRunSnapshot } from "@nervekit/contracts";
import type { ConversationActiveRunSnapshot } from "@nervekit/contracts";
import type { SandboxLiveRunState } from "./sandbox-ui-types";

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "streaming",
  "retrying",
  "waiting",
  "waiting_for_input",
  "waiting_for_approval",
  "suspended",
  "aborting",
  "cancellation_requested",
  "cancellation_failed",
  "interrupted",
  "recoverable_failed",
]);

export type SandboxPromptActiveRun = {
  conversationId: string;
  agentId: string;
  runId: string;
  status: string;
};

export type SandboxPromptDispatch =
  | {
      method: "run.start";
      params: OperationParams<"run.start">;
      activeRun?: undefined;
    }
  | {
      method: "run.followUp";
      params: OperationParams<"run.followUp">;
      activeRun: SandboxPromptActiveRun;
    };

export function isSandboxRunActive(status: string | undefined): boolean {
  return Boolean(status && ACTIVE_RUN_STATUSES.has(status));
}

export function selectPreferredSandboxRun(
  runs: readonly SandboxRunSnapshot[],
): SandboxRunSnapshot | undefined {
  const sorted = [...runs].sort((left, right) =>
    runUpdatedAt(right).localeCompare(runUpdatedAt(left)),
  );
  return sorted.find((run) => isSandboxRunActive(run.status)) ?? sorted[0];
}

export function resolveSandboxPromptDispatch(input: {
  text: string;
  conversationId?: string;
  agentId?: string;
  selectedRunId?: string;
  richActiveRun?: ConversationActiveRunSnapshot;
  liveRuns?: Readonly<Record<string, SandboxLiveRunState>>;
  snapshotRuns?: readonly SandboxRunSnapshot[];
}): SandboxPromptDispatch {
  const activeRun = resolveActiveRun(input);
  if (activeRun) {
    return {
      method: "run.followUp",
      params: {
        conversationId: activeRun.conversationId,
        agentId: activeRun.agentId,
        runId: activeRun.runId,
        text: input.text,
      },
      activeRun,
    };
  }
  return {
    method: "run.start",
    params: {
      conversationId: input.conversationId,
      agentId: input.agentId,
      text: input.text,
    },
  };
}

function resolveActiveRun(input: {
  conversationId?: string;
  agentId?: string;
  selectedRunId?: string;
  richActiveRun?: ConversationActiveRunSnapshot;
  liveRuns?: Readonly<Record<string, SandboxLiveRunState>>;
  snapshotRuns?: readonly SandboxRunSnapshot[];
}): SandboxPromptActiveRun | undefined {
  const rich = input.richActiveRun;
  if (
    rich &&
    isSandboxRunActive(rich.status) &&
    (!input.conversationId || rich.conversationId === input.conversationId)
  ) {
    return rich;
  }

  const liveRuns = Object.values(input.liveRuns ?? {}).filter(
    (run) =>
      isSandboxRunActive(run.status) &&
      (!input.conversationId || run.conversationId === input.conversationId),
  );
  const selectedLive = input.selectedRunId
    ? liveRuns.find((run) => run.runId === input.selectedRunId)
    : undefined;
  const live =
    selectedLive ??
    [...liveRuns].sort((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    )[0];
  if (live) return live;

  const snapshotRuns = (input.snapshotRuns ?? []).filter(
    (run) =>
      isSandboxRunActive(run.status) &&
      (!input.conversationId || run.conversationId === input.conversationId),
  );
  const selectedSnapshot = input.selectedRunId
    ? snapshotRuns.find((run) => run.runId === input.selectedRunId)
    : undefined;
  const snapshot = selectedSnapshot ?? selectPreferredSandboxRun(snapshotRuns);
  if (snapshot) return snapshot;

  return undefined;
}

function runUpdatedAt(run: SandboxRunSnapshot): string {
  return run.updatedAt ?? run.createdAt ?? "";
}
