import type {
  ManagedSandboxLifecycleState,
  ManagedSandboxObservedState,
  ManagedSandboxRecord,
} from "@nervekit/contracts";
import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import type { ManagerStore } from "../state/manager-store.js";

export class SandboxReconciler {
  constructor(
    private readonly store: ManagerStore,
    private readonly driver: ContainerRuntimeDriver,
  ) {}

  async reconcile(): Promise<void> {
    for (const record of await this.store.list())
      await refreshSandboxObservedState(this.store, this.driver, record);
  }
}

export async function refreshSandboxObservedState(
  store: ManagerStore,
  driver: ContainerRuntimeDriver,
  record: ManagedSandboxRecord,
): Promise<ManagedSandboxRecord> {
  if (!record.containerRef || record.desiredState === "removed") return record;
  try {
    const status = await driver.inspect(record.containerRef);
    const observedState = mapObservedState(status.state, status.exitCode);
    const lifecycleState = deriveLifecycleFromObserved(
      record,
      observedState,
      status.exitCode,
    );
    const now = new Date().toISOString();
    const lifecycleChanged = lifecycleState !== record.lifecycleState;
    const next: ManagedSandboxRecord = {
      ...record,
      observedState,
      lifecycleState,
      lifecycleUpdatedAt: lifecycleChanged ? now : record.lifecycleUpdatedAt,
      stoppedAt: status.finishedAt ?? record.stoppedAt,
      startedAt: status.startedAt ?? record.startedAt,
      updatedAt: now,
      lastError:
        lifecycleState === "failed" || observedState === "failed"
          ? {
              code:
                lifecycleState === "failed"
                  ? "CONTAINER_EXITED_BEFORE_READY"
                  : "CONTAINER_FAILED",
              message: `container exited${status.exitCode !== undefined ? ` ${status.exitCode}` : ""}`,
            }
          : record.lastError,
    };
    await store.put(next);
    return next;
  } catch (error) {
    const next: ManagedSandboxRecord = {
      ...record,
      observedState: "unknown",
      updatedAt: new Date().toISOString(),
      lastError: {
        code: "INSPECT_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
    await store.put(next);
    return next;
  }
}

function deriveLifecycleFromObserved(
  record: ManagedSandboxRecord,
  observedState: ManagedSandboxObservedState,
  exitCode?: number,
): ManagedSandboxLifecycleState {
  const current = record.lifecycleState;
  if (record.desiredState === "removed" || observedState === "removed")
    return "removed";
  if (record.desiredState === "stopped") return "stopped";
  if (observedState === "failed") return "failed";
  if (observedState === "exited") return "failed";
  if (observedState === "reconnecting") return "reconnecting";
  if (current === "daemon_connected" || current === "booting") return current;
  if (current === "ready" || current === "degraded") return current;
  if (current === "failed" || current === "removed") return current;
  if (observedState === "running") return "container_started";
  if (observedState === "starting") return "container_starting";
  if (observedState === "creating") return "container_creating";
  void exitCode;
  return current;
}

function mapObservedState(
  state: ManagedSandboxObservedState,
  exitCode?: number,
): ManagedSandboxObservedState {
  if (state === "exited" && exitCode === 22) return "reconnecting";
  if (state === "exited" && exitCode && exitCode !== 0) return "failed";
  return state;
}
