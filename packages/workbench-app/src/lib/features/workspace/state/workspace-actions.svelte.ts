import { SvelteSet } from "svelte/reactivity";
import { projectKey } from "$lib/core/utils/project-tree";
import { modelKey } from "$lib/presentation/utils/model";
import {
  type AgentRecord,
  apiPathSegment,
  type CompletionItem,
  type ConversationRecord,
  createProject,
  deleteConversation,
  deleteProject,
  getFileCompletions,
  getSlashCompletions,
  getWorkspaceSnapshot,
  openProjectInEditor,
  type ProjectEditor,
  type ProjectRecord,
  type PruneProjectConversationsRequest,
  pruneProjectConversations,
} from "$lib/api";
import { queryClient, queryKeys } from "$lib/core/query";
import { recoverSnapshotFromNetwork } from "$lib/core/events/snapshot-recovery";
import { agentConfigOverride } from "$lib/features/conversations/state/agent-config-mutations.svelte";
import {
  openPendingConversation,
  removeConversationTabs,
} from "$lib/features/conversations/state/conversation-flow.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import { loadTaskLogWindow } from "$lib/features/tasks/state/task-logs.svelte";
import { resolveSelectedTaskId } from "$lib/features/tasks/state/task-reducers";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import {
  workspaceState,
  type CenterTabIdentity,
} from "$lib/features/workspace/state/workspace-state.svelte";
import { mergeAgentsByUpdatedAt } from "./agent-freshness";
import { projectForNewConversation } from "./new-conversation-project";
import { closeCenterTabs } from "./center-tab-actions.svelte";
import { selectCenterTab, setActiveCenterTab } from "./center-tabs.svelte";
import {
  applyVisibleSession,
  hydrateWorkspaceTabSessions,
  persistWorkspaceTabSessions,
  removeTabsFromAllSessions,
  saveVisibleProjectSession,
} from "./workspace-tab-sessions";
export async function loadWorkspaceState() {
  const snapshot = await queryClient.fetchQuery({
    queryKey: queryKeys.workspace,
    queryFn: getWorkspaceSnapshot,
  });
  return applyWorkspaceSnapshot(snapshot);
}

export async function recoverWorkspaceSnapshotFromNetwork(
  options: { deferTabActivation?: boolean } = {},
) {
  let desiredTab: CenterTabIdentity | undefined;
  const cursor = await recoverSnapshotFromNetwork({
    fetch: getWorkspaceSnapshot,
    apply: async (snapshot) => {
      const applied = await applyWorkspaceSnapshot(snapshot, options);
      desiredTab = applied.desiredTab;
      return applied.cursor;
    },
    cache: (snapshot) =>
      queryClient.setQueryData(queryKeys.workspace, snapshot),
  });
  return { cursor, desiredTab };
}

async function applyWorkspaceSnapshot(
  snapshot: Awaited<ReturnType<typeof getWorkspaceSnapshot>>,
  options: { deferTabActivation?: boolean } = {},
) {
  const agents = mergeAgentsByUpdatedAt(
    snapshot.snapshot.agents,
    workspaceState.agents,
  );
  workspaceState.projects = snapshot.snapshot.projects;
  workspaceState.conversations = snapshot.snapshot.conversations;
  workspaceState.agents = agents;
  taskState.tasks = snapshot.snapshot.tasks;
  let desiredTab = hydrateWorkspaceTabSessions(
    {
      projects: snapshot.snapshot.projects,
      conversations: snapshot.snapshot.conversations,
      tasks: snapshot.snapshot.tasks,
    },
    { deferActivation: options.deferTabActivation },
  );
  const taskEntryIds = new SvelteSet(
    taskState.tasks.map(
      (task) => task.definitionId ?? task.restartRootTaskId ?? task.id,
    ),
  );
  const staleOpenTaskIds = taskState.openTaskTabIds.filter(
    (taskId) => !taskEntryIds.has(taskId),
  );
  if (staleOpenTaskIds.length) {
    await closeCenterTabs(
      staleOpenTaskIds.map((id) => ({ kind: "task" as const, id })),
    );
  }
  const selectedTaskId = resolveSelectedTaskId(
    taskState.tasks,
    taskState.selectedTaskId,
  );
  if (selectedTaskId !== taskState.selectedTaskId) {
    taskState.selectedTaskId = selectedTaskId;
    taskState.taskLogs = undefined;
  }
  workspaceState.approvals = snapshot.snapshot.approvals;
  workspaceState.userQuestions = snapshot.snapshot.userQuestions;
  workspaceState.planReviews = snapshot.snapshot.planReviews;
  syncSelectedAgentConfig(agents, snapshot.snapshot.conversations);
  const conversationIds = new SvelteSet(
    snapshot.snapshot.conversations.map((conversation) => conversation.id),
  );
  const staleOpenTabIds = conversationState.openConversationTabIds.filter(
    (conversationId) => !conversationIds.has(conversationId),
  );
  if (staleOpenTabIds.length) await removeConversationTabs(staleOpenTabIds);
  if (selectedTaskId && !options.deferTabActivation)
    await loadTaskLogWindow(selectedTaskId);
  const selectedStillExists = workspaceState.projects.some(
    (project) => projectKey(project) === workspaceState.selectedProjectKey,
  );
  if (!selectedStillExists) {
    const fallback = [...workspaceState.projects].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
    if (fallback)
      desiredTab =
        (await selectProject(fallback.id, {
          deferTabActivation: options.deferTabActivation,
        })) ?? desiredTab;
  } else if (
    workspaceState.selectedProjectKey &&
    !workspaceState.selectedProjectId
  ) {
    const selected = workspaceState.projects.find(
      (project) => projectKey(project) === workspaceState.selectedProjectKey,
    );
    if (selected)
      desiredTab =
        (await selectProject(selected.id, {
          deferTabActivation: options.deferTabActivation,
        })) ?? desiredTab;
  }
  return { cursor: snapshot.cursor, desiredTab };
}

