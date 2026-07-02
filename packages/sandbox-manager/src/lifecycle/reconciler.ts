import type { ManagedSandboxObservedState } from "@nervekit/shared";
import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import type { ManagerStore } from "../state/manager-store.js";

export class SandboxReconciler {
  constructor(
    private readonly store: ManagerStore,
    private readonly driver: ContainerRuntimeDriver,
  ) {}

  async reconcile(): Promise<void> {
    for (const record of await this.store.list()) {
      if (!record.containerRef || record.desiredState === "removed") continue;
      try {
        const status = await this.driver.inspect(record.containerRef);
        const observedState = mapObservedState(status.state, status.exitCode);
        await this.store.put({
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
        });
      } catch (error) {
        await this.store.put({
          ...record,
          observedState: "unknown",
          updatedAt: new Date().toISOString(),
          lastError: {
            code: "INSPECT_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
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
