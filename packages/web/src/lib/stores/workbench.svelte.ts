import { toast } from "svelte-sonner";
import {
  type AgentRecord,
  type ApprovalWithToolCall,
  type AuthProviderMetadata,
  apiGet,
  apiPost,
  type ClientConfig,
  type CompletionItem,
  compactSession,
  deleteProject,
  deleteSession,
  type EventEnvelope,
  getAuthProviders,
  getClientConfig,
  getFileCompletions,
  getModels,
  getPendingApprovals,
  getProcessLogs,
  getSessionMessages,
  getSessionTree,
  getSettings,
  getSlashCompletions,
  getWorkspaceSnapshot,
  type ModelInfo,
  type ModelSelection,
  type ProcessLogQueryResponse,
  type ProcessRecord,
  type ProjectRecord,
  restartProcess,
  type SessionEntry,
  type SessionRecord,
  type SessionTreeNode,
  type Settings,
  type StatusResponse,
  stopProcess,
  updateAgentConfig,
  updateSettings,
} from "../api";
import { queryClient, queryKeys } from "../query";
import type { ThemePreference } from "../state/app-state.svelte";
import {
  applyTheme,
  composerDraft,
  loadThemePreference,
  resetSelection,
  selection,
} from "../state/app-state.svelte";
import { modelKey, parseModelKey, usableModelOptions } from "../utils/model";

export type TranscriptItem = {
  id?: string;
  role: "user" | "assistant" | "system";
  kind?: SessionEntry["kind"];
  text: string;
};

export const workbenchState = $state({
  status: undefined as StatusResponse | undefined,
  config: undefined as ClientConfig | undefined,
  connection: "connecting",
  error: undefined as string | undefined,
  sending: false,
  projects: [] as ProjectRecord[],
  sessions: [] as SessionRecord[],
  agents: [] as AgentRecord[],
  treeNodes: [] as SessionTreeNode[],
  approvals: [] as ApprovalWithToolCall[],
  processes: [] as ProcessRecord[],
  selectedProcessId: undefined as string | undefined,
  processLogs: undefined as ProcessLogQueryResponse | undefined,
  transcript: [] as TranscriptItem[],
  streamingText: "",
  slashCompletions: [] as CompletionItem[],
  models: [] as ModelInfo[],
  selectedModelKey: "nerve-faux:faux-fast",
  selectedMode: "coding" as AgentRecord["mode"],
  selectedPermissionLevel: "supervised" as AgentRecord["permissionLevel"],
  projectPickerOpen: false,
  settingsDraft: undefined as Settings | undefined,
  authProviders: [] as AuthProviderMetadata[],
  settingsMessage: undefined as string | undefined,
});

let socket: WebSocket | undefined;
let navigateToSettings: (() => void) | undefined;

export const status = $derived(workbenchState.status);
export const connection = $derived(workbenchState.connection);
export const error = $derived(workbenchState.error);
export const sending = $derived(workbenchState.sending);
export const projects = $derived(workbenchState.projects);
export const sessions = $derived(workbenchState.sessions);
export const agents = $derived(workbenchState.agents);
export const approvals = $derived(workbenchState.approvals);
export const processes = $derived(workbenchState.processes);
export const treeNodes = $derived(workbenchState.treeNodes);
export const processLogs = $derived(workbenchState.processLogs);
export const transcript = $derived(workbenchState.transcript);
export const streamingText = $derived(workbenchState.streamingText);
export const slashCompletions = $derived(workbenchState.slashCompletions);
export const selectedModelKey = $derived(workbenchState.selectedModelKey);
export const selectedMode = $derived(workbenchState.selectedMode);
export const selectedPermissionLevel = $derived(
  workbenchState.selectedPermissionLevel,
);
export const settingsDraft = $derived(workbenchState.settingsDraft);
export const authProviders = $derived(workbenchState.authProviders);
export const settingsMessage = $derived(workbenchState.settingsMessage);

export const activeProject = $derived(
  workbenchState.projects.find((project) => project.id === selection.projectId),
);
export const activeSession = $derived(
  workbenchState.sessions.find((session) => session.id === selection.sessionId),
);
export const activeAgent = $derived(
  workbenchState.agents.find((agent) => agent.id === selection.agentId),
);
export const live = $derived(workbenchState.connection === "live");
export const branchDepth = $derived(workbenchState.treeNodes.length);
export const pendingApprovalCount = $derived(workbenchState.approvals.length);
export const selectedProcess = $derived(
  workbenchState.processes.find(
    (process) => process.id === workbenchState.selectedProcessId,
  ),
);
export const sessionAgents = $derived(
  workbenchState.agents.filter(
    (agent) => agent.sessionId === selection.sessionId,
  ),
);
export const usableModels = $derived(
  usableModelOptions(workbenchState.models, workbenchState.authProviders),
);

