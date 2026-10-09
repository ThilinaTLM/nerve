import { SvelteSet } from "svelte/reactivity";
import { protocolRequest } from "$lib/application/startup/workbench-connection";
import {
  isMaintenanceActive,
  maintenanceUpdatedEventSchema,
  type MaintenanceOperation,
  type MaintenanceRequest,
} from "@nervekit/contracts/maintenance";
import type { StorageCleanupRequest } from "@nervekit/contracts/storage";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { notify } from "$lib/application/notifications/notify.svelte";
import { MaintenanceController } from "./maintenance-controller";
import { reconcileMaintenance } from "./maintenance-reconciliation";
const state = $state<{ operation: MaintenanceOperation | null }>({
  operation: null,
});
const listeners = new SvelteSet<() => void>();
async function start(
  request: MaintenanceRequest,
): Promise<MaintenanceOperation> {
  if (request.kind === "storage_cleanup")
    return (await protocolRequest("storage.cleanup", request.parameters)).result
      .operation;
  throw new Error("Only storage cleanup uses maintenance");
}
const controller = new MaintenanceController({
  get: async () =>
    (await protocolRequest("maintenance.get", {})).result.operation,
  start,
  cancel: async (operationId) =>
    (await protocolRequest("maintenance.cancel", { operationId })).result
      .operation,
  subscribe: (handler) =>
    onEvent("maintenance.updated", (event) => {
      const parsed = maintenanceUpdatedEventSchema.safeParse(event.data);
      if (parsed.success) handler(parsed.data.operation);
    }),
  changed: (operation) => {
    state.operation = operation;
    for (const listener of listeners) listener();
  },
  terminal: async (operation, announce) => {
    if (announce) {
      if (operation.status === "failed")
        notify.error("Cleanup failed", {
          description: operation.error ?? operation.message,
        });
      else if (operation.warnings.length || operation.status === "cancelled")
        notify.message(operation.message);
      else
        notify.success(
          operation.kind === "delete_project"
            ? "Project removed"
            : `Cleanup completed; ${operation.removedConversationCount} conversations removed`,
        );
    }
    await reconcileMaintenance();
  },
  error: (message, error) =>
    notify.error(message, {
      description: error instanceof Error ? error.message : String(error),
    }),
});
export const maintenance = {
  get operation() {
    return state.operation;
  },
  get active() {
    return isMaintenanceActive(state.operation);
  },
  start: () => controller.start(),
  dispose: () => controller.dispose(),
  reconnect: () => controller.reconnect(),
  load: () => controller.load(),
  cancel: () => controller.cancel(),
  startCleanup: (parameters: StorageCleanupRequest) =>
    controller.startRequest({ kind: "storage_cleanup", parameters }),
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
