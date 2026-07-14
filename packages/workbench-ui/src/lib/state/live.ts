import type {
  ConversationActiveRunSnapshot,
  ConversationEntry,
} from "@nervekit/contracts";
import type {
  ConversationLiveState,
  LiveMessageMeta,
  LiveToolCallDraft,
  TranscriptItem,
} from "./transcript-types";

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

export type ActiveRunLiveOptions = {
  materialized?: MaterializedLiveMessages;
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

function isMaterializedMessage(
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

function metaFor(
  live: ConversationLiveState,
  liveMessageId: string | undefined,
): LiveMessageMeta | undefined {
  return liveMessageId ? live.messageMeta?.[liveMessageId] : undefined;
}

function liveMessageIdFromKey(key: string | undefined): string | undefined {
  return key?.match(/^live:([^:]+):/)?.[1];
}

/**
 * Drain live blocks that the given persisted entry materializes: exact
 * `liveMessageId` match plus everything in the entry's turn at or below the
 * entry's `messageOrdinal`. Keyed structurally so a missed or mislabelled id
 * cannot strand thinking blocks in the live tail.
 */
export function drainMaterializedLiveMessages(
  live: ConversationLiveState,
  entry: Pick<
    ConversationEntry,
    "role" | "turnId" | "liveMessageId" | "messageOrdinal"
  >,
): void {
  if (entry.role !== "assistant") return;
  const materialized = materializedLiveMessagesFromEntries([entry]);
  if (
    materialized.liveMessageIds.size === 0 &&
    materialized.turnWatermarks.size === 0
  ) {
    return;
  }

  const itemMaterialized = (item: {
    id?: string;
    key?: string;
    turnId?: string;
    messageOrdinal?: number;
  }): boolean => {
    const liveMessageId = liveMessageIdFromKey(item.id ?? item.key);
    const meta = metaFor(live, liveMessageId);
    return isMaterializedMessage(materialized, {
      liveMessageId,
      turnId: item.turnId ?? meta?.turnId,
      messageOrdinal: item.messageOrdinal ?? meta?.messageOrdinal,
    });
  };

  live.messages = live.messages.filter((item) => !itemMaterialized(item));
  live.toolDrafts = live.toolDrafts.filter((draft) => !itemMaterialized(draft));
}

/**
 * Convert an active-run snapshot into the legacy live state used by the
 * transcript renderer. Messages that have already been materialized as
 * persisted entries must be excluded, otherwise snapshot refreshes resurrect
 * stale live blocks and append them at the bottom of the timeline.
 */
export function activeRunToLegacyLive(
  activeRun: ConversationActiveRunSnapshot | undefined,
  options: ActiveRunLiveOptions = {},
): ConversationLiveState {
  if (!activeRun) {
    return { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
  }

  const materialized = options.materialized;
  const liveTurns = activeRun.turns.map((turn) => ({
    ...turn,
    messages: turn.messages.filter(
      (message) =>
        !isMaterializedMessage(materialized, {
          liveMessageId: message.liveMessageId,
          turnId: turn.turnId,
          messageOrdinal: message.messageOrdinal,
        }),
    ),
  }));

  const messageMeta: Record<string, LiveMessageMeta> = {};
  for (const turn of activeRun.turns) {
    for (const message of turn.messages) {
      messageMeta[message.liveMessageId] = {
        turnId: turn.turnId,
        messageOrdinal: message.messageOrdinal,
      };
    }
  }

  const messages: TranscriptItem[] = liveTurns.flatMap((turn) =>
    turn.messages.flatMap((message) =>
      message.blocks.flatMap((block) => {
        if (block.kind === "tool_call_draft") return [];
        return [
          {
            id: `live:${message.liveMessageId}:${block.kind}:${block.contentIndex}`,
            role: "assistant" as const,
            displayKind:
              block.kind === "thinking"
                ? ("thinking" as const)
                : ("message" as const),
            text: block.text,
            createdAt: message.startedAt,
            contentIndex: block.contentIndex,
            turnId: turn.turnId,
            messageOrdinal: message.messageOrdinal,
            live: !block.done,
            done: block.done,
            redacted: block.redacted,
          },
        ];
      }),
    ),
  );
  const toolDrafts: LiveToolCallDraft[] = liveTurns.flatMap((turn) =>
    turn.messages.flatMap((message) =>
      message.blocks.flatMap((block) => {
        if (block.kind !== "tool_call_draft") return [];
        return [
          {
            kind: "tool_call_draft" as const,
            key: `live:${message.liveMessageId}:tool-draft:${block.contentIndex}`,
            runId: activeRun.runId,
            conversationId: activeRun.conversationId,
            contentIndex: block.contentIndex,
            turnId: turn.turnId,
            messageOrdinal: message.messageOrdinal,
            providerToolCallId: block.providerToolCallId,
            toolName: block.toolName,
            argsText: block.argsText,
            args: block.args,
            progress: block.progress,
            done: block.done,
            createdAt: message.startedAt,
            updatedAt: message.startedAt,
          },
        ];
      }),
    ),
  );
  return {
    runId: activeRun.runId,
    messages,
    toolDrafts,
    toolOutputByToolCallId: activeRun.toolOutputsByToolCallId,
    messageMeta,
    runStatus: activeRun.retry
      ? {
          conversationId: activeRun.conversationId,
          agentId: activeRun.agentId,
          runId: activeRun.runId,
          state: "retrying",
          ...activeRun.retry,
        }
      : undefined,
    hiddenEntryIds: activeRun.retry?.failedEntryId
      ? [activeRun.retry.failedEntryId]
      : undefined,
  };
}

export function liveTextFromLegacyLive(live: ConversationLiveState): string {
  return live.messages
    .filter((item) => item.displayKind !== "thinking")
    .sort((a, b) => (a.contentIndex ?? 0) - (b.contentIndex ?? 0))
    .map((item) => item.text)
    .join("\n");
}
