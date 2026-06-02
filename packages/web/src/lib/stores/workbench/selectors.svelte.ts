import { selection } from "../../state/app-state.svelte";
import { usableModelOptions } from "../../utils/model";
import { workbenchState } from "./state.svelte";

export const workbenchSelectors = {
  get status() {
    return workbenchState.status;
  },
  get connection() {
    return workbenchState.connection;
  },
  get error() {
    return workbenchState.error;
  },
  get sending() {
    return workbenchState.sending;
  },
  get projects() {
    return workbenchState.projects;
  },
  get sessions() {
    return workbenchState.sessions;
  },
  get agents() {
    return workbenchState.agents;
  },
  get approvals() {
    return workbenchState.approvals;
  },
  get processes() {
    return workbenchState.processes;
  },
  get treeNodes() {
    return workbenchState.treeNodes;
  },
  get processLogs() {
    return workbenchState.processLogs;
  },
  get transcript() {
    return workbenchState.transcript;
  },
  get streamingText() {
    return workbenchState.streamingText;
  },
  get slashCompletions() {
    return workbenchState.slashCompletions;
  },
  get selectedModelKey() {
    return workbenchState.selectedModelKey;
  },
  get selectedMode() {
    return workbenchState.selectedMode;
  },
  get selectedPermissionLevel() {
    return workbenchState.selectedPermissionLevel;
  },
  get settingsDraft() {
    return workbenchState.settingsDraft;
  },
  get authProviders() {
    return workbenchState.authProviders;
  },
  get settingsMessage() {
    return workbenchState.settingsMessage;
  },
  get activeProject() {
    return workbenchState.projects.find(
      (project) => project.id === selection.projectId,
    );
  },
  get activeSession() {
    return workbenchState.sessions.find(
      (session) => session.id === selection.sessionId,
    );
  },
  get activeAgent() {
    return workbenchState.agents.find(
      (agent) => agent.id === selection.agentId,
    );
  },
  get live() {
    return workbenchState.connection === "live";
  },
  get branchDepth() {
    return workbenchState.treeNodes.length;
  },
  get pendingApprovalCount() {
    return workbenchState.approvals.length;
  },
  get selectedProcess() {
    return workbenchState.processes.find(
      (process) => process.id === workbenchState.selectedProcessId,
    );
  },
  get sessionAgents() {
    return workbenchState.agents.filter(
      (agent) => agent.sessionId === selection.sessionId,
    );
  },
  get usableModels() {
    return usableModelOptions(
      workbenchState.models,
      workbenchState.authProviders,
    );
  },
};
