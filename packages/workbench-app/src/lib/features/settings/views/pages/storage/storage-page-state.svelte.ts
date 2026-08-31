import type {
  StorageCleanupOperation,
  StorageCleanupRequest,
  StorageCleanupStartResponse,
  StorageCleanupStatusResponse,
  StorageUsageResponse,
} from "$lib/api";
import { onEvent } from "$lib/application/events/event-bus";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  cancelStorageCleanup,
  getStorageCleanup,
  getStorageUsage,
  startStorageCleanup,
} from "$lib/features/settings/api/storage.api";
import {
  isCleanupActive,
  parseStorageCleanupEvent,
} from "$lib/features/settings/state/storage-cleanup";
import { formatBytes } from "./storage-format";
import {
  completionNotice,
  shouldAnnounceCompletion,
  shouldIgnoreOperationUpdate,
} from "./storage-operation";
import { StorageRunGuard } from "./storage-run-guard";

const POLL_INTERVAL_MS = 2_500;

export type StorageControllerDeps = {
  getUsage: () => Promise<StorageUsageResponse>;
  getOperation: () => Promise<StorageCleanupStatusResponse>;
  startCleanup: (
    request: StorageCleanupRequest,
  ) => Promise<StorageCleanupStartResponse>;
  cancelCleanup: (operationId: string) => Promise<StorageCleanupStartResponse>;
  subscribe: (handler: (data: unknown) => void) => () => void;
  notifySuccess: (message: string) => void;
  notifyError: (message: string, description?: string) => void;
};

const defaultDeps: StorageControllerDeps = {
  getUsage: getStorageUsage,
  getOperation: getStorageCleanup,
  startCleanup: startStorageCleanup,
  cancelCleanup: cancelStorageCleanup,
  subscribe: (handler) =>
    onEvent("storage.cleanup.updated", (event) => handler(event.data)),
  notifySuccess: (message) => notify.success(message),
  notifyError: (message, description) => notify.error(message, { description }),
};

/**
 * Owns the storage page's fetch, poll, and event lifecycle so the page
 * component stays markup-only. Create it on mount and dispose it on unmount.
 */
export class StoragePageController {
  usage = $state<StorageUsageResponse | undefined>(undefined);
  operation = $state<StorageCleanupOperation | null>(null);
  loading = $state(true);
  refreshing = $state(false);
  operationLoading = $state(false);
  errorMessage = $state<string | undefined>(undefined);
  cleanupDialogOpen = $state(false);

  #deps: StorageControllerDeps;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #unsubscribe: (() => void) | undefined;
  #lastNotifiedOperationId: string | undefined;
  #run = new StorageRunGuard();

  constructor(deps: Partial<StorageControllerDeps> = {}) {
    this.#deps = { ...defaultDeps, ...deps };
  }

  get active(): boolean {
    return isCleanupActive(this.operation);
  }

  /** Safe to call again after `dispose()`; the page may be revisited. */
  start(): void {
    this.dispose();
    this.#run.begin();
    this.loading = !this.usage;
    void Promise.all([this.loadUsage(), this.loadOperation()]);
    this.#unsubscribe = this.#deps.subscribe((data) => {
      const next = parseStorageCleanupEvent(data);
      if (next) this.applyOperation(next);
    });
  }

  dispose(): void {
    this.#run.end();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#stopPolling();
  }

  async loadUsage(force = false): Promise<void> {
    const runId = this.#run.currentRunId;
    if (force) this.refreshing = true;
    this.errorMessage = undefined;
    try {
      const usage = await this.#deps.getUsage();
      if (this.#isStale(runId)) return;
      this.usage = usage;
    } catch (error) {
      if (this.#isStale(runId)) return;
      this.errorMessage =
        error instanceof Error
          ? error.message
          : "Could not load storage usage.";
    } finally {
      if (!this.#isStale(runId)) {
        this.loading = false;
        this.refreshing = false;
      }
    }
  }

  async loadOperation(): Promise<void> {
    const runId = this.#run.currentRunId;
    this.operationLoading = true;
    try {
      const response = await this.#deps.getOperation();
      if (this.#isStale(runId)) return;
      this.applyOperation(response.operation);
    } catch (error) {
      if (this.#isStale(runId)) return;
      if (!this.usage) {
        this.errorMessage =
          error instanceof Error
            ? error.message
            : "Could not load cleanup status.";
      }
    } finally {
      if (!this.#isStale(runId)) this.operationLoading = false;
    }
  }

  applyOperation(
    next: StorageCleanupOperation | null,
    options: { announceCompletion?: boolean } = {},
  ): void {
    if (!this.#run.active) return;
    const current = this.operation;
    if (shouldIgnoreOperationUpdate(current, next)) return;

    this.operation = next;
    if (next?.usage) this.usage = next.usage;
    this.#syncPolling();

    const notice = completionNotice(next, {
      lastNotifiedOperationId: this.#lastNotifiedOperationId,
      formatBytes,
    });
    if (!next?.completedAt) return;
    this.#lastNotifiedOperationId = next.id;
    if (
      !shouldAnnounceCompletion(current, next, {
        explicit: options.announceCompletion,
      }) ||
      !notice
    )
      return;
    if (notice.kind === "success") this.#deps.notifySuccess(notice.message);
    else this.#deps.notifyError(notice.message, notice.description);
  }

  async startCleanup(request: StorageCleanupRequest): Promise<boolean> {
    try {
      const response = await this.#deps.startCleanup(request);
      this.applyOperation(response.operation, { announceCompletion: true });
      return true;
    } catch (error) {
      this.#deps.notifyError(
        "Could not start cleanup",
        error instanceof Error ? error.message : "Try again.",
      );
      return false;
    }
  }

  async cancelCleanup(): Promise<void> {
    const current = this.operation;
    if (!current) return;
    try {
      const response = await this.#deps.cancelCleanup(current.id);
      this.applyOperation(response.operation);
    } catch (error) {
      this.#deps.notifyError(
        "Could not cancel cleanup",
        error instanceof Error ? error.message : "Try again.",
      );
    }
  }

  #isStale(runId: number): boolean {
    return this.#run.isStale(runId);
  }

  #syncPolling(): void {
    if (this.active && !this.#pollTimer && this.#run.active) {
      this.#pollTimer = setInterval(
        () => void this.loadOperation(),
        POLL_INTERVAL_MS,
      );
    } else if (!this.active) {
      this.#stopPolling();
    }
  }

  #stopPolling(): void {
    if (!this.#pollTimer) return;
    clearInterval(this.#pollTimer);
    this.#pollTimer = undefined;
  }
}
