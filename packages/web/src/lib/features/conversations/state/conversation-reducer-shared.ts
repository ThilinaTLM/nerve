import type {
  ConversationEntry,
  ConversationLiveToolDraftProgressSnapshot,
} from "$lib/api";
import type {
  ConversationLiveState,
  ConversationViewState,
  LiveToolOutput,
} from "$lib/core/types/state-types";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

export const MAX_LIVE_TOOL_OUTPUT_CHARS = 32_000;

export const MAX_LIVE_TOOL_OUTPUT_CHUNKS = 400;

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function active(conversationId: string): boolean {
  return selection.conversationId === conversationId;
}

export function isOpenConversation(conversationId: string): boolean {
  return workspaceState.openCenterTabs.some(
    (tab) => tab.kind === "conversation" && tab.id === conversationId,
  );
}

export function emptyLiveState(runId?: string): ConversationLiveState {
  return { runId, messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
}

export function ensureLiveState(
  view: ConversationViewState,
  runId?: string,
): ConversationLiveState {
  if (!runId || view.live.runId === runId || !view.live.runId) {
    view.live = { ...view.live, runId: runId || view.live.runId };
    return view.live;
  }
  view.live = emptyLiveState(runId);
  return view.live;
}

export function liveMessageId(data: Record<string, unknown>): string {
  return typeof data.liveMessageId === "string"
    ? data.liveMessageId
    : String(data.runId ?? "unknown");
}

export function liveTextId(data: Record<string, unknown>): string {
  return `live:${liveMessageId(data)}:${String(data.kind ?? "text")}:${Number(data.contentIndex ?? 0)}`;
}

export function liveRunStatusId(runId: string): string {
  return `live:run-status:${runId || "active"}`;
}

export function removeLiveRunStatusTranscriptItem(
  view: ConversationViewState,
  runId?: string,
): void {
  view.transcript = view.transcript.filter((item) => {
    if (item.runStatus?.state !== "retrying") return true;
    return Boolean(runId && item.runStatus.runId !== runId);
  });
}

export function capLiveOutput(output: LiveToolOutput): LiveToolOutput {
  let text = output.text;
  if (text.length > MAX_LIVE_TOOL_OUTPUT_CHARS) {
    text = text.slice(text.length - MAX_LIVE_TOOL_OUTPUT_CHARS);
  }
  const chunks =
    output.chunks.length > MAX_LIVE_TOOL_OUTPUT_CHUNKS
      ? output.chunks.slice(output.chunks.length - MAX_LIVE_TOOL_OUTPUT_CHUNKS)
      : output.chunks;
  return { ...output, text, chunks };
}

export function toolDraftProgressFromValue(
  value: unknown,
): ConversationLiveToolDraftProgressSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const progress: ConversationLiveToolDraftProgressSnapshot = {
    estimated: typeof record.estimated === "boolean" ? record.estimated : true,
  };
  if (typeof record.path === "string") progress.path = record.path;
  progress.lineCount = numberValue(record.lineCount);
  progress.operationCount = numberValue(record.operationCount);
  progress.generatedLineCount = numberValue(record.generatedLineCount);
  progress.estimatedAdditions = numberValue(record.estimatedAdditions);
  progress.estimatedDeletions = numberValue(record.estimatedDeletions);
  return progress;
}

export function draftKey(data: Record<string, unknown>): string {
  return `live:${liveMessageId(data)}:tool-draft:${Number(data.contentIndex ?? 0)}`;
}

export function syncActiveView(view: ConversationViewState): void {
  if (!active(view.conversationId)) return;
  workspaceState.error = view.error;
}

export function entryBelongsToActiveBranch(
  view: ConversationViewState,
  entry: ConversationEntry,
): boolean {
  const existingIndex = view.activeEntryIds.indexOf(entry.id);
  if (existingIndex !== -1) return true;
  const activeLeafId = view.activeEntryId ?? view.activeEntryIds.at(-1);
  if (activeLeafId) return entry.parentEntryId === activeLeafId;
  return view.activeEntryIds.length === 0 && !entry.parentEntryId;
}

export function updateActiveBranchPath(
  view: ConversationViewState,
  entry: ConversationEntry,
): void {
  const existingIndex = view.activeEntryIds.indexOf(entry.id);
  if (existingIndex !== -1) {
    view.activeEntryIds = view.activeEntryIds.slice(0, existingIndex + 1);
  } else {
    view.activeEntryIds = [...view.activeEntryIds, entry.id];
  }
  view.activeEntryId = entry.id;
}

export function updateConversationActiveEntryId(
  conversationId: string,
  entryId: string,
): void {
  workspaceState.conversations = workspaceState.conversations.map(
    (conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            activeEntryId: entryId,
            updatedAt: new Date().toISOString(),
          }
        : conversation,
  );
}

export function updateTreeNodesForEntry(
  view: ConversationViewState,
  entry: ConversationEntry,
): void {
  const existing = view.treeNodes.find((node) => node.entry.id === entry.id);
  if (existing) {
    view.treeNodes = view.treeNodes.map((node) =>
      node.entry.id === entry.id ? { ...node, entry } : node,
    );
    return;
  }

  view.treeNodes = [
    ...view.treeNodes.map((node) =>
      entry.parentEntryId && node.entry.id === entry.parentEntryId
        ? {
            ...node,
            childEntryIds: Array.from(
              new Set([...node.childEntryIds, entry.id]),
            ),
          }
        : node,
    ),
    { entry, childEntryIds: [] },
  ];
}
