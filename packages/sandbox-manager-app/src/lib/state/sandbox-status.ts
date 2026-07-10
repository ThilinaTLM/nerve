import type {
  ManagedSandboxLifecycleState,
  ManagedSandboxObservedState,
  ManagedSandboxRecord,
} from "@nervekit/contracts";

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

export function lifecycleStateTone(
  state: ManagedSandboxLifecycleState,
): SandboxStatusTone {
  switch (state) {
    case "ready":
      return "good";
    case "degraded":
      return "warn";
    case "record_created":
    case "container_creating":
    case "container_created":
    case "container_starting":
    case "container_started":
    case "daemon_connected":
    case "booting":
    case "reconnecting":
      return "running";
    case "stopping":
      return "warn";
    case "failed":
      return "danger";
    case "stopped":
    case "removed":
      return "neutral";
    default:
      return "neutral";
  }
}

export function lifecycleStateLabel(
  state: ManagedSandboxLifecycleState,
): string {
  switch (state) {
    case "record_created":
      return "Record created";
    case "container_creating":
      return "Creating container";
    case "container_created":
      return "Container created";
    case "container_starting":
      return "Starting container";
    case "container_started":
      return "Container started";
    case "daemon_connected":
      return "Controller connected";
    case "booting":
      return "Booting";
    case "ready":
      return "Ready";
    case "degraded":
      return "Degraded";
    case "reconnecting":
      return "Reconnecting";
    case "stopping":
      return "Stopping";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    case "removed":
      return "Removed";
    default:
      return "Unknown";
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
        record.lifecycleState === "ready" ||
        record.lifecycleState === "degraded" ||
        record.lifecycleState === "booting" ||
        record.lifecycleState === "daemon_connected" ||
        record.lifecycleState === "container_started" ||
        record.lifecycleState === "container_starting"
      );
    case "degraded":
      return (
        record.lifecycleState === "degraded" ||
        record.lifecycleState === "reconnecting" ||
        Boolean(record.lastError)
      );
    case "failed":
      return record.lifecycleState === "failed";
    case "stopped":
      return (
        record.lifecycleState === "stopped" ||
        record.lifecycleState === "stopping" ||
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
    record.lifecycleState === "stopped" ||
    record.lifecycleState === "failed" ||
    record.lifecycleState === "record_created" ||
    record.desiredState === "created" ||
    record.desiredState === "stopped"
  );
}

export function canStop(record: ManagedSandboxRecord): boolean {
  return (
    record.lifecycleState === "ready" ||
    record.lifecycleState === "degraded" ||
    record.lifecycleState === "booting" ||
    record.lifecycleState === "daemon_connected" ||
    record.lifecycleState === "container_started" ||
    record.lifecycleState === "container_starting" ||
    record.lifecycleState === "reconnecting"
  );
}

export function canRestart(record: ManagedSandboxRecord): boolean {
  return record.lifecycleState !== "removed";
}
