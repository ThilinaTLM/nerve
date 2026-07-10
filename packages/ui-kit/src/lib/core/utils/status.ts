export type StatusTone =
  | "neutral"
  | "accent"
  | "good"
  | "warn"
  | "danger"
  | "running";

export function statusTone(status: string | undefined): StatusTone {
  if (status === "running" || status === "ready" || status === "starting") {
    return "running";
  }
  if (
    status === "error" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "orphaned"
  ) {
    return "danger";
  }
  if (status === "completed" || status === "stopped" || status === "exited") {
    return "good";
  }
  if (
    status === "pending" ||
    status === "stopping" ||
    status === "aborted" ||
    status === "awaiting_user"
  ) {
    return "warn";
  }
  return "neutral";
}

export function agentRunningTone(mode: string | undefined): StatusTone {
  return mode === "planning" ? "good" : "running";
}

// Agent activity indicators intentionally collapse all non-active states to
// neutral so conversation dots only call attention to running work or pending
// user action.
export function agentActivityTone(
  status: string | undefined,
  active = false,
  mode?: string,
): StatusTone {
  if (status === "awaiting_user") return "warn";
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
// as muted (neutral) rather than "good" (green), which is misleading for a
// task that is no longer running.
export function taskTone(status: string | undefined): StatusTone {
  if (status === "running" || status === "ready") return "good";
  if (status === "starting" || status === "stopping") return "warn";
  if (status === "failed" || status === "timed_out" || status === "orphaned")
    return "danger";
  return "neutral";
}

export function taskPulse(status: string | undefined): boolean {
  return (
    status === "running" ||
    status === "ready" ||
    status === "starting" ||
    status === "stopping"
  );
}

export function logLevelTone(level: string): StatusTone {
  if (level === "error") return "danger";
  if (level === "warn") return "warn";
  return "neutral";
}

export function pulseForStatus(status: string | undefined): boolean {
  return status === "running" || status === "ready" || status === "starting";
}
