import {
  composerDraft,
  resetSelection,
  selection,
} from "$lib/features/workspace/state/selection.svelte";
import type { ProjectRecord } from "../../api";
import { resolveNewAgentComposerSelection } from "../agent-selection-defaults";
import {
  addCenterTab,
  setActiveCenterTab,
} from "../workbench/center-tabs.svelte";
import { workbenchState } from "../workbench/state.svelte";
import { pendingConversationKey } from "../workbench/state-keys";
import { clearTranscriptState, createPendingConversationId } from "./state";

export function openPendingConversation(project: ProjectRecord) {
  const id = createPendingConversationId();
  const defaults = workbenchState.settingsDraft
    ? resolveNewAgentComposerSelection(
        workbenchState.settingsDraft,
        workbenchState.models,
        workbenchState.authProviders,
      )
    : {
        selectedModelKey: workbenchState.selectedModelKey,
        selectedThinkingLevel: workbenchState.selectedThinkingLevel,
        selectedMode: workbenchState.selectedMode,
        selectedPermissionLevel: workbenchState.selectedPermissionLevel,
      };
  workbenchState.pendingConversations[pendingConversationKey(id)] = {
    id,
    projectId: project.id,
    projectDir: project.dir,
    title: "New Conversation",
    composerText: "",
    selectedModelKey: defaults.selectedModelKey,
    thinkingLevel: defaults.selectedThinkingLevel,
    mode: defaults.selectedMode,
    permissionLevel: defaults.selectedPermissionLevel,
    sending: false,
    createdAt: new Date().toISOString(),
  };
  addCenterTab({ kind: "pending-conversation", id });
  selectPendingConversation(id);
}

export function selectPendingConversation(pendingId: string) {
  const pending =
    workbenchState.pendingConversations[pendingConversationKey(pendingId)];
  if (!pending) return;
  setActiveCenterTab({ kind: "pending-conversation", id: pending.id });
  workbenchState.activeConversationTabId = undefined;
  resetSelection();
  selection.projectId = pending.projectId;
  composerDraft.projectDir = pending.projectDir;
  workbenchState.selectedModelKey = pending.selectedModelKey;
  workbenchState.selectedThinkingLevel = pending.thinkingLevel;
  workbenchState.selectedMode = pending.mode;
  workbenchState.selectedPermissionLevel = pending.permissionLevel;
  clearTranscriptState();
  workbenchState.sending = pending.sending;
  workbenchState.error = pending.error;
}
