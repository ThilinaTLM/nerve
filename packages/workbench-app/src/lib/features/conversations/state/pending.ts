import type { AgentRecord, ProjectRecord } from "$lib/api";
import { pendingConversationKey } from "$lib/kernel/navigation/view-keys";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { settingsReadModel } from "$lib/application/preferences/settings-read-model.svelte";
import {
  addCenterTab,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import {
  composerDraft,
  resetSelection,
  selection,
} from "$lib/application/workspace/selection.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { resolveNewAgentComposerSelection } from "$lib/application/preferences/agent-selection";
import { clearTranscriptState, createPendingConversationId } from "./state";

export function openPendingConversation(
  project: ProjectRecord,
  initialMode?: AgentRecord["mode"],
) {
  const id = createPendingConversationId();
  const defaults = settingsReadModel.settingsDraft
    ? resolveNewAgentComposerSelection(
        settingsReadModel.settingsDraft,
        settingsReadModel.models,
        settingsReadModel.authProviders,
      )
    : {
        selectedModelKey: conversationState.selectedModelKey,
        selectedThinkingLevel: conversationState.selectedThinkingLevel,
        selectedMode: conversationState.selectedMode,
        selectedPermissionLevel: conversationState.selectedPermissionLevel,
      };
  conversationState.pendingConversations[pendingConversationKey(id)] = {
    id,
    projectId: project.id,
    projectDir: project.dir,
    title: "New Conversation",
    composerText: "",
    selectedModelKey: defaults.selectedModelKey,
    thinkingLevel: defaults.selectedThinkingLevel,
    mode: initialMode ?? defaults.selectedMode,
    permissionLevel: defaults.selectedPermissionLevel,
    sending: false,
    createdAt: new Date().toISOString(),
  };
  addCenterTab({ kind: "pending-conversation", id });
  selectPendingConversation(id);
}

export function selectPendingConversation(pendingId: string) {
  const pending =
    conversationState.pendingConversations[pendingConversationKey(pendingId)];
  if (!pending) return;
  setActiveCenterTab({ kind: "pending-conversation", id: pending.id });
  conversationState.activeConversationTabId = undefined;
  resetSelection();
  selection.projectId = pending.projectId;
  composerDraft.projectDir = pending.projectDir;
  conversationState.selectedModelKey = pending.selectedModelKey;
  conversationState.selectedThinkingLevel = pending.thinkingLevel;
  conversationState.selectedMode = pending.mode;
  conversationState.selectedPermissionLevel = pending.permissionLevel;
  clearTranscriptState();
  workspaceState.error = pending.error;
}
