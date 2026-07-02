import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import type { ManagerStore } from "../state/manager-store.js";

export class SandboxReconciler {
  constructor(
    private readonly store: ManagerStore,
    private readonly driver: ContainerRuntimeDriver,
  ) {}

  async reconcile(): Promise<void> {
    for (const record of await this.store.list()) {
      if (!record.instanceId || record.desiredState === "removed") continue;
      void this.driver;
    }
  }
}
