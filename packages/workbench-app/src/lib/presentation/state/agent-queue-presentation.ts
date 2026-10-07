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
    ? `${item.state}:${item.sequence}:${item.delivery?.deliveredAt ?? item.acceptedAt}`
    : `${item.status}:${item.updatedAt}`;
}
export function queueItemLabel(item: AgentQueueItem): string {
  if (!("state" in item))
    return `${item.status} · ${item.behavior === "follow-up" ? "next run" : "next turn"} · user`;
  const origin =
    item.origin.kind === "system"
      ? `${item.origin.producer} (${item.origin.correlationId})`
      : item.origin.kind === "parent"
        ? `parent ${item.origin.agentId}${item.origin.runId ? ` (${item.origin.runId})` : ""}`
        : `user ${item.origin.userId}`;
  const eligibility =
    item.eligibility.kind === "run"
      ? `run ${item.eligibility.runId}`
      : `${item.eligibility.kind.replaceAll("_", " ")}${item.eligibility.kind === "next_run" && item.eligibility.afterRunId ? ` after ${item.eligibility.afterRunId}` : ""}`;
  return `${item.state} · ${item.role} · ${origin} · ${eligibility} · #${item.sequence} · ${item.activation === "queue_only" ? "queue only" : "wake if idle"}`;
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