export function setSettingsNavigation(callback: () => void) {
  navigateToSettings = callback;
}

function entriesToTranscript(entries: SessionEntry[]): TranscriptItem[] {
  return entries
    .filter(
      (entry) =>
        entry.role === "user" ||
        entry.role === "assistant" ||
        entry.kind !== "message",
    )
    .map((entry) => ({
      id: entry.id,
      role: entry.role,
      kind: entry.kind,
      text: entry.text,
    }));
}

function currentActiveAgent(): AgentRecord | undefined {
  return workbenchState.agents.find((agent) => agent.id === selection.agentId);
}

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

export async function loadSettingsPanel() {
  const [settings, modelList, auth] = await Promise.all([
    getSettings(),
    getModels(),
    getAuthProviders(),
  ]);
  workbenchState.settingsDraft = settings;
  workbenchState.models = modelList;
  workbenchState.authProviders = auth;
  workbenchState.selectedMode =
    currentActiveAgent()?.mode ?? settings.defaultMode;
  workbenchState.selectedPermissionLevel =
    currentActiveAgent()?.permissionLevel ?? settings.defaultPermissionLevel;
  const usable = usableModelOptions(modelList, auth);
  const activeModel = currentActiveAgent()?.model;
  if (
    activeModel &&
    usable.some((model) => modelKey(model) === modelKey(activeModel))
  ) {
    workbenchState.selectedModelKey = modelKey(activeModel);
  } else if (
    !usable.some((model) => modelKey(model) === workbenchState.selectedModelKey)
  ) {
    workbenchState.selectedModelKey =
      usable.length > 0 ? modelKey(usable[0]) : "";
  }
}

export function selectedModel(): ModelSelection | undefined {
  return parseModelKey(workbenchState.selectedModelKey);
}

export async function saveSettings() {
  if (!workbenchState.settingsDraft) return;
  workbenchState.settingsMessage = undefined;
  try {
    workbenchState.settingsDraft = await updateSettings(
      workbenchState.settingsDraft,
    );
    workbenchState.settingsMessage =
      "Settings saved. Server host/port changes apply after daemon restart.";
    toast.success("Settings saved", {
      description: "Host/port changes apply after daemon restart.",
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workbenchState.settingsMessage = message;
    toast.error("Could not save settings", { description: message });
  }
}

export async function setComposerModel(key: string) {
  workbenchState.selectedModelKey = key;
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, {
    model: selectedModel() ?? null,
  });
  workbenchState.agents = workbenchState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
}

export async function setComposerMode(mode: AgentRecord["mode"]) {
  workbenchState.selectedMode = mode;
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, { mode });
  workbenchState.agents = workbenchState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
}

