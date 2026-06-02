import { toast } from "svelte-sonner";
import {
  type AgentRecord,
  apiPost,
  type CompletionItem,
  deleteProject,
  deleteSession,
  getFileCompletions,
  getPendingApprovals,
  getProcessLogs,
  getSlashCompletions,
  getWorkspaceSnapshot,
  type ProjectRecord,
  type SessionRecord,
} from "../api";
import { queryClient, queryKeys } from "../query";
import { composerDraft, selection } from "../state/app-state.svelte";
import { selectedModel } from "./composer-config.svelte";
import { clearConversationState, openSession } from "./session-flow.svelte";
import { workbenchState } from "./workbench/state.svelte";

export async function loadWorkspaceState() {
  const snapshot = await queryClient.fetchQuery({
    queryKey: queryKeys.workspace,
    queryFn: getWorkspaceSnapshot,
  });
  workbenchState.projects = snapshot.projects;
  workbenchState.sessions = snapshot.sessions;
  workbenchState.agents = snapshot.agents;
  workbenchState.processes = snapshot.processes;
  workbenchState.selectedProcessId =
    workbenchState.selectedProcessId ?? workbenchState.processes[0]?.id;
  workbenchState.approvals = await getPendingApprovals();
  if (workbenchState.selectedProcessId) {
    workbenchState.processLogs = await getProcessLogs(
      workbenchState.selectedProcessId,
    );
  }
}

export async function loadSlashCommands() {
  workbenchState.slashCompletions = await queryClient.fetchQuery({
    queryKey: queryKeys.slashCompletions,
    queryFn: getSlashCompletions,
  });
}

export function exportUrl(kind: "json" | "md" | "html"): string | undefined {
  if (!selection.sessionId) return undefined;
  const suffix = kind === "json" ? "export" : `export.${kind}`;
  return `/api/sessions/${selection.sessionId}/${suffix}`;
}

export async function completeFiles(query: string): Promise<CompletionItem[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.fileCompletions(selection.projectId, query),
    queryFn: () => getFileCompletions(selection.projectId, query),
    staleTime: 2_000,
  });
}

export function newSession() {
  clearConversationState();
  workbenchState.projectPickerOpen = true;
}

export function newConversationInProject(projectDir: string) {
  clearConversationState();
  void createConversationForDirectory(projectDir);
}

export async function deleteProjectAndRefresh(projectId: string) {
  try {
    await deleteProject(projectId);
    if (selection.projectId === projectId) clearConversationState();
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    toast.success("Project removed");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workbenchState.error = message;
    toast.error("Could not remove project", { description: message });
  }
}

export async function deleteSessionAndRefresh(sessionId: string) {
  try {
    await deleteSession(sessionId);
    if (selection.sessionId === sessionId) clearConversationState();
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
    const { project } = await apiPost<{ project: ProjectRecord }>(
      "/api/projects",
      {
        dir,
      },
    );
    const { session } = await apiPost<{ session: SessionRecord }>(
      "/api/sessions",
      {
        projectId: project.id,
        title: project.name,
        mode: workbenchState.selectedMode,
        permissionLevel: workbenchState.selectedPermissionLevel,
      },
    );
    const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
      projectId: project.id,
      sessionId: session.id,
      model: selectedModel(),
      mode: workbenchState.selectedMode,
      permissionLevel: workbenchState.selectedPermissionLevel,
    });
    selection.projectId = project.id;
    selection.sessionId = session.id;
    selection.entryId = session.activeEntryId;
    selection.agentId = agent.id;
    composerDraft.projectDir = project.dir;
    workbenchState.transcript = [];
    workbenchState.treeNodes = [];
    workbenchState.streamingText = "";
    workbenchState.sending = false;
    workbenchState.projectPickerOpen = false;
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    await openSession(session.id);
    toast.success("Project opened", { description: project.dir });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workbenchState.error = message;
    toast.error("Could not open project", { description: message });
  }
}
