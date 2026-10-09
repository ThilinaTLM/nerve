import type { TaskRecord } from "@nervekit/contracts/tasks";

const terminalStatuses = new Set<TaskRecord["status"]>([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);

export function isTerminalTaskStatus(status: TaskRecord["status"]): boolean {
  return terminalStatuses.has(status);
}

export function isActiveTaskStatus(status: TaskRecord["status"]): boolean {
  return (
    status === "starting" ||
    status === "running" ||
    status === "ready" ||
    status === "stopping"
  );
}

export function isStoppableTaskStatus(status: TaskRecord["status"]): boolean {
  return isActiveTaskStatus(status);
}
