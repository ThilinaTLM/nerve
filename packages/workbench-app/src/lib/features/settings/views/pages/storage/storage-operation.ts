import type { StorageCleanupOperation } from "@nervekit/contracts/storage";

/**
 * Cleanup updates arrive from both polling and events, so an out-of-order
 * update for the operation already in view must be ignored.
 */
export function shouldIgnoreOperationUpdate(
  current: StorageCleanupOperation | null | undefined,
  next: StorageCleanupOperation | null,
): boolean {
  if (!next || !current || current.id !== next.id) return false;
  return Date.parse(next.updatedAt) < Date.parse(current.updatedAt);
}

export type CleanupNotice =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string; description?: string };

/**
 * A completed operation is worth announcing only when this page observed it
 * running, or when the user just started it. A completed operation returned by
 * the initial status request is historical and should stay silent.
 */
export function shouldAnnounceCompletion(
  current: StorageCleanupOperation | null | undefined,
  next: StorageCleanupOperation | null,
  options: { explicit?: boolean } = {},
): boolean {
  if (!next?.completedAt) return false;
  if (options.explicit) return true;
  return (
    current?.id === next.id &&
    (current.status === "queued" ||
      current.status === "running" ||
      current.status === "cancelling")
  );
}

/**
 * The one-shot notification for a finished operation, or undefined when the
 * operation is unfinished or already announced.
 */
export function completionNotice(
  operation: StorageCleanupOperation | null,
  options: {
    lastNotifiedOperationId?: string;
    formatBytes: (bytes: number) => string;
  },
): CleanupNotice | undefined {
  if (!operation?.completedAt) return undefined;
  if (options.lastNotifiedOperationId === operation.id) return undefined;
  if (operation.status === "succeeded") {
    return {
      kind: "success",
      message: operation.results.some((result) => result.outcome === "failed")
        ? "Cleanup completed with issues"
        : `Freed ${options.formatBytes(operation.freedBytes)}`,
    };
  }
  if (operation.status === "failed") {
    return {
      kind: "error",
      message: "Cleanup failed",
      description: operation.error,
    };
  }
  return undefined;
}
