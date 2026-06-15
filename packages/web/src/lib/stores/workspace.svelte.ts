import { notify } from "$lib/notifications/notify.svelte";
import {
  type AgentRecord,
  apiPost,
  type CompletionItem,
  type ConversationRecord,
  deleteConversation,
  deleteProject,
  getFileCompletions,
  getPendingApprovals,
  getPendingPlanReviews,
  getPendingUserQuestions,
  getProcessLogs,
  getSlashCompletions,
  getWorkspaceSnapshot,
  type ProjectRecord,
  type PruneProjectConversationsRequest,
  pruneProjectConversations,
} from "../api";
import { queryClient, queryKeys } from "../query";
import { selection } from "../state/app-state.svelte";
import { modelKey } from "../utils/model";
import { mergeAgentsByUpdatedAt } from "./agent-freshness";
import {
  openPendingConversation,
  removeConversationTabs,
} from "./conversation-flow.svelte";
import { workbenchState } from "./workbench/state.svelte";

export async function loadWorkspaceState() {
  const snapshot = await queryClient.fetchQuery({
    queryKey: queryKeys.workspace,
    queryFn: getWorkspaceSnapshot,
  });
  const agents = mergeAgentsByUpdatedAt(snapshot.agents, workbenchState.agents);
  workbenchState.projects = snapshot.projects;
  workbenchState.conversations = snapshot.conversations;
  workbenchState.agents = agents;
  workbenchState.processes = snapshot.processes;
  syncSelectedAgentConfig(agents, snapshot.conversations);
  const conversationIds = new Set(
    snapshot.conversations.map((conversation) => conversation.id),
  );
  const staleOpenTabIds = workbenchState.openConversationTabIds.filter(
    (conversationId) => !conversationIds.has(conversationId),
  );
  if (staleOpenTabIds.length) await removeConversationTabs(staleOpenTabIds);
  workbenchState.selectedProcessId =
    workbenchState.selectedProcessId ?? workbenchState.processes[0]?.id;
  const [approvals, userQuestions, planReviews] = await Promise.all([
    getPendingApprovals(),
    getPendingUserQuestions(),
    getPendingPlanReviews(),
  ]);
  workbenchState.approvals = approvals;
  workbenchState.userQuestions = userQuestions;
  workbenchState.planReviews = planReviews;
  if (workbenchState.selectedProcessId) {
    workbenchState.processLogs = await getProcessLogs(
      workbenchState.selectedProcessId,
    );
  }
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
      workbenchState.selectedModelKey = modelKey(activeAgent.model);
    workbenchState.selectedThinkingLevel = activeAgent.thinkingLevel;
    workbenchState.selectedMode = activeAgent.mode;
    workbenchState.selectedPermissionLevel = activeAgent.permissionLevel;
    return;
  }

  const activeConversation = selection.conversationId
    ? conversations.find(
        (conversation) => conversation.id === selection.conversationId,
      )
    : undefined;
  if (!activeConversation) return;
  workbenchState.selectedMode = activeConversation.mode;
  workbenchState.selectedPermissionLevel = activeConversation.permissionLevel;
}

export async function loadSlashCommands() {
  workbenchState.slashCompletions = await queryClient.fetchQuery({
    queryKey: queryKeys.slashCompletions,
    queryFn: getSlashCompletions,
  });
}

export function exportUrl(kind: "json" | "md" | "html"): string | undefined {
  if (!selection.conversationId) return undefined;
  const suffix = kind === "json" ? "export" : `export.${kind}`;
  return `/api/conversations/${selection.conversationId}/${suffix}`;
}

export function systemPromptUrl(): string | undefined {
  if (!selection.agentId) return undefined;
  return `/api/agents/${selection.agentId}/system-prompt`;
}

export async function completeFiles(query: string): Promise<CompletionItem[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.fileCompletions(selection.projectId, query),
    queryFn: () => getFileCompletions(selection.projectId, query),
    staleTime: 2_000,
  });
}

export function newConversation() {
  const activeProject = workbenchState.projects.find(
    (project) => project.id === selection.projectId,
  );
  if (!activeProject) {
    workbenchState.projectPickerOpen = true;
    return;
  }
  void createConversationForDirectory(activeProject.dir);
}

export function newConversationInProject(projectDir: string) {
  void createConversationForDirectory(projectDir);
}

export async function deleteProjectAndRefresh(projectId: string) {
  try {
    const conversationIds = workbenchState.conversations
      .filter((conversation) => conversation.projectId === projectId)
      .map((conversation) => conversation.id);
    await deleteProject(projectId);
    await removeConversationTabs(conversationIds);
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    notify.success("Project removed");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workbenchState.error = message;
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
    workbenchState.error = message;
    notify.error("Could not remove conversation", { description: message });
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
    workbenchState.error = message;
    notify.error("Could not clean up conversations", { description: message });
  }
}

export async function createConversationForDirectory(dir: string) {
  workbenchState.error = undefined;
  try {
    const { project } = await apiPost<{ project: ProjectRecord }>(
      "/api/projects",
      { dir },
    );
    workbenchState.projects = [
      project,
      ...workbenchState.projects.filter(
        (candidate) => candidate.id !== project.id,
      ),
    ];
    workbenchState.projectPickerOpen = false;
    openPendingConversation(project);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workbenchState.error = message;
    notify.error("Could not open project", { description: message });
  }
}
