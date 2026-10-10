import type { CheckpointDetails } from "@nervekit/contracts/core";
import type { ConversationTreeEntry } from "../conversation/entries.js";
import { buildConversationContext } from "../conversation/context.js";
import { convertToLlm } from "../messages/messages.js";
import { CompactionError } from "../errors.js";
import type { CutPointResult } from "./compaction-preparation.js";
import {
  estimateRetainedContextTokens,
  getLatestCompactionEntry,
} from "./usage.js";
import { selectCheckpointAnchors } from "./anchors.js";

export interface CompactionPlanningOptions {
  /** Original stored provider IDs, never canonical/normalized IDs. */
  protectedToolCallIds?: ReadonlySet<string> | readonly string[];
  contextWindow?: number;
  anchorBudgetTokens?: number;
}

export function findTurnStartIndex(
  entries: ConversationTreeEntry[],
  entryIndex: number,
  startIndex: number,
): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i];
    const visible = convertToLlm(buildConversationContext([entry]).messages)[0];
    if (visible?.role === "user") return i;
  }
  return -1;
}

/** The sole replay-order planner. Metadata is transparent; provider-visible user/assistant boundaries close unprotected gaps. */
export function planCompaction(
  entries: ConversationTreeEntry[],
  keepRecentTokens: number,
  options: CompactionPlanningOptions = {},
  startIndex?: number,
  endIndex = entries.length,
) {
  const previous = getLatestCompactionEntry(entries.slice(0, endIndex));
  const previousIndex = previous
    ? entries.findIndex((e) => e.id === previous.firstKeptEntryId)
    : 0;
  if (previous && previousIndex < 0)
    throw new CompactionError(
      "invalid_conversation",
      "Previous compaction boundary is missing.",
    );
  const start = Math.max(startIndex ?? previousIndex, previousIndex);
  const details = previous?.details as CheckpointDetails | undefined;
  const protectedIds = new Set(options.protectedToolCallIds ?? []);
  const known = new Set(details?.knownToolCallIds ?? []);
  // Hidden ancestors supply lineage, not active spans. Never mutate stored messages.
  for (const entry of entries.slice(0, start)) {
    if (
      entry.type === "message" &&
      entry.message.role === "assistant" &&
      !["error", "aborted"].includes(entry.message.stopReason)
    )
      for (const block of entry.message.content)
        if (block.type === "toolCall") known.add(block.id);
  }
  const pending = new Set<string>();
  const protectedSpans = new Set<string>();
  const abandoned = new Set<string>();
  const boundaries: number[] = [];
  const sizes = new Map<number, { tokens: number; messages: number }>();
  for (let i = start; i < endIndex; i++) {
    const entry = entries[i];
    if (entry.type === "compaction") continue;
    const contextMessages = buildConversationContext([entry]).messages;
    const visible = convertToLlm(contextMessages)[0];
    if (!visible) continue;
    sizes.set(i, {
      tokens: estimateRetainedContextTokens(contextMessages),
      messages: contextMessages.length,
    });
    if (visible.role === "user" || visible.role === "assistant") {
      for (const id of pending)
        if (!protectedIds.has(id)) {
          pending.delete(id);
          abandoned.add(id);
        }
      const replayDropped =
        visible.role === "assistant" &&
        ["error", "aborted"].includes(visible.stopReason);
      if (!pending.size && !protectedSpans.size && !replayDropped)
        boundaries.push(i);
      if (
        visible.role === "assistant" &&
        !["error", "aborted"].includes(visible.stopReason)
      ) {
        for (const block of visible.content)
          if (block.type === "toolCall") {
            pending.add(block.id);
            known.add(block.id);
            if (protectedIds.has(block.id)) protectedSpans.add(block.id);
          }
      }
    } else if (visible.role === "toolResult") {
      if (!known.has(visible.toolCallId))
        throw new CompactionError(
          "invalid_conversation",
          "Cannot compact an orphan tool result.",
        );
      pending.delete(visible.toolCallId);
      // Late results do not reopen spans, but cannot start a retained suffix.
    }
  }
  let cut = boundaries.at(-1) ?? start;
  let retainedTokens = 0,
    retainedMessages = 0;
  const boundarySet = new Set(boundaries);
  let tokens = 0,
    messages = 0;
  for (let i = endIndex - 1; i >= start; i--) {
    const size = sizes.get(i);
    tokens += size?.tokens ?? 0;
    messages += size?.messages ?? 0;
    if (!boundarySet.has(i)) continue;
    if (retainedMessages && tokens > keepRecentTokens) break;
    cut = i;
    retainedTokens = tokens;
    retainedMessages = messages;
    if (tokens > keepRecentTokens) break;
  }
  if (!boundaries.length) {
    retainedTokens = tokens;
    retainedMessages = messages;
  }
  const isUser =
    convertToLlm(
      buildConversationContext([entries[cut]].filter(Boolean)).messages,
    )[0]?.role === "user";
  const turnStartIndex = isUser ? -1 : findTurnStartIndex(entries, cut, start);
  const anchors = selectCheckpointAnchors(
    entries,
    cut,
    options.anchorBudgetTokens ??
      Math.floor((options.contextWindow ?? 0) * 0.08),
    details,
  );
  const protectedCalls = [...protectedIds].filter((id) => known.has(id));
  const deferred =
    pending.size > 0 || protectedCalls.length > 0 || boundaries.length === 0;
  return {
    firstKeptEntryIndex: cut,
    turnStartIndex,
    isSplitTurn: !isUser && turnStartIndex !== -1,
    retainedEntries: entries
      .slice(cut, endIndex)
      .filter((e) => e.type !== "compaction"),
    retainedTokens,
    retainedMessages,
    retentionBudgetExceeded: retainedTokens > keepRecentTokens,
    ...anchors,
    knownToolCallIds: [...known],
    pendingToolCallIds: [...pending],
    protectedToolCallIds: protectedCalls,
    abandonedToolCallIds: [...abandoned],
    advances: cut > previousIndex,
    status: deferred ? ("deferred" as const) : ("ready" as const),
    safeBoundaryIndices: boundaries,
  };
}
export type CompactionPlan = ReturnType<typeof planCompaction>;

