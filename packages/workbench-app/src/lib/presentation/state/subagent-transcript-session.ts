import type { ConversationEntry } from "$lib/presentation/view-models/conversation";

import type { SubagentTranscriptSnapshot } from "$lib/presentation/view-models/conversation";

import type { ConversationRenderState } from "./conversation-render-state.js";

export function fromSubagentTranscriptSnapshot(
  snapshot: SubagentTranscriptSnapshot,
): ConversationRenderState {
  const entries = snapshot.entries as ConversationEntry[];
  return {
    conversationId: snapshot.conversationId,
    entries,
    activeEntryIds: entries.map((entry) => entry.id),
    toolCalls: snapshot.toolCalls,
    activeRun: snapshot.activeRun,
    lastRunOutcome: snapshot.lastRunOutcome,
    queuedPrompts: [],
    cursorSeq: snapshot.cursorSeq,
    sending: Boolean(snapshot.activeRun) || snapshot.status === "running",
    generatedAt: snapshot.updatedAt,
    readOnly: true,
    retainHiddenToolCalls: true,
  };
}
