import { ConversationStore } from "./core-conversation-store.svelte";

const openStores = new Map<
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
