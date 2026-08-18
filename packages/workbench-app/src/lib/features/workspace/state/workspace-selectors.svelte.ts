import { SvelteSet } from "svelte/reactivity";
import type { AgentRecord } from "$lib/api";
import { projectKey } from "$lib/core/utils/project-tree";
import { buildProjectSwitcherItems } from "$lib/features/projects/state/project-switcher";
import { agentRunningTone } from "@nervekit/ui-kit/core/utils/status";
import {
  conversationViewKey,
  diffViewKey,
  fileViewKey,
  mermaidViewKey,
  pendingConversationKey,
  prViewKey,
} from "$lib/core/state/state-keys";
import {
  defaultFileDisplayMode,
  fileRenderKind,
} from "@nervekit/ui-kit/core/utils/file-display";
import {
  buildConversationActivityById,
  idleConversationActivity,
} from "$lib/features/conversations/state/conversation-activity";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { fileState } from "$lib/features/filesystem/state/file-state.svelte";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { logsState } from "$lib/features/logs/state/log-state.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import {
  pendingApprovals,
  pendingPlanReviews,
  pendingUserQuestions,
} from "$lib/features/tools/state/tool-interaction-projections";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import {
  type CenterTabIdentity,
  workspaceState,
} from "./workspace-state.svelte";

export type {
  CenterTabModel,
  ConversationTabModel,
  DiffTabModel,
  FileTabModel,
  LogsTabModel,
  MermaidTabModel,
  PendingConversationTabModel,
  PrTabModel,
  SettingsTabModel,
  TaskTabModel,
} from "./center-tab-models";

import type {
  CenterTabModel,
  ConversationTabModel,
  DiffTabModel,
  FileTabModel,
  LogsTabModel,
  MermaidTabModel,
  PendingConversationTabModel,
  PrTabModel,
  SettingsTabModel,
  TaskTabModel,
} from "./center-tab-models";

function activeTabMatches(
  kind: CenterTabIdentity["kind"],
  id: string,
): boolean {
  return (
    workspaceState.activeCenterTab?.kind === kind &&
    workspaceState.activeCenterTab.id === id
  );
}

function activePendingConversation() {
  const active = workspaceState.activeCenterTab;
  if (active?.kind !== "pending-conversation") return undefined;
  return conversationState.pendingConversations[
    pendingConversationKey(active.id)
  ];
}

function isActiveTaskStatus(status: string): boolean {
  return ["starting", "running", "ready", "stopping"].includes(status);
}

const conversationActivityById = $derived.by(() =>
  buildConversationActivityById({
    conversations: workspaceState.conversations,
    agents: workspaceState.agents,
    views: conversationState.conversationViews,
    approvals: pendingApprovals(workspaceState.pendingToolCalls),
    userQuestions: pendingUserQuestions(workspaceState.pendingToolCalls),
    planReviews: pendingPlanReviews(workspaceState.pendingToolCalls),
  }),
);

function centerTabKey(tab: CenterTabIdentity): string {
  return `${tab.kind}\0${tab.id}`;
}

