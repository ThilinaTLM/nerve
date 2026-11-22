import { registerExtensionHostActions } from "$lib/features/extension-ui";
import { openFilePane } from "$lib/features/filesystem";
import { conversationDraftStore } from "$lib/application/workspace/conversation-draft-store";
import type { PromptDraftTarget } from "$lib/application/workspace/conversation-draft-store";
import { pendingConversations } from "$lib/application/workspace/pending-conversations.svelte";
import { selection } from "$lib/application/workspace/selection.svelte";
import { selectCenterTab } from "$lib/application/workspace/center-tabs.svelte";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { withConversationRow } from "$lib/application/workspace/conversation-rows";
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
    conversationStarted: async (_projectId, conversationId, options) => {
      if (options.draft !== undefined)
        conversationDraftStore().setPrompt(
          { kind: "conversation", id: conversationId },
          options.draft,
        );
      if (!options.open) return;
      // A conversation.changed notice may be late; make sure the tab has its row.
      const snapshot = await requestConversation("conversation.getSnapshot", {
        conversationId,
      });
      workspaceState.conversations = withConversationRow(
        workspaceState.conversations,
        {
          ...snapshot.conversation,
          references: [],
          childCount: 0,
          pendingWork: false,
          pendingInput: null,
          agentProfile: snapshot.config.agentProfile,
          model: snapshot.config.model,
          permissionRuleSetId: snapshot.config.permissionRuleSetId,
        },
      );
      await selectCenterTab({ kind: "conversation", id: conversationId });
    },
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
