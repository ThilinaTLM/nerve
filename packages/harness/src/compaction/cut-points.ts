import type { ConversationTreeEntry } from "../conversation/entries.js";
import { buildConversationContext } from "../conversation/context.js";
import { CompactionError } from "../errors.js";
import type { CutPointResult } from "./compaction-preparation.js";
import { estimateRetainedContextTokens } from "./usage.js";

/** Find the user-visible message that starts the turn containing an entry. */
export function findTurnStartIndex(
  entries: ConversationTreeEntry[],
  entryIndex: number,
  startIndex: number,
): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type === "branch_summary" || entry.type === "custom_message")
      return i;
    if (
      entry.type === "message" &&
      (entry.message.role === "user" || entry.message.role === "bashExecution")
    )
      return i;
  }
  return -1;
}

/** Atomic spans prevent a retained result from losing its assistant proposal. */
function retainedGroups(
  entries: ConversationTreeEntry[],
  startIndex: number,
  endIndex: number,
) {
  const groups: Array<{ index: number; tokens: number; messages: number }> = [];
  const pending = new Set<string>();
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];
    if (entry.type === "compaction") continue;
    const messages = buildConversationContext([entry]).messages;
    if (!messages.length) continue;
    const message = entry.type === "message" ? entry.message : undefined;
    if (message?.role === "toolResult" && !pending.has(message.toolCallId)) {
      throw new CompactionError(
        "invalid_conversation",
        "Cannot compact an orphan tool result.",
      );
    }
    if (!pending.size) groups.push({ index: i, tokens: 0, messages: 0 });
    const group = groups.at(-1)!;
    group.tokens += estimateRetainedContextTokens(messages);
    group.messages += messages.length;
    if (message?.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "toolCall") pending.add(block.id);
      }
    } else if (message?.role === "toolResult")
      pending.delete(message.toolCallId);
  }
  return groups;
}

export function assertSafeCompactionBoundary(
  entries: ConversationTreeEntry[],
  startIndex: number,
  boundaryIndex: number,
): void {
  if (
    !retainedGroups(entries, startIndex, entries.length).some(
      (group) => group.index === boundaryIndex,
    )
  ) {
    throw new CompactionError(
      "invalid_conversation",
      "Compaction boundary splits a message/tool group.",
    );
  }
}

export function findCutPoint(
  entries: ConversationTreeEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const groups = retainedGroups(entries, startIndex, endIndex);
  // An unresolved proposal is an intact newest span; it must not be split.
  let retainedTokens = 0;
  let retainedMessages = 0;
  let cutIndex = endIndex;
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (retainedMessages && retainedTokens + group.tokens > keepRecentTokens)
      break;
    retainedTokens += group.tokens;
    retainedMessages += group.messages;
    cutIndex = group.index;
    if (retainedTokens > keepRecentTokens) break;
  }
  if (cutIndex === endIndex) cutIndex = startIndex;
  const cut = entries[cutIndex];
  const isUser = cut?.type === "message" && cut.message.role === "user";
  const turnStartIndex = isUser
    ? -1
    : findTurnStartIndex(entries, cutIndex, startIndex);
  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUser && turnStartIndex !== -1,
    retainedTokens,
    retainedMessages,
    retentionBudgetExceeded: retainedTokens > keepRecentTokens,
  };
}
