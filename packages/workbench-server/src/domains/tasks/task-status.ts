import type { TaskRecord } from "@nervekit/contracts";

export function isActiveTaskStatus(status: TaskRecord["status"]): boolean {
  return (
    status === "starting" ||
    status === "running" ||
    status === "ready" ||
    status === "stopping"
  );
}

export function isOrphanedTaskStatus(status: TaskRecord["status"]): boolean {
  return status === "orphaned";
}

export function isStoppableTaskStatus(status: TaskRecord["status"]): boolean {
  return isActiveTaskStatus(status) || isOrphanedTaskStatus(status);
}
