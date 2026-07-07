import type {
  ManagedSandboxObservedState,
  ManagedSandboxRecord,
} from "@nervekit/shared";
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
    const next: ManagedSandboxRecord = {
      ...record,
      observedState,
      stoppedAt: status.finishedAt ?? record.stoppedAt,
      startedAt: status.startedAt ?? record.startedAt,
      updatedAt: new Date().toISOString(),
      lastError:
        observedState === "failed"
          ? {
              code: "CONTAINER_FAILED",
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

function mapObservedState(
  state: ManagedSandboxObservedState,
  exitCode?: number,
): ManagedSandboxObservedState {
  if (state === "exited" && exitCode === 22) return "reconnecting";
  if (state === "exited" && exitCode && exitCode !== 0) return "failed";
  return state;
}
