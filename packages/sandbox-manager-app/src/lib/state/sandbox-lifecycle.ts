import type {
  ManagedSandboxLifecycleState,
  ManagedSandboxObservedState,
  ManagedSandboxRecord,
  SandboxDaemonStatus,
} from "@nervekit/contracts";
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

export function sandboxLifecycleState(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): ManagedSandboxLifecycleState | undefined {
  // The record is refreshed by both detail loads and live
  // `sandbox.lifecycle.changed` events, so it is never staler than the
  // fetched status/snapshot payloads; prefer it to keep boot transitions
  // visible in real time.
  return (
    record?.lifecycleState ??
    detail?.status?.lifecycle?.state ??
    detail?.snapshot?.lifecycle?.state
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
  if (!detail) return false;
  // `controllerConnected` mirrors `status.connected` whenever the detail is
  // loaded and is kept fresh by live controller events (`sandbox.ready`,
  // `sandbox.controller.disconnected`/`reconnected`), so it wins over the
  // fetched payloads. Snapshot-only details (conversation-list preloads that
  // never fetched status) fall back to the snapshot's connected flag.
  if (detail.controllerConnected) return true;
  return detail.status === undefined && detail.snapshot?.connected === true;
}

export function sandboxIsOffline(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  const state = sandboxContainerState(record, detail);
  const lifecycle = sandboxLifecycleState(record, detail);
  return (
    lifecycle === "stopped" ||
    lifecycle === "removed" ||
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
    sandboxLifecycleState(record, detail) === "failed" ||
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
    sandboxLifecycleState(record, detail) === "stopping" ||
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
  const lifecycle = sandboxLifecycleState(record, detail);
  return (
    lifecycle === "removed" ||
    lifecycle === "stopped" ||
    lifecycle === "failed" ||
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

export function sandboxReadyForCommands(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  const lifecycle = sandboxLifecycleState(record, detail);
  const daemon = sandboxDaemonStatus(detail);
  return (
    lifecycle === "ready" ||
    lifecycle === "degraded" ||
    daemon === "ready" ||
    daemon === "degraded"
  );
}

export function sandboxCanForwardCommand(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  return (
    sandboxIsConnected(detail) &&
    sandboxReadyForCommands(record, detail) &&
    !sandboxIsReadOnly(record, detail)
  );
}

export function sandboxShouldPollStatus(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): boolean {
  const daemon = sandboxDaemonStatus(detail);
  const lifecycle = sandboxLifecycleState(record, detail);
  if (lifecycle === "ready" || lifecycle === "degraded") return false;
  if (
    lifecycle === "failed" ||
    lifecycle === "stopped" ||
    lifecycle === "removed"
  )
    return false;
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
  const lifecycle = sandboxLifecycleState(record, detail);
  if (state === "removed" || record?.desiredState === "removed")
    return "The sandbox container has been removed. Previous conversations are read-only snapshots.";
  if (sandboxIsFailed(record, detail))
    return "The sandbox failed. Restart it before sending new commands.";
  if (sandboxIsStopping(record, detail))
    return "The sandbox is stopping. New commands are disabled until it is started again.";
  if (sandboxIsOffline(record, detail))
    return "The sandbox container is offline. Previous conversations are read-only snapshots until you start or restart it.";
  if (lifecycle === "container_started")
    return "The container is running. Waiting for the sandbox controller to connect.";
  if (lifecycle === "daemon_connected" || lifecycle === "booting")
    return "The sandbox controller is connected and booting. Messages can be queued and will send when ready.";
  if (!sandboxIsConnected(detail)) {
    const daemon = sandboxDaemonStatus(detail);
    if (daemon === "booting")
      return "The sandbox is booting. Messages can be queued and will send when ready.";
    return "Waiting for the sandbox controller to reconnect.";
  }
  return sandboxReadyForCommands(record, detail)
    ? "Sandbox is ready."
    : "The sandbox controller is connected; waiting for readiness.";
}

export function sandboxLifecycleBadgeLabel(
  record: ManagedSandboxRecord | undefined,
  detail: SandboxDetailState | undefined,
): string {
  const lifecycle = sandboxLifecycleState(record, detail);
  const daemon = sandboxDaemonStatus(detail);
  if (lifecycle) return lifecycle;
  if (sandboxIsConnected(detail)) return "connected";
  if (daemon === "offline") return "offline";
  if (daemon) return daemon;
  return sandboxContainerState(record, detail) ?? "unknown";
}
