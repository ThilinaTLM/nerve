import {
  isMaintenanceActive,
  type MaintenanceOperation,
} from "@nervekit/contracts/maintenance";
import type { StorageCleanupTarget } from "@nervekit/contracts/storage";

const STAGES: Record<string, string> = {
  stopping_agents: "Checking and stopping agents",
  events: "Deleting events",
  leaves: "Deleting agent context leaves",
  parent_links: "Detaching parent links",
  record_projections: "Deleting history projections",
  tool_projections: "Deleting tool projections",
  records: "Deleting history records",
  snapshots: "Deleting snapshots",
  journal_heads: "Deleting journal metadata",
  journal_commits: "Deleting journal commits",
  metadata: "Deleting conversation metadata",
  complete: "Finishing history deletion",
  streams: "Removing streams",
  payloads: "Removing payloads",
};

export function stageLabel(stage: string): string {
  return STAGES[stage] ?? stage;
}

export function cleanupTargetLabel(target: StorageCleanupTarget): string {
  return (
    {
      conversations: "Old conversations",
      datedLogs: "Dated logs",
      rotatedEventLog: "Rotated event log",
      crashReports: "Crash reports",
      cache: "Cache",
      tmp: "Temporary files",
    } satisfies Record<StorageCleanupTarget, string>
  )[target];
}

/** "Cleaning up" or "Removing project". */
export function maintenanceTitle(operation: MaintenanceOperation): string {
  return operation.kind === "delete_project"
    ? "Removing project"
    : "Cleaning up";
}

/** Whole percent done while counting is possible, else undefined (indeterminate). */
export function maintenanceProgress(
  operation: MaintenanceOperation,
): number | undefined {
  if (
    !isMaintenanceActive(operation) ||
    ["queued", "preparing", "discovering", "finalizing"].includes(
      operation.phase,
    )
  )
    return undefined;
  const total = operation.totalItems ?? operation.totalTargets;
  const completed =
    operation.totalItems === undefined
      ? operation.completedTargets
      : operation.completedItems;
  return total > 0 && completed < total
    ? Math.min(99, Math.round((completed / total) * 100))
    : undefined;
}

/** "12 of 40 conversations", "2 of 5 items", or "" before counting starts. */
export function maintenanceCount(operation: MaintenanceOperation): string {
  if (operation.totalItems !== undefined)
    return `${operation.completedItems} of ${operation.totalItems} conversations`;
  if (operation.totalTargets > 0)
    return `${operation.completedTargets} of ${operation.totalTargets} items`;
  return "";
}

/** What is happening now: the conversation and its stage, or the daemon's message. */
export function maintenanceActivity(operation: MaintenanceOperation): string {
  const item = operation.currentItem;
  if (!item) return operation.message;
  return `${item.title ?? item.conversationId} · ${stageLabel(item.stage)}`;
}
