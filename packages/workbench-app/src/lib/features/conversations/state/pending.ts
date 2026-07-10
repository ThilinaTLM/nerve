import type { ProjectRecord } from "$lib/api";
import { pendingConversationKey } from "$lib/core/state/state-keys";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import {
  addCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import {
  composerDraft,
  resetSelection,
  selection,
} from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { resolveNewAgentComposerSelection } from "./agent-selection-defaults";
import { clearTranscriptState, createPendingConversationId } from "./state";

export function openPendingConversation(project: ProjectRecord) {
  const id = createPendingConversationId();
  const defaults = settingsState.settingsDraft
    ? resolveNewAgentComposerSelection(
        settingsState.settingsDraft,
        settingsState.models,
        settingsState.authProviders,
      )
    : {
        selectedModelKey: conversationState.selectedModelKey,
        selectedThinkingLevel: conversationState.selectedThinkingLevel,
        selectedMode: conversationState.selectedMode,
        selectedPermissionLevel: conversationState.selectedPermissionLevel,
        selectedApprovalPolicy: conversationState.selectedApprovalPolicy,
      };
  conversationState.pendingConversations[pendingConversationKey(id)] = {
    id,
    projectId: project.id,
    projectDir: project.dir,
    title: "New Conversation",
    composerText: "",
    selectedModelKey: defaults.selectedModelKey,
    thinkingLevel: defaults.selectedThinkingLevel,
    mode: defaults.selectedMode,
    permissionLevel: defaults.selectedPermissionLevel,
    approvalPolicy: defaults.selectedApprovalPolicy,
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
  conversationState.selectedApprovalPolicy = pending.approvalPolicy;
  clearTranscriptState();
  workspaceState.error = pending.error;
}
