import { randomUUID } from "node:crypto";
import {
  isMaintenanceActive,
  type MaintenanceOperation,
  type MaintenanceRequest,
} from "@nervekit/contracts/maintenance";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import type {
  MaintenanceExecution,
  MaintenanceProgressPatch,
} from "./maintenance-execution.js";

export interface MaintenanceServiceDeps {
  repository: {
    read(): Promise<MaintenanceOperation | null>;
    write(operation: MaintenanceOperation): Promise<void>;
  };
  publish(operation: MaintenanceOperation): Promise<unknown>;
  execute(
    request: MaintenanceRequest,
    execution: MaintenanceExecution,
  ): Promise<void>;
  getProject(projectId: string): ProjectRecord;
  reserveProject(projectId: string): () => void;
  warn(error: unknown): Promise<unknown>;
}

/** Single daemon-owned destructive lane; executors own work, never scheduling. */
export class MaintenanceService {
  #operation: MaintenanceOperation | null = null;
  #execution?: Promise<void>;
  #writes = Promise.resolve();
  #busy = false;
  #closing = false;
  #lastPublish = 0;
  constructor(private readonly deps: MaintenanceServiceDeps) {}

  async hydrate(): Promise<void> {
    this.#operation = await this.deps.repository.read();
    if (isMaintenanceActive(this.#operation))
      await this.patch(
        {
          status: "failed",
          completedAt: new Date().toISOString(),
          cancellable: false,
          phase: "interrupted",
          message: "Cleanup was interrupted when the daemon stopped.",
          error:
            "The daemon stopped before cleanup completed. Already removed data is not restored.",
        },
        true,
      );
  }
  get(): MaintenanceOperation | null {
    return this.#operation ? structuredClone(this.#operation) : null;
  }

  async start(request: MaintenanceRequest): Promise<MaintenanceOperation> {
    if (this.#closing) throw new Error("The daemon is shutting down.");
    if (this.#busy)
      throw new Error(
        `Cleanup is already in progress: ${this.#operation?.message} (${this.#operation?.id})`,
      );
    const project =
      request.kind === "storage_cleanup"
        ? undefined
        : this.deps.getProject(request.projectId);
    const release =
      request.kind === "delete_project"
        ? this.deps.reserveProject(request.projectId)
        : () => undefined;
    const now = new Date().toISOString();
    const operation: MaintenanceOperation = {
      id: `maintenanceop_${randomUUID()}`,
      revision: 1,
      kind: request.kind,
      request,
      project,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      phase: "queued",
      message: "Cleanup is queued.",
      cancellable: request.kind !== "delete_project",
      cancellationRequested: false,
      completedItems: 0,
      completedTargets: 0,
      totalTargets:
        request.kind === "storage_cleanup"
          ? Object.values(request.parameters).filter(
              (value) => value !== undefined && value !== false,
            ).length
          : 0,
      removedConversationCount: 0,
      removedTaskCount: 0,
      skippedActiveAgentCount: 0,
      skippedActiveTaskCount: 0,
      freedBytes: 0,
      warnings: [],
    };
    // Reserve before the very first await, including queued-state persistence.
    this.#busy = true;
    this.#operation = operation;
    const accepted = this.persist(operation);
    this.#execution = accepted
      .then(async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        await this.patch(
          {
            status: this.#operation?.cancellationRequested
              ? "cancelling"
              : "running",
            phase: "preparing",
            message: "Preparing cleanup…",
            startedAt: new Date().toISOString(),
          },
          true,
        );
        await this.deps.execute(request, {
          operationId: operation.id,
          cancelled: () => this.#operation?.cancellationRequested ?? false,
          report: (patch) => this.report(patch),
        });
        const cancelled = this.#operation?.cancellationRequested;
        await this.patch(
          {
            status: cancelled ? "cancelled" : "succeeded",
            phase: "completed",
            completedAt: new Date().toISOString(),
            cancellable: false,
            currentItem: undefined,
            currentTarget: undefined,
            message: cancelled
              ? "Cleanup stopped. Already removed data is not restored."
              : this.#operation?.warnings.length
                ? "Cleanup completed with issues."
                : "Cleanup completed.",
          },
          true,
        );
      })
      .catch(async (error: unknown) => {
        await this.patch(
          {
            status: "failed",
            phase: "completed",
            completedAt: new Date().toISOString(),
            cancellable: false,
            message: "Cleanup failed. Some data may already have been removed.",
            error: error instanceof Error ? error.message : String(error),
          },
          true,
        ).catch(() => undefined);
        await this.deps.warn(error).catch(() => undefined);
      })
      .finally(() => {
        release();
        this.#busy = false;
      });
    await accepted;
    return operation;
  }
  async cancel(operationId: string): Promise<MaintenanceOperation> {
    if (!this.#operation || this.#operation.id !== operationId)
      throw new Error("Maintenance operation not found.");
    if (!isMaintenanceActive(this.#operation)) return this.get()!;
    if (!this.#operation.cancellable)
      throw new Error("This operation cannot be interrupted safely.");
    await this.patch(
      {
        status: "cancelling",
        cancellationRequested: true,
        message:
          "Stopping after the current safe item. Already removed data is not restored.",
      },
      true,
    );
    return this.get()!;
  }
  async shutdown(): Promise<void> {
    this.#closing = true;
    if (isMaintenanceActive(this.#operation) && this.#operation?.cancellable)
      await this.cancel(this.#operation.id).catch(() => undefined);
    await this.#execution;
    await this.#writes;
  }
  private report(patch: MaintenanceProgressPatch): Promise<void> {
    const immediate =
      (patch.phase !== undefined && patch.phase !== this.#operation?.phase) ||
      ("currentItem" in patch &&
        patch.currentItem?.stage !== this.#operation?.currentItem?.stage) ||
      ("currentTarget" in patch &&
        patch.currentTarget !== this.#operation?.currentTarget);
    return this.patch(patch, immediate);
  }
  private patch(
    patch: Partial<MaintenanceOperation>,
    immediate: boolean,
  ): Promise<void> {
    if (!this.#operation) return Promise.resolve();
    this.#operation = {
      ...this.#operation,
      ...patch,
      revision: this.#operation.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    if (!immediate && performance.now() - this.#lastPublish < 250)
      return Promise.resolve();
    return this.persist(this.#operation);
  }
  private persist(operation: MaintenanceOperation): Promise<void> {
    this.#lastPublish = performance.now();
    const write = this.#writes.then(async () => {
      await this.deps.repository.write(operation);
      await this.deps.publish(operation);
    });
    this.#writes = write.catch(() => undefined);
    return write;
  }
}
