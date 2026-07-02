import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import type { ManagerStore } from "../state/manager-store.js";

export class HealthMonitor {
  constructor(
    private readonly store: ManagerStore,
    private readonly driver: ContainerRuntimeDriver,
  ) {}

  async inspectAll(): Promise<void> {
    for (const record of await this.store.list()) {
      if (record.instanceId) void this.driver;
    }
  }
}