export async function setComposerPermission(
  permissionLevel: AgentRecord["permissionLevel"],
) {
  workbenchState.selectedPermissionLevel = permissionLevel;
  if (!selection.agentId) return;
  const agent = await updateAgentConfig(selection.agentId, { permissionLevel });
  workbenchState.agents = workbenchState.agents.map((candidate) =>
    candidate.id === agent.id ? agent : candidate,
  );
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

export async function openSession(sessionId: string) {
  const session =
    workbenchState.sessions.find((candidate) => candidate.id === sessionId) ??
    (await apiGet<{ session: SessionRecord }>(`/api/sessions/${sessionId}`))
      .session;
  selection.sessionId = session.id;
  selection.projectId = session.projectId;
  selection.agentId =
    session.activeAgentId ??
    workbenchState.agents.find((agent) => agent.sessionId === session.id)?.id;
  selection.entryId = session.activeEntryId;
  const project =
    workbenchState.projects.find(
      (candidate) => candidate.id === session.projectId,
    ) ??
    (
      await apiGet<{ project: ProjectRecord }>(
        `/api/projects/${session.projectId}`,
      )
    ).project;
  composerDraft.projectDir = project.dir;
  const sessionAgent = workbenchState.agents.find(
    (agent) => agent.id === selection.agentId,
  );
  if (sessionAgent?.model)
    workbenchState.selectedModelKey = modelKey(sessionAgent.model);
  workbenchState.selectedMode = sessionAgent?.mode ?? session.mode;
  workbenchState.selectedPermissionLevel =
    sessionAgent?.permissionLevel ?? session.permissionLevel;
  const [entries, tree] = await Promise.all([
    getSessionMessages(session.id),
    getSessionTree(session.id),
  ]);
  workbenchState.transcript = entriesToTranscript(entries);
  workbenchState.treeNodes = tree.nodes;
  selection.entryId = tree.activeEntryId;
  workbenchState.streamingText = "";
  workbenchState.sending = false;
}

export async function navigateToEntry(
  entryId: string | undefined,
  summarize = false,
) {
  if (!selection.sessionId) return;
  await apiPost(`/api/sessions/${selection.sessionId}/navigate`, {
    activeEntryId: entryId ?? null,
    summarize,
  });
  await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  await loadWorkspaceState();
  await openSession(selection.sessionId);
}

export async function compactActiveSession() {
  if (!selection.sessionId) return;
  await compactSession(selection.sessionId);
  await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  await loadWorkspaceState();
  await openSession(selection.sessionId);
}

export function clearConversationState() {
  resetSelection();
  workbenchState.transcript = [];
  workbenchState.treeNodes = [];
  workbenchState.streamingText = "";
  workbenchState.sending = false;
  composerDraft.text = "";
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

export async function ensureAgent(): Promise<string> {
  if (selection.agentId) {
    const desired = selectedModel();
    const agent = currentActiveAgent();
    const needsModel =
      desired &&
      modelKey(agent?.model ?? { provider: "", modelId: "" }) !==
        modelKey(desired);
    const needsMode = agent?.mode !== workbenchState.selectedMode;
    const needsPermission =
      agent?.permissionLevel !== workbenchState.selectedPermissionLevel;
    if (needsModel || needsMode || needsPermission) {
      const updated = await updateAgentConfig(selection.agentId, {
        model: desired ?? null,
        mode: workbenchState.selectedMode,
        permissionLevel: workbenchState.selectedPermissionLevel,
      }).catch(() => undefined);
      if (updated) {
        workbenchState.agents = workbenchState.agents.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        );
      }
    }
    return selection.agentId;
  }
  if (selection.projectId && selection.sessionId) {
    const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
      projectId: selection.projectId,
      sessionId: selection.sessionId,
      model: selectedModel(),
      mode: workbenchState.selectedMode,
      permissionLevel: workbenchState.selectedPermissionLevel,
    });
    selection.agentId = agent.id;
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    return agent.id;
  }
  workbenchState.projectPickerOpen = true;
  throw new Error("Select a project directory before starting a conversation.");
}

export async function grantApproval(approvalId: string) {
  await apiPost(`/api/approvals/${approvalId}/grant`, {});
  workbenchState.approvals = await getPendingApprovals();
  toast.success("Approval granted");
}

export async function selectProcess(processId: string) {
  workbenchState.selectedProcessId = processId;
  workbenchState.processLogs = await getProcessLogs(processId);
}

export async function stopSelectedProcess(processId: string) {
  await stopProcess(processId);
  await loadWorkspaceState();
  if (workbenchState.selectedProcessId) {
    workbenchState.processLogs = await getProcessLogs(
      workbenchState.selectedProcessId,
    );
  }
  toast.success("Process stopped");
}

export async function restartSelectedProcess(processId: string) {
  const restarted = await restartProcess(processId);
  workbenchState.selectedProcessId = restarted.id;
  await loadWorkspaceState();
  workbenchState.processLogs = await getProcessLogs(restarted.id);
  toast.success("Process restarted", {
    description: restarted.name ?? restarted.id,
  });
}

export async function refreshProcessLogs() {
  if (!workbenchState.selectedProcessId) return;
  workbenchState.processLogs = await getProcessLogs(
    workbenchState.selectedProcessId,
  );
}

export async function denyApproval(approvalId: string) {
  await apiPost(`/api/approvals/${approvalId}/deny`, {
    note: "Denied from UI.",
  });
  workbenchState.approvals = await getPendingApprovals();
  toast.message("Approval denied");
}

export async function abortActiveRun() {
  if (!selection.agentId) return;
  await apiPost(`/api/agents/${selection.agentId}/abort`, {});
  workbenchState.sending = false;
  workbenchState.streamingText = "";
}

export async function sendPrompt() {
  const text = composerDraft.text.trim();
  if (!text || workbenchState.sending) return;
  if (text === "/abort") {
    composerDraft.text = "";
    await abortActiveRun();
    return;
  }
  if (!selection.projectId || !selection.sessionId) {
    workbenchState.projectPickerOpen = true;
    workbenchState.error =
      "Select a project directory before starting a conversation.";
    return;
  }
  if (
    usableModelOptions(workbenchState.models, workbenchState.authProviders)
      .length === 0
  ) {
    navigateToSettings?.();
    workbenchState.error =
      "Configure a model provider in Settings before prompting.";
    return;
  }
  workbenchState.sending = true;
  workbenchState.error = undefined;
  workbenchState.streamingText = "";
  try {
    const agentId = await ensureAgent();
    workbenchState.transcript = [
      ...workbenchState.transcript,
      { role: "user", text },
    ];
    composerDraft.text = "";
    await apiPost(`/api/agents/${agentId}/prompt`, { text });
  } catch (caught) {
    workbenchState.error =
      caught instanceof Error ? caught.message : String(caught);
    workbenchState.sending = false;
  }
}

