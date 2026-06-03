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
import { openSession, removeConversationTabs } from "./session-flow.svelte";
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
  const sessionIds = new Set(snapshot.sessions.map((session) => session.id));
  const staleOpenTabIds = workbenchState.openConversationTabIds.filter(
    (sessionId) => !sessionIds.has(sessionId),
  );
  if (staleOpenTabIds.length) await removeConversationTabs(staleOpenTabIds);
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
  workbenchState.projectPickerOpen = true;
}

export function newConversationInProject(projectDir: string) {
  void createConversationForDirectory(projectDir);
}

function projectDirKey(dir: string): string {
  return dir.replace(/[\\/]+$/, "") || dir;
}

function isEmptySession(session: SessionRecord): boolean {
  return !session.activeEntryId;
}

function projectForSession(session: SessionRecord): ProjectRecord | undefined {
  return workbenchState.projects.find(
    (project) => project.id === session.projectId,
  );
}

function activeEmptySession(): SessionRecord | undefined {
  const active = workbenchState.sessions.find(
    (session) => session.id === selection.sessionId,
  );
  return active && isEmptySession(active) ? active : undefined;
}

function emptySessionForProjectDir(dir: string): SessionRecord | undefined {
  const targetKey = projectDirKey(dir);
  const projectIds = new Set(
    workbenchState.projects
      .filter((project) => projectDirKey(project.dir) === targetKey)
      .map((project) => project.id),
  );
  return workbenchState.sessions.find(
    (session) => projectIds.has(session.projectId) && isEmptySession(session),
  );
}

async function handleExistingEmptyConversation(dir: string): Promise<boolean> {
  const targetKey = projectDirKey(dir);
  const active = activeEmptySession();
  const activeProject = active ? projectForSession(active) : undefined;
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

  const empty = emptySessionForProjectDir(dir);
  if (!empty) return false;

  const project = projectForSession(empty);
  await openSession(empty.id);
  workbenchState.projectPickerOpen = false;
  toast.message("Opened existing empty conversation", {
    description: project?.dir,
  });
  return true;
}

export async function deleteProjectAndRefresh(projectId: string) {
  try {
    const sessionIds = workbenchState.sessions
      .filter((session) => session.projectId === projectId)
      .map((session) => session.id);
    await deleteProject(projectId);
    await removeConversationTabs(sessionIds);
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
    await removeConversationTabs([sessionId]);
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
