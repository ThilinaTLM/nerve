import type { AgentRecord, ModelInfo, ModelSelection, Settings } from "../api";
import { getConversationContextUsage, updateAgentConfig } from "../api";
import { selection } from "../state/app-state.svelte";
import { modelKey, parseModelKey } from "../utils/model";
import {
  clampThinkingLevelForModel,
  supportedThinkingLevelsForModel,
} from "./agent-selection-defaults";
import { queueSettingsSave } from "./settings.svelte";
import { workbenchState } from "./workbench/state.svelte";

export function currentActiveAgent(): AgentRecord | undefined {
  return workbenchState.agents.find((agent) => agent.id === selection.agentId);
}

export function selectedModel(): ModelSelection | undefined {
  return parseModelKey(workbenchState.selectedModelKey);
}

export function selectedModelInfo(): ModelInfo | undefined {
  return workbenchState.models.find(
    (model) => modelKey(model) === workbenchState.selectedModelKey,
  );
}

export { clampThinkingLevelForModel, supportedThinkingLevelsForModel };

export function supportedThinkingLevelsForSelectedModel(): AgentRecord["thinkingLevel"][] {
  return supportedThinkingLevelsForModel(selectedModelInfo());
}

type LastAgentSelectionPatch = Partial<Settings["lastAgentSelection"]>;

function rememberLastAgentSelection(patch: LastAgentSelectionPatch): void {
  const settings = workbenchState.settingsDraft;
  if (!settings?.rememberLastAgentSelection) return;
  settings.lastAgentSelection = {
    ...settings.lastAgentSelection,
    ...patch,
  };
  queueSettingsSave({ lastAgentSelection: patch }, { immediate: true });
}

export function selectedThinkingLevel(): AgentRecord["thinkingLevel"] {
  return clampThinkingLevelForModel(
    workbenchState.selectedThinkingLevel,
    selectedModelInfo(),
  );
}

export async function setComposerModel(key: string) {
  workbenchState.selectedModelKey = key;
  const thinkingLevel = clampThinkingLevelForModel(
    workbenchState.selectedThinkingLevel,
    selectedModelInfo(),
  );
  workbenchState.selectedThinkingLevel = thinkingLevel;
  const pending =
    workbenchState.activeCenterTab?.kind === "pending-conversation"
      ? workbenchState.pendingConversations[workbenchState.activeCenterTab.id]
      : undefined;
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
  workbenchState.selectedThinkingLevel = agent.thinkingLevel;
  workbenchState.agents = workbenchState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
  if (selection.conversationId) {
    const contextUsage = await getConversationContextUsage(
      selection.conversationId,
    ).catch(() => undefined);
    const view = workbenchState.conversationViews[selection.conversationId];
    if (contextUsage && view) view.contextUsage = contextUsage;
  }
}

export async function setComposerThinkingLevel(
  level: AgentRecord["thinkingLevel"],
) {
  const thinkingLevel = clampThinkingLevelForModel(level, selectedModelInfo());
  workbenchState.selectedThinkingLevel = thinkingLevel;
  const pending =
    workbenchState.activeCenterTab?.kind === "pending-conversation"
      ? workbenchState.pendingConversations[workbenchState.activeCenterTab.id]
      : undefined;
  if (pending) pending.thinkingLevel = thinkingLevel;
  rememberLastAgentSelection({ thinkingLevel });
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, { thinkingLevel });
  workbenchState.selectedThinkingLevel = agent.thinkingLevel;
  workbenchState.agents = workbenchState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
}

export async function setComposerMode(mode: AgentRecord["mode"]) {
  workbenchState.selectedMode = mode;
  const pending =
    workbenchState.activeCenterTab?.kind === "pending-conversation"
      ? workbenchState.pendingConversations[workbenchState.activeCenterTab.id]
      : undefined;
  if (pending) pending.mode = mode;
  rememberLastAgentSelection({ mode });
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, { mode });
  workbenchState.agents = workbenchState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
}

export async function setComposerPermission(
  permissionLevel: AgentRecord["permissionLevel"],
) {
  workbenchState.selectedPermissionLevel = permissionLevel;
  const pending =
    workbenchState.activeCenterTab?.kind === "pending-conversation"
      ? workbenchState.pendingConversations[workbenchState.activeCenterTab.id]
      : undefined;
  if (pending) pending.permissionLevel = permissionLevel;
  rememberLastAgentSelection({ permissionLevel });
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, { permissionLevel });
  workbenchState.agents = workbenchState.agents.map((candidate) =>
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
  const needsMode = agent?.mode !== workbenchState.selectedMode;
  const needsPermission =
    agent?.permissionLevel !== workbenchState.selectedPermissionLevel;
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
