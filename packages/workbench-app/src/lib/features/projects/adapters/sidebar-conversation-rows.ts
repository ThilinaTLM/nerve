import type { ConversationSummary } from "@nervekit/contracts/core";
import type { ConversationRecord } from "$lib/domain/projects/sidebar-view-models";

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && sameValue(left[key], right[key]))
  );
}

/** Last mapped row per conversation id, so unchanged summaries keep the same
 * row object and downstream deriveds short-circuit while others stream. */
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
              source,
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
