import { SvelteMap } from "svelte/reactivity";
import { pendingWork } from "../agents/agent-team";
import { ConversationStore } from "./core-conversation-store.svelte";

const openStores = new SvelteMap<
  string,
  { store: ConversationStore; users: number; ready: Promise<void> }
>();

/** Panes and read-only child peeks retain the same conversation detail state. */
export function retainConversationStore(conversationId: string): {
  store: ConversationStore;
  ready: Promise<void>;
  release(): void;
} {
  let entry = openStores.get(conversationId);
  if (!entry) {
    const store = new ConversationStore(conversationId);
    entry = { store, users: 0, ready: store.open() };
    openStores.set(conversationId, entry);
  }
  entry.users += 1;
  const retained = entry;
  let released = false;
  return {
    store: retained.store,
    ready: retained.ready,
    release() {
      if (released) return;
      released = true;
      retained.users -= 1;
      if (retained.users === 0) {
        openStores.delete(conversationId);
        retained.store.dispose();
      }
    },
  };
}

export function retainedConversationStores(): ConversationStore[] {
  return [...openStores.values()].map((entry) => entry.store);
}

/**
 * Open conversations whose turn ended but that still wait on sub-agents or
 * background commands. Reactive; only conversations with an open store are
 * known.
 */
export function waitingConversationIds(): Set<string> {
  const ids = new Set<string>();
  for (const { store } of openStores.values()) {
    const snapshot = store.snapshot;
    if (
      snapshot &&
      pendingWork({
        children: snapshot.children,
        asyncBash: snapshot.asyncBash,
      }).length > 0
    )
      ids.add(snapshot.conversation.id);
  }
  return ids;
}
