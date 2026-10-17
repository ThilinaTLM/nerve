import type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
import type {
  ActivityHandle,
  ActivityProducerPort,
} from "./activity.service.js";

/** Mirrors maintenance; its destructive lane and Settings contract remain authoritative. */
export class MaintenanceActivityProducer {
  #handle?: ActivityHandle;
  #id?: string;
  constructor(
    private readonly activities: ActivityProducerPort,
    private readonly cancel: (id: string) => Promise<unknown>,
  ) {}
  report(operation: MaintenanceOperation): void {
    if (this.#id !== operation.id) {
      this.#id = operation.id;
      this.#handle = this.activities.start(
        {
          id: operation.id,
          kind: `maintenance.${operation.kind}`,
          title:
            operation.kind === "storage_cleanup"
              ? "Clean storage"
              : operation.kind === "delete_project"
                ? "Delete project"
                : "Prune conversations",
          status: "queued",
          scope: operation.project
            ? {
                projectId: operation.project.id,
                projectName: operation.project.name,
              }
            : undefined,
        },
        {
          cancel: operation.cancellable
            ? async () => {
                await this.cancel(operation.id);
              }
            : undefined,
        },
      );
    }
    const handle = this.#handle!;
    handle.progress({
      status: operation.status === "queued" ? "queued" : "running",
      phase: operation.phase,
      message: operation.message,
      cancellable: operation.cancellable && !operation.cancellationRequested,
      progress:
        operation.totalItems && operation.totalItems > 0
          ? { completed: operation.completedItems, total: operation.totalItems }
          : undefined,
    });
    if (operation.status === "succeeded") handle.succeed();
    else if (operation.status === "cancelled") handle.cancelled();
    else if (operation.status === "failed") {
      if (operation.phase === "interrupted") handle.interrupt();
      else
        handle.fail({
          message:
            "Maintenance failed. Some data may already have been removed. See Settings → Storage for details.",
        });
    }
  }
}
