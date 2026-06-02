import type { AgentRecord, ModelSelection } from "../api";
import { updateAgentConfig } from "../api";
import { selection } from "../state/app-state.svelte";
import { modelKey, parseModelKey } from "../utils/model";
import { workbenchState } from "./workbench/state.svelte";

export function currentActiveAgent(): AgentRecord | undefined {
  return workbenchState.agents.find((agent) => agent.id === selection.agentId);
}

export function selectedModel(): ModelSelection | undefined {
  return parseModelKey(workbenchState.selectedModelKey);
}

export async function setComposerModel(key: string) {
  workbenchState.selectedModelKey = key;
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, {
    model: selectedModel() ?? null,
  });
  workbenchState.agents = workbenchState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
}

export async function setComposerMode(mode: AgentRecord["mode"]) {
  workbenchState.selectedMode = mode;
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
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, { permissionLevel });
  workbenchState.agents = workbenchState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
}

export function agentNeedsComposerUpdate(agent: AgentRecord | undefined) {
  const desired = selectedModel();
  const needsModel =
    desired &&
    modelKey(agent?.model ?? { provider: "", modelId: "" }) !==
      modelKey(desired);
  const needsMode = agent?.mode !== workbenchState.selectedMode;
  const needsPermission =
    agent?.permissionLevel !== workbenchState.selectedPermissionLevel;
  return { desired, needsModel, needsMode, needsPermission };
}
