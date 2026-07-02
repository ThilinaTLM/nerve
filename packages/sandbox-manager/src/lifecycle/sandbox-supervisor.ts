import type {
  ManagedContainerCreateSpec,
  ManagedSandboxRecord,
} from "@nervekit/shared";
import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import type { ManagerStore } from "../state/manager-store.js";

export class SandboxSupervisor {
  constructor(
    private readonly store: ManagerStore,
    private readonly driver: ContainerRuntimeDriver,
  ) {}

  async create(record: ManagedSandboxRecord): Promise<ManagedSandboxRecord> {
    const now = new Date().toISOString();
    const next: ManagedSandboxRecord = {
      ...record,
      desiredState: "created",
      observedState: "creating",
      updatedAt: now,
    };
    await this.store.put(next);
    return next;
  }

  async start(
    sandboxId: string,
    spec: ManagedContainerCreateSpec,
  ): Promise<ManagedSandboxRecord> {
    const record = await this.requireRecord(sandboxId);
    const now = new Date().toISOString();
    await this.store.put({
      ...record,
      desiredState: "running",
      observedState: "starting",
      updatedAt: now,
    });
    const ref = await this.driver.create(spec);
    await this.driver.start(ref);
    const started: ManagedSandboxRecord = {
      ...record,
      instanceId: spec.instanceId,
      desiredState: "running",
      observedState: "running",
      startedAt: now,
      updatedAt: now,
    };
    await this.store.put(started);
    return started;
  }

  async stop(sandboxId: string): Promise<ManagedSandboxRecord> {
    const record = await this.requireRecord(sandboxId);
    const now = new Date().toISOString();
    const stopped: ManagedSandboxRecord = {
      ...record,
      desiredState: "stopped",
      observedState: "stopping",
      stoppedAt: now,
      updatedAt: now,
    };
    await this.store.put(stopped);
    return stopped;
  }

  private async requireRecord(
    sandboxId: string,
  ): Promise<ManagedSandboxRecord> {
    const record = await this.store.get(sandboxId);
    if (!record) throw new Error(`Unknown sandbox record: ${sandboxId}`);
    return record;
  }
}
