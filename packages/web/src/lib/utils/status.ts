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
  if (status === "error" || status === "failed" || status === "orphaned") {
    return "danger";
  }
  if (status === "completed" || status === "stopped" || status === "exited") {
    return "good";
  }
  if (status === "pending" || status === "stopping" || status === "aborted") {
    return "warn";
  }
  return "neutral";
}

export function logLevelTone(level: string): StatusTone {
  if (level === "error") return "danger";
  if (level === "warn") return "warn";
  return "neutral";
}

export function pulseForStatus(status: string | undefined): boolean {
  return status === "running" || status === "ready" || status === "starting";
}
