import { SvelteSet } from "svelte/reactivity";
import { modelKey } from "@nervekit/workbench-ui/core/utils/model";
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
  getTaskLogs,
  getWorkspaceSnapshot,
  openProjectInEditor,
  type ProjectEditor,
  type PruneProjectConversationsRequest,
  pruneProjectConversations,
} from "$lib/api";
import { queryClient, queryKeys } from "$lib/core/query";
import {
  openPendingConversation,
  removeConversationTabs,
} from "$lib/features/conversations/state/conversation-flow.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { mergeAgentsByUpdatedAt } from "./agent-freshness";
export async function loadWorkspaceState() {
  const snapshot = await queryClient.fetchQuery({
    queryKey: queryKeys.workspace,
    queryFn: getWorkspaceSnapshot,
  });
  const agents = mergeAgentsByUpdatedAt(
    snapshot.snapshot.agents,
    workspaceState.agents,
  );
  workspaceState.projects = snapshot.snapshot.projects;
  workspaceState.conversations = snapshot.snapshot.conversations;
  workspaceState.agents = agents;
  taskState.tasks = snapshot.snapshot.tasks;
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
  taskState.selectedTaskId = taskState.selectedTaskId ?? taskState.tasks[0]?.id;
  if (taskState.selectedTaskId) {
    taskState.taskLogs = await getTaskLogs(taskState.selectedTaskId);
  }
  return snapshot.cursor;
}

function syncSelectedAgentConfig(
  agents: AgentRecord[],
  conversations: ConversationRecord[],
): void {
  const activeAgent = selection.agentId
    ? agents.find((agent) => agent.id === selection.agentId)
    : undefined;
  if (activeAgent) {
    if (activeAgent.model)
      conversationState.selectedModelKey = modelKey(activeAgent.model);
    conversationState.selectedThinkingLevel = activeAgent.thinkingLevel;
    conversationState.selectedMode = activeAgent.mode;
    conversationState.selectedPermissionLevel = activeAgent.permissionLevel;
    conversationState.selectedApprovalPolicy = activeAgent.approvalPolicy;
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

export function newConversation() {
  const activeProject = workspaceState.projects.find(
    (project) => project.id === selection.projectId,
  );
  if (!activeProject) {
    workspaceState.projectPickerOpen = true;
    return;
  }
  void createConversationForDirectory(activeProject.dir);
}

export function newConversationInProject(projectDir: string) {
  void createConversationForDirectory(projectDir);
}

export async function deleteProjectAndRefresh(projectId: string) {
  try {
    const conversationIds = workspaceState.conversations
      .filter((conversation) => conversation.projectId === projectId)
      .map((conversation) => conversation.id);
    await deleteProject(projectId);
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

export async function createConversationForDirectory(dir: string) {
  workspaceState.error = undefined;
  try {
    const project = await createProject(dir);
    workspaceState.projects = [
      project,
      ...workspaceState.projects.filter(
        (candidate) => candidate.id !== project.id,
      ),
    ];
    workspaceState.projectPickerOpen = false;
    openPendingConversation(project);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not open project", { description: message });
  }
}
