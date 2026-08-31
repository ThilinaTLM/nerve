import type { TaskRecord } from "@nervekit/contracts/tasks";

const terminalStatuses = new Set<TaskRecord["status"]>([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
  "interrupted",
]);

export function isTerminalTaskStatus(status: TaskRecord["status"]): boolean {
  return terminalStatuses.has(status);
}

export function isActiveTaskStatus(status: TaskRecord["status"]): boolean {
  return (
    status === "starting" ||
    status === "running" ||
    status === "ready" ||
    status === "stopping" ||
    status === "recovered"
  );
}

export function isOrphanedTaskStatus(status: TaskRecord["status"]): boolean {
  return status === "orphaned" || status === "recovery_unknown";
}

export function isStoppableTaskStatus(status: TaskRecord["status"]): boolean {
  return isActiveTaskStatus(status) || isOrphanedTaskStatus(status);
}