export function handleEvent(event: EventEnvelope<Record<string, unknown>>) {
  if (isSelectedAgentStreamEvent(event)) handleSelectedAgentStreamEvent(event);
  if (event.type === "process.log") {
    const processId = String(event.data?.processId ?? "");
    if (processId && processId === workbenchState.selectedProcessId) {
      void getProcessLogs(processId).then((logs) => {
        workbenchState.processLogs = logs;
      });
    }
    return;
  }
  if (shouldRefreshWorkspace(event.type)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    void loadWorkspaceState();
    if (shouldRefreshSettings(event.type)) void loadSettingsPanel();
  }
}

function isSelectedAgentStreamEvent(
  event: EventEnvelope<Record<string, unknown>>,
): boolean {
  if (
    event.type !== "agent.message_delta" &&
    event.type !== "agent.message_complete" &&
    event.type !== "agent.error"
  ) {
    return false;
  }
  const agentId = event.data?.agentId;
  return !agentId || agentId === selection.agentId;
}

function handleSelectedAgentStreamEvent(
  event: EventEnvelope<Record<string, unknown>>,
) {
  if (event.type === "agent.message_delta") {
    workbenchState.streamingText += String(event.data?.delta ?? "");
  }
  if (event.type === "agent.message_complete") {
    const entry = event.data?.entry as
      | { id?: string; text?: string }
      | undefined;
    const text =
      workbenchState.streamingText ||
      entry?.text ||
      String(event.data?.text ?? "");
    if (text) {
      workbenchState.transcript = [
        ...workbenchState.transcript,
        { id: entry?.id, role: "assistant", text },
      ];
    }
    selection.entryId = entry?.id ?? selection.entryId;
    workbenchState.streamingText = "";
    workbenchState.sending = false;
    if (selection.sessionId) void openSession(selection.sessionId);
  }
  if (event.type === "agent.error") {
    workbenchState.error = String(event.data?.message ?? "Agent error");
    workbenchState.sending = false;
  }
}

function shouldRefreshWorkspace(type: string): boolean {
  return (
    type === "session.created" ||
    type === "session.updated" ||
    type === "session.deleted" ||
    type === "session.compacted" ||
    type === "session.branch_summarized" ||
    type === "session.navigated" ||
    type === "project.deleted" ||
    type === "agent.created" ||
    type === "agent.status_changed" ||
    type.startsWith("agent.subagent_") ||
    type === "project.created" ||
    type.startsWith("approval.") ||
    type.startsWith("agent.tool_call") ||
    type.startsWith("process.") ||
    shouldRefreshSettings(type)
  );
}

function shouldRefreshSettings(type: string): boolean {
  return (
    type.startsWith("settings.") ||
    type.startsWith("secrets.") ||
    type.startsWith("auth.")
  );
}

export function setTheme(preference: ThemePreference) {
  applyTheme(preference);
}

export async function initializeWorkbench(): Promise<void> {
  try {
    applyTheme(loadThemePreference());
    workbenchState.config = await getClientConfig();
    workbenchState.status = workbenchState.config.status;
    composerDraft.projectDir = workbenchState.config.status.storage.home;
    await Promise.all([loadWorkspaceState(), loadSlashCommands()]);
    await loadSettingsPanel();
    connectWebsocket(workbenchState.config.wsUrl);
  } catch (caught) {
    workbenchState.error =
      caught instanceof Error ? caught.message : String(caught);
    workbenchState.connection = "error";
  }
}

function connectWebsocket(wsUrl: string) {
  socket?.close();
  socket = new WebSocket(new URL(wsUrl));
  socket.addEventListener("open", () => {
    workbenchState.connection = "live";
  });
  socket.addEventListener("message", (message) => {
    const parsed = JSON.parse(String(message.data)) as EventEnvelope<
      Record<string, unknown>
    >;
    if (parsed.type) handleEvent(parsed);
  });
  socket.addEventListener("close", () => {
    workbenchState.connection = "closed";
  });
  socket.addEventListener("error", () => {
    workbenchState.connection = "error";
  });
}

export function disconnectWorkbench() {
  socket?.close();
  socket = undefined;
}
