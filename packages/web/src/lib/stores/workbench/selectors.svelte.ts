import type { AgentRecord, ProjectRecord, SessionRecord } from "../../api";
import { selection } from "../../state/app-state.svelte";
import { usableModelOptions } from "../../utils/model";
import type { ConversationViewState } from "./state.svelte";
import { workbenchState } from "./state.svelte";

export type ConversationTabModel = {
  session: SessionRecord;
  project?: ProjectRecord;
  agent?: AgentRecord;
  active: boolean;
  hasDraft: boolean;
  sending: boolean;
  error?: string;
};

function activeView(): ConversationViewState | undefined {
  const sessionId =
    selection.sessionId ?? workbenchState.activeConversationTabId;
  if (!sessionId) return undefined;
  return workbenchState.conversationViews[sessionId];
}

export const workbenchSelectors = {
  get status() {
    return workbenchState.status;
  },
  get connection() {
    return workbenchState.connection;
  },
  get error() {
    return activeView()?.error ?? workbenchState.error;
  },
  get sending() {
    return activeView()?.sending ?? false;
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
  get userQuestions() {
    return workbenchState.userQuestions;
  },
  get activeUserQuestion() {
    const sessionId = selection.sessionId;
    const agentId = selection.agentId;
    return workbenchState.userQuestions.find((question) => {
      if (sessionId && question.sessionId === sessionId) return true;
      return Boolean(agentId && question.agentId === agentId);
    });
  },
  get processes() {
    return workbenchState.processes;
  },
  get treeNodes() {
    return activeView()?.treeNodes ?? [];
  },
  get processLogs() {
    return workbenchState.processLogs;
  },
  get transcript() {
    return activeView()?.transcript ?? [];
  },
  get toolCalls() {
    return activeView()?.toolCalls ?? [];
  },
  get streamingText() {
    return activeView()?.streamingText ?? "";
  },
  get activeComposerText() {
    return activeView()?.composerText ?? "";
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
  get activeConversationView() {
    return activeView();
  },
  get openConversationTabs(): ConversationTabModel[] {
    const tabs: ConversationTabModel[] = [];
    for (const sessionId of workbenchState.openConversationTabIds) {
      const session = workbenchState.sessions.find(
        (candidate) => candidate.id === sessionId,
      );
      if (!session) continue;
      const project = workbenchState.projects.find(
        (candidate) => candidate.id === session.projectId,
      );
      const agent = workbenchState.agents.find(
        (candidate) =>
          candidate.id === session.activeAgentId ||
          candidate.sessionId === session.id,
      );
      const view = workbenchState.conversationViews[session.id];
      tabs.push({
        session,
        project,
        agent,
        active: session.id === selection.sessionId,
        hasDraft: Boolean(view?.composerText.trim()),
        sending: Boolean(view?.sending || agent?.status === "running"),
        error:
          view?.error ??
          (agent?.status === "error" ? "Agent error" : undefined),
      });
    }
    return tabs;
  },
  get live() {
    return workbenchState.connection === "live";
  },
  get branchDepth() {
    return (activeView()?.treeNodes ?? workbenchState.treeNodes).length;
  },
  /**
   * Reserved seam for git status. The orchestrator does not expose git data yet,
   * so this returns undefined and the footer slot stays hidden. Wire this to real
   * branch/dirty state once the daemon provides it.
   */
  get gitStatus(): { branch: string; dirty: boolean } | undefined {
    return undefined;
  },
  get pendingApprovalCount() {
    return workbenchState.approvals.length;
  },
  get pendingUserQuestionCount() {
    return workbenchState.userQuestions.length;
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
