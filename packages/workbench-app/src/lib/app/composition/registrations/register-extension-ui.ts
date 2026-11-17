import { registerExtensionHostActions } from "$lib/features/extension-ui";
import { openFilePane } from "$lib/features/filesystem";
import { conversationDraftStore } from "$lib/application/workspace/conversation-draft-store";
import type { PromptDraftTarget } from "$lib/application/workspace/conversation-draft-store";
import { pendingConversations } from "$lib/application/workspace/pending-conversations.svelte";
import { selection } from "$lib/application/workspace/selection.svelte";
import { selectCenterTab } from "$lib/application/workspace/center-tabs.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

/** The composer an extension's `composer.insert` fills: the open conversation's, else the selected one's. */
function composerTarget(): PromptDraftTarget | undefined {
  const active = workspaceState.activeCenterTab;
  if (active?.kind === "conversation")
    return { kind: "conversation", id: active.id };
  if (active?.kind === "pending-conversation") {
    const projectId = pendingConversations.get(active.id)?.projectId;
    return projectId
      ? { kind: "pending-conversation", id: active.id, projectId }
      : undefined;
  }
  return selection.conversationId
    ? { kind: "conversation", id: selection.conversationId }
    : undefined;
}

/** Connects what extension frames may ask of the app (open a file, fill the composer). */
export function registerExtensionUiActions(): () => void {
  return registerExtensionHostActions({
    openFile: async (projectId, path) => {
      await openFilePane({ projectId, path });
    },
    insertIntoComposer: (text) => {
      const target = composerTarget();
      if (!target) throw new Error("Open a conversation first");
      const drafts = conversationDraftStore();
      const current = drafts.getPrompt(target);
      drafts.setPrompt(target, current.trim() ? `${current}\n\n${text}` : text);
      // The draft is only visible with its conversation; bring it forward without sending.
      if (workspaceState.activeCenterTab?.kind !== target.kind)
        void selectCenterTab({ kind: target.kind, id: target.id });
    },
  });
}
