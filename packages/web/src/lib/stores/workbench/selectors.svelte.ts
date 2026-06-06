import type {
  AgentRecord,
  FilesystemFileResponse,
  ProcessRecord,
  ProjectRecord,
  SessionRecord,
} from "../../api";
import { selection } from "../../state/app-state.svelte";
import { modelKey, usableModelOptions } from "../../utils/model";
import { isPathInDirectory } from "../../utils/path";
import type { CenterTabIdentity, ConversationViewState } from "./state.svelte";
import { workbenchState } from "./state.svelte";

export type ConversationTabModel = {
  kind: "conversation";
  id: string;
  session: SessionRecord;
  project?: ProjectRecord;
  agent?: AgentRecord;
  active: boolean;
  hasDraft: boolean;
  sending: boolean;
  error?: string;
};

export type ProcessTabModel = {
  kind: "process";
  id: string;
  process?: ProcessRecord;
  active: boolean;
  sending: boolean;
  error?: string;
};

export type FileTabModel = {
  kind: "file";
  id: string;
  file?: FilesystemFileResponse;
  path?: string;
  relativePath?: string;
  active: boolean;
  sending: boolean;
  error?: string;
};

export type SettingsTabModel = {
  kind: "settings";
  id: "settings";
  active: boolean;
  sending: boolean;
  error?: string;
};

export type CenterTabModel =
  | ConversationTabModel
  | ProcessTabModel
  | FileTabModel
  | SettingsTabModel;

function activeView(): ConversationViewState | undefined {
  const sessionId =
    selection.sessionId ?? workbenchState.activeConversationTabId;
  if (!sessionId) return undefined;
  return workbenchState.conversationViews[sessionId];
}

function activeTabMatches(
  kind: CenterTabIdentity["kind"],
  id: string,
): boolean {
  return (
    workbenchState.activeCenterTab?.kind === kind &&
    workbenchState.activeCenterTab.id === id
  );
}

function isActiveProcessStatus(status: string): boolean {
  return ["starting", "running", "ready", "stopping"].includes(status);
}

