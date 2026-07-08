import type {
  ManagedSandboxRecord,
  ModelInfo,
  SandboxActivitySummary,
  SandboxConversationSnapshot,
  SandboxRunSnapshot,
} from "@nervekit/shared";
import type { StatusTone } from "@nervekit/shared-ui/core/utils/status";
import type { SandboxManagerStore } from "./sandbox-manager-state.svelte";
import { matchesFleetFilter, matchesSearch } from "./sandbox-status";
import type {
  SandboxDetailState,
  SandboxPendingConversationState,
} from "./sandbox-ui-types";

export type SandboxConversationListItem =
  | ({ kind: "durable" } & SandboxConversationSnapshot)
  | ({ kind: "pending" } & SandboxPendingConversationState);

type SandboxModelSummary = {
  provider?: string;
  status?: string;
};

type RedactedSnapshotConfig = {
  agent?: {
    mainModel?: { provider?: string };
    exploreModel?: { provider?: string };
  };
};

const usableSandboxModelStatuses = new Set(["available", "degraded"]);

export function durableConversationsFor(
  detail: SandboxDetailState | undefined,
): SandboxConversationSnapshot[] {
  return mergedDurableConversations(detail);
}

export function sandboxConversationById(
  detail: SandboxDetailState | undefined,
  conversationId: string,
): SandboxConversationSnapshot | undefined {
  return durableConversationsFor(detail).find(
    (conversation) => conversation.conversationId === conversationId,
  );
}

export function conversationsFor(
  store: SandboxManagerStore,
  sandboxId: string,
): SandboxConversationSnapshot[] {
  return durableConversationsFor(store.details[sandboxId]);
}

export function sandboxAvailableModels(
  models: ModelInfo[],
  detail: SandboxDetailState | undefined,
): ModelInfo[] {
  const providers = sandboxAvailableModelProviders(detail);
  if (providers.size === 0) return [];
  return models.filter((model) => providers.has(model.provider));
}

function sandboxAvailableModelProviders(
  detail: SandboxDetailState | undefined,
): Set<string> {
  const summaries = [
    ...(detail?.status?.models ?? []),
    ...(detail?.snapshot?.models ?? []),
  ] as SandboxModelSummary[];
  const reported = summaries.filter((summary) => summary.provider);
  if (reported.length > 0) {
    const usable = reported.filter((summary) =>
      usableSandboxModelStatuses.has(summary.status ?? "available"),
    );
    return new Set(usable.map((summary) => summary.provider).filter(isString));
  }

  return sandboxConfiguredModelProviders(detail);
}

