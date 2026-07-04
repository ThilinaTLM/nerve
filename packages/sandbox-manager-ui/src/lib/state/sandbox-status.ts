import type {
  ManagedSandboxObservedState,
  ManagedSandboxRecord,
} from "@nervekit/shared";

/** Status tones shared by StatusDot/Badge components. */
export type SandboxStatusTone =
  | "neutral"
  | "accent"
  | "running"
  | "good"
  | "warn"
  | "danger";

/** Maps a manager observed-state to a UI status-dot tone. */
export function observedStateTone(
  state: ManagedSandboxObservedState,
): SandboxStatusTone {
  switch (state) {
    case "running":
      return "good";
    case "starting":
    case "creating":
    case "reconnecting":
      return "running";
    case "stopping":
      return "warn";
    case "failed":
      return "danger";
    case "exited":
    case "removed":
      return "neutral";
    default:
      return "neutral";
  }
}

export function observedStateLabel(state: ManagedSandboxObservedState): string {
  switch (state) {
    case "running":
      return "Running";
    case "starting":
      return "Starting";
    case "creating":
      return "Creating";
    case "reconnecting":
      return "Reconnecting";
    case "stopping":
      return "Stopping";
    case "failed":
      return "Failed";
    case "exited":
      return "Exited";
    case "removed":
      return "Removed";
    default:
      return "Unknown";
  }
}

export type SandboxFleetFilter =
  | "all"
  | "running"
  | "degraded"
  | "failed"
  | "stopped";

export function matchesFleetFilter(
  record: ManagedSandboxRecord,
  filter: SandboxFleetFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return (
        record.observedState === "running" ||
        record.observedState === "starting" ||
        record.observedState === "reconnecting"
      );
    case "degraded":
      return (
        record.observedState === "reconnecting" || Boolean(record.lastError)
      );
    case "failed":
      return record.observedState === "failed";
    case "stopped":
      return (
        record.observedState === "exited" ||
        record.observedState === "stopping" ||
        record.desiredState === "stopped"
      );
    default:
      return true;
  }
}

export function matchesSearch(
  record: ManagedSandboxRecord,
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const haystack = [
    record.sandboxId,
    record.name,
    record.image.reference,
    ...Object.entries(record.labels ?? {}).map(
      ([key, value]) => `${key}=${value}`,
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(trimmed);
}

/** Lifecycle action availability given a record's observed/desired state. */
export function canStart(record: ManagedSandboxRecord): boolean {
  return (
    record.observedState === "exited" ||
    record.observedState === "failed" ||
    record.observedState === "unknown" ||
    record.desiredState === "created" ||
    record.desiredState === "stopped"
  );
}

export function canStop(record: ManagedSandboxRecord): boolean {
  return (
    record.observedState === "running" ||
    record.observedState === "starting" ||
    record.observedState === "reconnecting"
  );
}

export function canRestart(record: ManagedSandboxRecord): boolean {
  return record.observedState !== "removed";
}
