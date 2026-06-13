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