function syncSelectedAgentConfig(
  agents: AgentRecord[],
  conversations: ConversationRecord[],
): void {
  const activeAgent = selection.agentId
    ? agents.find((agent) => agent.id === selection.agentId)
    : undefined;
  if (activeAgent) {
    // A pending desired override outranks the snapshot for its agent so a
    // delayed snapshot cannot undo an optimistic composer selection.
    const override = agentConfigOverride(activeAgent.id);
    const overrideModel = override?.model ?? undefined;
    if (overrideModel) {
      conversationState.selectedModelKey = modelKey(overrideModel);
    } else if (activeAgent.model) {
      conversationState.selectedModelKey = modelKey(activeAgent.model);
    }
    conversationState.selectedThinkingLevel =
      override?.thinkingLevel ?? activeAgent.thinkingLevel;
    conversationState.selectedMode = override?.mode ?? activeAgent.mode;
    conversationState.selectedPermissionLevel =
      override?.permissionLevel ?? activeAgent.permissionLevel;
    conversationState.selectedApprovalPolicy =
      override?.approvalPolicy ?? activeAgent.approvalPolicy;
    return;
  }

  const activeConversation = selection.conversationId
    ? conversations.find(
        (conversation) => conversation.id === selection.conversationId,
      )
    : undefined;
  if (!activeConversation) return;
  conversationState.selectedMode = activeConversation.mode;
  conversationState.selectedPermissionLevel =
    activeConversation.permissionLevel;
  conversationState.selectedApprovalPolicy = activeConversation.approvalPolicy;
}

export async function loadSlashCommands() {
  conversationState.slashCompletions = await queryClient.fetchQuery({
    queryKey: queryKeys.slashCompletions,
    queryFn: getSlashCompletions,
  });
}

export function exportUrl(kind: "json" | "md" | "html"): string | undefined {
  if (!selection.conversationId) return undefined;
  const suffix = kind === "json" ? "export" : `export.${kind}`;
  return `/api/conversations/${apiPathSegment(selection.conversationId)}/${suffix}`;
}

export function systemPromptUrl(): string | undefined {
  if (!selection.agentId) return undefined;
  return `/api/agents/${apiPathSegment(selection.agentId)}/system-prompt`;
}

export async function completeFiles(query: string): Promise<CompletionItem[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.fileCompletions(selection.projectId, query),
    queryFn: () => getFileCompletions(selection.projectId, query),
    staleTime: 2_000,
  });
}

export async function selectProject(
  projectId: string,
  options: { deferTabActivation?: boolean } = {},
): Promise<CenterTabIdentity | undefined> {
  const project = workspaceState.projects.find(
    (candidate) => candidate.id === projectId,
  );
  if (!project) return;
  const key = projectKey(project);
  if (
    workspaceState.selectedProjectKey === key &&
    workspaceState.selectedProjectId
  ) {
    workspaceState.selectedProjectId = project.id;
    selection.projectId = project.id;
    workspaceState.projectRecency[key] = Date.now();
    persistWorkspaceTabSessions();
    return;
  }
  // During startup the persisted key is hydrated before a concrete project ID.
  // There is no outgoing visible session to save in that state.
  if (workspaceState.selectedProjectId) saveVisibleProjectSession();
  workspaceState.selectedProjectId = project.id;
  workspaceState.selectedProjectKey = key;
  workspaceState.projectRecency[key] = Date.now();
  const session = applyVisibleSession(key, {
    deferActivation: options.deferTabActivation,
  });
  selection.projectId = project.id;
  selection.conversationId = undefined;
  selection.agentId = undefined;
  selection.entryId = undefined;
  persistWorkspaceTabSessions();
  if (options.deferTabActivation) return session.active;
  if (session.active) await selectCenterTab(session.active);
  else setActiveCenterTab(undefined);
  return session.active;
}

