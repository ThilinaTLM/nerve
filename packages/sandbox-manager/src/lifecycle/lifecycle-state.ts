import type {
  ManagedContainerRef,
  ManagedSandboxDaemonMetadata,
  ManagedSandboxLifecycleState,
  ManagedSandboxRecord,
} from "@nervekit/contracts";
import type { ManagerLifecycleEventInput } from "../events/manager-events.js";
import type { ManagerStore } from "../state/manager-store.js";

type LifecycleEventRecorder = (
  event: ManagerLifecycleEventInput,
) => Promise<void> | void;

export type SandboxLifecycleTransitionDetails = {
  reason?: string;
  lastError?: ManagedSandboxRecord["lastError"];
  daemon?: Partial<ManagedSandboxDaemonMetadata>;
  desiredState?: ManagedSandboxRecord["desiredState"];
  observedState?: ManagedSandboxRecord["observedState"];
  containerRef?: ManagedContainerRef;
  instanceId?: string;
  startedAt?: string;
  stoppedAt?: string;
  force?: boolean;
  extra?: Record<string, unknown>;
};

export type SandboxLifecycleTransitionContext = {
  store: ManagerStore;
  recordEvent?: LifecycleEventRecorder;
};

const terminalStates = new Set<ManagedSandboxLifecycleState>([
  "failed",
  "stopped",
  "removed",
]);

export function lifecycleReadyForOperations(
  record: Pick<ManagedSandboxRecord, "lifecycleState"> | undefined,
): boolean {
  return (
    record?.lifecycleState === "ready" || record?.lifecycleState === "degraded"
  );
}

export function lifecycleSummary(record: ManagedSandboxRecord): {
  state: ManagedSandboxLifecycleState;
  updatedAt?: string;
  daemon?: ManagedSandboxDaemonMetadata;
  reason?: string;
} {
  return {
    state: record.lifecycleState,
    updatedAt: record.lifecycleUpdatedAt,
    daemon: record.daemon,
    reason: record.lastError?.message,
  };
}

export async function transitionSandboxLifecycle(
  context: SandboxLifecycleTransitionContext,
  sandboxId: string,
  nextState: ManagedSandboxLifecycleState,
  details: SandboxLifecycleTransitionDetails = {},
): Promise<ManagedSandboxRecord> {
  const current = await context.store.get(sandboxId);
  if (!current) throw new Error(`Unknown sandbox record: ${sandboxId}`);
  if (
    terminalStates.has(current.lifecycleState) &&
    current.lifecycleState !== nextState &&
    !details.force &&
    nextState !== "removed"
  ) {
    return current;
  }
  const now = new Date().toISOString();
  const daemon = details.daemon
    ? { ...(current.daemon ?? {}), ...details.daemon }
    : current.daemon;
  const next: ManagedSandboxRecord = {
    ...current,
    ...(details.instanceId ? { instanceId: details.instanceId } : {}),
    ...(details.containerRef ? { containerRef: details.containerRef } : {}),
    ...(details.startedAt ? { startedAt: details.startedAt } : {}),
    ...(details.stoppedAt ? { stoppedAt: details.stoppedAt } : {}),
    ...(details.desiredState ? { desiredState: details.desiredState } : {}),
    ...(details.observedState ? { observedState: details.observedState } : {}),
    ...(daemon ? { daemon } : {}),
    lifecycleState: nextState,
    lifecycleUpdatedAt: now,
    updatedAt: now,
    lastError: Object.hasOwn(details, "lastError")
      ? details.lastError
      : current.lastError,
  };
  await context.store.put(next);
  await context.recordEvent?.({
    type: "sandbox.lifecycle.changed",
    sandboxId,
    payload: {
      sandboxId,
      previous: current.lifecycleState,
      current: next.lifecycleState,
      changedAt: next.lifecycleUpdatedAt,
      reason: details.reason,
    },
  });
  return next;
}
