import type { AgentRecord, ModelInfo, ModelSelection } from "../api";
import { getConversationContextUsage, updateAgentConfig } from "../api";
import { selection } from "../state/app-state.svelte";
import { modelKey, parseModelKey } from "../utils/model";
import { workbenchState } from "./workbench/state.svelte";

const THINKING_LEVEL_ORDER: AgentRecord["thinkingLevel"][] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

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

export function supportedThinkingLevelsForModel(
  model: ModelInfo | undefined,
): AgentRecord["thinkingLevel"][] {
  return model?.supportedThinkingLevels?.length
    ? model.supportedThinkingLevels
    : ["off"];
}

export function supportedThinkingLevelsForSelectedModel(): AgentRecord["thinkingLevel"][] {
  return supportedThinkingLevelsForModel(selectedModelInfo());
}

export function clampThinkingLevelForModel(
  level: AgentRecord["thinkingLevel"],
  model: ModelInfo | undefined,
): AgentRecord["thinkingLevel"] {
  const supported = supportedThinkingLevelsForModel(model);
  if (supported.includes(level)) return level;

  const requestedIndex = THINKING_LEVEL_ORDER.indexOf(level);
  if (requestedIndex === -1) return supported[0] ?? "off";

  for (
    let index = requestedIndex;
    index < THINKING_LEVEL_ORDER.length;
    index++
  ) {
    const candidate = THINKING_LEVEL_ORDER[index];
    if (supported.includes(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index--) {
    const candidate = THINKING_LEVEL_ORDER[index];
    if (supported.includes(candidate)) return candidate;
  }
  return supported[0] ?? "off";
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
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, {
    model: selectedModel() ?? null,
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
