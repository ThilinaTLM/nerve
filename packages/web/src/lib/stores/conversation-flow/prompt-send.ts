import { deriveConversationTitle } from "@nerve/shared";
import { notify } from "$lib/notifications/notify.svelte";
import {
  type AgentRecord,
  apiPathSegment,
  apiPost,
  type ConversationRecord,
  deleteConversation,
  updateAgentConfig,
} from "../../api";
import { queryClient, queryKeys } from "../../query";
import { composerDraft, selection } from "../../state/app-state.svelte";
import { scopedUsableModelOptions } from "../../utils/model";
import {
  agentNeedsComposerUpdate,
  currentActiveAgent,
  selectedModel,
  selectedThinkingLevel,
} from "../composer-config.svelte";
import { openSettingsPane } from "../settings.svelte";
import { replaceCenterTab } from "../workbench/center-tabs.svelte";
import type {
  ConversationViewState,
  PendingConversationState,
} from "../workbench/state.svelte";
import { workbenchState } from "../workbench/state.svelte";
import { pendingConversationKey } from "../workbench/state-keys";
import { loadWorkspaceState } from "../workspace.svelte";
import { abortActiveRun } from "./run-control";
import { upsertAgentRecord, upsertConversationRecord } from "./selection";
import {
  activePendingConversation,
  ensureConversationView,
  persistConversationTabs,
} from "./state";

export function setActiveComposerText(value: string) {
  const pending = activePendingConversation();
  if (pending) {
    pending.composerText = value;
    return;
  }
  if (!selection.conversationId) {
    composerDraft.text = value;
    return;
  }
  ensureConversationView(selection.conversationId).composerText = value;
}

export async function ensureAgent(): Promise<string> {
  if (selection.agentId) {
    const agent = currentActiveAgent();
    const {
      desired,
      thinkingLevel,
      needsModel,
      needsMode,
      needsPermission,
      needsThinking,
    } = agentNeedsComposerUpdate(agent);
    if (needsModel || needsMode || needsPermission || needsThinking) {
      const updated = await updateAgentConfig(selection.agentId, {
        model: desired ?? null,
        thinkingLevel,
        mode: workbenchState.selectedMode,
        permissionLevel: workbenchState.selectedPermissionLevel,
      }).catch(() => undefined);
      if (updated) {
        workbenchState.selectedThinkingLevel = updated.thinkingLevel;
        workbenchState.agents = workbenchState.agents.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        );
      }
    }
    return selection.agentId;
  }
  if (selection.projectId && selection.conversationId) {
    const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
      projectId: selection.projectId,
      conversationId: selection.conversationId,
      model: selectedModel(),
      thinkingLevel: selectedThinkingLevel(),
      mode: workbenchState.selectedMode,
      permissionLevel: workbenchState.selectedPermissionLevel,
    });
    selection.agentId = agent.id;
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    return agent.id;
  }
  workbenchState.projectPickerOpen = true;
  throw new Error("Select a project directory before starting a conversation.");
}

function hasUsableModel(): boolean {
  return (
    scopedUsableModelOptions(
      workbenchState.models,
      workbenchState.authProviders,
      workbenchState.settingsDraft?.scopedModels,
    ).length > 0
  );
}

function notifyPromptError(title: string, message: string): void {
  notify.error(title, { description: message });
}

type SendPromptTextOptions = {
  clearComposer?: boolean;
};

