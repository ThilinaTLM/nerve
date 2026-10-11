import type { LaunchRecord } from "@nervekit/contracts/launches";

const terminalStatuses = new Set<LaunchRecord["status"]>([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);

export function isTerminalLaunchStatus(
  status: LaunchRecord["status"],
): boolean {
  return terminalStatuses.has(status);
}

export function isActiveLaunchStatus(status: LaunchRecord["status"]): boolean {
  return (
    status === "starting" ||
    status === "running" ||
    status === "ready" ||
    status === "stopping"
  );
}

export function isStoppableLaunchStatus(
  status: LaunchRecord["status"],
): boolean {
  return isActiveLaunchStatus(status);
}
