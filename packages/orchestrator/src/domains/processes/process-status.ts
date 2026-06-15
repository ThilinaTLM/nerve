import type { ProcessRecord } from "@nerve/shared";

export function isActiveProcessStatus(
  status: ProcessRecord["status"],
): boolean {
  return (
    status === "starting" ||
    status === "running" ||
    status === "ready" ||
    status === "stopping"
  );
}

export function isOrphanedProcessStatus(
  status: ProcessRecord["status"],
): boolean {
  return status === "orphaned";
}

export function isStoppableProcessStatus(
  status: ProcessRecord["status"],
): boolean {
  return isActiveProcessStatus(status) || isOrphanedProcessStatus(status);
}
