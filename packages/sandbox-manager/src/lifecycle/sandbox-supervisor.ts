import type {
  ManagedContainerCreateSpec,
  ManagedSandboxRecord,
  RemoveOptions,
  StopOptions,
} from "@nervekit/shared";
import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import type { ManagerLifecycleEventInput } from "../events/manager-events.js";
import type { ManagerStore } from "../state/manager-store.js";
import { transitionSandboxLifecycle } from "./lifecycle-state.js";

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
      observedState: "unknown",
      lifecycleState: "record_created",
      lifecycleUpdatedAt: record.lifecycleUpdatedAt ?? now,
      updatedAt: now,
    };
    await this.store.put(next);
    await this.emit("manager.sandbox.created", next, {
      desiredState: next.desiredState,
      observedState: next.observedState,
      lifecycleState: next.lifecycleState,
    });
    return next;
  }

  async start(
    sandboxId: string,
    spec: ManagedContainerCreateSpec,
  ): Promise<ManagedSandboxRecord> {
    let record = await transitionSandboxLifecycle(
      { store: this.store, recordEvent: this.recordEvent },
      sandboxId,
      "container_creating",
      {
        desiredState: "running",
        observedState: "starting",
        instanceId: spec.instanceId,
        force: true,
      },
    );
    await this.emit("manager.sandbox.start_requested", record, {
      desiredState: "running",
      observedState: "starting",
      lifecycleState: "container_creating",
    });
    try {
      let ref = record.containerRef;
      if (ref) {
        try {
          const status = await this.driver.inspect(ref);
          if (status.state === "unknown" || status.state === "removed")
            ref = undefined;
        } catch {
          ref = undefined;
        }
      }
      if (!ref) ref = await this.driver.create(spec);
      record = await transitionSandboxLifecycle(
        { store: this.store, recordEvent: this.recordEvent },
        sandboxId,
        "container_created",
        {
          desiredState: "running",
          observedState: "starting",
          containerRef: ref,
          instanceId: spec.instanceId,
          force: true,
        },
      );
      await this.emit("manager.sandbox.container_created", record, {
        desiredState: record.desiredState,
        observedState: record.observedState,
        lifecycleState: record.lifecycleState,
        containerRef: ref,
      });
      record = await transitionSandboxLifecycle(
        { store: this.store, recordEvent: this.recordEvent },
        sandboxId,
        "container_starting",
        {
          desiredState: "running",
          observedState: "starting",
          containerRef: ref,
          force: true,
        },
      );
      await this.driver.start(ref);
      const inspected = await this.driver.inspect(ref).catch(() => undefined);
      const running = inspected?.state === "running";
      if (!running) return record;
      const started = await transitionSandboxLifecycle(
        { store: this.store, recordEvent: this.recordEvent },
        sandboxId,
        "container_started",
        {
          desiredState: "running",
          observedState: "running",
          containerRef: ref,
          startedAt: inspected?.startedAt ?? new Date().toISOString(),
          lastError: undefined,
          force: true,
        },
      );
      await this.emit("manager.sandbox.container_started", started, {
        desiredState: started.desiredState,
        observedState: started.observedState,
        lifecycleState: started.lifecycleState,
        containerRef: started.containerRef,
      });
      await this.emit("manager.sandbox.started", started, {
        desiredState: started.desiredState,
        observedState: started.observedState,
        lifecycleState: started.lifecycleState,
        containerRef: started.containerRef,
      });
      return started;
    } catch (error) {
      const failed = await transitionSandboxLifecycle(
        { store: this.store, recordEvent: this.recordEvent },
        sandboxId,
        "failed",
        {
          desiredState: "running",
          observedState: "failed",
          lastError: {
            code: "START_FAILED",
            message: redactErrorMessage(error),
          },
          force: true,
        },
      );
      await this.emit("manager.sandbox.start_failed", failed, {
        desiredState: failed.desiredState,
        observedState: failed.observedState,
        lifecycleState: failed.lifecycleState,
        error: failed.lastError,
      });
      throw error;
    }
  }

  async stop(
    sandboxId: string,
    options: StopOptions = {},
  ): Promise<ManagedSandboxRecord> {
    let record = await transitionSandboxLifecycle(
      { store: this.store, recordEvent: this.recordEvent },
      sandboxId,
      "stopping",
      { desiredState: "stopped", observedState: "stopping", force: true },
    );
    await this.emit("manager.sandbox.stop_requested", record, {
      desiredState: "stopped",
      observedState: "stopping",
      lifecycleState: "stopping",
    });
    if (record.containerRef)
      await this.driver.stop(record.containerRef, options);
    record = await transitionSandboxLifecycle(
      { store: this.store, recordEvent: this.recordEvent },
      sandboxId,
      "stopped",
      {
        desiredState: "stopped",
        observedState: "exited",
        stoppedAt: new Date().toISOString(),
        force: true,
      },
    );
    await this.emit("manager.sandbox.stopped", record, {
      desiredState: record.desiredState,
      observedState: record.observedState,
      lifecycleState: record.lifecycleState,
    });
    return record;
  }

  async remove(
    sandboxId: string,
    options: RemoveOptions = {},
  ): Promise<ManagedSandboxRecord> {
    const record = await this.requireRecord(sandboxId);
    if (record.containerRef)
      await this.driver.remove(record.containerRef, options);
    const removed = await transitionSandboxLifecycle(
      { store: this.store, recordEvent: this.recordEvent },
      sandboxId,
      "removed",
      { desiredState: "removed", observedState: "removed", force: true },
    );
    await this.emit("manager.sandbox.removed", removed, {
      desiredState: removed.desiredState,
      observedState: removed.observedState,
      lifecycleState: removed.lifecycleState,
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
