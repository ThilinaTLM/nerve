import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import type { ManagerStore } from "../state/manager-store.js";

export class HealthMonitor {
  constructor(
    private readonly store: ManagerStore,
    private readonly driver: ContainerRuntimeDriver,
  ) {}

  async inspectAll(): Promise<void> {
    for (const record of await this.store.list()) {
      if (!record.containerRef) continue;
      try {
        const status = await this.driver.inspect(record.containerRef);
        await this.store.put({
          ...record,
          observedState: status.state,
          startedAt: status.startedAt ?? record.startedAt,
          stoppedAt: status.finishedAt ?? record.stoppedAt,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        await this.store.put({
          ...record,
          observedState: "unknown",
          updatedAt: new Date().toISOString(),
          lastError: {
            code: "HEALTH_INSPECT_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }
}
