import { modelKey, parseModelKey } from "$lib/presentation/utils/model";
import type { AgentRecord, ModelInfo, ModelSelection } from "$lib/api";
import { pendingConversationKey } from "$lib/kernel/navigation/view-keys";
import { queueAgentConfigChange } from "$lib/features/conversations/state/agent-config-mutations.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { rememberLastAgentSelection } from "$lib/application/settings";
import { settingsReadModel } from "$lib/application/preferences/settings-read-model.svelte";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { mainAgentForConversation } from "./main-agent";
import {
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
} from "$lib/application/preferences/agent-selection";

export function currentActiveAgent(): AgentRecord | undefined {
  const conversation = workspaceState.conversations.find(
    (candidate) => candidate.id === selection.conversationId,
  );
  if (!conversation) return undefined;
  return mainAgentForConversation(
    conversation,
    workspaceState.agents,
    selection.agentId,
  );
}

export function selectedModel(): ModelSelection | undefined {
  return parseModelKey(conversationState.selectedModelKey);
}

export function selectedModelInfo(): ModelInfo | undefined {
  return settingsReadModel.models.find(
    (model) => modelKey(model) === conversationState.selectedModelKey,
  );
}

export { clampThinkingLevelForModel, supportedThinkingLevelsForModel };

export function supportedThinkingLevelsForSelectedModel(): AgentRecord["thinkingLevel"][] {
  return supportedThinkingLevelsForModel(selectedModelInfo());
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

/**
 * Composer setters mutate local state synchronously (immediate display) and
 * enqueue one coalesced, serialized `agent.configure` mutation per agent.
 * Pending-conversation controls stay local-only. The `agent.configured`
 * conversation event owns the coalesced context-usage refresh.
 */
export function setComposerModel(key: string) {
  conversationState.selectedModelKey = key;
  // Clamp thinking locally from the already-loaded model info.
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
  const agentId = currentActiveAgent()?.id;
  if (pending || !agentId) return;
  queueAgentConfigChange(agentId, {
    model: model ?? null,
    thinkingLevel,
  });
}

export function setComposerThinkingLevel(level: AgentRecord["thinkingLevel"]) {
  const thinkingLevel = clampThinkingLevelForModel(level, selectedModelInfo());
  conversationState.selectedThinkingLevel = thinkingLevel;
  const pending = activePendingComposerConversation();
  if (pending) pending.thinkingLevel = thinkingLevel;
  rememberLastAgentSelection({ thinkingLevel });
  const agentId = currentActiveAgent()?.id;
  if (pending || !agentId) return;
  queueAgentConfigChange(agentId, { thinkingLevel });
}

export function setComposerMode(mode: AgentRecord["mode"]) {
  conversationState.selectedMode = mode;
  const pending = activePendingComposerConversation();
  if (pending) pending.mode = mode;
  rememberLastAgentSelection({ mode });
  const agentId = currentActiveAgent()?.id;
  if (pending || !agentId) return;
  queueAgentConfigChange(agentId, { mode });
}

export function setComposerPermission(
  permissionLevel: AgentRecord["permissionLevel"],
) {
  conversationState.selectedPermissionLevel = permissionLevel;
  const pending = activePendingComposerConversation();
  if (pending) pending.permissionLevel = permissionLevel;
  rememberLastAgentSelection({ permissionLevel });
  const agentId = currentActiveAgent()?.id;
  if (pending || !agentId) return;
  queueAgentConfigChange(agentId, { permissionLevel });
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
