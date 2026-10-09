import type { ConversationEntry, ConversationTreeNode } from "$lib/api";

export type HistoryNavigationTarget = NonNullable<
  ConversationTreeNode["navigation"]["editTarget"]
>;
export type EditHistoryEntry = (
  entry: ConversationEntry,
  target: HistoryNavigationTarget,
) => void;

/** The server's model parent (including explicit null root), never transcript ancestry. */
export async function editHistoryMessage(
  entry: Pick<ConversationEntry, "text">,
  target: HistoryNavigationTarget,
  navigate: (activeEntryId: string | null) => Promise<boolean>,
  fillComposer: (text: string) => void,
): Promise<boolean> {
  if (!(await navigate(target.activeEntryId))) return false;
  fillComposer(entry.text);
  return true;
}