function sandboxConfiguredModelProviders(
  detail: SandboxDetailState | undefined,
): Set<string> {
  const config = detail?.snapshot?.config as RedactedSnapshotConfig | undefined;
  return new Set(
    [
      config?.agent?.mainModel?.provider,
      config?.agent?.exploreModel?.provider,
    ].filter(isString),
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function mergedDurableConversations(
  detail: SandboxDetailState | undefined,
): SandboxConversationSnapshot[] {
  const byId = new Map<string, SandboxConversationSnapshot>();
  for (const conversation of Object.values(
    detail?.localConversationsById ?? {},
  ))
    byId.set(conversation.conversationId, conversation);
  for (const conversation of detail?.snapshot?.conversations ?? [])
    byId.set(conversation.conversationId, conversation);
  return [...byId.values()];
}

export function conversationItemsFor(
  store: SandboxManagerStore,
  sandboxId: string,
): SandboxConversationListItem[] {
  const detail = store.details[sandboxId];
  const pending = Object.values(detail?.pendingConversationsById ?? {}).map(
    (conversation) => ({ ...conversation, kind: "pending" as const }),
  );
  const durable = mergedDurableConversations(detail).map((conversation) => ({
    ...conversation,
    kind: "durable" as const,
  }));
  return [...pending, ...durable].sort((a, b) =>
    conversationSortTime(b).localeCompare(conversationSortTime(a)),
  );
}

function conversationSortTime(
  conversation: SandboxConversationListItem,
): string {
  return conversation.kind === "durable"
    ? (conversation.updatedAt ?? conversation.createdAt ?? "")
    : conversation.createdAt;
}

export type SandboxConversationActivityState = {
  tone: StatusTone;
  pulse: boolean;
  label: string;
};

const idleSandboxConversationActivity: SandboxConversationActivityState = {
  tone: "neutral",
  pulse: false,
  label: "Idle",
};

export function sandboxConversationActivity(
  conversation: SandboxConversationSnapshot,
  detail: SandboxDetailState | undefined,
): SandboxConversationActivityState {
  const runs = runsForConversation(detail, conversation.conversationId);
  if (runs.some((run) => isWaitingRunStatus(run.status))) {
    return { tone: "warn", pulse: false, label: "Needs user action" };
  }
  if (runs.some((run) => isFailedRunStatus(run.status))) {
    return { tone: "danger", pulse: false, label: "Run failed" };
  }
  const activeRunIds = new Set(conversation.activeRunIds ?? []);
  const hasKnownActiveRunId = runs.some(
    (run) => activeRunIds.has(run.runId) && isActiveRunStatus(run.status),
  );
  const hasUnknownActiveRunId = [...activeRunIds].some(
    (runId) => !runs.some((run) => run.runId === runId),
  );
  const hasActiveRun = runs.some((run) => isActiveRunStatus(run.status));
  if (hasKnownActiveRunId || hasUnknownActiveRunId || hasActiveRun) {
    const planning = conversationMode(conversation, detail) === "planning";
    return {
      tone: planning ? "good" : "running",
      pulse: true,
      label: planning ? "Planning" : "Agent running",
    };
  }
  return idleSandboxConversationActivity;
}

function runsForConversation(
  detail: SandboxDetailState | undefined,
  conversationId: string,
): SandboxRunSnapshot[] {
  return (
    detail?.snapshot?.runs.filter(
      (run) => run.conversationId === conversationId,
    ) ?? []
  );
}

function isWaitingRunStatus(status: string | undefined): boolean {
  return status === "waiting_for_input" || status === "waiting_for_approval";
}

function isFailedRunStatus(status: string | undefined): boolean {
  return status === "failed" || status === "recoverable_failed";
}

function isActiveRunStatus(status: string | undefined): boolean {
  return status === "queued" || status === "running";
}

function conversationMode(
  conversation: SandboxConversationSnapshot,
  detail: SandboxDetailState | undefined,
): "coding" | "planning" {
  if (conversation.mode === "planning") return "planning";
  if (conversation.mode === "coding") return "coding";
  return detail?.agentControls.mode === "planning" ? "planning" : "coding";
}

export function activityFor(
  store: SandboxManagerStore,
  sandboxId: string,
): SandboxActivitySummary | undefined {
  return store.activityById[sandboxId];
}

export function filteredSandboxes(
  store: SandboxManagerStore,
): ManagedSandboxRecord[] {
  return store.sandboxes.filter(
    (record) =>
      matchesFleetFilter(record, store.fleetFilter) &&
      matchesSearch(record, store.searchQuery),
  );
}

export type FleetSummary = {
  total: number;
  running: number;
  degraded: number;
  failed: number;
  pendingWaits: number;
  avgContextPct: number | undefined;
};

export function fleetSummary(store: SandboxManagerStore): FleetSummary {
  let running = 0;
  let degraded = 0;
  let failed = 0;
  let pendingWaits = 0;
  let contextSum = 0;
  let contextCount = 0;
  for (const record of store.sandboxes) {
    if (record.observedState === "running") running += 1;
    if (record.observedState === "reconnecting" || record.lastError)
      degraded += 1;
    if (record.observedState === "failed") failed += 1;
    const detail = store.details[record.sandboxId];
    if (detail)
      pendingWaits += Object.values(detail.waitsById).filter(
        (wait) => wait.status === "waiting",
      ).length;
    const pct = store.activityById[record.sandboxId]?.contextUsagePct;
    if (typeof pct === "number") {
      contextSum += pct;
      contextCount += 1;
    }
  }
  return {
    total: store.sandboxes.length,
    running,
    degraded,
    failed,
    pendingWaits,
    avgContextPct:
      contextCount > 0 ? Math.round(contextSum / contextCount) : undefined,
  };
}

export function pendingWaitCount(
  store: SandboxManagerStore,
  sandboxId: string,
): number {
  const detail = store.details[sandboxId];
  if (!detail) return 0;
  return Object.values(detail.waitsById).filter(
    (wait) => wait.status === "waiting",
  ).length;
}

export function activeRunCount(
  store: SandboxManagerStore,
  sandboxId: string,
): number {
  const detail = store.details[sandboxId];
  if (!detail) return 0;
  return Object.values(detail.liveRuns).filter(
    (run) => run.status === "running" || run.status === "queued",
  ).length;
}
