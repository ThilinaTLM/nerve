import type { CompactionOperation } from "@nervekit/contracts/core";

/** Revisions span operations, not just progress within a single operation. */
export function reconcileCompactionNotice(
  current: CompactionOperation | null | undefined,
  incoming: CompactionOperation,
): CompactionOperation {
  return !current || incoming.revision > current.revision ? incoming : current;
}
