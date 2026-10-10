import type { ConversationSummary } from "@nervekit/contracts/core";
import { SvelteMap } from "svelte/reactivity";
export interface ProjectConversationList {
  readonly roots: ConversationSummary[];
  readonly children: Record<string, ConversationSummary[]>;
  readonly expanded: Record<string, boolean>;
  open(): Promise<void>;
  recover(): Promise<void>;
  toggleChildren(id: string): Promise<void>;
  dispose(): void;
}
let createList: ((projectId: string) => ProjectConversationList) | undefined;
export const conversationLists = new SvelteMap<
  string,
  ProjectConversationList
>();
export function registerConversationLists(
  factory: (projectId: string) => ProjectConversationList,
): () => void {
  createList = factory;
  return () => {
    for (const list of conversationLists.values()) list.dispose();
    conversationLists.clear();
    createList = undefined;
  };
}
export async function recoverConversationLists(
  projectIds: string[],
): Promise<void> {
  for (const [id, list] of conversationLists)
    if (!projectIds.includes(id)) {
      list.dispose();
      conversationLists.delete(id);
    }
  await Promise.all(
    projectIds.map(async (id) => {
      let list = conversationLists.get(id);
      if (!list) {
        if (!createList) throw new Error("Conversation lists not registered");
        list = createList(id);
        conversationLists.set(id, list);
      }
      await list.recover();
    }),
  );
}