export async function openProjectDirectory(dir: string) {
  try {
    const project = await createProject(dir);
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    const current =
      workspaceState.projects.find(
        (candidate) => projectKey(candidate) === projectKey(project),
      ) ?? project;
    if (
      !workspaceState.projects.some((candidate) => candidate.id === current.id)
    ) {
      workspaceState.projects = [...workspaceState.projects, current];
    }
    await selectProject(current.id);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not open project", { description: message });
  }
}

export function newConversation() {
  const activeProject = workspaceState.projects.find(
    (project) => project.id === workspaceState.selectedProjectId,
  );
  if (!activeProject) {
    workspaceState.projectPickerOpen = true;
    return;
  }
  void openPendingConversationForProject(activeProject);
}

export function newConversationInProject(
  projectDir: string,
  initialMode?: AgentRecord["mode"],
) {
  const project = projectForNewConversation(
    workspaceState.projects,
    projectDir,
  );
  if (project) {
    void openPendingConversationForProject(project, initialMode);
    return;
  }
  void createConversationForDirectory(projectDir, initialMode);
}

export async function deleteProjectAndRefresh(projectId: string) {
  try {
    const deletingProject = workspaceState.projects.find(
      (project) => project.id === projectId,
    );
    const deletingKey = deletingProject
      ? projectKey(deletingProject)
      : undefined;
    const aliasedIds = new SvelteSet(
      workspaceState.projects
        .filter((project) => deletingKey && projectKey(project) === deletingKey)
        .map((project) => project.id),
    );
    const conversationIds = workspaceState.conversations
      .filter((conversation) => aliasedIds.has(conversation.projectId))
      .map((conversation) => conversation.id);
    await deleteProject(projectId);
    if (deletingKey) delete workspaceState.projectTabSessions[deletingKey];
    await removeConversationTabs(conversationIds);
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    notify.success("Project removed");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not remove project", { description: message });
  }
}

export async function deleteConversationAndRefresh(conversationId: string) {
  try {
    await deleteConversation(conversationId);
    removeTabsFromAllSessions(
      (tab) => tab.kind === "conversation" && tab.id === conversationId,
    );
    await removeConversationTabs([conversationId]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    notify.success("Conversation removed");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not remove conversation", { description: message });
  }
}

export async function openProjectInEditorAndNotify(
  projectId: string,
  editor: ProjectEditor,
) {
  try {
    await openProjectInEditor(projectId, editor);
    notify.success(
      editor === "vscode"
        ? "Opening project in VS Code"
        : "Opening project in Zed",
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error(
      editor === "vscode" ? "Could not open VS Code" : "Could not open Zed",
      { description: message },
    );
  }
}

export async function pruneProjectConversationsAndRefresh(
  projectId: string,
  request: PruneProjectConversationsRequest,
) {
  try {
    const result = await pruneProjectConversations(projectId, request);
    await removeConversationTabs(result.prunedConversationIds);
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    const pruned = result.prunedConversationIds.length;
    const skipped = result.skipped.length;
    notify.success(
      pruned === 1
        ? "Cleaned up 1 conversation"
        : `Cleaned up ${pruned} conversations`,
      skipped > 0
        ? {
            description:
              skipped === 1
                ? "Skipped 1 active conversation"
                : `Skipped ${skipped} active conversations`,
          }
        : {},
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not clean up conversations", { description: message });
  }
}

async function openPendingConversationForProject(
  project: ProjectRecord,
  initialMode?: AgentRecord["mode"],
): Promise<void> {
  workspaceState.error = undefined;
  workspaceState.projectPickerOpen = false;
  await selectProject(project.id, { deferTabActivation: true });
  openPendingConversation(project, initialMode);
}

export async function createConversationForDirectory(
  dir: string,
  initialMode?: AgentRecord["mode"],
) {
  workspaceState.error = undefined;
  try {
    const project = await createProject(dir);
    workspaceState.projects = [
      project,
      ...workspaceState.projects.filter(
        (candidate) => candidate.id !== project.id,
      ),
    ];
    await openPendingConversationForProject(project, initialMode);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not open project", { description: message });
  }
}