export const workspaceSelectors = {
  get status() {
    return workspaceState.status;
  },
  get connection() {
    return workspaceState.connection;
  },
  get error() {
    const conversationId =
      selection.conversationId ?? conversationState.activeConversationTabId;
    const activeView = conversationId
      ? conversationState.conversationViews[conversationViewKey(conversationId)]
      : undefined;
    return (
      activePendingConversation()?.error ??
      activeView?.error ??
      workspaceState.error
    );
  },
  get projects() {
    return workspaceState.projects;
  },
  get conversations() {
    return workspaceState.conversations;
  },
  get agents() {
    return workspaceState.agents;
  },
  get approvals() {
    return pendingApprovals(workspaceState.pendingToolCalls);
  },
  get userQuestions() {
    return pendingUserQuestions(workspaceState.pendingToolCalls);
  },
  get planReviews() {
    return pendingPlanReviews(workspaceState.pendingToolCalls);
  },
  get activeProject() {
    return (
      workspaceState.projects.find(
        (project) => project.id === workspaceState.selectedProjectId,
      ) ??
      workspaceState.projects.find(
        (project) => projectKey(project) === workspaceState.selectedProjectKey,
      )
    );
  },
  get selectedProjectIds() {
    const key = workspaceState.selectedProjectKey;
    return workspaceState.projects
      .filter((project) => key && projectKey(project) === key)
      .map((project) => project.id);
  },
  get selectedProjectConversations() {
    const ids = new SvelteSet(this.selectedProjectIds);
    return workspaceState.conversations.filter((conversation) =>
      ids.has(conversation.projectId),
    );
  },
  get projectSwitcherItems() {
    return buildProjectSwitcherItems({
      projects: workspaceState.projects,
      conversations: workspaceState.conversations,
      tasks: taskState.tasks,
      activityById: this.conversationActivityById,
      homeDir: workspaceState.status?.storage.userHome,
      recency: workspaceState.projectRecency,
    });
  },
  get activeConversation() {
    return workspaceState.conversations.find(
      (conversation) => conversation.id === selection.conversationId,
    );
  },
  get activeAgent() {
    return workspaceState.agents.find(
      (agent) => agent.id === selection.agentId,
    );
  },
  get conversationActivityById() {
    return conversationActivityById;
  },
  get openConversationTabs(): ConversationTabModel[] {
    const tabs: ConversationTabModel[] = [];
    const conversationsById = Object.fromEntries(
      workspaceState.conversations.map((conversation) => [
        conversation.id,
        conversation,
      ]),
    );
    const projectsById = Object.fromEntries(
      workspaceState.projects.map((project) => [project.id, project]),
    );
    const agentsById = Object.fromEntries(
      workspaceState.agents.map((agent) => [agent.id, agent]),
    );
    const agentsByConversationId: Record<string, AgentRecord> =
      Object.create(null);
    for (const agent of workspaceState.agents) {
      if (
        agent.conversationId &&
        !agentsByConversationId[agent.conversationId]
      ) {
        agentsByConversationId[agent.conversationId] = agent;
      }
    }
    const activityById = conversationActivityById;

    for (const conversationId of conversationState.openConversationTabIds) {
      const conversation = conversationsById[conversationId];
      if (!conversation) continue;
      const project = projectsById[conversation.projectId];
      const agent =
        (conversation.activeAgentId
          ? agentsById[conversation.activeAgentId]
          : undefined) ?? agentsByConversationId[conversation.id];
      const view =
        conversationState.conversationViews[
          conversationViewKey(conversation.id)
        ];
      const activity =
        activityById[conversation.id] ?? idleConversationActivity;
      tabs.push({
        kind: "conversation",
        id: conversation.id,
        conversation,
        project,
        agent,
        active: activeTabMatches("conversation", conversation.id),
        hasDraft: Boolean(view?.composerText.trim()),
        sending: activity.busy,
        activity,
        error:
          view?.error ??
          (agent?.status === "error" ? "Agent error" : undefined),
      });
    }
    return tabs;
  },
  get openPendingConversationTabs(): PendingConversationTabModel[] {
    const tabs: PendingConversationTabModel[] = [];
    for (const tab of workspaceState.openCenterTabs) {
      if (tab.kind !== "pending-conversation") continue;
      const pending =
        conversationState.pendingConversations[pendingConversationKey(tab.id)];
      if (!pending) continue;
      tabs.push({
        kind: "pending-conversation",
        id: pending.id,
        title: pending.title,
        project: workspaceState.projects.find(
          (candidate) => candidate.id === pending.projectId,
        ),
        projectDir: pending.projectDir,
        active: activeTabMatches("pending-conversation", pending.id),
        hasDraft: Boolean(pending.composerText.trim()),
        sending: pending.sending,
        activity: pending.sending
          ? {
              tone: agentRunningTone(pending.mode),
              pulse: true,
              label: "Agent running",
              busy: true,
              needsUser: false,
              source: "live-view",
            }
          : idleConversationActivity,
        error: pending.error,
      });
    }
    return tabs;
  },
  get openTaskTabs(): TaskTabModel[] {
    const tabs: TaskTabModel[] = [];
    for (const taskId of taskState.openTaskTabIds) {
      const selectedRunId = taskState.selectedRunByEntry[taskId];
      const candidates = taskState.tasks
        .filter(
          (candidate) =>
            (candidate.definitionId ??
              candidate.restartRootTaskId ??
              candidate.id) === taskId,
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const task =
        candidates.find((candidate) => candidate.id === selectedRunId) ??
        candidates[0];
      tabs.push({
        kind: "task",
        id: taskId,
        task,
        active: activeTabMatches("task", taskId),
        sending: task ? isActiveTaskStatus(task.status) : false,
        error: task
          ? task.status === "failed"
            ? (task.error ?? "Task failed")
            : undefined
          : "Task not found",
      });
    }
    return tabs;
  },
  get openFileTabs(): FileTabModel[] {
    return fileState.openFileTabIds.map((id) => {
      const view = fileState.fileViews[fileViewKey(id)];
      const displayPath = view?.content?.relativePath ?? view?.path;
      return {
        kind: "file" as const,
        id,
        file: view?.content,
        path: view?.path,
        relativePath: view?.content?.relativePath,
        displayMode: view?.displayMode ?? defaultFileDisplayMode(displayPath),
        wrapLines: Boolean(view?.wrapLines),
        renderKind: fileRenderKind(displayPath),
        active: activeTabMatches("file", id),
        sending: Boolean(view?.loading),
        error: view?.error,
      };
    });
  },
  get openMermaidTabs(): MermaidTabModel[] {
    return workspaceState.openCenterTabs.flatMap((tab) => {
      if (tab.kind !== "mermaid") return [];
      const view = fileState.mermaidViews[mermaidViewKey(tab.id)];
      if (!view) return [];
      return [
        {
          kind: "mermaid" as const,
          id: tab.id,
          path: view.path,
          relativePath: view.relativePath,
          name: view.name,
          locator: view.locator,
          active: activeTabMatches("mermaid", tab.id),
          sending: view.loading,
          error: view.error,
        },
      ];
    });
  },
  get openDiffTabs(): DiffTabModel[] {
    return gitState.openDiffTabIds.map((id) => {
      const view = gitState.diffViews[diffViewKey(id)];
      return {
        kind: "diff" as const,
        id,
        path: view?.path,
        repo: view?.repo,
        area: view?.area,
        active: activeTabMatches("diff", id),
        sending: Boolean(view?.loading || view?.refreshing),
        error: view?.error,
      };
    });
  },
  get openPrTabs(): PrTabModel[] {
    return gitState.openPrTabIds.map((id) => {
      const view = gitState.prViews[prViewKey(id)];
      return {
        kind: "pr" as const,
        id,
        number: view?.number ?? 0,
        title: view?.core.data?.title,
        checksStatus: view?.checks.data?.checks.status,
        isDraft: view?.core.data?.isDraft,
        active: activeTabMatches("pr", id),
        sending: Boolean(view?.core.loading || view?.core.refreshing),
        error: view?.core.error,
      };
    });
  },
  get openSettingsTabs(): SettingsTabModel[] {
    return settingsState.settingsTabOpen
      ? [
          {
            kind: "settings" as const,
            id: "settings" as const,
            active: activeTabMatches("settings", "settings"),
            sending: settingsState.settingsSaveStatus === "saving",
            error:
              settingsState.settingsSaveStatus === "error"
                ? settingsState.settingsMessage
                : undefined,
          },
        ]
      : [];
  },
  get openLogsTabs(): LogsTabModel[] {
    return logsState.logsTabOpen
      ? [
          {
            kind: "logs" as const,
            id: "logs" as const,
            active: activeTabMatches("logs", "logs"),
            sending: false,
          },
        ]
      : [];
  },
  get openConversationTabIds(): Set<string> {
    const ids = new SvelteSet<string>();
    for (const tab of workspaceState.openCenterTabs) {
      if (tab.kind === "conversation") ids.add(tab.id);
    }
    return ids;
  },
  get centerTabs(): CenterTabModel[] {
    const modelByKey: Record<string, CenterTabModel> = Object.create(null);
    const collections: CenterTabModel[][] = [
      this.openConversationTabs,
      this.openPendingConversationTabs,
      this.openTaskTabs,
      this.openFileTabs,
      this.openMermaidTabs,
      this.openPrTabs,
      this.openDiffTabs,
      this.openSettingsTabs,
      this.openLogsTabs,
    ];
    for (const collection of collections) {
      for (const model of collection) {
        modelByKey[centerTabKey(model)] = model;
      }
    }

    return workspaceState.openCenterTabs.flatMap((tab) => {
      const model = modelByKey[centerTabKey(tab)];
      return model ? [model] : [];
    });
  },
  get activeCenterTab() {
    return workspaceState.activeCenterTab;
  },
};
