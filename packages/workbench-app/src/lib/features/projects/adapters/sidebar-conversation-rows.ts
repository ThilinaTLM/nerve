import type { ConversationSummary } from "@nervekit/contracts/core";
import { sameValue } from "$lib/domain/conversations/summary-patch";
import type { ConversationRecord } from "$lib/domain/projects/sidebar-view-models";

/** Last mapped row per conversation id, so unchanged summaries keep the same
 * row object and downstream deriveds short-circuit while others stream.
 * `source` is a copy: workspace summaries are patched in place. */
const sidebarRowCache = new Map<
  string,
  { source: ConversationSummary; row: ConversationRecord }
>();

export function sidebarConversations(
  rows: ConversationSummary[],
): ConversationRecord[] {
  const next = new Map<
    string,
    { source: ConversationSummary; row: ConversationRecord }
  >();
  const result = rows
    .filter((row) => row.parentConversationId === null)
    .map((source) => {
      const cached = sidebarRowCache.get(source.id);
      const entry =
        cached && sameValue(cached.source, source)
          ? cached
          : {
              source: { ...source },
              row: {
                ...source,
                pinned: source.pinnedAt !== null,
                activeAgentId: source.id,
                permissionRuleSetId: source.permissionRuleSetId,
              },
            };
      next.set(source.id, entry);
      return entry.row;
    });
  sidebarRowCache.clear();
  for (const [id, entry] of next) sidebarRowCache.set(id, entry);
  return result;
}
