import { retainConversationStore } from "../state/open-conversation-stores";
import { conversationTranscript } from "./core-transcript.adapter";
import type { SubagentTranscriptSnapshot } from "$lib/presentation/view-models/conversation";
export function watchSubagentTranscript(
  parentAgentId: string,
  childAgentId: string,
  handlers: {
    snapshot: (snapshot: SubagentTranscriptSnapshot) => void;
    error: (message: string) => void;
  },
) {
  const retained = retainConversationStore(childAgentId);
  void retained.ready.catch((e) =>
    handlers.error(e instanceof Error ? e.message : String(e)),
  );
  const dispose = $effect.root(() => {
    $effect(() => {
      const store = retained.store;
      const snapshot = store.snapshot;
      if (!snapshot) return;
      const view = conversationTranscript({
        snapshot,
        events: store.events,
        liveBlocks: store.liveBlocks,
        toolOutput: store.toolOutput,
      });
      handlers.snapshot({
        agentId: childAgentId,
        parentAgentId,
        conversationId: childAgentId,
        projectId: snapshot.conversation.projectId,
        cursorSeq: snapshot.lastSequence,
        activeRun: view.activeRun,
        lastRunOutcome: view.lastRunOutcome,
        status:
          snapshot.conversation.status === "running"
            ? "running"
            : snapshot.conversation.status === "waiting"
              ? "awaiting_user"
              : snapshot.conversation.status === "failed"
                ? "error"
                : snapshot.conversation.status === "interrupted"
                  ? "aborted"
                  : "idle",
        entries: view.entries,
        toolCalls: view.toolCalls,
        totalEntryCount: view.entries.length,
        totalToolCallCount: view.toolCalls.length,
        entriesTruncated: store.hasOlder,
        toolCallsTruncated: store.hasOlder,
        updatedAt: snapshot.conversation.updatedAt,
      });
    });
  });
  return () => {
    dispose();
    retained.release();
  };
}
