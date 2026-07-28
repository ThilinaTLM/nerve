import type {
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationLiveContentBlockSnapshot,
  ConversationLiveMessageSnapshot,
  ConversationLiveToolDraftBlockSnapshot,
  ConversationLiveTurnSnapshot,
} from "@nervekit/contracts";

/**
 * Live messages that have already been persisted as conversation entries.
 * `liveMessageIds` covers exact-id correlation; `turnWatermarks` maps each
 * `turnId` to the highest materialized `messageOrdinal`, so stale live blocks
 * are drained structurally even when id correlation misses (messages within a
 * turn always materialize in stream order).
 */
export type MaterializedLiveMessages = {
  liveMessageIds: Set<string>;
  turnWatermarks: Map<string, number>;
};

export function emptyMaterializedLiveMessages(): MaterializedLiveMessages {
  return { liveMessageIds: new Set(), turnWatermarks: new Map() };
}

/** Collect materialized live-message coordinates from persisted entries. */
export function materializedLiveMessagesFromEntries(
  entries: Iterable<
    Pick<
      ConversationEntry,
      "role" | "turnId" | "liveMessageId" | "messageOrdinal"
    >
  >,
): MaterializedLiveMessages {
  const materialized = emptyMaterializedLiveMessages();
  for (const entry of entries) {
    if (entry.role !== "assistant") continue;
    if (entry.liveMessageId)
      materialized.liveMessageIds.add(entry.liveMessageId);
    if (entry.turnId && typeof entry.messageOrdinal === "number") {
      const current = materialized.turnWatermarks.get(entry.turnId);
      if (current === undefined || entry.messageOrdinal > current) {
        materialized.turnWatermarks.set(entry.turnId, entry.messageOrdinal);
      }
    }
  }
  return materialized;
}

export function isMaterializedMessage(
  materialized: MaterializedLiveMessages | undefined,
  message: { liveMessageId?: string; turnId?: string; messageOrdinal?: number },
): boolean {
  if (!materialized) return false;
  if (
    message.liveMessageId &&
    materialized.liveMessageIds.has(message.liveMessageId)
  ) {
    return true;
  }
  if (message.turnId && typeof message.messageOrdinal === "number") {
    const watermark = materialized.turnWatermarks.get(message.turnId);
    return watermark !== undefined && message.messageOrdinal <= watermark;
  }
  return false;
}

/**
 * Materialize active-run messages matched by exact `liveMessageId` or a turn
 * ordinal watermark. Persisted text/thinking blocks are drained, while
 * tool-draft blocks remain as handoff anchors until the active run ends.
 * Messages emptied by the drain are removed; tool-only messages retain their
 * original coordinates. Mutates `activeRun` in place; callers own cloning.
 */
export function drainMaterializedActiveRunMessages(
  activeRun: ConversationActiveRunSnapshot,
  materialized: MaterializedLiveMessages,
): void {
  if (
    materialized.liveMessageIds.size === 0 &&
    materialized.turnWatermarks.size === 0
  ) {
    return;
  }
  for (const turn of activeRun.turns) {
    turn.messages = turn.messages.flatMap((message) => {
      if (
        !isMaterializedMessage(materialized, {
          liveMessageId: message.liveMessageId,
          turnId: turn.turnId,
          messageOrdinal: message.messageOrdinal,
        })
      ) {
        return [message];
      }
      const blocks = message.blocks.filter(
        (block): block is ConversationLiveToolDraftBlockSnapshot =>
          block.kind === "tool_call_draft",
      );
      return blocks.length > 0 ? [{ ...message, blocks }] : [];
    });
  }
}

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
