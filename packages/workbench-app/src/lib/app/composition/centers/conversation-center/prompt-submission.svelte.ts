import { createId } from "@nervekit/contracts";
import { replacementSettingsMutation } from "$lib/application/agent-configuration/override-view";
import { agentProfileCatalog } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import type { ComposerView } from "$lib/application/composer/composer-view.svelte";
import type {
  conversationDraftStore,
  PromptDraftTarget,
} from "$lib/application/workspace/conversation-draft-store";
import {
  replaceOpenCenterTabs,
  selectCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import {
  pendingConversations,
  type PendingConversationState,
} from "$lib/application/workspace/pending-conversations.svelte";
import { withConversationRow } from "$lib/application/workspace/conversation-rows";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { submitPendingConversation } from "$lib/app/composition/conversations/submit-pending-conversation";
import { switchAgentProfile } from "$lib/features/conversations/adapters/core-agent-configuration.adapter";

/** Reports an action failure to the user instead of leaving it unhandled. */
export async function runActivePaneAction(
  action: () => unknown | Promise<unknown>,
) {
  try {
    await action();
  } catch (e) {
    notify.error(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Creates the conversation behind a pending draft, sends its first prompt and
 * promotes the pending tab to the new conversation.
 */
export async function submitPendingPrompt(input: {
  pending: PendingConversationState;
  text: string;
  inherited: ComposerView["inherited"];
  drafts: ReturnType<typeof conversationDraftStore>;
  clearComposer: boolean;
}) {
  const { pending, text, drafts } = input;
  if (pending.sending) return;
  pending.sending = true;
  try {
    const snapshot = await submitPendingConversation(pending, text, {
      inherited: input.inherited,
      create: (params) =>
        requestConversation("conversation.create", {
          id: createId("conv"),
          ...params,
        }),
      getSnapshot: (conversationId) =>
        requestConversation("conversation.getSnapshot", { conversationId }),
      configure: (conversationId, patch) =>
        requestConversation("conversation.configure", {
          conversationId,
          patch,
        }),
      resolveProfile: async (projectId, name) => {
        const profile = (await agentProfileCatalog.ensure(projectId)).find(
          (p) => p.name === name,
        );
        if (!profile?.digest)
          throw new Error("Profile unavailable. Refresh and try again.");
        return { name, digest: profile.digest };
      },
      setAgentProfile: switchAgentProfile,
      saveOverrides: async (conversationId, changes) => {
        const scope = { scope: "conversation" as const, conversationId };
        const current = await requestConversation("agentConfiguration.get", {
          scope,
        });
        if (current.status !== "available")
          throw new Error("Configuration unavailable.");
        const result = await requestConversation("agentConfiguration.save", {
          scope,
          expectedRevision: current.source.revision,
          expectedDigest: current.source.digest,
          ...replacementSettingsMutation(current.overrides, changes),
        });
        if (result.status !== "saved")
          throw new Error(
            `Configuration ${result.status}. Refresh and try again.`,
          );
      },
      submit: (conversationId, prompt) =>
        requestConversation("input.submit", {
          conversationId,
          inputId: createId("input"),
          text: prompt,
          source: "user",
        }),
    });
    const pendingTarget: PromptDraftTarget = {
      kind: "pending-conversation",
      id: pending.id,
      projectId: pending.projectId,
    };
    if (input.clearComposer) drafts.clearPromptIfUnchanged(pendingTarget, text);
    // Move any remaining draft to the created conversation before the tab is promoted.
    drafts.promotePendingPrompt(pending.id, snapshot.conversation.id);
    // A conversation.changed notice may already have added a fresher row.
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
    replaceOpenCenterTabs(
      workspaceState.openCenterTabs.map((t) =>
        t.kind === "pending-conversation" && t.id === pending.id
          ? { kind: "conversation", id: snapshot.conversation.id }
          : t,
      ),
    );
    pendingConversations.delete(pending.id);
    await selectCenterTab({
      kind: "conversation",
      id: snapshot.conversation.id,
    });
  } catch (e) {
    pending.error = String(e);
    throw e;
  } finally {
    pending.sending = false;
  }
}
