import {
  deriveConversationTitle,
  isInlineCommandPrompt,
} from "@nervekit/contracts";
import { scopedUsableModelOptions } from "@nervekit/workbench-ui/core/utils/model";
import {
  type AgentRecord,
  type ConversationRecord,
  deleteConversation,
  updateAgentConfig,
} from "$lib/api";
import { protocolRequest } from "@nervekit/protocol";
import { queryClient, queryKeys } from "$lib/core/query";
import { pendingConversationKey } from "$lib/core/state/state-keys";
import type {
  ConversationViewState,
  PendingConversationState,
} from "$lib/core/types/state-types";
import {
  agentNeedsComposerUpdate,
  currentActiveAgent,
  selectedModel,
  selectedThinkingLevel,
} from "$lib/features/conversations/state/composer-config.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import { openSettingsPane } from "$lib/features/settings/state/settings-actions.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { replaceCenterTab } from "$lib/features/workspace/state/center-tabs.svelte";
import {
  composerDraft,
  selection,
} from "$lib/features/workspace/state/selection.svelte";
import { loadWorkspaceState } from "$lib/features/workspace/state/workspace-actions.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
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
      needsApprovalPolicy,
      needsThinking,
    } = agentNeedsComposerUpdate(agent);
    if (
      needsModel ||
      needsMode ||
      needsPermission ||
      needsApprovalPolicy ||
      needsThinking
    ) {
      const updated = await updateAgentConfig(selection.agentId, {
        model: desired ?? null,
        thinkingLevel,
        mode: conversationState.selectedMode,
        permissionLevel: conversationState.selectedPermissionLevel,
        approvalPolicy: conversationState.selectedApprovalPolicy,
      }).catch(() => undefined);
      if (updated) {
        conversationState.selectedThinkingLevel = updated.thinkingLevel;
        workspaceState.agents = workspaceState.agents.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        );
      }
    }
    return selection.agentId;
  }
  if (selection.projectId && selection.conversationId) {
    const { agent } = (
      await protocolRequest<{ agent: AgentRecord }>("agent.create", {
        projectId: selection.projectId,
        conversationId: selection.conversationId,
        model: selectedModel(),
        thinkingLevel: selectedThinkingLevel(),
        mode: conversationState.selectedMode,
        permissionLevel: conversationState.selectedPermissionLevel,
        approvalPolicy: conversationState.selectedApprovalPolicy,
      })
    ).result;
    selection.agentId = agent.id;
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    return agent.id;
  }
  workspaceState.projectPickerOpen = true;
  throw new Error("Select a project directory before starting a conversation.");
}

function hasUsableModel(): boolean {
  return (
    scopedUsableModelOptions(
      settingsState.models,
      settingsState.authProviders,
      settingsState.settingsDraft?.scopedModels,
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
    workspaceState.error = message;
    notifyPromptError("No usable model configured", message);
    return;
  }

  pending.selectedModelKey = conversationState.selectedModelKey;
  pending.thinkingLevel = selectedThinkingLevel();
  pending.mode = conversationState.selectedMode;
  pending.permissionLevel = conversationState.selectedPermissionLevel;
  pending.approvalPolicy = conversationState.selectedApprovalPolicy;
  pending.sending = true;
  pending.error = undefined;
  workspaceState.error = undefined;

  let view: ConversationViewState | undefined;
  let createdConversationId: string | undefined;
  try {
    const { conversation } = (
      await protocolRequest<{
        conversation: ConversationRecord;
      }>("conversation.create", {
        projectId: pending.projectId,
        title: deriveConversationTitle(text),
        mode: pending.mode,
        permissionLevel: pending.permissionLevel,
        approvalPolicy: pending.approvalPolicy,
      })
    ).result;
    createdConversationId = conversation.id;
    const { agent } = (
      await protocolRequest<{ agent: AgentRecord }>("agent.create", {
        projectId: pending.projectId,
        conversationId: conversation.id,
        model: selectedModel(),
        thinkingLevel: pending.thinkingLevel,
        mode: pending.mode,
        permissionLevel: pending.permissionLevel,
        approvalPolicy: pending.approvalPolicy,
      })
    ).result;

    upsertConversationRecord(conversation);
    upsertAgentRecord(agent);
    replaceCenterTab(
      { kind: "pending-conversation", id: pending.id },
      { kind: "conversation", id: conversation.id },
    );
    conversationState.activeConversationTabId = conversation.id;
    selection.projectId = conversation.projectId;
    selection.conversationId = conversation.id;
    selection.entryId = conversation.activeEntryId;
    selection.agentId = agent.id;
    composerDraft.projectDir = pending.projectDir;
    const preservedComposerText = clearComposer ? "" : pending.composerText;
    delete conversationState.pendingConversations[
      pendingConversationKey(pending.id)
    ];
    view = ensureConversationView(conversation.id);
    view.sending = true;
    view.error = undefined;
    view.streamingText = "";
    view.live = { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
    view.transcript = isInlineCommandPrompt(text)
      ? []
      : [{ role: "user", text, optimistic: true }];
    view.composerText = preservedComposerText;
    workspaceState.error = undefined;
    if (clearComposer) composerDraft.text = "";
    persistConversationTabs();
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    await protocolRequest<{ accepted: true }>(
      "run.start",
      { agentId: agent.id, text },
      { idempotencyKey: crypto.randomUUID() },
    );
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
    workspaceState.error = message;
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
    workspaceState.projectPickerOpen = true;
    const message =
      "Select a project directory before starting a conversation.";
    workspaceState.error = message;
    notifyPromptError("Select a project directory", message);
    return;
  }
  if (!hasUsableModel()) {
    void openSettingsPane();
    const message =
      "Configure a model provider or adjust Scoped Models in Settings before prompting.";
    view.error = message;
    workspaceState.error = message;
    notifyPromptError("No usable model configured", message);
    return;
  }
  if (view.live.compaction?.state === "running") {
    notifyPromptError(
      "Compaction in progress",
      "Wait for context compaction to finish before sending another prompt.",
    );
    return;
  }
  const queueWhileRunning = Boolean(view.sending);
  view.error = undefined;
  workspaceState.error = undefined;
  if (!queueWhileRunning) {
    view.sending = true;
    view.streamingText = "";
    view.live = { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
  }
  try {
    const agentId = await ensureAgent();
    if (clearComposer) {
      view.composerText = "";
      composerDraft.text = "";
    }
    if (queueWhileRunning) {
      await protocolRequest<{ accepted: true }>(
        "run.steer",
        { agentId, text },
        { idempotencyKey: crypto.randomUUID() },
      );
      return;
    }
    if (!isInlineCommandPrompt(text)) {
      view.transcript = [
        ...view.transcript,
        { role: "user", text, optimistic: true },
      ];
    }
    await protocolRequest<{ accepted: true }>(
      "run.start",
      { agentId, text },
      { idempotencyKey: crypto.randomUUID() },
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.error = message;
    workspaceState.error = message;
    if (!queueWhileRunning) {
      view.sending = false;
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
