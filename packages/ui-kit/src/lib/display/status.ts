/* One status vocabulary for the whole app, named after the semantic tokens it
 * paints with. StatusDot, Badge, and ProgressRing all speak it. */
export type StatusTone =
  | "neutral"
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "destructive";

export function statusTone(status: string | undefined): StatusTone {
  if (status === "running" || status === "ready" || status === "starting") {
    return "info";
  }
  if (
    status === "error" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "orphaned" ||
    status === "recovery_unknown"
  ) {
    return "destructive";
  }
  if (
    status === "completed" ||
    status === "stopped" ||
    status === "exited" ||
    status === "interrupted"
  ) {
    return "success";
  }
  if (
    status === "pending" ||
    status === "stopping" ||
    status === "aborted" ||
    status === "awaiting_user"
  ) {
    return "warning";
  }
  return "neutral";
}

export function agentRunningTone(mode: string | undefined): StatusTone {
  return mode === "planning" ? "success" : "info";
}

// Agent activity indicators intentionally collapse all non-active states to
// neutral so conversation dots only call attention to running work or pending
// user action.
export function agentActivityTone(
  status: string | undefined,
  active = false,
  mode?: string,
): StatusTone {
  if (status === "awaiting_user") return "warning";
  if (status === "running" || active) return agentRunningTone(mode);
  return "neutral";
}

export function agentActivityPulse(
  status: string | undefined,
  active = false,
): boolean {
  if (status === "awaiting_user") return false;
  return status === "running" || active;
}

// Task-specific tone mapping. Unlike `statusTone`, a finished task reads
// as muted (neutral) rather than "success" (green), which is misleading for a
// task that is no longer running.
export function taskTone(status: string | undefined): StatusTone {
  if (status === "running" || status === "ready" || status === "recovered")
    return "success";
  if (status === "starting" || status === "stopping") return "warning";
  if (
    status === "failed" ||
    status === "timed_out" ||
    status === "orphaned" ||
    status === "recovery_unknown"
  )
    return "destructive";
  return "neutral";
}

export function taskPulse(status: string | undefined): boolean {
  return (
    status === "running" ||
    status === "ready" ||
    status === "starting" ||
    status === "stopping" ||
    status === "recovered"
  );
}

export function logLevelTone(level: string): StatusTone {
  if (level === "error") return "destructive";
  if (level === "warn") return "warning";
  return "neutral";
}

export function pulseForStatus(status: string | undefined): boolean {
  return status === "running" || status === "ready" || status === "starting";
}
