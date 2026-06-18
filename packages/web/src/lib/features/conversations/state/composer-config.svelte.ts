import type {
  AgentRecord,
  ModelInfo,
  ModelSelection,
  Settings,
} from "$lib/api";
import { getConversationContextUsage, updateAgentConfig } from "$lib/api";
import {
  conversationViewKey,
  pendingConversationKey,
} from "$lib/core/state/state-keys";
import { modelKey, parseModelKey } from "$lib/core/utils/model";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { queueSettingsSave } from "$lib/features/settings/state/settings-actions.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import {
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
} from "./agent-selection-defaults";

export function currentActiveAgent(): AgentRecord | undefined {
  return workspaceState.agents.find((agent) => agent.id === selection.agentId);
}

export function selectedModel(): ModelSelection | undefined {
  return parseModelKey(conversationState.selectedModelKey);
}

export function selectedModelInfo(): ModelInfo | undefined {
  return settingsState.models.find(
    (model) => modelKey(model) === conversationState.selectedModelKey,
  );
}

export { clampThinkingLevelForModel, supportedThinkingLevelsForModel };

export function supportedThinkingLevelsForSelectedModel(): AgentRecord["thinkingLevel"][] {
  return supportedThinkingLevelsForModel(selectedModelInfo());
}

type LastAgentSelectionPatch = Partial<Settings["lastAgentSelection"]>;

function rememberLastAgentSelection(patch: LastAgentSelectionPatch): void {
  const settings = settingsState.settingsDraft;
  if (!settings?.rememberLastAgentSelection) return;
  settings.lastAgentSelection = {
    ...settings.lastAgentSelection,
    ...patch,
  };
  queueSettingsSave({ lastAgentSelection: patch }, { immediate: true });
}

function activePendingComposerConversation() {
  const active = workspaceState.activeCenterTab;
  if (active?.kind !== "pending-conversation") return undefined;
  return conversationState.pendingConversations[
    pendingConversationKey(active.id)
  ];
}

export function selectedThinkingLevel(): AgentRecord["thinkingLevel"] {
  return clampThinkingLevelForModel(
    conversationState.selectedThinkingLevel,
    selectedModelInfo(),
  );
}

export async function setComposerModel(key: string) {
  conversationState.selectedModelKey = key;
  const thinkingLevel = clampThinkingLevelForModel(
    conversationState.selectedThinkingLevel,
    selectedModelInfo(),
  );
  conversationState.selectedThinkingLevel = thinkingLevel;
  const pending = activePendingComposerConversation();
  if (pending) {
    pending.selectedModelKey = key;
    pending.thinkingLevel = thinkingLevel;
  }
  const model = selectedModel();
  rememberLastAgentSelection({
    ...(model ? { model } : {}),
    thinkingLevel,
  });
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, {
    model: model ?? null,
    thinkingLevel,
  });
  conversationState.selectedThinkingLevel = agent.thinkingLevel;
  workspaceState.agents = workspaceState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
  if (selection.conversationId) {
    const contextUsage = await getConversationContextUsage(
      selection.conversationId,
    ).catch(() => undefined);
    const view =
      conversationState.conversationViews[
        conversationViewKey(selection.conversationId)
      ];
    if (contextUsage && view) view.contextUsage = contextUsage;
  }
}

export async function setComposerThinkingLevel(
  level: AgentRecord["thinkingLevel"],
) {
  const thinkingLevel = clampThinkingLevelForModel(level, selectedModelInfo());
  conversationState.selectedThinkingLevel = thinkingLevel;
  const pending = activePendingComposerConversation();
  if (pending) pending.thinkingLevel = thinkingLevel;
  rememberLastAgentSelection({ thinkingLevel });
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, { thinkingLevel });
  conversationState.selectedThinkingLevel = agent.thinkingLevel;
  workspaceState.agents = workspaceState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
}

export async function setComposerMode(mode: AgentRecord["mode"]) {
  conversationState.selectedMode = mode;
  const pending = activePendingComposerConversation();
  if (pending) pending.mode = mode;
  rememberLastAgentSelection({ mode });
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, { mode });
  workspaceState.agents = workspaceState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
}

export async function setComposerPermission(
  permissionLevel: AgentRecord["permissionLevel"],
) {
  conversationState.selectedPermissionLevel = permissionLevel;
  const pending = activePendingComposerConversation();
  if (pending) pending.permissionLevel = permissionLevel;
  rememberLastAgentSelection({ permissionLevel });
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, { permissionLevel });
  workspaceState.agents = workspaceState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
}

export function agentNeedsComposerUpdate(agent: AgentRecord | undefined) {
  const desired = selectedModel();
  const thinkingLevel = selectedThinkingLevel();
  const needsModel =
    desired &&
    modelKey(agent?.model ?? { provider: "", modelId: "" }) !==
      modelKey(desired);
  const needsMode = agent?.mode !== conversationState.selectedMode;
  const needsPermission =
    agent?.permissionLevel !== conversationState.selectedPermissionLevel;
  const needsThinking = agent?.thinkingLevel !== thinkingLevel;
  return {
    desired,
    thinkingLevel,
    needsModel,
    needsMode,
    needsPermission,
    needsThinking,
  };
}
