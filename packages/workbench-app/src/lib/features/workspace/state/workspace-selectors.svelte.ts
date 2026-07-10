import { SvelteSet } from "svelte/reactivity";
import { agentRunningTone } from "@nervekit/workbench-ui/core/utils/status";
import {
  conversationViewKey,
  fileViewKey,
  pendingConversationKey,
  prViewKey,
} from "$lib/core/state/state-keys";
import {
  defaultFileDisplayMode,
  isMarkdownPath,
} from "$lib/core/utils/file-display";
import { authState } from "$lib/features/auth/state/auth-state.svelte";
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
import { selection } from "$lib/features/workspace/state/selection.svelte";
import {
  type CenterTabIdentity,
  workspaceState,
} from "./workspace-state.svelte";

export type {
  AuthTabModel,
  CenterTabModel,
  ConversationTabModel,
  FileTabModel,
  LogsTabModel,
  PendingConversationTabModel,
  PrTabModel,
  SettingsTabModel,
  TaskTabModel,
} from "./center-tab-models";

import type {
  AuthTabModel,
  CenterTabModel,
  ConversationTabModel,
  FileTabModel,
  LogsTabModel,
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
    return workspaceState.approvals;
  },
  get userQuestions() {
    return workspaceState.userQuestions;
  },
  get planReviews() {
    return workspaceState.planReviews;
  },
  get activeProject() {
    const pending = activePendingConversation();
    const projectId = pending?.projectId ?? selection.projectId;
    return workspaceState.projects.find((project) => project.id === projectId);
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
    return buildConversationActivityById({
      conversations: workspaceState.conversations,
      agents: workspaceState.agents,
      views: conversationState.conversationViews,
      approvals: workspaceState.approvals,
      userQuestions: workspaceState.userQuestions,
      planReviews: workspaceState.planReviews,
    });
  },
  get openConversationTabs(): ConversationTabModel[] {
    const tabs: ConversationTabModel[] = [];
    for (const conversationId of conversationState.openConversationTabIds) {
      const conversation = workspaceState.conversations.find(
        (candidate) => candidate.id === conversationId,
      );
      if (!conversation) continue;
      const project = workspaceState.projects.find(
        (candidate) => candidate.id === conversation.projectId,
      );
      const agent = workspaceState.agents.find(
        (candidate) =>
          candidate.id === conversation.activeAgentId ||
          candidate.conversationId === conversation.id,
      );
      const view =
        conversationState.conversationViews[
          conversationViewKey(conversation.id)
        ];
      const activity =
        this.conversationActivityById[conversation.id] ??
        idleConversationActivity;
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
      const task = taskState.tasks.find((candidate) => candidate.id === taskId);
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
        markdown: isMarkdownPath(displayPath),
        active: activeTabMatches("file", id),
        sending: Boolean(view?.loading),
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
        title: view?.detail?.title,
        checksStatus: view?.detail?.checks.status,
        isDraft: view?.detail?.isDraft,
        active: activeTabMatches("pr", id),
        sending: Boolean(view?.loading),
        error: view?.error,
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
            sending: false,
            error: settingsState.settingsMessage,
          },
        ]
      : [];
  },
  get openAuthTabs(): AuthTabModel[] {
    return authState.authTabOpen
      ? [
          {
            kind: "auth" as const,
            id: "auth" as const,
            active: activeTabMatches("auth", "auth"),
            sending: false,
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
    const models: CenterTabModel[] = [];
    for (const tab of workspaceState.openCenterTabs) {
      if (tab.kind === "conversation") {
        const model = this.openConversationTabs.find(
          (candidate) => candidate.id === tab.id,
        );
        if (model) models.push(model);
      } else if (tab.kind === "pending-conversation") {
        const model = this.openPendingConversationTabs.find(
          (candidate) => candidate.id === tab.id,
        );
        if (model) models.push(model);
      } else if (tab.kind === "task") {
        const model = this.openTaskTabs.find(
          (candidate) => candidate.id === tab.id,
        );
        if (model) models.push(model);
      } else if (tab.kind === "file") {
        const model = this.openFileTabs.find(
          (candidate) => candidate.id === tab.id,
        );
        if (model) models.push(model);
      } else if (tab.kind === "pr") {
        const model = this.openPrTabs.find(
          (candidate) => candidate.id === tab.id,
        );
        if (model) models.push(model);
      } else if (tab.kind === "settings") {
        models.push(...this.openSettingsTabs);
      } else if (tab.kind === "auth") {
        models.push(...this.openAuthTabs);
      } else {
        models.push(...this.openLogsTabs);
      }
    }
    return models;
  },
  get activeCenterTab() {
    return workspaceState.activeCenterTab;
  },
};
