import { toast } from "svelte-sonner";
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
} from "../api";
import { queryClient, queryKeys } from "../query";
import { composerDraft, selection } from "../state/app-state.svelte";
import { modelKey } from "../utils/model";
import { selectedModel, selectedThinkingLevel } from "./composer-config.svelte";
import {
  openConversation,
  removeConversationTabs,
} from "./conversation-flow.svelte";
import { workbenchState } from "./workbench/state.svelte";

export async function loadWorkspaceState() {
  const snapshot = await queryClient.fetchQuery({
    queryKey: queryKeys.workspace,
    queryFn: getWorkspaceSnapshot,
  });
  workbenchState.projects = snapshot.projects;
  workbenchState.conversations = snapshot.conversations;
  workbenchState.agents = snapshot.agents;
  workbenchState.processes = snapshot.processes;
  syncSelectedAgentConfig(snapshot.agents, snapshot.conversations);
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

function projectDirKey(dir: string): string {
  return dir.replace(/[\\/]+$/, "") || dir;
}

function isEmptyConversation(conversation: ConversationRecord): boolean {
  return !conversation.activeEntryId;
}

function projectForConversation(
  conversation: ConversationRecord,
): ProjectRecord | undefined {
  return workbenchState.projects.find(
    (project) => project.id === conversation.projectId,
  );
}

function activeEmptyConversation(): ConversationRecord | undefined {
  const active = workbenchState.conversations.find(
    (conversation) => conversation.id === selection.conversationId,
  );
  return active && isEmptyConversation(active) ? active : undefined;
}

function emptyConversationForProjectDir(
  dir: string,
): ConversationRecord | undefined {
  const targetKey = projectDirKey(dir);
  const projectIds = new Set(
    workbenchState.projects
      .filter((project) => projectDirKey(project.dir) === targetKey)
      .map((project) => project.id),
  );
  return workbenchState.conversations.find(
    (conversation) =>
      projectIds.has(conversation.projectId) &&
      isEmptyConversation(conversation),
  );
}

async function handleExistingEmptyConversation(dir: string): Promise<boolean> {
  const targetKey = projectDirKey(dir);
  const active = activeEmptyConversation();
  const activeProject = active ? projectForConversation(active) : undefined;
  if (
    active &&
    activeProject &&
    projectDirKey(activeProject.dir) !== targetKey
  ) {
    toast.message("Use or delete the empty conversation first", {
      description:
        "The active conversation has no messages yet, so Nerve will not create another empty conversation.",
    });
    return true;
  }

  const empty = emptyConversationForProjectDir(dir);
  if (!empty) return false;

  const project = projectForConversation(empty);
  await openConversation(empty.id);
  workbenchState.projectPickerOpen = false;
  toast.message("Opened existing empty conversation", {
    description: project?.dir,
  });
  return true;
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
    toast.success("Project removed");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workbenchState.error = message;
    toast.error("Could not remove project", { description: message });
  }
}

export async function deleteConversationAndRefresh(conversationId: string) {
  try {
    await deleteConversation(conversationId);
    await removeConversationTabs([conversationId]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    toast.success("Conversation removed");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workbenchState.error = message;
    toast.error("Could not remove conversation", { description: message });
  }
}

export async function createConversationForDirectory(dir: string) {
  workbenchState.error = undefined;
  try {
    if (await handleExistingEmptyConversation(dir)) return;
    const { project } = await apiPost<{ project: ProjectRecord }>(
      "/api/projects",
      {
        dir,
      },
    );
    const { conversation } = await apiPost<{
      conversation: ConversationRecord;
    }>("/api/conversations", {
      projectId: project.id,
      title: "New Conversation",
      mode: workbenchState.selectedMode,
      permissionLevel: workbenchState.selectedPermissionLevel,
    });
    const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
      projectId: project.id,
      conversationId: conversation.id,
      model: selectedModel(),
      thinkingLevel: selectedThinkingLevel(),
      mode: workbenchState.selectedMode,
      permissionLevel: workbenchState.selectedPermissionLevel,
    });
    selection.projectId = project.id;
    selection.conversationId = conversation.id;
    selection.entryId = conversation.activeEntryId;
    selection.agentId = agent.id;
    composerDraft.projectDir = project.dir;
    workbenchState.projectPickerOpen = false;
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    await openConversation(conversation.id);
    toast.success("Project opened", { description: project.dir });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workbenchState.error = message;
    toast.error("Could not open project", { description: message });
  }
}
