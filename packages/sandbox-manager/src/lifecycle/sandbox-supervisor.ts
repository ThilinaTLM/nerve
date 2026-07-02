import type {
  ManagedContainerCreateSpec,
  ManagedSandboxRecord,
  RemoveOptions,
  StopOptions,
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
    try {
      const ref = record.containerRef ?? (await this.driver.create(spec));
      await this.driver.start(ref);
      const started: ManagedSandboxRecord = {
        ...record,
        instanceId: spec.instanceId,
        desiredState: "running",
        observedState: "running",
        containerRef: ref,
        startedAt: now,
        updatedAt: now,
        lastError: undefined,
      };
      await this.store.put(started);
      return started;
    } catch (error) {
      const failed: ManagedSandboxRecord = {
        ...record,
        desiredState: "running",
        observedState: "failed",
        updatedAt: new Date().toISOString(),
        lastError: {
          code: "START_FAILED",
          message: redactErrorMessage(error),
        },
      };
      await this.store.put(failed);
      throw error;
    }
  }

  async stop(
    sandboxId: string,
    options: StopOptions = {},
  ): Promise<ManagedSandboxRecord> {
    const record = await this.requireRecord(sandboxId);
    const now = new Date().toISOString();
    await this.store.put({
      ...record,
      desiredState: "stopped",
      observedState: "stopping",
      updatedAt: now,
    });
    if (record.containerRef)
      await this.driver.stop(record.containerRef, options);
    const stopped: ManagedSandboxRecord = {
      ...record,
      desiredState: "stopped",
      observedState: "exited",
      stoppedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.store.put(stopped);
    return stopped;
  }

  async remove(
    sandboxId: string,
    options: RemoveOptions = {},
  ): Promise<ManagedSandboxRecord> {
    const record = await this.requireRecord(sandboxId);
    if (record.containerRef)
      await this.driver.remove(record.containerRef, options);
    const removed: ManagedSandboxRecord = {
      ...record,
      desiredState: "removed",
      observedState: "removed",
      updatedAt: new Date().toISOString(),
    };
    await this.store.put(removed);
    return removed;
  }

  private async requireRecord(
    sandboxId: string,
  ): Promise<ManagedSandboxRecord> {
    const record = await this.store.get(sandboxId);
    if (!record) throw new Error(`Unknown sandbox record: ${sandboxId}`);
    return record;
  }
}

function redactErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /(token|secret|password|api[_-]?key)=\S+/gi,
    "$1=[REDACTED]",
  );
}
