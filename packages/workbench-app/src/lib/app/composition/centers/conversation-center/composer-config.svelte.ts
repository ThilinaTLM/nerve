import type { ConversationConfig } from "@nervekit/contracts/core";
import type { ModelSelection } from "@nervekit/contracts/models";
import type { ComposerView } from "$lib/application/composer/composer-view.svelte";
import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { captureSystemPromptPreview } from "$lib/app/composition/conversations/system-prompt-preview";
import { openSystemPromptPane } from "$lib/features/conversations/state/system-prompt-pane.svelte";
import { modelKey } from "$lib/presentation/utils/model";

/** Composer model/profile/permission setters, delegating to the composer view. */
export function createComposerConfigActions(composerView: ComposerView) {
  return {
    /** The combined picker changes model and reasoning; locks keep either out. */
    async setComposerModelSelection(next: {
      model?: ModelSelection;
      thinkingLevel?: ConversationConfig["reasoningLevel"];
    }) {
      if (next.model)
        await composerView.setModel(modelKey(next.model), next.thinkingLevel);
      else if (next.thinkingLevel !== undefined)
        await composerView.setReasoning(next.thinkingLevel);
    },
    resetComposerPermission() {
      return composerView.setPermission("");
    },
    setComposerAgentProfile(name: string) {
      return composerView.setProfile(name);
    },
    setComposerPermissionRuleSet(value: string) {
      return composerView.setPermission(value);
    },
  };
}

/** Opens the system prompt preview for the pending draft or active conversation. */
export function createSystemPromptOpener(deps: {
  pending: () => PendingConversationState | undefined;
  inherited: () => ComposerView["inherited"];
  profiles: () => readonly { name: string; digest?: string }[];
  conversation: () => Parameters<
    typeof captureSystemPromptPreview
  >[0]["conversation"];
}) {
  let opening = false;
  return async function openSystemPrompt() {
    if (opening) return;
    const pending = deps.pending();
    const target = captureSystemPromptPreview({
      pending,
      inherited: deps.inherited(),
      targetProfile: (() => {
        const profile = deps
          .profiles()
          .find((p) => p.name === pending?.explicitAgentProfile);
        return profile?.digest
          ? { name: profile.name, digest: profile.digest }
          : undefined;
      })(),
      conversation: deps.conversation(),
    });
    if (!target) return;
    opening = true;
    try {
      const preview = await requestConversation(
        "conversation.previewSystemPrompt",
        target.params,
      );
      await openSystemPromptPane({
        projectId: target.projectId,
        sourceId: target.sourceId,
        text:
          preview.status === "available"
            ? preview.systemPrompt
            : "Configuration unavailable. Check scoped configuration diagnostics.",
      });
    } finally {
      opening = false;
    }
  };
}
