import {
  isMaintenanceActive,
  type MaintenanceOperation,
} from "@nervekit/contracts/maintenance";
import type {
  StorageCleanupRequest,
  StorageCleanupTarget,
  StorageUsageResponse,
} from "@nervekit/contracts/storage";
import { maintenance } from "$lib/application/maintenance/maintenance-state.svelte";
import { ControllerLifecycle } from "$lib/platform/lifecycle/controller-lifecycle";
import { getStorageUsage } from "$lib/features/settings/api/storage.api";

/** A shown scan older than this is refreshed in the background on open. */
export const STORAGE_USAGE_STALE_MS = 60_000;

/** Feature-owned usage and dialog state. Maintenance subscription/polling is global. */
export class StoragePageController {
  usage = $state<StorageUsageResponse | undefined>();
  loading = $state(true);
  /** A scan is running while older usage stays on screen. */
  refreshing = $state(false);
  errorMessage = $state<string | undefined>();
  cleanupDialogOpen = $state(false);
  /** Target the cleanup dialog opens with selected; none opens it empty. */
  cleanupPreset = $state<StorageCleanupTarget | undefined>();
  #dismissedId = $state<string | undefined>();
  /** Results finished before the page was first opened are not shown. */
  #openedAt = Date.now();
  #life = new ControllerLifecycle();
  #terminalId?: string;
  get operation() {
    return maintenance.operation;
  }
  get active() {
    return maintenance.active;
  }
  /** The running cleanup, or the finished storage cleanup until dismissed. */
  get shownOperation(): MaintenanceOperation | undefined {
    const operation = maintenance.operation;
    if (!operation) return undefined;
    if (isMaintenanceActive(operation)) return operation;
    if (
      operation.kind !== "storage_cleanup" ||
      operation.id === this.#dismissedId ||
      !operation.completedAt ||
      Date.parse(operation.completedAt) < this.#openedAt
    )
      return undefined;
    return operation;
  }
  start(): void {
    this.#life.restart((scope) => {
      maintenance.start();
      void this.#open();
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
  /** Show the daemon's last scan at once, then rescan if it is old. */
  async #open(): Promise<void> {
    await this.loadUsage();
    const generatedAt = this.usage && Date.parse(this.usage.generatedAt);
    if (generatedAt && Date.now() - generatedAt > STORAGE_USAGE_STALE_MS)
      await this.loadUsage(true);
  }
  async loadUsage(force = false): Promise<void> {
    const isCurrent = this.#life.capture();
    if (force) this.refreshing = true;
    this.errorMessage = undefined;
    try {
      const usage = await getStorageUsage({ force });
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
  openCleanup(target?: StorageCleanupTarget): void {
    this.cleanupPreset = target;
    this.cleanupDialogOpen = true;
  }
  dismissResult(): void {
    this.#dismissedId = maintenance.operation?.id;
  }
  startCleanup(request: StorageCleanupRequest): Promise<boolean> {
    return maintenance.startCleanup(request);
  }
  cancelCleanup(): Promise<void> {
    return maintenance.cancel();
  }
}
