import type { ConversationTreeEntry } from "@nervekit/harness/conversation";

/** Migration-only extraction of provider-fidelity messages from legacy trees. */
export function extractExactHarnessMessages(
  entries: readonly ConversationTreeEntry[],
  includedEntryIds?: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  const exact: Record<string, unknown> = {};
  for (const entry of entries) {
    if (
      entry.type !== "message" ||
      (includedEntryIds && !includedEntryIds.has(entry.id))
    ) {
      continue;
    }
    if (Object.hasOwn(exact, entry.id)) {
      throw new Error(`Duplicate exact harness message '${entry.id}'.`);
    }
    exact[entry.id] = entry.message;
  }
  return exact;
}
