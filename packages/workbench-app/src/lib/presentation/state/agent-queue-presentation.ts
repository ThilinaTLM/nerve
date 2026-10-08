import type { AgentQueueItem } from "@nervekit/contracts/agents";

export function queueItemPending(item: AgentQueueItem): boolean {
  return "state" in item
    ? item.state === "pending"
    : item.status === "queued" || item.status === "accepted";
}
export function queueItemState(item: AgentQueueItem): string {
  return "state" in item ? item.state : item.status;
}
export function queueItemAcceptedAt(item: AgentQueueItem): string {
  return "state" in item ? item.acceptedAt : item.createdAt;
}
export function queueItemRevision(item: AgentQueueItem): string {
  return "state" in item
    ? `${item.state}:${item.sequence}:${item.delivery?.deliveredAt ?? item.acceptedAt}:${item.preparation ?? ""}:${item.interruptionRequested ?? false}`
    : `${item.status}:${item.updatedAt}`;
}
export function queueItemLabel(item: AgentQueueItem): string {
  if (!("state" in item)) return `${item.status} · next turn · user`;
  if (item.preparation === "preparing") return "Preparing commands";
  if (item.interruptionRequested) return "Interrupt requested";
  const eligibility =
    item.eligibility.kind === "next_run" ? "next run" : "next turn";
  return `Queued for ${eligibility}`;
}
export function pendingQueueItems(
  items: readonly AgentQueueItem[],
): AgentQueueItem[] {
  return items
    .filter(queueItemPending)
    .sort((a, b) =>
      "sequence" in a && "sequence" in b
        ? a.sequence - b.sequence
        : queueItemAcceptedAt(a).localeCompare(queueItemAcceptedAt(b)),
    );
}