function scopedProcesses(): ProcessRecord[] {
  const projectDir = workbenchSelectors.activeProject?.dir;
  if (!projectDir) return [];
  return workbenchState.processes.filter((process) =>
    isPathInDirectory(process.cwd, projectDir),
  );
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
  get planReviews() {
    return workbenchState.planReviews;
  },
  get activePlanReview() {
    const sessionId = selection.sessionId;
    const agentId = selection.agentId;
    return workbenchState.planReviews.find((review) => {
      if (sessionId && review.sessionId === sessionId) return true;
      return Boolean(agentId && review.agentId === agentId);
    });
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
  get scopedProcesses() {
    return scopedProcesses();
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
  get conversationLiveState() {
    return activeView()?.live;
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
  get selectedThinkingLevel() {
    return workbenchState.selectedThinkingLevel;
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
  get settingsSaveStatus() {
    return workbenchState.settingsSaveStatus;
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
        kind: "conversation",
        id: session.id,
        session,
        project,
        agent,
        active: activeTabMatches("conversation", session.id),
        hasDraft: Boolean(view?.composerText.trim()),
        sending: Boolean(view?.sending || agent?.status === "running"),
        error:
          view?.error ??
          (agent?.status === "error" ? "Agent error" : undefined),
      });
    }
    return tabs;
  },
  get openProcessTabs(): ProcessTabModel[] {
    const tabs: ProcessTabModel[] = [];
    for (const processId of workbenchState.openProcessTabIds) {
      const process = workbenchState.processes.find(
        (candidate) => candidate.id === processId,
      );
      tabs.push({
        kind: "process",
        id: processId,
        process,
        active: activeTabMatches("process", processId),
        sending: process ? isActiveProcessStatus(process.status) : false,
        error: process
          ? process.status === "error"
            ? (process.error ?? "Process error")
            : undefined
          : "Process not found",
      });
    }
    return tabs;
  },
  get openFileTabs(): FileTabModel[] {
    return workbenchState.openFileTabIds.map((id) => {
      const view = workbenchState.fileViews[id];
      return {
        kind: "file" as const,
        id,
        file: view?.content,
        path: view?.path,
        relativePath: view?.content?.relativePath,
        active: activeTabMatches("file", id),
        sending: Boolean(view?.loading),
        error: view?.error,
      };
    });
  },
  get openSettingsTabs(): SettingsTabModel[] {
    return workbenchState.settingsTabOpen
      ? [
          {
            kind: "settings" as const,
            id: "settings" as const,
            active: activeTabMatches("settings", "settings"),
            sending: false,
            error: workbenchState.settingsMessage,
          },
        ]
      : [];
  },
  get centerTabs(): CenterTabModel[] {
    const models: CenterTabModel[] = [];
    for (const tab of workbenchState.openCenterTabs) {
      if (tab.kind === "conversation") {
        const model = this.openConversationTabs.find(
          (candidate) => candidate.id === tab.id,
        );
        if (model) models.push(model);
      } else if (tab.kind === "process") {
        const model = this.openProcessTabs.find(
          (candidate) => candidate.id === tab.id,
        );
        if (model) models.push(model);
      } else if (tab.kind === "file") {
        const model = this.openFileTabs.find(
          (candidate) => candidate.id === tab.id,
        );
        if (model) models.push(model);
      } else {
        models.push(...this.openSettingsTabs);
      }
    }
    return models;
  },
  get activeCenterTab() {
    return workbenchState.activeCenterTab;
  },
  get activeCenterProcess() {
    const active = workbenchState.activeCenterTab;
    if (active?.kind !== "process") return undefined;
    return workbenchState.processes.find((process) => process.id === active.id);
  },
  get activeCenterFileView() {
    const active = workbenchState.activeCenterTab;
    if (active?.kind !== "file") return undefined;
    return workbenchState.fileViews[active.id];
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
  get pendingPlanReviewCount() {
    return workbenchState.planReviews.length;
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
  /** Model metadata for the active agent's selected model, if known. */
  get activeModelInfo() {
    const model = workbenchState.agents.find(
      (agent) => agent.id === selection.agentId,
    )?.model;
    if (!model) return undefined;
    return workbenchState.models.find(
      (candidate) =>
        candidate.provider === model.provider &&
        candidate.modelId === model.modelId,
    );
  },
  /** Compaction-aware context usage for the active conversation. */
  get activeContextUsage() {
    return activeView()?.contextUsage;
  },
  /** The active/selected model's context window (0 when unknown). */
  get activeContextWindow(): number {
    const selectedModelInfo = workbenchState.models.find(
      (model) => modelKey(model) === workbenchState.selectedModelKey,
    );
    if (selectedModelInfo?.contextWindow) return selectedModelInfo.contextWindow;
    if (this.activeModelInfo?.contextWindow) return this.activeModelInfo.contextWindow;
    return activeView()?.contextUsage?.contextWindow ?? 0;
  },
  /** Cumulative token + cost totals across the active conversation branch. */
  get activeSessionUsage(): {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  } {
    const totals = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    };
    for (const item of activeView()?.transcript ?? []) {
      if (!item.usage) continue;
      totals.input += item.usage.input;
      totals.output += item.usage.output;
      totals.cacheRead += item.usage.cacheRead;
      totals.cacheWrite += item.usage.cacheWrite;
      totals.cost += item.usage.cost;
    }
    return totals;
  },
  /** Subscription usage for the active agent's provider, if available. */
  get activeSubscriptionUsage() {
    const provider = workbenchState.agents.find(
      (agent) => agent.id === selection.agentId,
    )?.model?.provider;
    if (!provider) return undefined;
    return workbenchState.subscriptionUsage[provider];
  },
};
