import type {
  ManagedSandboxRecord,
  SandboxActivitySummary,
} from "@nervekit/shared";
import type { SandboxManagerStore } from "./sandbox-manager-state.svelte";
import { matchesFleetFilter, matchesSearch } from "./sandbox-status";

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
