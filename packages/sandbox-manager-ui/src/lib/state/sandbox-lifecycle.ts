import type {
  ManagedSandboxObservedState,
  ManagedSandboxRecord,
  SandboxDaemonStatus,
} from "@nervekit/shared";
import type { SandboxDetailState } from "./sandbox-ui-types";

export function sandboxContainerState(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): ManagedSandboxObservedState | undefined {
  return (
    detail?.status?.container?.state ??
    detail?.snapshot?.container?.state ??
    record?.observedState
  );
}

export function sandboxDaemonStatus(
  detail: SandboxDetailState | undefined,
): SandboxDaemonStatus | undefined {
  return detail?.status?.status ?? detail?.snapshot?.status;
}

export function sandboxIsConnected(
  detail: SandboxDetailState | undefined,
): boolean {
  if (typeof detail?.status?.connected === "boolean") {
    return detail.status.connected;
  }
  return (
    detail?.controllerConnected === true || detail?.snapshot?.connected === true
  );
}

export function sandboxIsOffline(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  const state = sandboxContainerState(record, detail);
  return (
    sandboxDaemonStatus(detail) === "offline" ||
    state === "exited" ||
    state === "removed" ||
    record?.desiredState === "stopped" ||
    record?.desiredState === "removed"
  );
}

export function sandboxIsFailed(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  const state = sandboxContainerState(record, detail);
  return (
    sandboxDaemonStatus(detail) === "failed" ||
    state === "failed" ||
    record?.observedState === "failed"
  );
}

export function sandboxIsStopping(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  return (
    sandboxDaemonStatus(detail) === "stopping" ||
    sandboxContainerState(record, detail) === "stopping" ||
    record?.observedState === "stopping"
  );
}

export function sandboxIsTerminal(
  record: ManagedSandboxRecord | undefined,
  detail?: SandboxDetailState | undefined,
): boolean {
  const state = sandboxContainerState(record, detail);
  return (
    state === "removed" ||
    state === "exited" ||
    state === "failed" ||
    record?.desiredState === "removed"
  );
}

export function sandboxIsReadOnly(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  return (
    sandboxIsOffline(record, detail) ||
    sandboxIsFailed(record, detail) ||
    sandboxIsStopping(record, detail)
  );
}

export function sandboxCanCreateConversation(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  return (
    !sandboxIsReadOnly(record, detail) && !sandboxIsTerminal(record, detail)
  );
}

export function sandboxCanQueuePrompt(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  return sandboxCanCreateConversation(record, detail);
}

export function sandboxCanForwardCommand(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  return sandboxIsConnected(detail) && !sandboxIsReadOnly(record, detail);
}

export function sandboxShouldPollStatus(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  const daemon = sandboxDaemonStatus(detail);
  if (sandboxIsConnected(detail)) return false;
  if (daemon === "offline" || daemon === "failed" || daemon === "stopping")
    return false;
  if (sandboxIsTerminal(record, detail) || sandboxIsStopping(record, detail))
    return false;
  return true;
}

export function sandboxLifecycleMessage(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): string {
  const state = sandboxContainerState(record, detail);
  if (state === "removed" || record?.desiredState === "removed")
    return "The sandbox container has been removed. Previous conversations are read-only snapshots.";
  if (sandboxIsFailed(record, detail))
    return "The sandbox failed. Restart it before sending new commands.";
  if (sandboxIsStopping(record, detail))
    return "The sandbox is stopping. New commands are disabled until it is started again.";
  if (sandboxIsOffline(record, detail))
    return "The sandbox container is offline. Previous conversations are read-only snapshots until you start or restart it.";
  if (!sandboxIsConnected(detail)) {
    const daemon = sandboxDaemonStatus(detail);
    if (daemon === "booting")
      return "The sandbox is booting. Messages can be queued and will send when the controller connects.";
    return "Waiting for the sandbox controller to reconnect.";
  }
  return "Sandbox is ready.";
}

export function sandboxLifecycleBadgeLabel(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): string {
  const daemon = sandboxDaemonStatus(detail);
  if (sandboxIsConnected(detail)) return "connected";
  if (daemon === "offline") return "offline";
  if (daemon) return daemon;
  return sandboxContainerState(record, detail) ?? "unknown";
}
