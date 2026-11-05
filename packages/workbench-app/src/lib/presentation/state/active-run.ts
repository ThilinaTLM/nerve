import type {
  ConversationActiveRunSnapshot,
  ConversationLiveContentBlockSnapshot,
  ConversationLiveMessageSnapshot,
  ConversationLiveToolDraftBlockSnapshot,
  ConversationLiveTurnSnapshot,
} from "$lib/presentation/view-models/conversation";

function byNumberAscending(a: number, b: number): number {
  return a - b;
}

/** Turns in canonical stream order. */
export function orderedTurns(
  activeRun: ConversationActiveRunSnapshot,
): ConversationLiveTurnSnapshot[] {
  return [...activeRun.turns].sort((a, b) =>
    byNumberAscending(a.ordinal, b.ordinal),
  );
}

/** Messages of a turn in canonical stream order. */
export function orderedMessages(
  turn: ConversationLiveTurnSnapshot,
): ConversationLiveMessageSnapshot[] {
  return [...turn.messages].sort((a, b) =>
    byNumberAscending(a.messageOrdinal, b.messageOrdinal),
  );
}

/** Content blocks of a message in canonical stream order. */
export function orderedBlocks(
  message: ConversationLiveMessageSnapshot,
): ConversationLiveContentBlockSnapshot[] {
  return [...message.blocks].sort((a, b) =>
    byNumberAscending(a.contentIndex, b.contentIndex),
  );
}

/**
 * Concatenate the streaming assistant text (non-thinking blocks) in canonical
 * order. Used for lightweight previews such as workspace activity rows.
 */
export function activeRunStreamingText(
  activeRun: ConversationActiveRunSnapshot | undefined,
): string {
  if (!activeRun) return "";
  const parts: string[] = [];
  for (const turn of orderedTurns(activeRun)) {
    for (const message of orderedMessages(turn)) {
      for (const block of orderedBlocks(message)) {
        if (block.kind !== "text" || !block.text) continue;
        parts.push(block.text);
      }
    }
  }
  return parts.join("\n");
}

/** Stable key for a live streaming text/thinking row. */
export function liveBlockKey(
  liveMessageId: string,
  kind: "text" | "thinking",
  contentIndex: number,
): string {
  return `live:${liveMessageId}:${kind}:${contentIndex}`;
}

/**
 * Stable identity for one tool content slot. Shared by draft-only, joined
 * draft+tool, active actual-tool, and committed actual-tool timeline nodes so
 * the rendered row survives the draft-to-tool and live-to-persisted
 * transitions.
 */
export function toolSlotKey(
  liveMessageId: string,
  contentIndex: number,
): string {
  return `tool-slot:${liveMessageId}:${contentIndex}`;
}

/**
 * A tool draft block joined with its run/turn/message coordinates for
 * rendering. This is a projection view over the canonical active-run block,
 * not a second mutable store.
 */
export type ToolDraftViewModel = {
  key: string;
  runId: string;
  conversationId: string;
  turnId: string;
  liveMessageId: string;
  messageOrdinal: number;
  /** Message start time; the canonical block carries no timestamps. */
  startedAt: string;
  block: ConversationLiveToolDraftBlockSnapshot;
};
