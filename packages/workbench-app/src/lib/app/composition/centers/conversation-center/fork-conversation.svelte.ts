import { SvelteSet } from "svelte/reactivity";
import {
  notify,
  notifyToast,
} from "$lib/application/notifications/notify.svelte";
import { openConversation } from "$lib/application/workspace/workspace-actions.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";

/** Source conversations with a fork in flight; they must stay idle until it ends. */
const forking = new SvelteSet<string>();

export function isForking(conversationId: string | undefined): boolean {
  return conversationId !== undefined && forking.has(conversationId);
}

/**
 * Forks `store`'s conversation at `eventId` behind one progress toast. The
 * source stays readable; the new conversation opens when the user is still
 * looking at the source, and is otherwise offered through the toast.
 */
export function forkConversation(
  store: ConversationStore,
  eventId: string,
): void {
  const sourceId = store.conversationId;
  if (forking.has(sourceId)) return;
  forking.add(sourceId);
  const open = (id: string) => {
    void openConversation(id).catch((error) =>
      notify.error(error instanceof Error ? error.message : String(error)),
    );
  };
  const toastId = `fork:${sourceId}`;
  notify.loading("Forking conversation…", toastId);
  store
    .fork(eventId)
    .then((snapshot) => {
      const { id, title } = snapshot.conversation;
      const active = workspaceState.activeCenterTab;
      if (active?.kind === "conversation" && active.id === sourceId) open(id);
      notifyToast(`Forked to «${title}»`, {
        id: toastId,
        kind: "success",
        action: { label: "Open", onClick: () => open(id) },
      });
    })
    .catch((error) =>
      notifyToast(
        `Could not fork: ${error instanceof Error ? error.message : String(error)}`,
        { id: toastId, kind: "error" },
      ),
    )
    .finally(() => forking.delete(sourceId));
}
