import type {
  ManagedContainerCreateSpec,
  ManagedSandboxRecord,
  RemoveOptions,
  StopOptions,
} from "@nervekit/shared";
import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import type { ManagerLifecycleEventInput } from "../events/manager-events.js";
import type { ManagerStore } from "../state/manager-store.js";

type LifecycleEventRecorder = (
  event: ManagerLifecycleEventInput,
) => Promise<void> | void;

export class SandboxSupervisor {
  constructor(
    private readonly store: ManagerStore,
    private readonly driver: ContainerRuntimeDriver,
    private readonly recordEvent?: LifecycleEventRecorder,
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
    await this.emit("manager.sandbox.created", next, {
      desiredState: next.desiredState,
      observedState: next.observedState,
    });
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
    await this.emit("manager.sandbox.start_requested", record, {
      desiredState: "running",
      observedState: "starting",
    });
    try {
      const ref = record.containerRef ?? (await this.driver.create(spec));
      await this.driver.start(ref);
      const started: ManagedSandboxRecord = {
        ...record,
        instanceId: spec.instanceId,
        backend: ref.kind || record.backend,
        desiredState: "running",
        observedState: "running",
        containerRef: ref,
        startedAt: now,
        updatedAt: now,
        lastError: undefined,
      };
      await this.store.put(started);
      await this.emit("manager.sandbox.started", started, {
        desiredState: started.desiredState,
        observedState: started.observedState,
        containerRef: started.containerRef,
      });
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
      await this.emit("manager.sandbox.start_failed", failed, {
        desiredState: failed.desiredState,
        observedState: failed.observedState,
        error: failed.lastError,
      });
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
    await this.emit("manager.sandbox.stop_requested", record, {
      desiredState: "stopped",
      observedState: "stopping",
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
    await this.emit("manager.sandbox.stopped", stopped, {
      desiredState: stopped.desiredState,
      observedState: stopped.observedState,
    });
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
    await this.emit("manager.sandbox.removed", removed, {
      desiredState: removed.desiredState,
      observedState: removed.observedState,
    });
    return removed;
  }

  private async emit(
    type: string,
    record: ManagedSandboxRecord,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.recordEvent?.({
      type,
      sandboxId: record.sandboxId,
      payload: {
        ...payload,
        sandboxId: record.sandboxId,
        instanceId: record.instanceId,
        backend: record.backend,
        image: record.image,
      },
    });
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
