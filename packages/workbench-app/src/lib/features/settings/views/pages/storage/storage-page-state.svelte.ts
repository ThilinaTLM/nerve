import type {
  StorageCleanupRequest,
  StorageUsageResponse,
} from "@nervekit/contracts/storage";
import { maintenance } from "$lib/application/maintenance/maintenance-state.svelte";
import { getStorageUsage } from "$lib/features/settings/api/storage.api";
/** Feature-owned usage and dialog state. Maintenance subscription/polling is global. */
export class StoragePageController {
  usage = $state<StorageUsageResponse | undefined>();
  loading = $state(true);
  refreshing = $state(false);
  errorMessage = $state<string | undefined>();
  cleanupDialogOpen = $state(false);
  #generation = 0;
  #unsubscribe?: () => void;
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
    this.dispose();
    const generation = this.#generation;
    maintenance.start();
    void this.loadUsage();
    this.#unsubscribe = maintenance.subscribe(() => {
      const operation = maintenance.operation;
      if (
        generation !== this.#generation ||
        !operation?.completedAt ||
        this.#terminalId === operation.id
      )
        return;
      this.#terminalId = operation.id;
      void this.loadUsage(true);
    });
  }
  dispose(): void {
    ++this.#generation;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }
  async loadUsage(force = false): Promise<void> {
    const generation = this.#generation;
    if (force) this.refreshing = true;
    this.errorMessage = undefined;
    try {
      const usage = await getStorageUsage();
      if (generation === this.#generation) this.usage = usage;
    } catch (error) {
      if (generation === this.#generation)
        this.errorMessage =
          error instanceof Error
            ? error.message
            : "Could not load storage usage.";
    } finally {
      if (generation === this.#generation) {
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
