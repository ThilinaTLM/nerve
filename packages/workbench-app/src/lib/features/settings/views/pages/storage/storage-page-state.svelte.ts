import type {
  StorageCleanupRequest,
  StorageUsageResponse,
} from "@nervekit/contracts/storage";
import { maintenance } from "$lib/application/maintenance/maintenance-state.svelte";
import { ControllerLifecycle } from "$lib/platform/lifecycle/controller-lifecycle";
import { getStorageUsage } from "$lib/features/settings/api/storage.api";
/** Feature-owned usage and dialog state. Maintenance subscription/polling is global. */
export class StoragePageController {
  usage = $state<StorageUsageResponse | undefined>();
  loading = $state(true);
  refreshing = $state(false);
  errorMessage = $state<string | undefined>();
  cleanupDialogOpen = $state(false);
  #life = new ControllerLifecycle();
  #terminalId?: string;
  get operation() {
    return maintenance.operation;
  }
  get active() {
    return maintenance.active;
  }
  get operationLoading() {
    return false;
  }
  start(): void {
    this.#life.restart((scope) => {
      maintenance.start();
      void this.loadUsage();
      scope.onDispose(
        maintenance.subscribe(() => {
          const operation = maintenance.operation;
          if (
            !scope.isCurrent() ||
            !operation?.completedAt ||
            this.#terminalId === operation.id
          )
            return;
          this.#terminalId = operation.id;
          void this.loadUsage(true);
        }),
      );
    });
  }
  dispose(): void {
    this.#life.dispose();
  }
  async loadUsage(force = false): Promise<void> {
    const isCurrent = this.#life.capture();
    if (force) this.refreshing = true;
    this.errorMessage = undefined;
    try {
      const usage = await getStorageUsage();
      if (isCurrent()) this.usage = usage;
    } catch (error) {
      if (isCurrent())
        this.errorMessage =
          error instanceof Error
            ? error.message
            : "Could not load storage usage.";
    } finally {
      if (isCurrent()) {
        this.loading = false;
        this.refreshing = false;
      }
    }
  }
  startCleanup(request: StorageCleanupRequest): Promise<boolean> {
    return maintenance.startCleanup(request);
  }
  cancelCleanup(): Promise<void> {
    return maintenance.cancel();
  }
}