export function assertSafeCompactionBoundary(
  entries: ConversationTreeEntry[],
  startIndex: number,
  boundaryIndex: number,
  options: CompactionPlanningOptions = {},
): void {
  const plan = planCompaction(entries, 0, options, startIndex);
  if (
    plan.status === "deferred" ||
    !plan.safeBoundaryIndices.includes(boundaryIndex)
  )
    throw new CompactionError(
      "invalid_conversation",
      "Compaction boundary splits a message/tool group or pending work.",
    );
}

export function findCutPoint(
  entries: ConversationTreeEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
  options: CompactionPlanningOptions = {},
): CutPointResult & CompactionPlan {
  return planCompaction(
    entries,
    keepRecentTokens,
    options,
    startIndex,
    endIndex,
  );
}

/** Use before generation (summary ceiling) and after generation (actual checkpoint tokens). Pending prompt is deliberately not conversation accounting. */
export function assessCompactionUsefulness(input: {
  tokensBefore: number;
  retainedTokens: number;
  checkpointTokens: number;
  advances: boolean;
  pendingPromptTokens?: number;
  thresholdTokens?: number;
}) {
  const tokensAfter = input.retainedTokens + input.checkpointTokens;
  const reason = !input.advances
    ? ("no_new_history" as const)
    : tokensAfter >= input.tokensBefore ||
        (input.thresholdTokens !== undefined &&
          tokensAfter + (input.pendingPromptTokens ?? 0) >=
            input.thresholdTokens)
      ? ("ineffective" as const)
      : undefined;
  return { useful: reason === undefined, reason, tokensAfter };
}