async function sendPendingPrompt(
  pending: PendingConversationState,
  text: string,
  options: SendPromptTextOptions = {},
): Promise<void> {
  const clearComposer = options.clearComposer ?? true;

  if (!hasUsableModel()) {
    void openSettingsPane();
    const message =
      "Configure a model provider or adjust Scoped Models in Settings before prompting.";
    pending.error = message;
    workbenchState.error = message;
    notifyPromptError("No usable model configured", message);
    return;
  }

  pending.selectedModelKey = workbenchState.selectedModelKey;
  pending.thinkingLevel = selectedThinkingLevel();
  pending.mode = workbenchState.selectedMode;
  pending.permissionLevel = workbenchState.selectedPermissionLevel;
  pending.sending = true;
  pending.error = undefined;
  workbenchState.sending = true;
  workbenchState.error = undefined;
  workbenchState.streamingText = "";

  let view: ConversationViewState | undefined;
  let createdConversationId: string | undefined;
  try {
    const { conversation } = await apiPost<{
      conversation: ConversationRecord;
    }>("/api/conversations", {
      projectId: pending.projectId,
      title: deriveConversationTitle(text),
      mode: pending.mode,
      permissionLevel: pending.permissionLevel,
    });
    createdConversationId = conversation.id;
    const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
      projectId: pending.projectId,
      conversationId: conversation.id,
      model: selectedModel(),
      thinkingLevel: pending.thinkingLevel,
      mode: pending.mode,
      permissionLevel: pending.permissionLevel,
    });

    upsertConversationRecord(conversation);
    upsertAgentRecord(agent);
    replaceCenterTab(
      { kind: "pending-conversation", id: pending.id },
      { kind: "conversation", id: conversation.id },
    );
    workbenchState.activeConversationTabId = conversation.id;
    selection.projectId = conversation.projectId;
    selection.conversationId = conversation.id;
    selection.entryId = conversation.activeEntryId;
    selection.agentId = agent.id;
    composerDraft.projectDir = pending.projectDir;
    const preservedComposerText = clearComposer ? "" : pending.composerText;
    delete workbenchState.pendingConversations[
      pendingConversationKey(pending.id)
    ];
    view = ensureConversationView(conversation.id);
    view.sending = true;
    view.error = undefined;
    view.streamingText = "";
    view.live = { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
    view.transcript = [{ role: "user", text, optimistic: true }];
    view.composerText = preservedComposerText;
    workbenchState.transcript = view.transcript;
    workbenchState.treeNodes = [];
    workbenchState.streamingText = "";
    workbenchState.error = undefined;
    if (clearComposer) composerDraft.text = "";
    persistConversationTabs();
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    await apiPost(`/api/agents/${apiPathSegment(agent.id)}/prompt`, { text });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    if (view) {
      view.error = message;
      view.sending = false;
    } else {
      if (createdConversationId)
        await deleteConversation(createdConversationId).catch(() => undefined);
      pending.error = message;
      pending.sending = false;
    }
    workbenchState.error = message;
    workbenchState.sending = false;
    notifyPromptError("Prompt failed", message);
  }
}

export async function sendPromptText(
  rawText: string,
  options: SendPromptTextOptions = {},
) {
  const clearComposer = options.clearComposer ?? true;
  const pending = activePendingConversation();
  const view = selection.conversationId
    ? ensureConversationView(selection.conversationId)
    : undefined;
  const text = rawText.trim();
  if (!text || pending?.sending) return;
  if (pending) {
    await sendPendingPrompt(pending, text, { clearComposer });
    return;
  }
  if (!selection.projectId || !selection.conversationId || !view) {
    workbenchState.projectPickerOpen = true;
    const message =
      "Select a project directory before starting a conversation.";
    workbenchState.error = message;
    notifyPromptError("Select a project directory", message);
    return;
  }
  if (!hasUsableModel()) {
    void openSettingsPane();
    const message =
      "Configure a model provider or adjust Scoped Models in Settings before prompting.";
    view.error = message;
    workbenchState.error = message;
    notifyPromptError("No usable model configured", message);
    return;
  }
  const queueWhileRunning = Boolean(view.sending || workbenchState.sending);
  view.error = undefined;
  workbenchState.error = undefined;
  if (!queueWhileRunning) {
    view.sending = true;
    view.streamingText = "";
    view.live = { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
    workbenchState.sending = true;
    workbenchState.streamingText = "";
  }
  try {
    const agentId = await ensureAgent();
    if (clearComposer) {
      view.composerText = "";
      composerDraft.text = "";
    }
    if (queueWhileRunning) {
      await apiPost(`/api/agents/${apiPathSegment(agentId)}/prompt`, {
        text,
        behavior: "steer",
      });
      return;
    }
    view.transcript = [
      ...view.transcript,
      { role: "user", text, optimistic: true },
    ];
    workbenchState.transcript = view.transcript;
    await apiPost(`/api/agents/${apiPathSegment(agentId)}/prompt`, { text });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.error = message;
    workbenchState.error = message;
    if (!queueWhileRunning) {
      view.sending = false;
      workbenchState.sending = false;
    }
    notifyPromptError("Prompt failed", message);
  }
}

export async function sendPrompt() {
  const pending = activePendingConversation();
  const view = selection.conversationId
    ? ensureConversationView(selection.conversationId)
    : undefined;
  const text = (
    pending?.composerText ??
    view?.composerText ??
    composerDraft.text
  ).trim();
  if (!text || pending?.sending) return;
  if (text === "/abort") {
    if (pending) pending.composerText = "";
    if (view) view.composerText = "";
    composerDraft.text = "";
    await abortActiveRun();
    return;
  }
  await sendPromptText(text, { clearComposer: true });
}
