import type {
  SandboxRunSnapshot,
  SandboxSnapshotResult,
  SandboxToolCallSummary,
  SandboxWaitSummary,
} from "@nervekit/shared";
import type {
  SandboxDetailState,
  SandboxTimelineRow,
} from "./sandbox-ui-types";

/**
 * Normalize a snapshot into the detail state, choosing a default selected
 * conversation/run when none is selected and seeding durable tool calls/waits.
 */
export function applySnapshot(
  detail: SandboxDetailState,
  snapshot: SandboxSnapshotResult,
): void {
  detail.snapshot = snapshot;

  for (const run of snapshot.runs) {
    for (const toolCall of run.toolCalls ?? [])
      detail.toolCallsById[toolCall.toolCallId] ??= toolCall;
    for (const wait of run.waits ?? []) detail.waitsById[wait.waitId] ??= wait;
  }

  if (!detail.selectedConversationId && !detail.selectedPendingConversationId)
    selectDefault(detail, snapshot);
}

function selectDefault(
  detail: SandboxDetailState,
  snapshot: SandboxSnapshotResult,
): void {
  const active = snapshot.conversations.find(
    (conversation) => (conversation.activeRunIds?.length ?? 0) > 0,
  );
  const chosen = active ?? mostRecentConversation(snapshot);
  if (!chosen) return;
  detail.selectedConversationId = chosen.conversationId;
  const runs = snapshot.runs.filter(
    (run) => run.conversationId === chosen.conversationId,
  );
  const activeRun =
    runs.find((run) => run.status === "running") ?? mostRecentRun(runs);
  if (activeRun) {
    detail.selectedAgentId = activeRun.agentId;
    detail.selectedRunId = activeRun.runId;
  }
}

function mostRecentConversation(snapshot: SandboxSnapshotResult) {
  return [...snapshot.conversations].sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  )[0];
}

function mostRecentRun(runs: SandboxRunSnapshot[]) {
  return [...runs].sort((a, b) =>
    (b.updatedAt ?? b.createdAt ?? "").localeCompare(
      a.updatedAt ?? a.createdAt ?? "",
    ),
  )[0];
}

type SortableRow = { sortKey: string; order: number; row: SandboxTimelineRow };

/**
 * Build an ordered chat timeline for the selected conversation by merging the
 * durable snapshot transcript/tool calls with live streaming deltas and events.
 */
export function buildTimeline(
  detail: SandboxDetailState,
): SandboxTimelineRow[] {
  const conversationId = detail.selectedConversationId;
  const rows: SortableRow[] = [];
  let order = 0;

  const runs =
    detail.snapshot?.runs.filter(
      (run) => !conversationId || run.conversationId === conversationId,
    ) ?? [];
  const runIds = new Set(runs.map((run) => run.runId));

  const seenEntryIds = new Set<string>();
  for (const run of runs) {
    for (const entry of run.transcript ?? []) {
      seenEntryIds.add(entry.entryId);
      rows.push({
        sortKey: entry.createdAt ?? "",
        order: order++,
        row: {
          kind: "message",
          key: `entry:${entry.entryId}`,
          role: entry.role,
          text: entry.content?.text ?? entry.summary ?? "",
          createdAt: entry.createdAt,
        },
      });
    }
  }

  for (const entry of detail.appendedTranscript) {
    if (seenEntryIds.has(entry.entryId)) continue;
    if (
      conversationId &&
      entry.conversationId &&
      entry.conversationId !== conversationId
    )
      continue;
    if (runIds.size > 0 && entry.runId && !runIds.has(entry.runId)) continue;
    rows.push({
      sortKey: entry.createdAt,
      order: order++,
      row: {
        kind: "message",
        key: `entry:${entry.entryId}`,
        role: entry.role,
        text: entry.text,
        createdAt: entry.createdAt,
      },
    });
  }

  const toolCalls = mergeToolCalls(detail, runs);
  for (const toolCall of toolCalls) {
    rows.push({
      sortKey: toolCall.requestedAt ?? toolCall.startedAt ?? "",
      order: order++,
      row: { kind: "tool", key: `tool:${toolCall.toolCallId}`, toolCall },
    });
  }

  rows.sort((a, b) => {
    if (a.sortKey && b.sortKey && a.sortKey !== b.sortKey)
      return a.sortKey.localeCompare(b.sortKey);
    return a.order - b.order;
  });

  const timeline: SandboxTimelineRow[] = rows.map((entry) => entry.row);

  // Live streaming assistant text (transient) after durable content.
  for (const run of Object.values(detail.liveRuns)) {
    if (conversationId && run.conversationId !== conversationId) continue;
    if (run.deltaText.length === 0) continue;
    timeline.push({
      kind: "message",
      key: `live:${run.runId}`,
      role: "assistant",
      text: run.deltaText,
      streaming: true,
    });
  }

  // Pending waits as actionable rows.
  for (const wait of mergeWaits(detail, runs))
    if (wait.status === "waiting")
      timeline.push({ kind: "wait", key: `wait:${wait.waitId}`, wait });

  return timeline;
}

function mergeToolCalls(
  detail: SandboxDetailState,
  runs: SandboxRunSnapshot[],
): SandboxToolCallSummary[] {
  const byId = new Map<string, SandboxToolCallSummary>();
  for (const run of runs)
    for (const toolCall of run.toolCalls ?? [])
      byId.set(toolCall.toolCallId, toolCall);
  for (const [id, toolCall] of Object.entries(detail.toolCallsById))
    byId.set(id, toolCall);
  return [...byId.values()];
}

function mergeWaits(
  detail: SandboxDetailState,
  runs: SandboxRunSnapshot[],
): SandboxWaitSummary[] {
  const byId = new Map<string, SandboxWaitSummary>();
  for (const run of runs)
    for (const wait of run.waits ?? []) byId.set(wait.waitId, wait);
  for (const [id, wait] of Object.entries(detail.waitsById)) byId.set(id, wait);
  return [...byId.values()];
}
