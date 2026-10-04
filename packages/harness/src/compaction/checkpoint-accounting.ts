import type { ConversationTreeEntry } from "../conversation/entries.js";
import { buildConversationContext } from "../conversation/context.js";
import { CompactionError } from "../errors.js";
import {
  getLatestCompactionEntry,
  estimateRetainedContextTokens,
} from "./usage.js";
import { assertSafeCompactionBoundary } from "./cut-points.js";

/** Reconstruct exactly the context a newly appended checkpoint will select. */
export function estimatePostCompactionContext(
  branch: ConversationTreeEntry[],
  firstKeptEntryId: string,
  summary: string,
) {
  const index = branch.findIndex((entry) => entry.id === firstKeptEntryId);
  if (index < 0)
    throw new CompactionError(
      "invalid_conversation",
      "Compaction boundary is not on the active branch.",
    );
  const previous = getLatestCompactionEntry(branch);
  const previousIndex = previous
    ? branch.findIndex((entry) => entry.id === previous.firstKeptEntryId)
    : -1;
  if (index < previousIndex)
    throw new CompactionError(
      "invalid_conversation",
      "Compaction cannot restore previously removed history.",
    );
  if (previous && previousIndex < 0)
    throw new CompactionError(
      "invalid_conversation",
      "Previous compaction boundary is missing.",
    );
  // Validate against the entire active context, not a suffix that forgets pending calls.
  assertSafeCompactionBoundary(branch, Math.max(0, previousIndex), index);
  const messages = buildConversationContext([
    ...branch,
    {
      type: "compaction",
      id: "virtual-compaction-checkpoint",
      parentId: branch.at(-1)?.id ?? null,
      timestamp: new Date(0).toISOString(),
      firstKeptEntryId,
      summary,
      tokensBefore: 0,
    },
  ]).messages;
  const summaryTokens = estimateRetainedContextTokens(messages.slice(0, 1));
  const retainedTokens = estimateRetainedContextTokens(messages.slice(1));
  return {
    tokensBeforeEstimate: estimateRetainedContextTokens(
      buildConversationContext(branch).messages,
    ),
    tokensAfter: summaryTokens + retainedTokens,
    summaryTokens,
    retainedTokens,
    retainedMessages: Math.max(0, messages.length - 1),
  };
}
