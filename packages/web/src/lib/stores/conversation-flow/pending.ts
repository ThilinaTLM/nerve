import type { ProjectRecord } from "../../api";
import {
  composerDraft,
  resetSelection,
  selection,
} from "../../state/app-state.svelte";
import {
  addCenterTab,
  setActiveCenterTab,
} from "../workbench/center-tabs.svelte";
import { workbenchState } from "../workbench/state.svelte";
import { clearTranscriptState, createPendingConversationId } from "./state";

export function openPendingConversation(project: ProjectRecord) {
  const id = createPendingConversationId();
  workbenchState.pendingConversations[id] = {
    id,
    projectId: project.id,
    projectDir: project.dir,
    title: "New Conversation",
    composerText: "",
    selectedModelKey: workbenchState.selectedModelKey,
    thinkingLevel: workbenchState.selectedThinkingLevel,
    mode: workbenchState.selectedMode,
    permissionLevel: workbenchState.selectedPermissionLevel,
    sending: false,
    createdAt: new Date().toISOString(),
  };
  addCenterTab({ kind: "pending-conversation", id });
  selectPendingConversation(id);
}

export function selectPendingConversation(pendingId: string) {
  const pending = workbenchState.pendingConversations[pendingId];
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
